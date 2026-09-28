<script setup>
import { reactive, ref, computed, watchEffect, onMounted, onUnmounted } from 'vue';
import {
  state, labelFor, setColLabel, applyAt, commitBorder,
  eraseAt, fits, toggleHighlight, getSym, pasteAt, clipSel, clipBoard,
} from '../store.js';
import { CELL } from '../util.js';

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

const placed = computed(() => state.placements.map(p => ({
  p, sym: getSym(p.sym), ty: state.rows - p.row - p.h + 1,
})).filter(x => x.sym));

/* ================= canvas 符号层（零 DOM 节点，视口渲染 + Path2D 矢量） =================
   演进：① 每放置一个 SymbolArt 组件实例 → 大图解切换秒级卡顿；
   ② <g v-html> 内联路径 → 8-10s 主线程长任务；③ <defs>+<use> 影子树更慢，勿再试；
   ④ 全世界单 canvas 位图 → 1000×1000 时 backing 被像素上限压到 1/36，符号全糊；
   ⑤ data-URL Image + drawImage → Chrome 对 SVG image 首次绘制可能空帧，自测随机挂。
   现方案：canvas sticky 只覆盖滚动视口（backing=视口×dpr 恒满分辨率），符号按
   Path2D 缓存（WeakMap 按符号对象）逐放置矢量描画——零解码零异步，任意缩放
   天然清晰；SVG 两层仍为世界尺寸原生滚动，三明治 z 序不变。 */
let symRaf = 0;
let scroller = null;            // .canvas-scroll 滚动容器（sticky 跟随其滚动）
let scrollRo = null;            // 视口尺寸变化 → 重绘
let lastView = null;            // { k, ox, oy, px } backing↔格坐标换算（自测用）
const symOpsCache = new WeakMap(); // 符号对象 → Path2D 绘制指令

const svgParser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;
/* 符号 → [{path, fill, stroke, sw, cap}]：自定义符号按 shapes 直构，
   内置符号解析预生成 svg 里的 <path>（无 transform/g，转换器保证） */
function symOps(sym) {
  let ops = symOpsCache.get(sym);
  if (ops) return ops;
  ops = [];
  try {
    if (sym && Array.isArray(sym.shapes)) {
      for (const sh of sym.shapes) {
        const p = new Path2D();
        if (sh.type === 'line') { p.moveTo(sh.x1, sh.y1); p.lineTo(sh.x2, sh.y2); }
        else if (sh.type === 'circle') { p.arc(sh.cx, sh.cy, sh.r, 0, Math.PI * 2); }
        else if (sh.type === 'rect') { p.rect(sh.x, sh.y, sh.rw, sh.rh); }
        else if (sh.type === 'curve') {
          p.moveTo(sh.x1, sh.y1);
          p.bezierCurveTo(sh.cx1, sh.cy1, sh.cx2, sh.cy2, sh.x2, sh.y2);
        } else continue;
        ops.push({ path: p, fill: null, stroke: sh.color || '#111', sw: sh.w || 0.07, cap: 'round' });
      }
    } else if (sym && sym.svg && svgParser) {
      for (const el of svgParser.parseFromString(sym.svg, 'image/svg+xml').querySelectorAll('path')) {
        const d = el.getAttribute('d');
        if (!d) continue;
        const fill = el.getAttribute('fill'), stroke = el.getAttribute('stroke');
        ops.push({
          path: new Path2D(d),
          fill: fill && fill !== 'none' ? fill : null,
          stroke: stroke && stroke !== 'none' ? stroke : null,
          sw: parseFloat(el.getAttribute('stroke-width')) || 0.03,
          cap: el.getAttribute('stroke-linecap') || 'butt',
        });
      }
    }
  } catch (e) { /* 解析失败按空符号处理 */ }
  symOpsCache.set(sym, ops);
  return ops;
}
function ensureScroller() {
  if (scroller && scroller.isConnected) return scroller;
  const cv = symCanvasEl.value;
  scroller = cv ? cv.closest('.canvas-scroll') : null;
  if (scroller && !scrollRo) {
    scrollRo = new ResizeObserver(() => scheduleSymDraw());
    scrollRo.observe(scroller);
    scroller.addEventListener('scroll', scheduleSymDraw, { passive: true });
  }
  return scroller;
}
function drawSymLayer() {
  symRaf = 0;
  const cv = symCanvasEl.value;
  if (!cv) return;
  const { rows, cols, zoom } = state;
  const px = CELL * zoom, cssW = cols * px, cssH = rows * px;
  if (!(cssW > 0 && cssH > 0)) { lastView = null; return; }
  const scr = ensureScroller();
  if (!scr) return;
  const vw = scr.clientWidth, vh = scr.clientHeight;
  if (!(vw > 0 && vh > 0)) return;
  /* backing = 视口 × dpr 恒满分辨率；硬上限仅防异常大视口/超高分屏 */
  let scale = Math.min(window.devicePixelRatio || 1, 16384 / vw, 16384 / vh);
  if (vw * vh * scale * scale > 16 * 1024 * 1024)
    scale = Math.sqrt(16 * 1024 * 1024 / (vw * vh));
  const bw = Math.max(1, Math.round(vw * scale)), bh = Math.max(1, Math.round(vh * scale));
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
  if (cv.style.width !== vw + 'px') { cv.style.width = vw + 'px'; cv.style.height = vh + 'px'; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, bw, bh);
  const gx = PAD_L * px, gy = PAD_T * px;                  // 网格原点在 #chartWrap 内的偏移
  const sx = scr.scrollLeft - gx, sy = scr.scrollTop - gy; // 视口左上角（网格本地 css px）
  const k = bw / vw;                                       // backing / CSS 像素比
  ctx.setTransform(k, 0, 0, k, -sx * k, -sy * k);
  lastView = { k, ox: -sx * k, oy: -sy * k, px };
  /* 网格线只画可见范围，且限制在网格区内（视口可能露出留白区） */
  const c0 = Math.max(0, Math.floor(sx / px)), c1 = Math.min(cols, Math.ceil((sx + vw) / px));
  const r0 = Math.max(0, Math.floor(sy / px)), r1 = Math.min(rows, Math.ceil((sy + vh) / px));
  const lx0 = Math.max(0, sx), lx1 = Math.min(cssW, sx + vw);
  const ly0 = Math.max(0, sy), ly1 = Math.min(cssH, sy + vh);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 0.025 * px;
  ctx.beginPath();
  for (let c = c0; c <= c1; c++) { ctx.moveTo(c * px, ly0); ctx.lineTo(c * px, ly1); }
  for (let r = r0; r <= r1; r++) { ctx.moveTo(lx0, r * px); ctx.lineTo(lx1, r * px); }
  ctx.stroke();
  const obw = 0.06 * px;
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = obw;
  ctx.strokeRect(obw / 2, obw / 2, cssW - obw, cssH - obw);
  /* 符号矢量绘制（可见区裁剪，±1 格余量给描边/抗锯齿） */
  const visL = sx - px, visR = sx + vw + px, visT = sy - px, visB = sy + vh + px;
  for (const { p, sym, ty } of placed.value) {
    const x = p.col * px, y = ty * px, w = p.w * px, h = p.h * px;
    if (x > visR || x + w < visL || y > visB || y + h < visT) continue;
    const ops = symOps(sym);
    if (!ops.length) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(px, px); // 符号内部坐标 = 格单位（与 symDataUrl viewBox 同系）
    for (const op of ops) {
      if (op.fill) { ctx.fillStyle = op.fill; ctx.fill(op.path); }
      if (op.stroke) {
        ctx.strokeStyle = op.stroke; ctx.lineWidth = op.sw;
        ctx.lineCap = op.cap; ctx.stroke(op.path);
      }
    }
    ctx.restore();
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
/* 自测钩子：selftest 同步重绘后取像素断言（reveal 把目标格块滚进视口） */
if (typeof window !== 'undefined') {
  window.__symLayer = {
    redraw: drawSymLayer,
    ready() { return Promise.resolve(); }, // Path2D 同步绘制，无解码等待（兼容自测）
    /* 视口渲染下远处格子不落在 canvas 上：把目标格块滚到视口中心再同步重绘。
       无条件中心化（clamp 后贴边也全可见，前提块≤视口），采样窗口确定 */
    reveal(c0, ty, wCells, hCells) {
      const scr = ensureScroller();
      if (!scr) return;
      const px = CELL * state.zoom;
      const x = PAD_L * px + c0 * px, y = PAD_T * px + ty * px;
      const w = wCells * px, h = hCells * px;
      const mx = scr.scrollWidth - scr.clientWidth, my = scr.scrollHeight - scr.clientHeight;
      scr.scrollLeft = Math.max(0, Math.min(mx, x + w / 2 - scr.clientWidth / 2));
      scr.scrollTop = Math.max(0, Math.min(my, y + h / 2 - scr.clientHeight / 2));
      drawSymLayer();
    },
    /* 格块 → canvas backing 像素矩形（含 18% 内缩，避开网格线/外框） */
    blockRect(c0, ty, wCells, hCells) {
      if (!lastView) return null;
      const { k, ox, oy, px } = lastView;
      return {
        x: Math.round(ox + (c0 + 0.18) * px * k),
        y: Math.round(oy + (ty + 0.18) * px * k),
        w: Math.max(1, Math.round((wCells - 0.36) * px * k)),
        h: Math.max(1, Math.round((hCells - 0.36) * px * k)),
      };
    },
    debugView() { return lastView; },
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
  ensureScroller();
  scheduleSymDraw();
});
onUnmounted(() => {
  window.removeEventListener('pointerup', onPointerUp);
  if (symRaf) cancelAnimationFrame(symRaf);
  if (scrollRo) { scrollRo.disconnect(); scrollRo = null; }
  if (scroller) { scroller.removeEventListener('scroll', scheduleSymDraw); scroller = null; }
});
</script>

<template>
  <div id="chartWrap" :style="boxStyle">
    <!-- 底层 SVG：指针热区 / 高亮行 / 行号 / 列号（位于符号位图之下） -->
    <svg
      id="chart"
      ref="svgEl"
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

    <!-- 符号层：canvas 位图，零 DOM 节点（网格线+外框+所有符号），sticky 视口渲染 -->
    <canvas id="symCanvas" ref="symCanvasEl"></canvas>

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
