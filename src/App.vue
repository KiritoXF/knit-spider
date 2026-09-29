<script setup>
import { ui } from './ui.js';
import ChartCanvas from './components/ChartCanvas.vue';
import PalettePanel from './components/PalettePanel.vue';
import TopBar from './components/TopBar.vue';
import ToolBar from './components/ToolBar.vue';
import ChartTabs from './components/ChartTabs.vue';
import HomeView from './components/HomeView.vue';
import EditorModal from './components/EditorModal.vue';
import TextChartModal from './components/TextChartModal.vue';
import TutorialModal from './components/TutorialModal.vue';
</script>

<template>
  <HomeView v-if="ui.view === 'home'"/>

  <div v-else class="layout">
    <TopBar/>

    <div class="body-row">
      <aside class="sidebar">
        <PalettePanel/>

        <div class="text-xs font-semibold text-gray-600 mb-1">操作说明</div>
        <p class="text-xs text-gray-500 leading-relaxed">
          单击放符号 · 按住拖动连续画<br>
          消去 / 边框 / 框选在顶部工具栏<br>
          框选后复制，再点粘贴放到目标处<br>
          框选后点「标注」给区域命名（如重复花样）<br>
          Ctrl+Z 撤销 · Ctrl+Y 重做<br>
          右键 / 消去工具删除符号<br>
          点行号高亮当前行<br>
          <b>单击列下方</b>标注列号（留空=清除）<br>
          图解完成后点页签栏「锁定」防误改
        </p>
        <p class="text-[10px] text-gray-400 mt-3 leading-relaxed">
          行号从第 1 行起逐行左右交替。<br>
          图稿自动保存在浏览器本地。
        </p>
      </aside>

      <main class="main">
        <ChartTabs/>
        <ToolBar/>
        <div class="canvas-scroll">
          <ChartCanvas/>
        </div>
      </main>
    </div>
  </div>

  <EditorModal v-if="ui.view === 'editor'"/>
  <TextChartModal v-if="ui.view === 'editor'"/>
  <TutorialModal/>

  <!-- 切换作品/图解时的加载遮罩 -->
  <div v-if="ui.loading" class="loading-overlay">
    <div class="loading-spin"></div>
    <div>正在加载图解…</div>
  </div>
</template>
