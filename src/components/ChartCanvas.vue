<script setup>
import { reactive, ref, computed, watchEffect, onMounted, onUnmounted } from 'vue';
import {
  state, labelFor, setColLabel, applyAt, commitBorder,
  eraseAt, fits, toggleHighlight, getSym, pasteAt, clipSel, clipBoard,
} from '../store.js';
import { CELL, symDataUrl } from '../util.js';

const svgEl = ref(null);
const symCanvasEl = ref(null);
let painting = false;
let borderDrag = null;   // {c0,r0} 拖边框时的起点
let selDrag = null;      // {c0,r0} 框选起点
let skipClick = false;   // pointerdown 已处理（框选/粘贴）时跳过随后的 click，避免拖选被重置
let lastCell = null;
let lastHoverKey = null; // 上一次命中的格子，避免 pointermove 高频重复渲染

const ghost = reactive({ visible: false, x: 0, y: 0, w: 1, h: 1, color: '#3b82f6' });

const rowTopY = r => state.rows - r;

/* viewBox 与 CSS 宽高必须严格一致，否则 preserveAspectRatio 会留黑边导致点击错位 */
const PAD_L = 1.3, PAD_R = 1.3, PAD_T = 0.7, PAD_B = 1.0; // 左侧/右侧行号区、上方、下方列号区
const viewBox = computed(() =>
  `${-PAD_L} ${-PAD_T} ${state.cols + PAD_L + PAD_R} ${state.rows + PAD_T + PAD_B}`);
const boxStyle = computed(() => ({
  width: ((state.cols + PAD_L + PAD_R) * CELL * state.zoom) + 'px',
  height: ((state.rows + PAD_T + PAD_B) * CELL * state.zoom) + 'px',
}));
/* 符号位图 canvas 精确覆盖网格区（不含四周行号/列号留白） */
const canvasStyle = computed(() => ({
  left: (PAD_L * CELL * state.zoom) + 'px',
  top: (PAD_T * CELL * state.zoom) + 'px',
  width: (state.cols * CELL * state.zoom) + 'px',
  height: (state.rows * CELL * state.zoom) + 'px',
}));

const placed = computed(() => state.placements.map(p => ({
  p, sym: getSym(p.sym), ty: state.rows - p.row - p.h + 1,
})).filter(x => x.sym));

/* 工具光标：擦除=指针、粘贴=复制、框选/边框=十字；符号工具保持默认（有 ghost 预览） */
const toolClass = computed(() => {
  if (state.tool === 'erase') return 'cur-erase';
  if (state.tool === 'paste') return 'cur-paste';
  if (state.tool === 'select' || state.tool === 'border') return 'cur-cross';
  return '';
});

/* ================= canvas 符号层（零 DOM 节点） =================
   演进：① 每放置一个 SymbolArt 组件实例 → 大图解切换秒级卡顿；
   ② <g v-html> 内联路径一次性渲染 → 显示变快，但用户环境切回大图解仍有
   8-10s 主线程长任务（694KB 字符串解析 + 上万节点 SVG 布局/绘制）；
   ③ <defs>+<use> 去重实验 → Chrome 为数千 use 实例建影子树反而 9.4s，勿再试。
   现方案：每符号生成 data-URL SVG → Image 缓存（按符号对象弱引用，自定义符号
   编辑时对象被替换即自动失效），重绘 = 清屏 + 网格线 + 逐放置 drawImage 位图
   blit，与 DOM 树完全解耦。z 序用「底 SVG(热区/高亮/行号列号) < canvas <
   顶 SVG(边框/标注/框选/ghost)」夹心结构，与原单 SVG 层叠顺序一致 */
const symImgs = new WeakMap();  // 符号对象 → HTMLImageElement
let symPending = 0;             // 尚未解码完成的图片数
let symWaiters = [];            // 等待全部图片就绪的回调（自测用）
let symRaf = 0;

function symImage(sym) {
  let img = symImgs.get(sym);
  if (!img) {
    img = new Image();
    symPending++;
    img.onload = () => { symPending--; flushSymWaiters(); scheduleSymDraw(); };
    img.onerror = () => { symPending--; flushSymWaiters(); console.warn('符号位图生成失败:', sym && sym.id); };
    img.src = symDataUrl(sym);
    symImgs.set(sym, img);
  }
  return img;
}
function flushSymWaiters() {
  if (symPending > 0) return;
  symPending = 0;
  const ws = symWaiters; symWaiters = [];
  ws.forEach(r => r());
}
function drawSymLayer() {
  symRaf = 0;
  const cv = symCanvasEl.value;
  if (!cv) return;
  const { rows, cols, zoom } = state;
  const cssW = cols * CELL * zoom, cssH = rows * CELL * zoom;
  if (!(cssW > 0 && cssH > 0)) return;
  /* backing store 上限：防超大网格 × 高缩放时位图内存爆炸（1600 万像素 ≈ 64MB） */
  let scale = Math.min(window.devicePixelRatio || 1, 16384 / cssW, 16384 / cssH);
  if (cssW * cssH * scale * scale > 16 * 1024 * 1024)
    scale = Math.sqrt(16 * 1024 * 1024 / (cssW * cssH));
  const bw = Math.max(1, Math.round(cssW * scale)), bh = Math.max(1, Math.round(cssH * scale));
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(bw / cssW, 0, 0, bh / cssH, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const px = CELL * zoom; // 1 格 CSS 像素
  /* 网格线 + 外框（原先在 SVG 里，随符号层一起位图化） */
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 0.025 * px;
  ctx.beginPath();
  for (let c = 0; c <= cols; c++) { ctx.moveTo(c * px, 0); ctx.lineTo(c * px, cssH); }
  for (let r = 0; r <= rows; r++) { ctx.moveTo(0, r * px); ctx.lineTo(cssW, r * px); }
  ctx.stroke();
  const obw = 0.06 * px;
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = obw;
  ctx.strokeRect(obw / 2, obw / 2, cssW - obw, cssH - obw);
  /* 符号位图 blit */
  for (const { p, sym, ty } of placed.value) {
    const img = symImage(sym);
    if (!img.complete || !img.naturalWidth) continue; // 解码中，onload 后整体重绘
    ctx.drawImage(img, p.col * px, ty * px, p.w * px, p.h * px);
  }
}
function scheduleSymDraw() {
  if (symRaf) return;
  symRaf = requestAnimationFrame(() => { symRaf = 0; drawSymLayer(); });
}
watchEffect(() => {
  // 依赖收集：放置/缩放/网格尺寸变化（customSymbols 经 getSym 传导到 placed）→ 重绘
  placed.value; state.zoom; state.cols; state.rows;
  scheduleSymDraw();
});
/* 自测钩子：selftest 等待图片解码后同步重绘，再取像素断言 */
if (typeof window !== 'undefined') {
  window.__symLayer = {
    redraw: drawSymLayer,
    ready() { return symPending > 0 ? new Promise(r => symWaiters.push(r)) : Promise.resolve(); },
  };
}

const rowNumbers = computed(() => {
  const row1Right = state.rowStartSide !== 'left';
  const arr = [];
  for (let r = 1; r <= state.rows; r++) {
    const onRight = (r % 2 === 1) === row1Right;
    arr.push({ r, x: onRight ? state.cols + 0.45 : -0.45, y: rowTopY(r) + 0.52 });
  }
  return arr;
});
const colHits = computed(() =>
  Array.from({ length: state.cols }, (_, c) => ({ c, label: labelFor(c) })));

/* 屏幕坐标 → SVG 用户坐标；用 getScreenCTM 精确换算，消除 viewBox 缩放偏差 */
function pointToSvg(e) {
  const svg = svgEl.value;
  if (!svg) return null;
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}
function cellFromPoint(pt) {
  const { rows, cols } = state;
  if (!pt || pt.x < 0 || pt.x >= cols || pt.y < 0 || pt.y >= rows) return null;
  return { c: Math.floor(pt.x), r: rows - Math.floor(pt.y) };
}

function editColLabel(c) {
  const v = prompt(`第 ${c + 1} 列的标号：\n可输入任意数字或文字；留空 = 不显示`, labelFor(c));
  if (v === null) return;
  setColLabel(c, v);
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  // 列号标注区
  const colEl = e.target.closest ? e.target.closest('.colhit, .colnum') : null;
  if (colEl) { editColLabel(+colEl.dataset.c); return; }
  // 行号（点击高亮）交给 @click 处理
  const rowEl = e.target.closest ? e.target.closest('.rownum') : null;
  if (rowEl) return;
  const cell = cellFromPoint(pointToSvg(e));
  if (!cell) return;
  lastHoverKey = null; // 按下后允许同一格再次触发移动绘制
  if (state.tool === 'border') {
    borderDrag = { c0: cell.c, r0: cell.r };
    lastCell = cell;
  } else if (state.tool === 'select') {
    selDrag = { c0: cell.c, r0: cell.r };
    clipSel.rect = { c0: cell.c, r0: cell.r, c1: cell.c, r1: cell.r };
  } else if (state.tool === 'paste') {
    pasteAt(cell.c, cell.r);
  } else {
    applyAt(cell.c, cell.r);
    painting = true;
  }
}
// click 回退：自动化工具/部分触屏只派发 click；applyAt 幂等
function onClick(e) {
  const rowEl = e.target.closest ? e.target.closest('.rownum') : null;
  if (rowEl) { toggleHighlight(+rowEl.dataset.r); return; }
  const colEl = e.target.closest ? e.target.closest('.colhit, .colnum') : null;
  if (colEl) return;
  if (skipClick) { skipClick = false; return; } // pointerdown 已处理过（框选/粘贴）
  const cell = cellFromPoint(pointToSvg(e));
  if (!cell) return;
  if (state.tool === 'select') {
    clipSel.rect = { c0: cell.c, r0: cell.r, c1: cell.c, r1: cell.r };
    return;
  }
  if (state.tool === 'paste') { pasteAt(cell.c, cell.r); return; }
  applyAt(cell.c, cell.r);
}
/* 必须用 pointermove：网格区只有一个背景 rect 接收事件，
   pointerover 只在进入元素时触发一次，移动中不会更新高亮 */
function onPointerMove(e) {
  const cell = cellFromPoint(pointToSvg(e));
  const key = cell ? cell.c * 100000 + cell.r : -1;
  if (key === lastHoverKey) return; // 同一格内移动：无需更新
  lastHoverKey = key;
  updateGhost(cell);
  if (!cell) return;
  lastCell = cell;
  if (borderDrag) return;
  if (selDrag) {
    if ((e.buttons & 1) && cell) {
      clipSel.rect = { c0: selDrag.c0, r0: selDrag.r0, c1: cell.c, r1: cell.r };
    }
    return;
  }
  if (painting && (e.buttons & 1)) {
    const d = getSym(state.tool);
    if (state.tool === 'erase' || (d && d.w === 1 && d.h === 1)) applyAt(cell.c, cell.r);
  }
}
function onPointerUp() {
  if (borderDrag && lastCell) commitBorder(borderDrag.c0, borderDrag.r0, lastCell.c, lastCell.r);
  // 边框已在 pointerup 提交，框选也已处理：必须拦住随后的 click，
  // 否则 click 会再 commitBorder(单击格) —— 右下角多出一个 1×1 小框
  if (selDrag || borderDrag) skipClick = true;
  borderDrag = null;
  selDrag = null;
  painting = false;
}
function onPointerLeave() {
  lastHoverKey = null;
  updateGhost(null);
}
function onContextMenu(e) {
  const cell = cellFromPoint(pointToSvg(e));
  if (cell) { e.preventDefault(); eraseAt(cell.c, cell.r); }
}

function footprintAt(c, r) {
  if (state.tool === 'erase' || state.tool === 'border') return { w: 1, h: 1 };
  const d = getSym(state.tool);
  return d ? { w: d.w, h: d.h } : { w: 1, h: 1 };
}
function updateGhost(cell) {
  if (!cell || state.tool === 'select') { ghost.visible = false; return; }
  if (state.tool === 'paste') {
    // 粘贴预览：复制块整体 footprint，以点击格为左下角
    const cb = clipBoard.data;
    const w = cb ? cb.w : 1, h = cb ? cb.h : 1;
    ghost.x = cell.c;
    ghost.y = state.rows - cell.r - h + 1;
    ghost.w = w; ghost.h = h;
    ghost.color = cb ? '#0d9488' : '#ef4444';
  } else if (state.tool === 'border') {
    const c0 = borderDrag ? borderDrag.c0 : cell.c, r0 = borderDrag ? borderDrag.r0 : cell.r;
    ghost.x = Math.min(c0, cell.c);
    ghost.y = rowTopY(Math.max(r0, cell.r));
    ghost.w = Math.abs(cell.c - c0) + 1;
    ghost.h = Math.abs(cell.r - r0) + 1;
    ghost.color = '#d97706';
  } else {
    const fp = footprintAt(cell.c, cell.r);
    ghost.x = cell.c;
    ghost.y = state.rows - cell.r - fp.h + 1;
    ghost.w = fp.w; ghost.h = fp.h;
    ghost.color = (state.tool === 'erase' || !fits(cell.c, cell.r, fp.w, fp.h)) ? '#ef4444' : '#3b82f6';
  }
  ghost.visible = true;
}

onMounted(() => {
  window.addEventListener('pointerup', onPointerUp);
  scheduleSymDraw();
});
onUnmounted(() => {
  window.removeEventListener('pointerup', onPointerUp);
  if (symRaf) cancelAnimationFrame(symRaf);
});
</script>

<template>
  <div id="chartWrap" :style="boxStyle">
    <!-- 底层 SVG：指针热区 / 高亮行 / 行号 / 列号（位于符号位图之下） -->
    <svg
      id="chart"
      ref="svgEl"
      :class="toolClass"
      xmlns="http://www.w3.org/2000/svg"
      :viewBox="viewBox"
      @pointerdown="onPointerDown"
      @click="onClick"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
      @contextmenu="onContextMenu"
    >
      <!-- 高亮当前行 -->
      <g id="hlLayer" pointer-events="none">
        <rect v-if="state.highlight"
          x="-1.15" :y="rowTopY(state.highlight)" :width="state.cols + 2.3" height="1"
          fill="#fbbf24" opacity="0.28"/>
      </g>

      <!-- 网格背景：透明矩形接收整个网格区的指针事件，用于坐标换算命中 -->
      <rect x="0" y="0" :width="state.cols" :height="state.rows" fill="transparent"/>

      <!-- 行号：第 1 行位置由 rowStartSide 决定，其后逐行左右交替 -->
      <text v-for="rn in rowNumbers" :key="'rn' + rn.r"
        class="rownum" :data-r="rn.r" :x="rn.x" :y="rn.y"
        text-anchor="middle" dominant-baseline="central" font-size="0.42"
        :fill="state.highlight === rn.r ? '#b45309' : '#64748b'"
        :font-weight="state.highlight === rn.r ? 'bold' : 'normal'">{{ rn.r }}</text>

      <!-- 列号热区 + 手动标注 -->
      <template v-for="ch in colHits" :key="'ch' + ch.c">
        <rect class="colhit" :data-c="ch.c" :x="ch.c" :y="state.rows" width="1" height="0.9" fill="transparent"/>
        <text v-if="ch.label !== ''" class="colnum" :data-c="ch.c"
          :x="ch.c + 0.5" :y="state.rows + 0.42"
          text-anchor="middle" dominant-baseline="central" font-size="0.3" fill="#64748b">{{ ch.label }}</text>
      </template>
    </svg>

    <!-- 符号层：canvas 位图，零 DOM 节点（网格线+外框+所有符号） -->
    <canvas id="symCanvas" ref="symCanvasEl" :style="canvasStyle"></canvas>

    <!-- 顶层 SVG：边框 / 区域标注 / 框选 / ghost（位于符号位图之上，不接收指针） -->
    <svg id="chartTop" xmlns="http://www.w3.org/2000/svg" :viewBox="viewBox" pointer-events="none">
      <!-- 粗边框层 -->
      <g id="borderLayer" pointer-events="none">
        <rect v-for="(b, i) in state.borders" :key="i"
          :x="b.col" :y="rowTopY(b.row + b.h - 1)" :width="b.w" :height="b.h"
          fill="none" stroke="#0f172a" stroke-width="0.1"/>
      </g>

      <!-- 区域标注层：青色虚线框 + 区域上方文字 -->
      <g id="annoLayer" pointer-events="none">
        <g v-for="(a, i) in state.annotations" :key="'an' + i">
          <rect :x="a.col" :y="rowTopY(a.row + a.h - 1)" :width="a.w" :height="a.h"
            fill="#14b8a6" fill-opacity="0.07" stroke="#0d9488"
            stroke-width="0.06" stroke-dasharray="0.18 0.12"/>
          <text :x="a.col + 0.05" :y="rowTopY(a.row + a.h - 1) - 0.14"
            font-size="0.4" font-weight="bold" fill="#0f766e"
            stroke="#fff" stroke-width="0.12" style="paint-order: stroke">{{ a.text }}</text>
        </g>
      </g>

      <!-- 框选矩形 -->
      <rect v-if="clipSel.rect" id="selRect" pointer-events="none"
        :x="Math.min(clipSel.rect.c0, clipSel.rect.c1)"
        :y="rowTopY(Math.max(clipSel.rect.r0, clipSel.rect.r1))"
        :width="Math.abs(clipSel.rect.c1 - clipSel.rect.c0) + 1"
        :height="Math.abs(clipSel.rect.r1 - clipSel.rect.r0) + 1"
        fill="#3b82f6" fill-opacity="0.08" stroke="#3b82f6"
        stroke-width="0.06" stroke-dasharray="0.15 0.1"/>

      <!-- 放置预览 ghost -->
      <rect id="ghost" pointer-events="none"
        :x="ghost.x" :y="ghost.y" :width="ghost.w" :height="ghost.h"
        :fill="ghost.color" opacity="0.15" :stroke="ghost.color"
        stroke-width="0.04" stroke-dasharray="0.12 0.08"
        :style="{ display: ghost.visible ? '' : 'none' }"/>
    </svg>
  </div>
</template>
