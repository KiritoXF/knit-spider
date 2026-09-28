<script setup>
import { ref } from 'vue';
import {
  state, resizeGrid, clearAll, clearColLabels, setRowStartSide,
  saveJson, saveChartJson, importJson, activeWork,
  addWork, renameWork, deleteWork, switchWork,
} from '../store.js';
import { ui, withLoading } from '../ui.js';
import { exportSvg } from '../exportSvg.js';

const inCols = ref(state.cols);
const inRows = ref(state.rows);
const fileInput = ref(null);

function goHome() { ui.view = 'home'; }

/* ---- 作品管理 ---- */
function onAddWork() {
  const t = prompt('新作品名称：', '');
  if (t === null) return;
  withLoading(() => addWork(t)); // 留空自动命名
}
function onRenameWork() {
  const w = activeWork();
  if (!w) return;
  const t = prompt('重命名作品：', w.name);
  if (t === null) return;
  renameWork(w.id, t);
}
function onDeleteWork() {
  const w = activeWork();
  if (!w) return;
  if (!confirm(`删除作品「${w.name}」及其下 ${w.charts.length} 个图解？不可恢复。`)) return;
  withLoading(() => deleteWork(w.id));
}

function onSaveWork() { saveJson(); }
function onSaveChart() { saveChartJson(); }

function pickLoadJson() { fileInput.value.click(); }

async function onLoadJson(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    await importJson(await file.text());
  } catch (err) {
    alert('载入失败：' + (err && err.message ? err.message : '文件解析错误'));
  }
}

function applyResize() {
  const cols = Math.min(1000, Math.max(4, +inCols.value || state.cols));
  const rows = Math.min(1000, Math.max(4, +inRows.value || state.rows));
  inCols.value = cols; inRows.value = rows;
  resizeGrid(cols, rows);
}
function onClear() {
  if (!confirm('清空当前图解的全部符号和粗边框？（自定义符号与列号设置保留）')) return;
  clearAll();
}
</script>

<template>
  <header class="topbar">
    <div class="flex items-center gap-2 pr-3 mr-1 border-r border-gray-200">
      <span class="text-base">🧶</span>
      <h1 class="text-sm font-bold whitespace-nowrap">蜘蛛织毛线</h1>
    </div>

    <!-- 作品选择与管理 -->
    <div class="tb-group">
      <button id="btnHome" class="tb-btn" title="返回作品管理页" @click="goHome">⌂ 作品</button>
      <select id="selWork" class="tb-input max-w-32" :value="state.activeWorkId"
        title="切换作品"
        @change="withLoading(() => switchWork($event.target.value))">
        <option v-for="w in state.works" :key="w.id" :value="w.id">{{ w.name }}</option>
      </select>
      <button id="btnAddWork" class="tb-btn" title="新建作品" @click="onAddWork">＋</button>
      <button id="btnRenameWork" class="tb-btn" title="重命名当前作品" @click="onRenameWork">✎</button>
      <button id="btnDelWork" class="tb-btn" title="删除当前作品"
        :disabled="state.works.length <= 1" @click="onDeleteWork">🗑</button>
    </div>

    <div class="tb-group">
      <span class="tb-label">网格</span>
      <div class="flex items-center gap-1 text-xs">
        <span>宽</span>
        <input id="inCols" v-model.number="inCols" type="number"
          class="tb-input w-14" min="4" max="1000">
        <span>行</span>
        <input id="inRows" v-model.number="inRows" type="number"
          class="tb-input w-14" min="4" max="1000">
        <button id="btnResize" class="tb-btn" @click="applyResize">应用</button>
      </div>
    </div>

    <div class="tb-group">
      <span class="tb-label">第1行号</span>
      <select id="inRowSide" class="tb-input"
        :value="state.rowStartSide"
        @change="setRowStartSide($event.target.value)">
        <option value="right">右侧（从右往左）</option>
        <option value="left">左侧（从左往右）</option>
      </select>
    </div>

    <div class="tb-group">
      <button id="btnClearCol" class="tb-btn" title="清除全部手动列号标注"
        @click="clearColLabels">清除列号</button>
    </div>

    <div class="tb-group ml-auto">
      <button id="btnTextChart" class="tb-btn" title="把当前图解转换为逐行文字解（反面行自动换算，可复制/下载txt）"
        @click="ui.textChartOpen = true">文字解</button>
      <button id="btnSaveJson" class="tb-btn" title="把整个作品（全部图解）保存为 JSON 文件"
        @click="onSaveWork">存档</button>
      <button id="btnSaveChartJson" class="tb-btn" title="仅导出当前图解为 JSON 文件"
        @click="onSaveChart">导出图解</button>
      <button id="btnLoadJson" class="tb-btn" title="从 JSON 文件载入：作品包导入为新作品，单图解追加为新图解"
        @click="pickLoadJson">载入</button>
      <input ref="fileInput" type="file" accept=".json,application/json"
        style="display:none" @change="onLoadJson">
      <button id="btnExport" class="tb-btn-primary" @click="exportSvg">导出 SVG</button>
      <button id="btnClear" class="tb-btn-danger" @click="onClear">清空</button>
    </div>
  </header>
</template>
