<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { addWork, importJson, importArchive } from '../store.js';
import { ui, withLoading, toast } from '../ui.js';

/* 新建作品弹窗：画布尺寸预设 + 名称 + 从文件导入。
   由 HomeView 通过 ui.newWorkOpen 控制显隐。 */
const PRESETS = [
  { id: 'mini', label: '小样', cols: 60, rows: 60 },
  { id: 'std', label: '标准', cols: 100, rows: 100 },
  { id: 'large', label: '加大', cols: 200, rows: 200 },
  { id: 'xl', label: '超大', cols: 400, rows: 400 },
  { id: 'custom', label: '自定义' },
];

const open = ref(false);
const name = ref('');
const preset = ref('std');
const cols = ref(24);
const rows = ref(36);
const nameInput = ref(null);
const fileInput = ref(null);

watch(() => ui.newWorkOpen, async o => {
  open.value = !!o;
  if (!o) return;
  name.value = '';
  preset.value = 'std'; cols.value = 24; rows.value = 36;
  await nextTick();
  if (nameInput.value) nameInput.value.focus();
});

function pickPreset(p) {
  preset.value = p.id;
  if (p.cols) { cols.value = p.cols; rows.value = p.rows; }
}
const clamp = v => Math.min(400, Math.max(4, Math.round(+v) || 0));

function close() { ui.newWorkOpen = false; }

function create() {
  const c = clamp(cols.value) || 24, r = clamp(rows.value) || 36;
  if (!c || !r) { toast('请填写画布的列数和行数', 'warn'); return; }
  close();
  withLoading(() => addWork(name.value, r, c)); // 留空自动命名；建完留在首页，新卡片直接出现在网格里
}

function pickFile() { if (fileInput.value) fileInput.value.click(); }

/* 从文件导入：zip 作品包 / v2 存档 → 追加为新作品；
   v1 单图解存档 → 用文件名（或上面填的名称）立为一个新作品 */
async function onFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const base = file.name.replace(/\.(json|zip)$/i, '');
  try {
    let res;
    if (/\.zip$/i.test(file.name) || /zip/i.test(file.type)) {
      res = await importArchive(file);
    } else {
      res = importJson(await file.text(), name.value.trim() || base);
    }
    close();
    toast(`导入成功：${res.works} 个作品、${res.charts} 张图解`, 'ok');
  } catch (err) {
    toast('导入失败：' + (err && err.message ? err.message : '文件解析错误'), 'warn');
  }
}

/* Enter=创建 / Esc=关闭（与其他弹窗同惯例；AppDialog 会先让路给 dlg.open） */
function onKey(e) {
  if (!open.value || ui.loading) return;
  if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
    e.preventDefault();
    create();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    close();
  }
}
onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <div v-if="open" class="fixed inset-0 bg-black/30 items-center justify-center"
    style="z-index:80;display:flex" @mousedown.self="close">
    <div class="modal-shell w-[380px]" style="animation: tbMenuIn .15s ease-out">
      <div class="modal-head">
        <h2 class="modal-title">新建作品</h2>
      </div>
      <div class="p-4 pt-3">
        <label class="block text-[12px] text-stone-500 mb-1">作品名称</label>
        <input ref="nameInput" v-model="name" spellcheck="false" placeholder="留空自动命名"
          class="w-full border border-stone-300 rounded px-2 py-1.5 text-[13px] bg-white focus:outline-none focus:border-rose-400"
          @keydown.enter.stop>

        <label class="block text-[12px] text-stone-500 mb-1.5 mt-3.5">画布尺寸（列 × 行）</label>
        <div class="flex flex-wrap gap-1.5">
          <button v-for="p in PRESETS" :key="p.id" type="button"
            class="nw-preset" :class="{ 'nw-preset-on': preset === p.id }" @click="pickPreset(p)">
            {{ p.label }}<span v-if="p.cols" class="nw-preset-dim">{{ p.cols }}×{{ p.rows }}</span>
          </button>
        </div>
        <div v-if="preset === 'custom'" class="flex items-center gap-2 mt-2.5">
          <input v-model.number="cols" type="number" min="4" max="400" class="nw-num" aria-label="列数">
          <span class="text-stone-400 text-[12px]">×</span>
          <input v-model.number="rows" type="number" min="4" max="400" class="nw-num" aria-label="行数">
        </div>

        <div class="flex items-center gap-2 mt-4 text-[11px] text-stone-400">
          <span class="flex-1 border-t border-stone-200"></span>或者<span class="flex-1 border-t border-stone-200"></span>
        </div>
        <button type="button" class="mt-3 w-full border border-dashed border-stone-300 rounded px-3 py-2 text-[12.5px] text-stone-600 hover:bg-stone-50 hover:border-stone-400"
          title="支持 .zip 作品包 / .json 存档，导入为一个新作品"
          @click="pickFile">
          📂 从文件导入（.json / .zip）
        </button>
        <input ref="fileInput" type="file" accept=".json,.zip,application/json,application/zip"
          style="display:none" @change="onFile">
      </div>
      <div class="flex justify-end gap-2 px-4 pb-4">
        <button class="border border-stone-300 rounded px-3 py-1.5 bg-white text-[12px] hover:bg-stone-50"
          @click="close">取消</button>
        <button class="rounded px-3 py-1.5 text-[12px] text-white bg-rose-700 hover:bg-rose-800"
          @click="create">创建</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nw-preset {
  border: 1px solid #d6d3d1; border-radius: 6px;
  padding: 4px 8px; font-size: 12px; background: #fff; color: #57534e;
  display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
}
.nw-preset:hover { border-color: #a8a29e; }
.nw-preset-on { border-color: #be123c; color: #be123c; background: #fff1f2; }
.nw-preset-dim { color: #a8a29e; font-size: 11px; }
.nw-preset-on .nw-preset-dim { color: #fb7185; }
.nw-num {
  width: 84px; border: 1px solid #d6d3d1; border-radius: 6px;
  padding: 4px 8px; font-size: 13px; background: #fff;
}
.nw-num:focus { outline: none; border-color: #fb7185; }
</style>
