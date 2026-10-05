<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  state, upsertCustom, deleteCustom, selectTool, openEditor, closeEditor,
} from '../store.js';
import { ui, ed, toast, dlg, appConfirm } from '../ui.js';
import SymbolArt from './SymbolArt.vue';

const edCanvas = ref(null);
let edPainting = false;

const SHAPE_NAMES = { line: '直线', circle: '圆', rect: '矩形', curve: '曲线' };

const gridPath = computed(() => {
  let gp = '';
  for (let c = 0; c <= ed.w; c++) gp += `M${c},0 V${ed.h} `;
  for (let r = 0; r <= ed.h; r++) gp += `M0,${r} H${ed.w} `;
  return gp;
});
/* 最长边放大到 320px；细长符号（如 1×6）最细边不小于 48px，保证可绘制 */
const canvasU = computed(() => {
  const m = Math.max(ed.w, ed.h), n = Math.min(ed.w, ed.h);
  return Math.max(320 / m, 48 / n);
});
const canvasBox = computed(() => ({
  width: (ed.w * canvasU.value) + 'px',
  height: (ed.h * canvasU.value) + 'px',
}));

function shapeInBounds(sh, w, h) {
  if (sh.type === 'line') return [sh.x1, sh.x2].every(v => v >= 0 && v <= w) && [sh.y1, sh.y2].every(v => v >= 0 && v <= h);
  if (sh.type === 'circle') return sh.cx + sh.r <= w && sh.cy + sh.r <= h && sh.cx - sh.r >= 0 && sh.cy - sh.r >= 0;
  if (sh.type === 'rect') return sh.x >= 0 && sh.y >= 0 && sh.x + sh.rw <= w && sh.y + sh.rh <= h;
  if (sh.type === 'curve') return [sh.x1, sh.x2, sh.cx1, sh.cx2].every(v => v >= 0 && v <= w) &&
    [sh.y1, sh.y2, sh.cy1, sh.cy2].every(v => v >= 0 && v <= h);
  return true;
}

// 宽高实时生效：输入即更新画布，自动 clamp，越界图元丢弃
function applySize() {
  ed.w = Math.min(8, Math.max(1, +edWValue() || ed.w));
  ed.h = Math.min(8, Math.max(1, +edHValue() || ed.h));
  ed.shapes = ed.shapes.filter(sh => shapeInBounds(sh, ed.w, ed.h));
}
// 不使用 v-model：保留对输入框值与光标位置的完全控制
function edWValue() { return document.getElementById('edW').value; }
function edHValue() { return document.getElementById('edH').value; }

async function onDeleteExisting(id) {
  const ok = await appConfirm({
    title: '删除自定义符号',
    message: '删除这个自定义符号？\n图上已放置的也会一并删除。',
    okText: '删除', danger: true,
  });
  if (ok) deleteCustom(id);
}

/* 图元镜像：x → 宽-x / y → 高-y（0.25 格步进坐标精确换算，画对称符号不用画两遍）。
   画到一半的曲线（ed.drawing）不参与，先让它画完 */
function flipShapes(dir) {
  if (!ed.shapes.length) return;
  const mx = sh => { // 水平：所有 x 类坐标镜像
    if (sh.type === 'line') { sh.x1 = ed.w - sh.x1; sh.x2 = ed.w - sh.x2; }
    else if (sh.type === 'circle') sh.cx = ed.w - sh.cx;
    else if (sh.type === 'rect') sh.x = ed.w - sh.x - sh.rw;
    else if (sh.type === 'curve') { sh.x1 = ed.w - sh.x1; sh.x2 = ed.w - sh.x2; sh.cx1 = ed.w - sh.cx1; sh.cx2 = ed.w - sh.cx2; }
  };
  const my = sh => { // 垂直：所有 y 类坐标镜像
    if (sh.type === 'line') { sh.y1 = ed.h - sh.y1; sh.y2 = ed.h - sh.y2; }
    else if (sh.type === 'circle') sh.cy = ed.h - sh.cy;
    else if (sh.type === 'rect') sh.y = ed.h - sh.y - sh.rh;
    else if (sh.type === 'curve') { sh.y1 = ed.h - sh.y1; sh.y2 = ed.h - sh.y2; sh.cy1 = ed.h - sh.cy1; sh.cy2 = ed.h - sh.cy2; }
  };
  const fn = dir === 'h' ? mx : my;
  ed.shapes = ed.shapes.map(sh => { const c = { ...sh }; fn(c); return c; });
  ed.drawing = null; // 正在画的半截图元直接取消，避免与翻转后的画布错位
}

function onSave() {
  ed.name = document.getElementById('edName').value.trim();
  if (!ed.name) return toast('请填写符号名称', 'warn');
  if (!ed.shapes.length) return toast('请至少画一个图元', 'warn');
  const id = upsertCustom({ id: ed.id || undefined, name: ed.name, w: ed.w, h: ed.h, shapes: ed.shapes });
  selectTool(id);
  closeEditor();
}

/* ------- 画布指针 → 符号单位坐标（吸附 1/4 格） ------- */
function edPoint(e) {
  const pt = edCanvas.value.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(edCanvas.value.getScreenCTM().inverse());
  const clamp = (v, max) => Math.min(max, Math.max(0, v));
  return {
    x: clamp(Math.round(p.x * 4) / 4, ed.w),
    y: clamp(Math.round(p.y * 4) / 4, ed.h),
  };
}
/* 曲线路径：三次贝塞尔 M 起点 C 控1 控2 终点 */
const curveD = d => `M${d.x1} ${d.y1} C${d.cx1} ${d.cy1} ${d.cx2} ${d.cy2} ${d.x2} ${d.y2}`;

/* 曲线交互三步：① 按住拖出起止线（chord）② 单击定弯点1（c1）③ 再单击定弯点2（c2）并提交 */
function onCanvasDown(e) {
  if (e.button !== 0) return; // 右键用于取消未完成的曲线
  e.preventDefault();
  const p = edPoint(e);
  const base = { color: ed.color, w: ed.sw };
  const d = ed.drawing;
  if (d && d.type === 'curve') {
    if (d.phase === 'c1') { d.cx1 = p.x; d.cy1 = p.y; d.phase = 'c2'; return; }
    if (d.phase === 'c2') {
      d.cx2 = p.x; d.cy2 = p.y;
      ed.shapes.push({ type: 'curve', x1: d.x1, y1: d.y1, cx1: d.cx1, cy1: d.cy1,
        cx2: d.cx2, cy2: d.cy2, x2: d.x2, y2: d.y2, color: d.color, w: d.w });
      ed.drawing = null;
      return;
    }
  }
  if (ed.cur === 'line') ed.drawing = { type: 'line', x1: p.x, y1: p.y, x2: p.x, y2: p.y, ...base };
  else if (ed.cur === 'circle') ed.drawing = { type: 'circle', cx: p.x, cy: p.y, r: 0, ...base };
  else if (ed.cur === 'rect') ed.drawing = { type: 'rect', x0: p.x, y0: p.y, x1: p.x, y1: p.y, ...base };
  else if (ed.cur === 'curve') ed.drawing = { type: 'curve', phase: 'chord',
    x1: p.x, y1: p.y, x2: p.x, y2: p.y, cx1: p.x, cy1: p.y, cx2: p.x, cy2: p.y, ...base };
  edPainting = true;
  try { edCanvas.value.setPointerCapture(e.pointerId); } catch (err) {} // 拖出画布外也持续跟踪
}
function onCanvasMove(e) {
  const p = edPoint(e), d = ed.drawing;
  if (!d) return;
  if (d.type === 'curve') {
    if (!edPainting && d.phase === 'chord') return; // 尚未按下，忽略
    if (d.phase === 'chord') { d.x2 = p.x; d.y2 = p.y; }
    else if (d.phase === 'c1') {
      d.cx1 = p.x; d.cy1 = p.y;
      d.cx2 = d.x1 + (d.x2 - d.x1) * 2 / 3; d.cy2 = d.y1 + (d.y2 - d.y1) * 2 / 3;
    } else if (d.phase === 'c2') { d.cx2 = p.x; d.cy2 = p.y; }
    return;
  }
  if (!edPainting) return;
  if (d.type === 'line') { d.x2 = p.x; d.y2 = p.y; }
  if (d.type === 'circle') d.r = Math.max(Math.abs(p.x - d.cx), Math.abs(p.y - d.cy));
  if (d.type === 'rect') { d.x1 = p.x; d.y1 = p.y; }
}
function onPointerUp() {
  if (!ui.editorOpen) { edPainting = false; return; }
  const d = ed.drawing;
  // 曲线：chord 拖完转 c1 阶段；c1/c2 阶段的 pointerup 不清 drawing（等下一次单击）
  if (d && d.type === 'curve') {
    if (edPainting && d.phase === 'chord') {
      if (Math.abs(d.x2 - d.x1) > 0.05 || Math.abs(d.y2 - d.y1) > 0.05) d.phase = 'c1';
      else ed.drawing = null; // 空拖丢弃
    }
    edPainting = false;
    return;
  }
  // 只在真正提交了一个图元时才追加；空拖不改动 shapes
  let committed = null;
  if (edPainting && d) {
    if (d.type === 'line' && (Math.abs(d.x2 - d.x1) > 0.05 || Math.abs(d.y2 - d.y1) > 0.05)) committed = d;
    else if (d.type === 'circle' && d.r > 0.05) committed = d;
    else if (d.type === 'rect') {
      const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
      const rw = Math.abs(d.x1 - d.x0), rh = Math.abs(d.y1 - d.y0);
      if (rw > 0.05 && rh > 0.05)
        committed = { type: 'rect', x, y, rw, rh, color: d.color, w: d.w };
    }
    if (committed) ed.shapes.push(committed);
  }
  ed.drawing = null; edPainting = false;
}
/* Esc：应用内对话框优先（dlg.open 让路）；正在画的图元先取消，再按才关弹窗 */
function onKey(e) {
  if (e.key !== 'Escape' || !ui.editorOpen || dlg.open) return;
  if (ed.drawing) { ed.drawing = null; return; }
  closeEditor();
}
onMounted(() => {
  window.addEventListener('pointerup', onPointerUp);
  document.addEventListener('keydown', onKey);
});
onUnmounted(() => {
  window.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div v-if="ui.editorOpen" id="modal"
    class="fixed inset-0 bg-black/30 items-center justify-center open" style="z-index:50;display:flex"
    @mousedown.self="closeEditor()">
    <div class="modal-shell w-[780px] max-h-[92vh] overflow-auto">
      <div class="modal-head">
        <h2 class="modal-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>
            <path d="m15 5 4 4"/>
          </svg>
          自定义符号
        </h2>
        <button id="edClose" class="modal-x" title="关闭" @click="closeEditor">×</button>
      </div>
      <div class="p-4 pt-3">

      <div class="text-xs text-gray-600 mb-1">已有符号</div>
      <div id="edList" class="flex flex-wrap gap-2 mb-4">
        <div v-for="s in state.customSymbols" :key="s.id"
          class="flex items-center gap-1 border rounded px-1 py-0.5 bg-white">
          <svg :viewBox="`0 0 ${s.w} ${s.h}`" style="width:28px;height:28px">
            <SymbolArt :sym="s"/>
          </svg>
          <span>{{ s.name }}</span>
          <button class="text-rose-600 ed-edit" :data-id="s.id"
            @click="openEditor(s.id)">编辑</button>
          <button class="text-red-500 ed-del" :data-id="s.id"
            @click="onDeleteExisting(s.id)">删除</button>
        </div>
        <span v-if="!state.customSymbols.length" class="text-gray-400">还没有自定义符号</span>
      </div>

      <div class="flex gap-4">
        <div>
          <svg id="edCanvas" ref="edCanvas" class="border border-gray-300 bg-white"
            style="cursor:crosshair"
            :viewBox="`-0.06 -0.06 ${ed.w + 0.12} ${ed.h + 0.12}`"
            :style="canvasBox"
            @pointerdown="onCanvasDown"
            @pointermove="onCanvasMove"
            @contextmenu.prevent="ed.drawing = null">
            <path :d="gridPath" stroke="var(--acc-border)" stroke-width="0.02" fill="none"/>
            <rect x="0" y="0" :width="ed.w" :height="ed.h" fill="none" stroke="var(--acc-ink-3)" stroke-width="0.04"/>
            <g id="edShapesLayer">
              <template v-for="(sh, i) in ed.shapes" :key="'s' + i">
                <line v-if="sh.type === 'line'"
                  :x1="sh.x1" :y1="sh.y1" :x2="sh.x2" :y2="sh.y2"
                  :stroke="sh.color" :stroke-width="sh.w" stroke-linecap="round"/>
                <circle v-else-if="sh.type === 'circle'"
                  :cx="sh.cx" :cy="sh.cy" :r="sh.r" fill="none"
                  :stroke="sh.color" :stroke-width="sh.w"/>
                <rect v-else-if="sh.type === 'rect'"
                  :x="sh.x" :y="sh.y" :width="sh.rw" :height="sh.rh" fill="none"
                  :stroke="sh.color" :stroke-width="sh.w"/>
                <path v-else-if="sh.type === 'curve'"
                  :d="curveD(sh)" fill="none"
                  :stroke="sh.color" :stroke-width="sh.w" stroke-linecap="round"/>
              </template>
            </g>
            <template v-if="ed.drawing">
              <line v-if="ed.drawing.type === 'line'"
                :x1="ed.drawing.x1" :y1="ed.drawing.y1" :x2="ed.drawing.x2" :y2="ed.drawing.y2"
                :stroke="ed.drawing.color" :stroke-width="ed.drawing.w" stroke-linecap="round"/>
              <circle v-else-if="ed.drawing.type === 'circle'"
                :cx="ed.drawing.cx" :cy="ed.drawing.cy" :r="ed.drawing.r" fill="none"
                :stroke="ed.drawing.color" :stroke-width="ed.drawing.w"/>
              <rect v-else-if="ed.drawing.type === 'rect'"
                :x="Math.min(ed.drawing.x0, ed.drawing.x1)" :y="Math.min(ed.drawing.y0, ed.drawing.y1)"
                :width="Math.abs(ed.drawing.x1 - ed.drawing.x0)"
                :height="Math.abs(ed.drawing.y1 - ed.drawing.y0)"
                fill="none" :stroke="ed.drawing.color" :stroke-width="ed.drawing.w"/>
              <path v-else-if="ed.drawing.type === 'curve'"
                :d="curveD(ed.drawing)" fill="none"
                :stroke="ed.drawing.color" :stroke-width="ed.drawing.w" stroke-linecap="round"/>
            </template>
          </svg>
          <p class="text-[11px] text-gray-400 mt-1 w-[320px]">拖动画图元（吸附 1/4 格）；曲线：先拖出起止线，再点两下定弯曲点，右键取消未完成的曲线</p>
        </div>
        <div class="flex-1 text-xs space-y-2">
          <div class="flex items-center gap-1">
            <span class="w-14">名称</span>
            <input id="edName" class="flex-1 border rounded px-1 py-0.5" placeholder="例如：6目麻花"
              :value="ed.name" @input="ed.name = $event.target.value">
          </div>
          <div class="flex items-center gap-1">
            <span class="w-14">宽（格）</span>
            <input id="edW" type="number" min="1" max="8" class="w-16 border rounded px-1 py-0.5"
              :value="ed.w" @input="applySize">
            <span>高（格）</span>
            <input id="edH" type="number" min="1" max="8" class="w-16 border rounded px-1 py-0.5"
              :value="ed.h" @input="applySize">
            <button id="edResize" class="border rounded px-2 py-0.5 bg-white"
              @click="applySize">改尺寸</button>
          </div>
          <div class="flex items-center gap-2">
            <span class="w-14">图元</span>
            <button v-for="t in ['line','circle','rect','curve']" :key="t"
              class="ed-shape-btn border rounded px-2 py-0.5 bg-white"
              :class="{ selected: ed.cur === t }" :data-shape="t"
              @click="ed.cur = t; ed.drawing = null">{{ SHAPE_NAMES[t] }}</button>
          </div>
          <div class="flex items-center gap-2">
            <span class="w-14">颜色</span>
            <input id="edColor" type="color" class="w-10 h-6 border rounded"
              :value="ed.color" @input="ed.color = $event.target.value">
            <span class="ml-2">粗细</span>
            <select id="edSW" class="border rounded px-1 py-0.5"
              :value="ed.sw" @change="ed.sw = +($event.target.value)">
              <option value="0.05">细</option>
              <option value="0.08">标准</option>
              <option value="0.14">粗</option>
            </select>
          </div>
          <div>
            <div class="text-gray-600 mb-1">已画图元</div>
            <div class="flex items-center gap-1 mb-1">
              <button id="edFlipH" class="border rounded px-2 py-0.5 bg-white" title="所有图元水平镜像（x → 宽-x）"
                @click="flipShapes('h')">左右翻转</button>
              <button id="edFlipV" class="border rounded px-2 py-0.5 bg-white" title="所有图元垂直镜像（y → 高-y）"
                @click="flipShapes('v')">上下翻转</button>
            </div>
            <div id="edShapes" class="border rounded p-1 h-32 overflow-auto bg-gray-50">
              <div v-for="(sh, i) in ed.shapes" :key="'l' + i"
                class="flex items-center justify-between px-1 py-0.5">
                <span>{{ i + 1 }}. {{ SHAPE_NAMES[sh.type] }}
                  <i :style="{ color: sh.color }">●</i></span>
                <button class="text-red-500 ed-shape-del" :data-i="i"
                  @click="ed.shapes.splice(i, 1)">删除</button>
              </div>
              <span v-if="!ed.shapes.length" class="text-gray-400">在左侧画布画第一个图元</span>
            </div>
          </div>
          <div class="flex gap-2 pt-1">
            <button id="edSave" class="bg-rose-700 text-white rounded px-3 py-1"
              @click="onSave">保存到符号面板</button>
            <button id="edCancel" class="border rounded px-3 py-1 bg-white"
              @click="closeEditor">放弃新建</button>
          </div>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>
