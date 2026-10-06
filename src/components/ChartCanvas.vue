<script setup>
import { reactive, ref, computed, watchEffect, onMounted, onUnmounted, toRaw, nextTick } from 'vue';
import {
  state, labelFor, setColLabel, applyAt, commitBorder,
  fits, toggleHighlight, getSym, pasteAt, clipSel, clipBoard, contentRev,
} from '../store.js';
import { ui, appPrompt } from '../ui.js';
import { CELL, symDataUrl, symbolInnerMarkup } from '../util.js';
import { createTileLayer } from '../tileLayer.js';

const svgEl = ref(null);
const symLayerEl = ref(null);
let painting = false;
let borderDrag = null;   // {c0,r0} 拖边框时的起点
let selDrag = null;      // {c0,r0} 框选起点
let skipClick = false;   // pointerdown 已处理（框选/粘贴）时跳过随后的 click，避免拖选被重置
let lastCell = null;
let lastHoverKey = null; // 上一次命中的格子，避免 pointermove 高频重复渲染
let lastClient = null;   // 上一次 pointermove 的屏幕坐标：同位置事件直接跳过
let lastPaint = null;    // 本次笔画最后一次落格：同格内的高频 move 不重复 applyAt
let pdCell = null;       // pointerdown 已 applyAt 的 {c,r,tool}：click 不再重复落格
let svgRect = null;      // #chart 的屏幕矩形缓存：pointermove 高频换算不做 getScreenCTM

const ghost = reactive({ visible: false, x: 0, y: 0, w: 1, h: 1, color: '#3b82f6' });

const rowTopY = r => state.rows - r;

/* ---- 行号/列号虚拟化 ----
   底层 SVG 的盒子随网格尺寸走（400×400@zoom1 ≈ 1.27 亿像素的图层），
   若把 400 行号 + 400 列热区全部渲染：① 800 个 <text> 的 DOM/diff 常驻；
   ② 图层被显存丢弃后重新光栅化要对巨型 SVG 全量走一遍，实测呈现段
   （INP 的呈现分量）卡数百毫秒。改为只渲染可视区 ±2 格的行列号，
   滚动/缩放时增量更新 */
const scrollEl = ref(null);
const vis = reactive({ c0: 0, c1: 0, w0: 1, w1: 1 }); // 可视列范围(0基) / 可视行号范围(1基)
let visRaf = 0;
function updateVis() {
  const el = scrollEl.value;
  if (!el) return;
  const p = CELL * state.zoom;
  const c0 = Math.max(0, Math.floor(el.scrollLeft / p) - 2);
  const c1 = Math.min(state.cols - 1, Math.ceil((el.scrollLeft + el.clientWidth) / p) + 2);
  const y0 = Math.max(0, Math.floor(el.scrollTop / p) - 2);
  const y1 = Math.min(state.rows - 1, Math.ceil((el.scrollTop + el.clientHeight) / p) + 2);
  vis.c0 = c0; vis.c1 = c1;
  vis.w0 = Math.max(1, state.rows - y1);
  vis.w1 = state.rows - y0;
}
function onScrollVis() {
  if (visRaf) return;
  visRaf = requestAnimationFrame(() => {
    visRaf = 0;
    refreshSvgRect(); // 滚动改变 #chart 的屏幕位置，矩形缓存必须同步
    updateVis();
  });
}
watchEffect(() => {
  state.zoom; state.rows; state.cols; // 缩放/网格尺寸变化 → 立即重算可视范围
  updateVis();
  nextTick(refreshSvgRect); // 盒子尺寸随 zoom/rows/cols 变化，等 DOM 更新后刷新缓存
});

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

/* 工具光标：自绘 SVG 光标贴合工具语义（见 style.css）；
   框选=虚线选框、边框=四角括号、消去=橡皮擦、粘贴=复制；符号工具保持默认（有 ghost 预览） */
const toolClass = computed(() => {
  if (state.tool === 'erase') return 'cur-erase';
  if (state.tool === 'paste') return 'cur-paste';
  if (state.tool === 'select') return 'cur-select';
  if (state.tool === 'border') return 'cur-border';
  return '';
});

/* ================= 瓦片化 canvas 符号层 =================
   演进：① 每放置一个 SymbolArt 组件实例 → 大图解切换秒级卡顿；
   ② <g v-html> 内联路径 → 上万节点 SVG 布局 8-10s 长任务；
   ③ <defs>+<use> → Chrome 影子树反而 9.4s，勿再试；
   ④ 单 canvas 位图（data-URL Image + drawImage）→ 快，但 backing 被全局
   16M 像素帽压住，世界越大符号越糊，且重绘要遍历全部放置；
   现方案：16 格瓦片 canvas（tileLayer.js），每块按 dpr 全分辨率渲染
   （无全局帽 → 任何尺寸锐利），只保活可视区 ±1 圈 + LRU 逐出，编辑/滚动
   只重渲可见块。符号位图缓存（WeakMap 按符号对象弱引用）沿用。
   z 序：底 SVG(热区/高亮/行号列号) < #symLayer(瓦片) < 顶 SVG(外框/边框/
   标注/框选/ghost)，外框改为顶 SVG rect（原在 canvas 里画，随位图会糊） */
const symImgs = new WeakMap();  // 符号对象 → HTMLImageElement
let symPending = 0;             // 尚未解码完成的图片数
let symWaiters = [];            // 等待全部图片就绪的回调（自测用）
const symCanvases = new WeakMap(); // 符号对象 → Map<'宽x高 设备像素', 离屏 canvas>
let layer = null;               // createTileLayer 实例（onMounted 创建）

function symImage(sym) {
  let img = symImgs.get(sym);
  if (!img) {
    img = new Image();
    symPending++;
    img.onload = () => {
      symPending--;
      flushSymWaiters();
      // 解码前渲染的瓦片画的是空帧，必须标记重渲，否则迟到的符号永远画不上
      if (layer) { layer.markAllDirty(); layer.schedule(); }
    };
    img.onerror = () => { symPending--; flushSymWaiters(); console.warn('符号位图生成失败:', sym && sym.id); };
    img.src = symDataUrl(sym);
    symImgs.set(sym, img);
  }
  return img;
}
/* 符号预光栅化：SVG image 每次 drawImage 都要按目标尺寸重新光栅化
   （矢量源），慢机器上每帧几百个 drawImage 就是数百毫秒。改为每个
   (符号, 尺寸) 只光栅化一次到离屏 canvas，之后全部 canvas→canvas 拷贝 */
function symBitmap(sym, wPx, hPx) {
  let sizes = symCanvases.get(sym);
  if (!sizes) { sizes = new Map(); symCanvases.set(sym, sizes); }
  const key = Math.round(wPx) + 'x' + Math.round(hPx);
  let cv = sizes.get(key);
  if (!cv) {
    const img = symImage(sym); // 同时承担解码计数/等待者机制
    if (!img.complete || !img.naturalWidth) return null; // 解码中，onload 后整体重渲
    cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(wPx));
    cv.height = Math.max(1, Math.round(hPx));
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    sizes.set(key, cv);
  }
  return cv;
}
function flushSymWaiters() {
  if (symPending > 0) return;
  symPending = 0;
  const ws = symWaiters; symWaiters = [];
  ws.forEach(r => r());
}
watchEffect(() => {
  /* 依赖收集：内容版本号（图面真变了才自增——覆盖绘制长度不变也覆盖到）、
     缩放、网格尺寸、自定义符号编辑 → 触发瓦片重渲。
     不能只读 placements.length：同格覆盖时长度不变会漏触发，
     导致「改动攒到下次编辑才一起画出来」 */
  contentRev.n; state.zoom; state.cols; state.rows;
  for (const s of state.customSymbols) void s.id;
  if (layer) layer.schedule();
});
/* 自测钩子：selftest 等待图片解码 + 可见瓦片渲完后同步重绘，再取像素断言 */
if (typeof window !== 'undefined') {
  window.__symLayer = {
    redraw() { if (layer) layer.reconcile(); },
    async ready() {
      if (symPending > 0) await new Promise(r => symWaiters.push(r));
      if (layer) await layer.readyTiles();
    },
    debug() { return layer ? layer.debug() : null; },
  };
}

const rowNumbers = computed(() => {
  const row1Right = state.rowStartSide !== 'left';
  const arr = [];
  for (let r = vis.w0; r <= vis.w1; r++) { // 只渲染可视区行号（虚拟化）
    const onRight = (r % 2 === 1) === row1Right;
    arr.push({ r, x: onRight ? state.cols + 0.45 : -0.45, y: rowTopY(r) + 0.52 });
  }
  return arr;
});
const colHits = computed(() => {
  const out = [];
  for (let c = vis.c0; c <= vis.c1; c++) out.push({ c, label: labelFor(c) });
  return out;
});

/* 屏幕坐标 → SVG 用户坐标。用缓存的 #chart 屏幕矩形做纯算术换算：
   pointermove 高频触发，getScreenCTM 每次都要走矩阵+潜在布局，是
   move 风暴里的隐形大头。矩形在挂载/滚动/缩放/窗口变化时刷新 */
function refreshSvgRect() {
  if (svgEl.value) svgRect = svgEl.value.getBoundingClientRect();
}
function pointToSvg(e) {
  if (!svgRect) refreshSvgRect();
  if (!svgRect) return null;
  const vbW = state.cols + PAD_L + PAD_R, vbH = state.rows + PAD_T + PAD_B;
  return {
    x: (e.clientX - svgRect.left) * (vbW / svgRect.width) - PAD_L,
    y: (e.clientY - svgRect.top) * (vbH / svgRect.height) - PAD_T,
  };
}
function cellFromPoint(pt) {
  const { rows, cols } = state;
  if (!pt || pt.x < 0 || pt.x >= cols || pt.y < 0 || pt.y >= rows) return null;
  return { c: Math.floor(pt.x), r: rows - Math.floor(pt.y) };
}

async function editColLabel(c) {
  const v = await appPrompt({
    title: '列标号',
    message: `第 ${c + 1} 列的标号：可输入任意数字或文字；留空 = 不显示`,
    value: labelFor(c),
  });
  if (v === null) return;
  setColLabel(c, v.trim());
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  refreshSvgRect(); // 兜底刷新矩形缓存（覆盖漏刷场景，每次点击仅一次）
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
    lastPaint = cell;
    pdCell = { c: cell.c, r: cell.r, tool: state.tool };
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
  // pointerdown 已在同行同列用同一工具落格 → click 不再重复 applyAt
  // （重复 applyAt 虽是内容 no-op，但要各扫一遍全量放置，8 万符号下白费几十毫秒）
  if (pdCell && pdCell.c === cell.c && pdCell.r === cell.r && pdCell.tool === state.tool) return;
  applyAt(cell.c, cell.r);
}
/* 必须用 pointermove：网格区只有一个背景 rect 接收事件，
   pointerover 只在进入元素时触发一次，移动中不会更新高亮 */
function onPointerMove(e) {
  if (lastClient && e.clientX === lastClient.x && e.clientY === lastClient.y) return;
  lastClient = { x: e.clientX, y: e.clientY };
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
    // 同格内的高频 move 不重复落格（applyAt 需扫全量放置，move 风暴会占满主线程）
    if (lastPaint && lastPaint.c === cell.c && lastPaint.r === cell.r) return;
    const d = getSym(state.tool);
    if (state.tool === 'erase' || (d && d.w === 1 && d.h === 1)) {
      applyAt(cell.c, cell.r);
      lastPaint = cell;
    }
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
  lastPaint = null;
  // 注意：pdCell 不在这里清——pointerup 先于 click 触发，click 的
  // 去重要靠它（下次 pointerdown 会覆盖）
}
function onPointerLeave() {
  lastHoverKey = null;
  updateGhost(null);
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

/* ---- 粘贴预览内容：ghost 框里照实画出（镜像后的）复制块，方便确认落位 ----
   坐标变换与 pasteAt 完全同源：块内相对格位 → 世界格位，镜像时按符号
   占格整块翻转；符号图形带 fx/fy 的镜像由 SVG transform 实现（与位图
   渲染一致）。ghost 不显示时（指针不在网格上）返回 null 整组不渲染 */
const pasteGhost = computed(() => {
  if (!ghost.visible || state.tool !== 'paste' || !clipBoard.data) return null;
  const cb = clipBoard.data;
  const x0 = ghost.x, y0 = ghost.y; // 粘贴块世界左上角（updateGhost 已算好）
  const syms = [], borders = [], annos = [];
  for (const rp of cb.placements) {
    const d = getSym(rp.sym);
    if (!d) continue;
    let cc = rp.col, rr = rp.row;
    if (ui.mirrorH) cc = cb.w - cc - d.w;
    if (ui.mirrorV) rr = cb.h - rr - d.h;
    /* 镜像粘贴只翻转位置：符号与 fx/fy 照原样预览（与 pasteAt 同源） */
    let inner = symbolInnerMarkup(d);
    if (rp.fx) inner = `<g transform="translate(${d.w},0) scale(-1,1)">${inner}</g>`;
    if (rp.fy) inner = `<g transform="translate(0,${d.h}) scale(1,-1)">${inner}</g>`;
    syms.push({ x: x0 + cc, y: y0 + (cb.h - rr - d.h), w: d.w, h: d.h, inner });
  }
  for (const b of (cb.borders || [])) {
    const cc = ui.mirrorH ? cb.w - b.col - b.w : b.col;
    const rr = ui.mirrorV ? cb.h - b.row - b.h : b.row;
    borders.push({ x: x0 + cc, y: y0 + (cb.h - rr - b.h), w: b.w, h: b.h });
  }
  for (const a of (cb.annotations || [])) {
    const cc = ui.mirrorH ? cb.w - a.col - a.w : a.col;
    const rr = ui.mirrorV ? cb.h - a.row - a.h : a.row;
    annos.push({ x: x0 + cc, y: y0 + (cb.h - rr - a.h), w: a.w, h: a.h, text: a.text });
  }
  return { syms, borders, annos };
});

onMounted(() => {
  window.addEventListener('pointerup', onPointerUp);
  layer = createTileLayer({
    host: symLayerEl.value,
    scrollEl: symLayerEl.value ? symLayerEl.value.closest('.canvas-scroll') : null,
    symImage, symBitmap, getSym,
  });
  layer.schedule();
  scrollEl.value = symLayerEl.value ? symLayerEl.value.closest('.canvas-scroll') : null;
  if (scrollEl.value) scrollEl.value.addEventListener('scroll', onScrollVis, { passive: true });
  window.addEventListener('resize', onScrollVis);
  refreshSvgRect();
  updateVis();
  // 自测钩子：滚动虚拟化是异步链（scroll→rAF→渲染），测试用同步入口保证确定性
  window.__chartVis = { update: updateVis, refreshRect: refreshSvgRect };
});
onUnmounted(() => {
  window.removeEventListener('pointerup', onPointerUp);
  if (scrollEl.value) scrollEl.value.removeEventListener('scroll', onScrollVis);
  window.removeEventListener('resize', onScrollVis);
  if (visRaf) cancelAnimationFrame(visRaf);
  if (layer) { layer.destroy(); layer = null; }
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
      @contextmenu.prevent
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

    <!-- 符号层：16 格瓦片 canvas 容器（tileLayer.js 命令式管理，网格线+符号位图） -->
    <div id="symLayer" ref="symLayerEl" :style="canvasStyle"></div>

    <!-- 顶层 SVG：外框 / 边框 / 区域标注 / 框选 / ghost（位于符号位图之上，不接收指针） -->
    <svg id="chartTop" xmlns="http://www.w3.org/2000/svg" :viewBox="viewBox" pointer-events="none">
      <!-- 图解外框（原在 canvas 里画，随位图会糊；SVG 矢量永不糊） -->
      <rect id="chartFrame" x="0.03" y="0.03" :width="state.cols - 0.06" :height="state.rows - 0.06"
        fill="none" stroke="#475569" stroke-width="0.06"/>
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
      <!-- 框选尺寸提示：当前选中 N 行 × M 列 -->
      <text v-if="clipSel.rect" pointer-events="none"
        :x="Math.min(clipSel.rect.c0, clipSel.rect.c1) + 0.05"
        :y="rowTopY(Math.max(clipSel.rect.r0, clipSel.rect.r1)) - 0.12"
        font-size="0.36" font-weight="bold" fill="#1d4ed8"
        stroke="#fff" stroke-width="0.12" style="paint-order: stroke">
        {{ Math.abs(clipSel.rect.r1 - clipSel.rect.r0) + 1 }}行 × {{ Math.abs(clipSel.rect.c1 - clipSel.rect.c0) + 1 }}列
      </text>

      <!-- 放置预览 ghost -->
      <rect id="ghost" pointer-events="none"
        :x="ghost.x" :y="ghost.y" :width="ghost.w" :height="ghost.h"
        :fill="ghost.color" opacity="0.15" :stroke="ghost.color"
        stroke-width="0.04" stroke-dasharray="0.12 0.08"
        :style="{ display: ghost.visible ? '' : 'none' }"/>

      <!-- 粘贴预览内容：照实画出（镜像后的）复制块符号/边框/标注，方便确认落位 -->
      <g v-if="pasteGhost" id="pasteGhost" pointer-events="none" opacity="0.55">
        <svg v-for="(s, i) in pasteGhost.syms" :key="'ps' + i"
          :x="s.x" :y="s.y" :width="s.w" :height="s.h"
          :viewBox="`0 0 ${s.w} ${s.h}`" overflow="visible" v-html="s.inner"/>
        <rect v-for="(b, i) in pasteGhost.borders" :key="'pb' + i"
          :x="b.x" :y="b.y" :width="b.w" :height="b.h"
          fill="none" stroke="#0f172a" stroke-width="0.1"/>
        <g v-for="(a, i) in pasteGhost.annos" :key="'pa' + i">
          <rect :x="a.x" :y="a.y" :width="a.w" :height="a.h"
            fill="#14b8a6" fill-opacity="0.07" stroke="#0d9488"
            stroke-width="0.06" stroke-dasharray="0.18 0.12"/>
          <text :x="a.x + 0.05" :y="a.y - 0.14"
            font-size="0.4" font-weight="bold" fill="#0f766e"
            stroke="#fff" stroke-width="0.12" style="paint-order: stroke">{{ a.text }}</text>
        </g>
      </g>
    </svg>
  </div>
</template>
