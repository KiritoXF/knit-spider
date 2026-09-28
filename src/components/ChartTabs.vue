<script setup>
import { ref, computed, nextTick } from 'vue';
import {
  state, activeWork, activeChart, switchChart, addChart, renameChart, deleteChart,
  isChartLocked, toggleChartLocked,
} from '../store.js';
import { withLoading } from '../ui.js';

const renamingId = ref(null);
const renameText = ref('');
const work = computed(() => activeWork());
const curLocked = computed(() => isChartLocked());
/* 当前图解最后更改时间（chart.updatedAt 由 store 在图面内容变化时刷新） */
const updText = computed(() => {
  const t = activeChart() && activeChart().updatedAt;
  if (!t) return '';
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  return (d.getFullYear() === new Date().getFullYear() ? '' : d.getFullYear() + '-') +
    (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
});
const updTitle = computed(() => {
  const t = activeChart() && activeChart().updatedAt;
  return t ? '最后更改：' + new Date(t).toLocaleString() : '';
});
function onToggleLock() { toggleChartLocked(); }

function startRename(c) {
  renamingId.value = c.id;
  renameText.value = c.name;
  nextTick(() => {
    const el = document.querySelector('.ctab input');
    if (el) { el.focus(); el.select(); }
  });
}
function commitRename() {
  if (!renamingId.value) return;
  renameChart(renamingId.value, renameText.value);
  renamingId.value = null;
}
function cancelRename() { renamingId.value = null; }
function onAdd() { withLoading(() => addChart()); }
function onSwitch(c) {
  if (c.id === state.activeChartId) return; // 当前图解再点不响应（也不闪 loading）
  withLoading(() => switchChart(c.id));
}
function onDel(c) {
  if (c.locked) { alert(`图解「${c.name}」已锁定，请先解锁再删除。`); return; }
  if (confirm(`删除图解「${c.name}」？该图解内容将不可恢复。`)) {
    withLoading(() => deleteChart(c.id));
  }
}
</script>

<template>
  <div v-if="work" class="chart-tabs">
    <div v-for="c in work.charts" :key="c.id" class="ctab"
      :class="{ 'ctab-on': c.id === state.activeChartId }"
      :title="(c.id === state.activeChartId ? '当前图解（双击重命名）' : '切换到「' + c.name + '」（双击重命名）') + (c.locked ? ' · 已锁定' : '')"
      @click="onSwitch(c)" @dblclick="startRename(c)">
      <input v-if="renamingId === c.id" v-model="renameText" spellcheck="false"
        @blur="commitRename" @keydown.enter="commitRename" @keydown.esc="cancelRename"
        @click.stop @dblclick.stop>
      <span v-else class="ctab-name">{{ c.name }}</span>
      <span v-if="c.locked" class="ctab-lock" title="已锁定（防止误改）">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>
        </svg>
      </span>
      <span v-if="work.charts.length > 1" class="ctab-x" title="删除此图解"
        @click.stop="onDel(c)">×</span>
    </div>
    <button class="ctab-add" title="新建图解" @click="onAdd">＋</button>
    <button class="ctab-lockbtn" :class="{ on: curLocked }"
      :title="curLocked ? '解锁当前图解（恢复编辑）' : '锁定当前图解（完成后防误改）'"
      @click="onToggleLock">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="4" y="11" width="16" height="10" rx="2"/>
        <path v-if="curLocked" d="M8 11V7a4 4 0 0 1 8 0v4"/>
        <path v-else d="M8 11V7a4 4 0 0 1 7.9-1.4"/>
      </svg>
      {{ curLocked ? '已锁定' : '锁定' }}
    </button>
    <span v-if="updText" class="ctab-upd" :title="updTitle">最后更改 {{ updText }}</span>
  </div>
</template>
