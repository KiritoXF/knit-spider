<script setup>
import { computed } from 'vue';
import { state, setZoom, ZOOM_MIN, ZOOM_MAX } from '../store.js';
import { CELL, PAD_L, PAD_R, PAD_T, PAD_B, zoomScrollAnchor } from '../util.js';

/* 缩放控件停靠在左栏符号面板最底下：不悬浮在画布上，
   不会挡住格子的点选。Ctrl+滚轮缩放同步走同一 state.zoom。
   按钮缩放以视口中心为锚点，画面不会往左上角跑。 */
const STEP = 0.1;
const pct = computed(() => Math.round(state.zoom * 100));
const atMin = computed(() => state.zoom <= ZOOM_MIN + 1e-6);
const atMax = computed(() => state.zoom >= ZOOM_MAX - 1e-6);
const scrollEl = () => document.querySelector('.canvas-scroll');

function applyZoom(next) {
  const el = scrollEl();
  const prev = state.zoom;
  setZoom(next);
  zoomScrollAnchor(el, prev, state.zoom);
}
function zoomBy(d) { applyZoom(state.zoom + d); }
function resetZoom() { applyZoom(1); }
/* 适应窗口：整张图解装进可视区（大图会缩到 0.2×） */
function fitZoom() {
  const el = scrollEl();
  if (!el || !el.clientWidth || !el.clientHeight) return;
  const zx = el.clientWidth / ((state.cols + PAD_L + PAD_R) * CELL);
  const zy = el.clientHeight / ((state.rows + PAD_T + PAD_B) * CELL);
  applyZoom(Math.min(zx, zy));
}
</script>

<template>
  <div class="zoom-dock" role="group" aria-label="画布缩放">
    <button class="zoom-btn" :disabled="atMin" title="缩小（Ctrl+滚轮向下）"
      aria-label="缩小" @click="zoomBy(-STEP)">−</button>
    <button id="btnZoomReset" class="zoom-val" :class="{ 'zoom-val-off': state.zoom === 1 }"
      title="点击恢复 100%" aria-label="恢复 100% 缩放" @click="resetZoom">{{ pct }}%</button>
    <button class="zoom-btn" :disabled="atMax" title="放大（Ctrl+滚轮向上）"
      aria-label="放大" @click="zoomBy(STEP)">＋</button>
    <button class="zoom-btn zoom-fit" title="适应窗口：整张图解完整显示"
      aria-label="适应窗口" @click="fitZoom">适应</button>
  </div>
</template>
