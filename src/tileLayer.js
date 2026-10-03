/* 符号层瓦片渲染器（2026-10-03，取代单块全画布 #symCanvas）。
   动机：单 canvas 的 backing store 被全局像素帽压住，世界越大整块被等比压小，
   符号越糊（1000×1000 时被压到 1/36）；且每次重绘都要遍历全部放置。
   方案：固定 TILE 格见方的瓦片 canvas，各自按设备像素比全分辨率渲染
   （无全局像素帽 → 任何尺寸不糊），只保活可视区附近 ±1 圈，LRU 逐出。
   交互不变：瓦片是普通绝对定位元素随宿主 div 被原生滚动，不劫持滚动
   （勿重蹈 57afe4b sticky 视口的覆辙）。
   脏区策略（方案 A）：contentRev 变化 → O(N) 重建瓦片桶 → 只重渲可见块；
   滚动/尺寸变化 → reconcile 增量建块。若将来实测编辑超标，后备方案 B：
   store 变更函数返回受影响 bbox，只重渲相交块（本文件留有分界注释）。 */
import { toRaw } from 'vue';
import { state, contentRev } from './store.js';
import { CELL } from './util.js';

export const TILE = 16;              // 每瓦片格数（见方）；zoom2.5×dpr2 时单块 backing ≈ 5M 像素
const MAX_TILES = 96;                // LRU 块数上限
const MAX_BYTES = 160 * 1024 * 1024; // LRU 字节上限（dpr 变化块变大，按字节比按块数稳）
const TILE_BACKING = 4096;           // 单块 backing 边长上限（16 格 × 2.5 zoom × 2 dpr = 2240，远够）

export function createTileLayer({ host, scrollEl, symImage, getSym }) {
  const cache = new Map();   // 'tc,tr' → {cv, tc, tr, use, gen, rev, rendered}
  const pool = [];           // 逐出回收的 canvas，复用避免 GC 抖动
  let useCounter = 0;
  let raf = 0;
  let gen = 0;               // 布局代次：zoom/dpr/网格尺寸/换图 变化 → 全部失效
  let lastSig = '';
  let buckets = new Map();   // 'tc,tr' → [placement,…]（含跨块符号）
  let bucketRev = -1;        // 桶对应的 contentRev
  let lastVis = [];          // 最近一次 reconcile 的可见块
  let waiters = [];          // readyTiles 等待者
  let destroyed = false;
  let mq = null;             // devicePixelRatio 变化监听

  const key = (tc, tr) => tc + ',' + tr;
  const nColTiles = () => Math.ceil(state.cols / TILE);
  const nRowTiles = () => Math.ceil(state.rows / TILE);
  const px = () => CELL * state.zoom;
  const tileCss = () => TILE * px();
  const layoutSig = () =>
    state.cols + 'x' + state.rows + '@' + state.zoom + ':' + (window.devicePixelRatio || 1);

  /* ---- 瓦片桶：placement 按足迹落入所有触及块（跨块符号每块各画裁剪段） ---- */
  function ensureBuckets() {
    if (bucketRev === contentRev.n) return;
    bucketRev = contentRev.n;
    buckets = new Map();
    for (const p of toRaw(state.placements)) {
      const w = p.w || 1, h = p.h || 1;
      const y0 = state.rows - p.row - h + 1;      // 顶边所在世界 y（格）
      const tc0 = Math.floor(p.col / TILE), tc1 = Math.floor((p.col + w - 1) / TILE);
      const tr0 = Math.floor(y0 / TILE), tr1 = Math.floor((y0 + h - 1) / TILE);
      for (let tr = tr0; tr <= tr1; tr++) for (let tc = tc0; tc <= tc1; tc++) {
        const k = key(tc, tr);
        let b = buckets.get(k);
        if (!b) { b = []; buckets.set(k, b); }
        b.push(p);
      }
    }
  }

  function ensure(tc, tr) {
    const k = key(tc, tr);
    let t = cache.get(k);
    if (t) return t;
    const cv = pool.pop() || document.createElement('canvas');
    t = { cv, tc, tr, use: 0, gen: -1, rev: -1, rendered: false };
    cache.set(k, t);
    host.appendChild(cv);
    return t;
  }

  /* ---- 渲染一块：网格线 + 本块桶内的符号位图 blit ----
     网格线画 i=0..cells（含右/下边）：共享边被相邻两块各画一半（各自被
     canvas 边界裁剪），拼起来恰是一条完整线，无重叠也无缺缝 */
  function renderTile(t) {
    const { rows, cols, zoom } = state;
    const p1 = CELL * zoom, ts = TILE * p1;
    const cellCols = Math.min(TILE, cols - t.tc * TILE);
    const cellRows = Math.min(TILE, rows - t.tr * TILE);
    const cssW = cellCols * p1, cssH = cellRows * p1;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(dpr, TILE_BACKING / cssW, TILE_BACKING / cssH);
    const bw = Math.max(1, Math.round(cssW * scale)), bh = Math.max(1, Math.round(cssH * scale));
    if (t.cv.width !== bw || t.cv.height !== bh) { t.cv.width = bw; t.cv.height = bh; }
    t.cv.dataset.tc = t.tc; // 自测 blockHasInk 按此定位瓦片
    t.cv.dataset.tr = t.tr;
    t.cv.style.left = (t.tc * ts) + 'px';
    t.cv.style.top = (t.tr * ts) + 'px';
    t.cv.style.width = cssW + 'px';
    t.cv.style.height = cssH + 'px';
    const ctx = t.cv.getContext('2d');
    /* 注意：setTransform 的 e,f 是设备像素偏移、不参与 a,d 缩放——
       平移量必须先乘 scale（曾漏乘导致 tc/tr>0 的瓦片内容整体错位） */
    ctx.setTransform(scale, 0, 0, scale, -t.tc * ts * scale, -t.tr * ts * scale);
    ctx.clearRect(t.tc * ts, t.tr * ts, ts, ts);
    t.dbgDraw = 0; t.dbgSkip = 0;
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.025 * p1;
    ctx.beginPath();
    const x0 = t.tc * TILE * p1, y0 = t.tr * TILE * p1;
    for (let i = 0; i <= cellCols; i++) {
      const x = x0 + i * p1;
      ctx.moveTo(x, y0); ctx.lineTo(x, y0 + cssH);
    }
    for (let i = 0; i <= cellRows; i++) {
      const y = y0 + i * p1;
      ctx.moveTo(x0, y); ctx.lineTo(x0 + cssW, y);
    }
    ctx.stroke();
    const b = buckets.get(key(t.tc, t.tr));
    if (b) for (const p of b) {
      const sym = getSym(p.sym);
      if (!sym) continue;
      const img = symImage(sym);
      if (!img.complete || !img.naturalWidth) continue; // 解码中，onload 后整体重渲
      /* 与瓦片求交后按源矩形裁剪绘制：目标坐标恒在瓦片内（≥0）。
         直接整图 drawImage 会出现负目标坐标——Chromium 对 SVG 图像 +
         负目标偏移有裁剪错位 bug（跨块符号右半段会丢），勿回退 */
      const sy0w = rows - p.row - p.h + 1;               // 符号顶边（世界 y，格）
      const dx0 = p.col * p1, dy0 = sy0w * p1;           // 符号世界 css 矩形
      const dw = p.w * p1, dh = p.h * p1;
      const vx0 = Math.max(dx0, t.tc * ts), vx1 = Math.min(dx0 + dw, (t.tc + 1) * ts);
      const vy0 = Math.max(dy0, t.tr * ts), vy1 = Math.min(dy0 + dh, (t.tr + 1) * ts);
      if (vx1 <= vx0 || vy1 <= vy0) continue;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const u0 = (vx0 - dx0) / dw * iw, v0 = (vy0 - dy0) / dh * ih;
      const uw = (vx1 - vx0) / dw * iw, vh = (vy1 - vy0) / dh * ih;
      ctx.drawImage(img, u0, v0, uw, vh, vx0, vy0, vx1 - vx0, vy1 - vy0);
      t.dbgDraw++;
    }
    t.gen = gen;
    t.rev = bucketRev;
    t.rendered = true;
  }

  /* ---- 逐出：非可见块按最久未用先出，受块数与字节双上限约束 ---- */
  function evict(bytesNow, visSet) {
    let bytes = bytesNow;
    const cands = [...cache.values()].filter(t => !visSet.has(t))
      .sort((a, b) => a.use - b.use);
    for (const t of cands) {
      if (cache.size <= MAX_TILES && bytes <= MAX_BYTES) break;
      bytes -= t.cv.width * t.cv.height * 4;
      cache.delete(key(t.tc, t.tr));
      t.cv.width = 0; t.cv.height = 0; // 释放 backing
      t.cv.remove();
      pool.push(t.cv);
    }
  }

  function allVisibleRendered() {
    return lastVis.every(t => t.rendered && t.gen === gen && t.rev === bucketRev);
  }
  function flushWaitersIfDone() {
    if (!allVisibleRendered() || raf) return;
    const ws = waiters; waiters = [];
    ws.forEach(r => r());
  }

  /* ---- reconcile：保证可视区 ±1 圈的块存在且已渲染 ----
     内容没变且块已渲染时直接跳过（滚动往返零成本） */
  function reconcile() {
    if (destroyed || !host.isConnected) return;
    const sig = layoutSig();
    if (sig !== lastSig) { invalidate(); lastSig = sig; }
    ensureBuckets();
    const ts = tileCss();
    let c0 = 0, r0 = 0, c1 = nColTiles() - 1, r1 = nRowTiles() - 1;
    if (scrollEl) {
      c0 = Math.max(0, Math.floor(scrollEl.scrollLeft / ts) - 1);
      r0 = Math.max(0, Math.floor(scrollEl.scrollTop / ts) - 1);
      c1 = Math.min(c1, Math.floor((scrollEl.scrollLeft + scrollEl.clientWidth) / ts) + 1);
      r1 = Math.min(r1, Math.floor((scrollEl.scrollTop + scrollEl.clientHeight) / ts) + 1);
    }
    const vis = [];
    let bytes = 0;
    for (let tr = r0; tr <= r1; tr++) for (let tc = c0; tc <= c1; tc++) {
      const t = ensure(tc, tr);
      t.use = ++useCounter;
      vis.push(t);
      bytes += t.cv.width * t.cv.height * 4;
    }
    lastVis = vis;
    for (const t of vis)
      if (t.gen !== gen || t.rev !== bucketRev || !t.rendered) renderTile(t);
    evict(bytes, new Set(vis));
    flushWaitersIfDone();
  }

  function schedule() {
    if (raf || destroyed) return;
    raf = requestAnimationFrame(() => { raf = 0; reconcile(); });
  }

  /* 布局代次失效：zoom / dpr / 网格尺寸变化时由 layoutSig 比对自动触发，
     也可显式调用（换图解等） */
  function invalidate() {
    gen++;
    for (const t of cache.values()) {
      t.cv.width = 0; t.cv.height = 0;
      t.cv.remove();
      pool.push(t.cv);
    }
    cache.clear();
  }

  /* 符号位图解码完成后调用：已渲染的瓦片当时画的是空帧，全部标记待重渲。
     （reconcile 对已渲染块是跳过的——不标记的话，迟到的符号永远画不上） */
  function markAllDirty() {
    for (const t of cache.values()) t.rendered = false;
  }

  function readyTiles() {
    if (destroyed || (!raf && allVisibleRendered())) return Promise.resolve();
    return new Promise(r => waiters.push(r));
  }

  function onDpr() {
    watchDpr();          // 重新订阅新 dpr
    schedule();          // layoutSig 含 dpr → reconcile 内自动失效
  }
  function watchDpr() {
    const d = window.devicePixelRatio || 1;
    if (mq && mq.__dpr === d) return;
    if (mq) mq.removeEventListener('change', onDpr);
    mq = window.matchMedia(`(resolution: ${d}dppx)`);
    mq.__dpr = d;
    mq.addEventListener('change', onDpr);
  }

  function onScroll() { schedule(); }
  function onResize() { schedule(); }
  if (!destroyed) {
    if (scrollEl) scrollEl.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    watchDpr();
  }

  function destroy() {
    destroyed = true;
    if (raf) cancelAnimationFrame(raf);
    if (scrollEl) scrollEl.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    if (mq) mq.removeEventListener('change', onDpr);
    invalidate();
  }

  return {
    TILE,
    reconcile,           // 同步强制重渲可见块（自测 redraw 用）
    schedule,            // rAF 节流的常规重渲入口
    invalidate,          // 布局代次失效（换图解等）
    markAllDirty,        // 符号位图解码完成后标记全部缓存块待重渲
    readyTiles,
    destroy,
    debug() {            // 诊断用：缓存块/桶/代次状态快照
      return {
        sig: lastSig, curSig: layoutSig(), gen, bucketRev, rev: contentRev.n,
        buckets: [...buckets.entries()].map(([k, b]) => k + ':' + b.length),
        tiles: [...cache.values()].map(t => ({
          tc: t.tc, tr: t.tr, w: t.cv.width, h: t.cv.height,
          rendered: t.rendered, tgen: t.gen, trev: t.rev, inDom: t.cv.isConnected,
          draw: t.dbgDraw, skip: t.dbgSkip,
        })),
        sc: scrollEl ? { sw: scrollEl.scrollWidth, sh: scrollEl.scrollHeight,
          cw: scrollEl.clientWidth, ch: scrollEl.clientHeight,
          sl: scrollEl.scrollLeft, st: scrollEl.scrollTop } : null,
      };
    },
  };
}
