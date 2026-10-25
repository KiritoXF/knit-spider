<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ui, isModalOpen } from './ui.js';
import { state, setZoom, ZOOM_MIN, ZOOM_MAX, isChartLocked } from './store.js';
import { zoomScrollAnchor } from './util.js';
import ChartCanvas from './components/ChartCanvas.vue';
import PalettePanel from './components/PalettePanel.vue';
import TopBar from './components/TopBar.vue';
import ToolBar from './components/ToolBar.vue';
import ZoomControl from './components/ZoomControl.vue';
import HomeView from './components/HomeView.vue';
import EditorModal from './components/EditorModal.vue';
import TextChartModal from './components/TextChartModal.vue';
import SymbolCenterModal from './components/SymbolCenterModal.vue';
import HelpModal from './components/HelpModal.vue';
import ChangelogModal from './components/ChangelogModal.vue';
import ChartCodeModal from './components/ChartCodeModal.vue';
import ShapingModal from './components/ShapingModal.vue';
import AppDialog from './components/AppDialog.vue';

const locked = computed(() => isChartLocked());

/* Ctrl+滚轮缩放画布：以鼠标位置为锚点，画面不往左上角跳 */
function onWheelZoom(e) {
  const el = e.currentTarget;
  const prev = state.zoom;
  const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev * f)));
  zoomScrollAnchor(el, prev, state.zoom, e.clientX, e.clientY);
}

/* 中键拖动平移：大图不必来回找滚动条 */
let pan = null;
function onPanDown(e) {
  if (e.button !== 1) return;
  e.preventDefault();
  const el = e.currentTarget;
  pan = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
  el.setPointerCapture?.(e.pointerId);
  el.classList.add('panning');
}
function onPanMove(e) {
  if (!pan || pan.id !== e.pointerId) return;
  const el = e.currentTarget;
  el.scrollLeft = pan.left - (e.clientX - pan.x);
  el.scrollTop = pan.top - (e.clientY - pan.y);
}
function onPanUp(e) {
  if (!pan) return;
  const el = e.currentTarget;
  if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
  el.classList.remove('panning');
  pan = null;
}

/* ---- 模态层：焦点不跑出弹窗；全部关闭后把焦点还给打开它的元素 ---- */
const anyModal = computed(() => isModalOpen());
let returnFocus = null;
watch(anyModal, (open, was) => {
  if (open && !was) {
    returnFocus = document.activeElement;
    /* 打开后若焦点还在背景页，把它送进弹窗内（有自带聚焦逻辑的弹窗会抢先） */
    nextTick(() => {
      const root = topModal();
      if (!root || root.contains(document.activeElement)) return;
      const f = focusablesIn(root);
      if (f.length) f[0].focus();
    });
  } else if (!open && was && returnFocus && returnFocus.focus) {
    const el = returnFocus;
    returnFocus = null;
    nextTick(() => { if (el.isConnected) el.focus(); });
  }
});
function topModal() {
  const all = [...document.querySelectorAll('[data-modal]')].filter(el => el.getClientRects().length);
  return all[all.length - 1] || null;
}
function focusablesIn(root) {
  return [...root.querySelectorAll(
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter(el => el.getClientRects().length > 0);
}
function trapTab(e) {
  if (e.key !== 'Tab') return;
  const root = topModal();
  if (!root) return;
  const f = focusablesIn(root);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1], active = document.activeElement;
  if (!root.contains(active)) { e.preventDefault(); first.focus(); return; }
  if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
}
onMounted(() => document.addEventListener('keydown', trapTab, true));
onBeforeUnmount(() => document.removeEventListener('keydown', trapTab, true));
</script>

<template>
  <HomeView v-if="ui.view === 'home'"/>

  <div v-else class="layout">
    <TopBar/>

    <div class="body-row">
      <aside class="sidebar">
        <PalettePanel/>
        <ZoomControl/>
      </aside>

      <main class="main">
        <div v-if="locked" class="lock-banner" role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>
          </svg>
          图解已锁定 · 点页签右侧「解锁」后可继续编辑
        </div>
        <ToolBar/>
        <div class="canvas-scroll" @wheel.ctrl.prevent="onWheelZoom"
          @pointerdown="onPanDown" @pointermove="onPanMove" @pointerup="onPanUp" @pointercancel="onPanUp">
          <ChartCanvas/>
        </div>
      </main>
    </div>
  </div>

  <TextChartModal v-if="ui.view === 'editor'"/>
  <!-- 自定义符号编辑器：图解页与首页符号库都能打开，故挂在最外层（自身按 ui.editorOpen 显隐） -->
  <EditorModal/>
  <SymbolCenterModal/>
  <HelpModal/>
  <ChangelogModal/>
  <ChartCodeModal v-if="ui.view === 'editor'"/>
  <ShapingModal/>
  <AppDialog/>

  <!-- 轻提示 toast（右下角，role=status 让读屏也能听到） -->
  <div class="toast-wrap" role="status" aria-live="polite" aria-atomic="false">
    <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="'toast-' + t.tone">{{ t.msg }}</div>
  </div>

  <!-- 切换作品/图解时的加载遮罩 -->
  <div v-if="ui.loading" class="loading-overlay" role="status" aria-live="polite">
    <span class="loading-ring" aria-hidden="true"></span>
    <div>正在加载图解…</div>
  </div>
</template>
