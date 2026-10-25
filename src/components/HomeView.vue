<script setup>
import {
  state, renameWork, deleteWork, switchWork, switchChart, saveJson,
  THEMES, setTheme,
} from '../store.js';
import { ui, withLoading, appConfirm, appPrompt } from '../ui.js';
import NewWorkModal from './NewWorkModal.vue';

function openWork(w) {
  withLoading(() => { switchWork(w.id); ui.view = 'editor'; });
}
function openChart(w, c) {
  withLoading(() => { switchWork(w.id); switchChart(c.id); ui.view = 'editor'; });
}
function onAdd() {
  ui.newWorkOpen = true; // 尺寸预设 / 名称 / 从文件导入，都在弹窗里选
}
async function onRename(w) {
  const t = await appPrompt({ title: '重命名作品', value: w.name, okText: '保存' });
  if (t === null) return;
  renameWork(w.id, t);
}
async function onDelete(w) {
  const ok = await appConfirm({
    title: '删除作品',
    message: `删除「${w.name}」及其下 ${w.charts.length} 张图解？\n此操作不可恢复。`,
    okText: '删除', danger: true,
  });
  if (ok) withLoading(() => deleteWork(w.id));
}
/* 与作品页「文件 → 存档作品」相同：导出该作品的整包 zip（全部图解 + 教程图） */
function onSave(w) { saveJson(w); }
function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t), now = new Date();
  const pad = n => String(n).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
</script>

<template>
  <div class="home">
    <header class="home-top">
      <div class="home-brand">
        <span class="home-brand-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <circle cx="11" cy="12" r="8.2"/>
            <path d="M3 9.2c4-4 11.5-4 15 .9M3.2 13.2c4-3.6 11-4 14.2 0M5.4 17.2c4-3.8 9.6-4 12.4-.6M8 4.3c2.8 2.8 4.3 6.8 3.8 14M15.2 5.3c2 2.8 2.6 5.6 1.6 8.6"/>
          </svg>
        </span>
        <h1>蜘蛛织毛线</h1>
        <span class="home-count">{{ state.works.length }} 部作品</span>
      </div>
      <div class="flex items-center gap-2">
        <label class="home-theme" title="配色主题">
          <span class="tb-sw-dot" :class="'tb-sw-' + state.theme"></span>
          <select class="tb-input home-theme-sel" :value="state.theme" aria-label="配色主题"
            @change="setTheme($event.target.value)">
            <option v-for="t in THEMES" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
        </label>
        <button id="btnHomeSymbols" class="tb-btn" title="符号库：教程图 / 反面织法 / 移除恢复，随作品 zip 分享"
          @click="ui.symbolOpen = true">
          <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>
          </svg>
          符号库
        </button>
        <button id="btnHomeChangelog" class="tb-btn" title="版本更新记录" @click="ui.changelogOpen = true">
          <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 8v4l2.5 2.5"/><circle cx="12" cy="12" r="9"/>
          </svg>更新日志
        </button>
      </div>
    </header>

    <div class="home-grid">
      <div v-for="w in state.works" :key="w.id" class="work-card" :data-wid="w.id"
        role="button" tabindex="0" :aria-label="'打开作品「' + w.name + '」'"
        title="打开作品" @click="openWork(w)"
        @keydown.enter.self.prevent="openWork(w)" @keydown.space.self.prevent="openWork(w)">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="wc-name" :title="w.name">{{ w.name }}</div>
            <div class="text-[12px] text-gray-500 mt-0.5">
              {{ w.charts.length }} 张图解<span v-if="w.updatedAt"> · {{ fmtTime(w.updatedAt) }}</span>
            </div>
          </div>
          <div class="flex gap-1 flex-none" @click.stop>
            <button class="wc-btn" title="存档作品（整包 zip：全部图解＋教程图）" @click="onSave(w)">
              <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>
              </svg>
            </button>
            <button class="wc-btn" title="重命名" @click="onRename(w)">
              <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>
                <path d="m15 5 4 4"/>
              </svg>
            </button>
            <button class="wc-btn" title="删除" :disabled="state.works.length <= 1" @click="onDelete(w)">
              <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>
              </svg>
            </button>
          </div>
        </div>
        <div v-if="w.charts.length" class="wc-chips">
          <button v-for="c in w.charts" :key="c.id" class="wc-chip"
            :title="'直接打开「' + c.name + '」'" @click.stop="openChart(w, c)">{{ c.name }}</button>
        </div>
      </div>

      <button class="work-card wc-new" @click="onAdd">＋ 新建作品</button>
    </div>

    <NewWorkModal/>

    <footer class="home-foot">
      <span>© 2026 蜘蛛织毛线 ·
        <a href="https://github.com/KiritoXF/knit-spider" target="_blank" rel="noopener noreferrer">KiritoXF</a></span>
    </footer>
  </div>
</template>
