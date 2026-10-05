<script setup>
import { computed } from 'vue';
import { state, setZoom } from '../store.js';

/* 缩放控件停靠在左栏符号面板最底下：不悬浮在画布上，
   不会挡住格子的点选。Ctrl+滚轮缩放同步走同一 state.zoom。 */
const MIN = 0.5, MAX = 2.5, STEP = 0.1;
const pct = computed(() => Math.round(state.zoom * 100));
const atMin = computed(() => state.zoom <= MIN + 1e-6);
const atMax = computed(() => state.zoom >= MAX - 1e-6);

function zoomBy(d) {
  setZoom(Math.min(MAX, Math.max(MIN, +(state.zoom + d).toFixed(2))));
}
function resetZoom() { setZoom(1); }
</script>

<template>
  <div class="zoom-dock" role="group" aria-label="画布缩放">
    <button class="zoom-btn" :disabled="atMin" title="缩小（Ctrl+滚轮向下）"
      aria-label="缩小" @click="zoomBy(-STEP)">−</button>
    <button id="btnZoomReset" class="zoom-val" :class="{ 'zoom-val-off': state.zoom === 1 }"
      title="点击恢复 100%" @click="resetZoom">{{ pct }}%</button>
    <button class="zoom-btn" :disabled="atMax" title="放大（Ctrl+滚轮向上）"
      aria-label="放大" @click="zoomBy(STEP)">＋</button>
  </div>
</template>
