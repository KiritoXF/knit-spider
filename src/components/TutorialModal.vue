<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { ui, dlg, toast, appConfirm } from '../ui.js';
import { state, getSym } from '../store.js';
import { listTutorials, putTutorial, deleteTutorial, tutorialObjectUrl } from '../tutorialStore.js';
import { tutorialUrlForSid } from '../tutorials.js';
import { SYMBOLS, PALETTE_ORDER } from '../symbols.js';
import { symDataUrl } from '../util.js';

/* ---- 织法教程图管理（针法字典）：左侧按符号挑选，右侧为该符号上传/替换教程图 ----
   上传不再按文件名猜符号 id，改为「先选符号 → 传图」；图片存 IndexedDB（sid 为主键，
   同 sid 覆盖，不可能存进两条相同 key）；导出作品 zip 时随包分享。
   红色圆点=我上传的，灰色圆点=内置图，虚线圈=未配置。
   游离记录：sid 不属于任何内置/自定义符号（旧版 zip 按中文文件名导入会产生），
   在符号网格里无处显示，单独列出可清理。 */

const q = ref('');
const filter = ref('all');   // 'all' 全部 | 'mine' 我上传的 | 'none' 未配置
const selId = ref(null);
const mineList = ref([]);
const dropOver = ref(false);
const errMsg = ref('');
const okMsg = ref('');
let okTimer = null;
const fileInput = ref(null);
let pendingSid = null; // 正在为哪个符号选图

function refresh() { mineList.value = listTutorials(); }

/* Esc 关闭（应用内对话框 dlg.open 让路） */
function onKey(e) {
  if (e.key !== 'Escape' || !ui.tutorialOpen || dlg.open) return;
  ui.tutorialOpen = false;
}
onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => document.removeEventListener('keydown', onKey));

watch(() => ui.tutorialOpen, v => {
  if (!v) return;
  refresh();
  errMsg.value = ''; okMsg.value = '';
  if (selId.value && !getSym(selId.value)) selId.value = null;
});

const mineMap = computed(() => {
  const m = new Map();
  for (const it of mineList.value) m.set(it.sid, it);
  return m;
});

/* 游离教程图：sid 不对应任何内置符号或当前自定义符号（多半来自旧版 zip 按文件名导入）。
   这些图文字解永远查不到，符号网格里也不显示，单独提示可一键清理 */
const orphanSids = computed(() => {
  const customs = new Set((state.customSymbols || []).map(c => c.id));
  return mineList.value.map(it => it.sid)
    .filter(sid => !SYMBOLS[sid] && !customs.has(sid));
});

async function cleanOrphans() {
  const n = orphanSids.value.length;
  if (!n) return;
  const ok = await appConfirm({
    title: '清理无法识别的教程图',
    message: `检测到 ${n} 张教程图的符号 id 在当前符号库中找不到（可能是旧版 zip 导入留下的，文字解不会使用它们）。\n清理后不影响其他教程图，确定删除？`,
    okText: '清理', danger: true,
  });
  if (!ok) return;
  for (const sid of orphanSids.value.slice()) await deleteTutorial(sid);
  refresh();
  toast(`已清理 ${n} 张无法识别的教程图`, 'ok');
}

const items = computed(() => {
  mineMap.value; // 上传库刷新后重算列表
  const kw = q.value.trim().toLowerCase();
  const out = [];
  const seen = new Set();
  const push = id => {
    if (seen.has(id)) return;
    const sym = getSym(id);
    if (!sym) return;
    seen.add(id);
    const hasMine = mineMap.value.has(id);
    if (filter.value === 'mine' && !hasMine) return;
    if (filter.value === 'none' && tutorialUrlForSid(id)) return;
    if (kw && !String(sym.name || '').toLowerCase().includes(kw) && !id.toLowerCase().includes(kw)) return;
    out.push({ id, name: sym.name || id });
  };
  for (const id of PALETTE_ORDER) push(id);
  for (const c of state.customSymbols) push(c.id);
  return out;
});

const sel = computed(() => {
  const id = selId.value;
  const sym = id && getSym(id);
  if (!sym) return null;
  return {
    id, sym,
    isCustom: !SYMBOLS[id],
    hasMine: mineMap.value.has(id),
    mineUrl: tutorialObjectUrl(id),
    tutUrl: tutorialUrlForSid(id), // 用户上传优先，否则内置，否则 null
  };
});

function pickFor(sid) {
  pendingSid = sid || (sel.value && sel.value.id);
  if (!pendingSid) return;
  fileInput.value.click();
}

function flashOk(t) {
  okMsg.value = t;
  clearTimeout(okTimer);
  okTimer = setTimeout(() => { okMsg.value = ''; }, 2500);
}

async function saveOne(sid, f) {
  errMsg.value = ''; okMsg.value = '';
  try {
    await putTutorial(sid, f, f.name);
    flashOk(`已为「${sid}」设置教程图`);
  } catch (err) {
    errMsg.value = '保存失败：' + (err && err.message ? err.message : f.name);
  }
  refresh();
}

async function onFiles(e) {
  const f = (e.target.files || [])[0];
  e.target.value = '';
  if (f && pendingSid) await saveOne(pendingSid, f);
  pendingSid = null;
}

async function onDrop(ev) {
  dropOver.value = false;
  const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
  if (!f) return;
  if (!sel.value) { errMsg.value = '先在左侧选择一个符号'; return; }
  if (!/^image\//.test(f.type)) { errMsg.value = '请拖入图片文件'; return; }
  await saveOne(sel.value.id, f);
}

async function onDel() {
  const it = sel.value;
  if (!it || !it.hasMine) return;
  if (!confirm(`删除「${it.id}」的教程图？（不影响内置图）`)) return;
  await deleteTutorial(it.id);
  refresh();
}
</script>

<template>
  <div v-if="ui.tutorialOpen" class="fixed inset-0 bg-black/30 items-center justify-center"
    style="z-index:50;display:flex" @mousedown.self="ui.tutorialOpen = false">
    <div class="bg-white rounded-xl shadow-2xl w-[880px] max-w-[calc(100vw-24px)] max-h-[88vh]
      overflow-hidden flex flex-col">
      <!-- 头部：针法字典 -->
      <div class="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-dashed border-rose-200"
        style="background:linear-gradient(180deg,#fffdf8,#ffffff)">
        <span class="text-lg">🧵</span>
        <div class="min-w-0">
          <h2 class="font-bold text-sm tracking-wide">织法教程图 · 针法字典</h2>
          <p class="text-[11px] text-gray-400 mt-0.5">左侧选符号，右侧上传图片；文字解里悬停针法名即可查看</p>
        </div>
        <button id="tutClose" class="ml-auto text-xl leading-none px-2 text-gray-400 hover:text-gray-700"
          @click="ui.tutorialOpen = false">×</button>
      </div>

      <div class="flex min-h-0 flex-1">
        <!-- 左：符号字典 -->
        <div class="w-[300px] flex-none border-r border-stone-100 flex flex-col min-h-0">
          <div class="px-3 pt-3 pb-2 space-y-2">
            <input id="tutSearch" v-model="q" type="search" placeholder="搜符号名或 id，如 麻花 / c22L"
              class="w-full text-xs border border-stone-200 rounded-md px-2.5 py-1.5 bg-stone-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-200">
            <div class="flex gap-1 items-center">
              <button v-for="f in [['all','全部'],['mine','我的图'],['none','未配置']]" :key="f[0]"
                class="text-[11px] rounded-full px-2.5 py-1 border transition-colors"
                :class="filter === f[0] ? 'bg-rose-500 text-white border-rose-500'
                  : 'bg-white text-gray-500 border-stone-200 hover:border-rose-300'"
                @click="filter = f[0]">{{ f[1] }}</button>
              <span class="ml-auto text-[11px] text-gray-400">{{ items.length }} 个符号</span>
            </div>
          </div>
          <!-- 游离教程图警告：sid 不属于任何符号（旧版 zip 导入可能产生） -->
          <div v-if="orphanSids.length"
            class="mx-3 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700">
            <div class="flex items-start gap-1.5">
              <span class="flex-none">⚠️</span>
              <div class="min-w-0 flex-1">
                <div class="font-bold">{{ orphanSids.length }} 张教程图无法匹配符号</div>
                <div class="mt-0.5 text-amber-600/90 break-all leading-snug">
                  id：{{ orphanSids.join('、') }}
                </div>
                <button class="mt-1.5 text-[11px] rounded border border-amber-300 bg-white px-2 py-0.5 text-amber-700 hover:bg-amber-100"
                  @click="cleanOrphans">清理这些图</button>
              </div>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto px-3 pb-3">
            <div class="grid grid-cols-3 gap-1.5">
              <button v-for="it in items" :key="it.id"
                class="relative rounded-lg border p-1.5 flex flex-col items-center gap-1 transition-all"
                :class="selId === it.id ? 'border-rose-400 bg-rose-50/70 ring-2 ring-rose-200'
                  : 'border-stone-200 bg-white hover:border-rose-300 hover:shadow-sm'"
                :title="it.name + '（' + it.id + '）'" @click="selId = it.id">
                <img :src="symDataUrl(getSym(it.id))" alt="" class="h-8 max-w-full object-contain pointer-events-none">
                <span class="text-[10px] text-gray-600 w-full truncate text-center leading-tight">{{ it.name }}</span>
                <span class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                  :class="mineMap.has(it.id) ? 'bg-rose-500'
                    : (tutorialUrlForSid(it.id) ? 'bg-stone-300' : 'border border-dashed border-stone-300')"></span>
              </button>
            </div>
            <p v-if="!items.length" class="text-xs text-gray-400 text-center py-8">没有匹配的符号</p>
          </div>
        </div>

        <!-- 右：选中符号的教程图 -->
        <div class="flex-1 min-w-0 p-5 flex flex-col min-h-0" v-if="sel">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-lg border border-stone-200 bg-stone-50 flex items-center justify-center flex-none">
              <img :src="symDataUrl(sel.sym)" alt="" class="h-9 max-w-[40px] object-contain">
            </div>
            <div class="min-w-0">
              <div class="font-bold text-sm">{{ sel.sym.name || sel.id }}</div>
              <div class="text-[11px] text-gray-400 font-mono">{{ sel.id }}<span v-if="sel.isCustom"> · 自定义符号</span></div>
            </div>
            <span v-if="sel.hasMine" class="ml-auto flex-none text-[11px] rounded-full bg-rose-100 text-rose-600 px-2 py-0.5">我的图 · 悬停优先显示</span>
            <span v-else-if="sel.tutUrl" class="ml-auto flex-none text-[11px] rounded-full bg-stone-100 text-stone-500 px-2 py-0.5">内置图</span>
            <span v-else class="ml-auto flex-none text-[11px] rounded-full bg-amber-50 text-amber-600 px-2 py-0.5">还没有教程图</span>
          </div>

          <!-- 预览 / 拖放区 -->
          <div class="mt-4 flex-1 min-h-[200px] rounded-xl border-2 border-dashed flex items-center justify-center p-3 transition-colors relative"
            :class="dropOver ? 'border-rose-400 bg-rose-50/60'
              : (sel.tutUrl ? 'border-stone-200 bg-stone-50/60' : 'border-stone-300 bg-stone-50/40')"
            @dragover.prevent="dropOver = true" @dragleave="dropOver = false" @drop.prevent="onDrop">
            <img v-if="sel.tutUrl" :src="sel.tutUrl" alt="" draggable="false"
              class="max-h-[46vh] max-w-full object-contain rounded pointer-events-none select-none">
            <div v-else class="text-center text-gray-400 text-xs leading-relaxed pointer-events-none">
              <div class="text-2xl mb-1">🪄</div>
              还没有「{{ sel.sym.name || sel.id }}」的教程图<br>点击下方按钮上传，或把图片直接拖到这里
            </div>
            <div v-if="sel.tutUrl && dropOver"
              class="absolute inset-0 rounded-xl bg-rose-50/70 border-2 border-rose-400 flex items-center justify-center text-xs text-rose-600">
              松手替换
            </div>
          </div>

          <div class="mt-4 flex items-center gap-2 flex-wrap">
            <button id="tutUpload" class="bg-rose-700 text-white rounded-md px-4 py-1.5 text-sm hover:bg-rose-800"
              @click="pickFor(sel.id)">{{ sel.hasMine ? '替换图片' : '上传图片' }}</button>
            <button v-if="sel.hasMine" id="tutDelete"
              class="border border-red-200 rounded-md px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
              @click="onDel">删除我的图</button>
            <span v-if="okMsg" class="text-xs text-green-600">{{ okMsg }}</span>
            <span v-if="errMsg" class="text-xs text-red-600">{{ errMsg }}</span>
          </div>
        </div>

        <!-- 右侧空态：未选中符号 -->
        <div class="flex-1 min-w-0 p-5 flex flex-col items-center justify-center text-center" v-else>
          <div class="text-4xl mb-3">🧷</div>
          <p class="text-sm text-gray-500">在左侧选一个符号</p>
          <p class="text-[11px] text-gray-400 mt-1">为它上传一张织法教程图，文字解里悬停针法名即可查看</p>
        </div>
      </div>

      <div class="px-5 py-2.5 border-t border-stone-100 text-[11px] text-gray-400">
        🖼 教程图保存在本机浏览器；导出作品 zip 时会一并打包，对方导入 zip 即可获得
      </div>
    </div>
    <input ref="fileInput" type="file" accept="image/*" style="display:none" @change="onFiles">
  </div>
</template>
