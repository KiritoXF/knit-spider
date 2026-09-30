<script setup>
import { ui, toast } from './ui.js';
import { state, setZoom } from './store.js';
import ChartCanvas from './components/ChartCanvas.vue';
import PalettePanel from './components/PalettePanel.vue';
import TopBar from './components/TopBar.vue';
import ToolBar from './components/ToolBar.vue';
import ZoomControl from './components/ZoomControl.vue';
import HomeView from './components/HomeView.vue';
import EditorModal from './components/EditorModal.vue';
import TextChartModal from './components/TextChartModal.vue';
import TutorialModal from './components/TutorialModal.vue';
import SymbolManagerModal from './components/SymbolManagerModal.vue';
import HelpModal from './components/HelpModal.vue';
import AppDialog from './components/AppDialog.vue';

/* Ctrl+滚轮缩放画布（与工具栏滑条同源 state.zoom） */
function onWheelZoom(e) {
  const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  setZoom(Math.min(2.5, Math.max(0.5, state.zoom * f)));
}
</script>

<template>
  <HomeView v-if="ui.view === 'home'"/>

  <div v-else class="layout">
    <TopBar/>

    <div class="body-row">
      <aside class="sidebar">
        <PalettePanel/>
      </aside>

      <main class="main">
        <ToolBar/>
        <div class="canvas-scroll" @wheel.ctrl.prevent="onWheelZoom">
          <ChartCanvas/>
        </div>
        <ZoomControl/>
      </main>
    </div>
  </div>

  <TextChartModal v-if="ui.view === 'editor'"/>
  <!-- 自定义符号编辑器：图解页与首页符号库都能打开，故挂在最外层（自身按 ui.editorOpen 显隐） -->
  <EditorModal/>
  <TutorialModal/>
  <SymbolManagerModal/>
  <HelpModal/>
  <AppDialog/>

  <!-- 轻提示 toast（右下角） -->
  <div class="toast-wrap">
    <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="'toast-' + t.tone">{{ t.msg }}</div>
  </div>

  <!-- 切换作品/图解时的加载遮罩 -->
  <div v-if="ui.loading" class="loading-overlay">
    <div class="loading-yarn">🧶</div>
    <div>正在加载图解…</div>
  </div>
</template>
