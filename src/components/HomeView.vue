<script setup>
import {
  state, addWork, renameWork, deleteWork, switchWork, switchChart,
} from '../store.js';
import { ui, withLoading } from '../ui.js';

function openWork(w) {
  withLoading(() => { switchWork(w.id); ui.view = 'editor'; });
}
function openChart(w, c) {
  withLoading(() => { switchWork(w.id); switchChart(c.id); ui.view = 'editor'; });
}
function onAdd() {
  const t = prompt('新作品名称：', '');
  if (t === null) return;
  withLoading(() => { addWork(t); ui.view = 'editor'; }); // 留空自动命名
}
function onRename(w) {
  const t = prompt('重命名作品：', w.name);
  if (t === null) return;
  renameWork(w.id, t);
}
function onDelete(w) {
  if (!confirm(`删除作品「${w.name}」及其下 ${w.charts.length} 张图解？不可恢复。`)) return;
  withLoading(() => deleteWork(w.id));
}
function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t), now = new Date();
  const pad = n => String(n).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
</script>

<template>
  <div class="home">
    <header class="home-top">
      <div class="flex items-center gap-2">
        <span class="text-xl">🧶</span>
        <h1 class="text-base font-bold">蜘蛛织毛线</h1>
        <span class="text-xs text-gray-400">{{ state.works.length }} 部作品</span>
      </div>
      <button id="btnHomeAdd" class="tb-btn-primary" @click="onAdd">＋ 新建作品</button>
    </header>

    <div class="home-grid">
      <div v-for="w in state.works" :key="w.id" class="work-card" :data-wid="w.id"
        title="打开作品" @click="openWork(w)">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="wc-name" :title="w.name">{{ w.name }}</div>
            <div class="text-[11px] text-gray-400 mt-0.5">
              {{ w.charts.length }} 张图解<span v-if="w.updatedAt"> · {{ fmtTime(w.updatedAt) }}</span>
            </div>
          </div>
          <div class="flex gap-1 flex-none" @click.stop>
            <button class="wc-btn" title="重命名" @click="onRename(w)">✎</button>
            <button class="wc-btn" title="删除" :disabled="state.works.length <= 1"
              @click="onDelete(w)">🗑</button>
          </div>
        </div>
        <div v-if="w.charts.length" class="wc-chips">
          <button v-for="c in w.charts" :key="c.id" class="wc-chip"
            :title="'直接打开「' + c.name + '」'" @click.stop="openChart(w, c)">{{ c.name }}</button>
        </div>
      </div>

      <button class="work-card wc-new" @click="onAdd">＋ 新建作品</button>
    </div>
  </div>
</template>
