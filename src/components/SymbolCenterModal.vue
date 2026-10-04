<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { ui, dlg, toast, appConfirm } from '../ui.js';
import { state, getSym, hideSymbol, restoreSymbol, hiddenSyms, deleteCustom, openEditor, setWsMapping, removeWsMapping } from '../store.js';
import { listTutorials, putTutorial, putTutorialText, deleteTutorial, tutorialObjectUrl } from '../tutorialStore.js';
import { tutorialUrlForSid, tutorialTextForSid } from '../tutorials.js';
import { SYMBOLS, PALETTE_ORDER } from '../symbols.js';
import { WS_SYM } from '../textChart.js';
import { symDataUrl } from '../util.js';
import SymbolArt from './SymbolArt.vue';

/* ---- 符号中心：符号库 + 织法教程合并弹窗（只在首页使用）----
   左侧为符号字典网格（搜索 / 筛选 / 教程状态点 / 已移除区），
   右侧为选中符号的详情：① 教程图 + 文字说明  ② 反面织法  ③ 管理操作。
   原则：
   · 教程图 / 文字说明存 IndexedDB（sid 为主键），导出作品 zip 时随包分享；
     状态点：rose 实心=我的图，rose 空心=只有文字，灰实心=内置图，虚线圈=未配置。
   · 反面织法为本机全局偏好（文字解换算用），默认规则见 textChart.WS_SYM。
   · 符号库是全局的：内置符号「移除」= 从图解页符号面板隐藏（可恢复）；
     自定义符号「删除」= 彻底移除并清理所有图解引用（见 store.deleteCustom）。
   · 游离教程图：sid 不属于任何符号（旧版 zip 按中文文件名导入会产生），
     单独提示可一键清理。 */

const q = ref('');
const filter = ref('all'); // 'all' | 'builtin' | 'custom' | 'mine' | 'none' | 'hidden'
const selId = ref(null);
const mineList = ref([]);
const dropOver = ref(false);
const errMsg = ref('');
const okMsg = ref('');
let okTimer = null;
const fileInput = ref(null);
let pendingSid = null; // 正在为哪个符号选图
const txtDraft = ref(''); // 文字说明编辑稿，失焦即保存

function refresh() { mineList.value = listTutorials(); }

/* Esc 关闭（应用内对话框 dlg.open 让路） */
function onKey(e) {
  if (e.key !== 'Escape' || !ui.symbolOpen || dlg.open) return;
  ui.symbolOpen = false;
}
onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => document.removeEventListener('keydown', onKey));

watch(() => ui.symbolOpen, v => {
  if (!v) return;
  refresh();
  errMsg.value = ''; okMsg.value = '';
  if (selId.value && !getSym(selId.value)) selId.value = null;
});
/* 切换符号时把文字编辑稿换成该符号的现有说明 */
watch(selId, () => {
  txtDraft.value = (sel.value && sel.value.tutText) || '';
});

const mineMap = computed(() => {
  const m = new Map();
  for (const it of mineList.value) m.set(it.sid, it);
  return m;
});

const hidden = computed(() => hiddenSyms());

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

/* 左侧符号字典：内置按 PALETTE_ORDER 在前，自定义在后；
   已移除的内置符号只在「已移除」筛选下出现 */
const items = computed(() => {
  mineMap.value; // 上传库刷新后重算列表
  const kw = q.value.trim().toLowerCase();
  const hiddenSet = new Set(state.hiddenSymbols);
  const seen = new Set();
  const out = [];
  const push = (id, isHidden) => {
    if (seen.has(id)) return;
    const sym = getSym(id);
    if (!sym) return;
    seen.add(id);
    const custom = !SYMBOLS[id];
    if (filter.value === 'hidden') { if (!isHidden) return; }
    else if (isHidden) return;
    if (filter.value === 'builtin' && custom) return;
    if (filter.value === 'custom' && !custom) return;
    const hasMine = mineMap.value.has(id);
    if (filter.value === 'mine' && !hasMine) return;
    if (filter.value === 'none' && (tutorialUrlForSid(id) || tutorialTextForSid(id))) return;
    if (kw && !String(sym.name || '').toLowerCase().includes(kw) && !id.toLowerCase().includes(kw)) return;
    out.push({ id, sym, custom, name: sym.name || id, isHidden });
  };
  for (const id of PALETTE_ORDER) push(id, hiddenSet.has(id));
  for (const c of state.customSymbols) push(c.id, false);
  return out;
});

const sel = computed(() => {
  const id = selId.value;
  const sym = id && getSym(id);
  if (!sym) return null;
  const mine = mineMap.value.get(id) || {};
  return {
    id, sym,
    isCustom: !SYMBOLS[id],
    isHidden: state.hiddenSymbols.includes(id),
    hasMineImg: !!mine.url,   // 我上传的图
    hasMineText: !!mine.text, // 我写的文字
    mineUrl: tutorialObjectUrl(id),
    tutUrl: tutorialUrlForSid(id),   // 用户上传优先，否则内置，否则 null
    tutText: tutorialTextForSid(id), // 用户文字优先，否则内置，否则 null
  };
});

/* ---- ① 教程图 + 文字说明 ---- */
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
  if (!it || !it.hasMineImg) return;
  const keepTxt = it.hasMineText ? '文字说明会保留。' : '';
  const ok = await appConfirm({
    title: '删除教程图',
    message: `删除「${it.id}」的教程图？（不影响内置图）${keepTxt}`,
    okText: '删除', danger: true,
  });
  if (!ok) return;
  await deleteTutorial(it.id);
  refresh();
}

/* 文字说明：失焦即保存（清空即清除），空且无变化不写库 */
async function saveText() {
  const it = sel.value;
  if (!it) return;
  const v = txtDraft.value.replace(/\s+$/, '');
  if (v === (it.tutText || '')) return;
  try {
    await putTutorialText(it.id, v);
    flashOk(v ? '文字说明已保存' : '文字说明已清除');
  } catch (err) {
    errMsg.value = '保存失败：' + (err && err.message ? err.message : '');
  }
  refresh();
}

/* ---- ② 反面织法 ----
   候选目标：全部在库符号（含已移除面板的内置符号，它们仍是合法织法） */
const wsTargets = computed(() => {
  const seen = new Set();
  const out = [];
  for (const id of [...PALETTE_ORDER, ...state.customSymbols.map(s => s.id)]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const sym = getSym(id);
    if (sym) out.push({ id, name: sym.name || id });
  }
  return out;
});
function wsValue(id) {
  if (id in state.wsMap) return state.wsMap[id] || ''; // 有覆盖：目标 id 或 ''（通用）
  return WS_SYM[id] ? '__d' : ''; // 无覆盖：有默认映射选「默认：x」，否则即通用
}
function onWsChange(id, ev) {
  const v = ev.target.value;
  if (v === '__d') removeWsMapping(id);
  else setWsMapping(id, v);
}

/* ---- ③ 管理：移除 / 恢复 / 删除 ---- */
async function onRemove(it) {
  if (it.isCustom) {
    const ok = await appConfirm({
      title: '删除自定义符号',
      message: `删除自定义符号「${it.sym.name}」？\n图上已放置的也会一并删除，且影响所有作品，不可恢复。`,
      okText: '删除', danger: true,
    });
    if (!ok) return;
    deleteCustom(it.id);
    if (selId.value === it.id) selId.value = null;
    toast(`已删除自定义符号「${it.sym.name}」`, 'ok');
  } else {
    hideSymbol(it.id);
    toast(`已移除「${it.sym.name}」，可在左侧「已移除」里恢复`, 'ok');
  }
}

/* 新建/编辑自定义符号借图解页的自定义符号编辑器（全局弹窗，见 App.vue）。
   打开时先收起本弹窗，编辑器关闭后自动重新打开，方便直接看到新符号。 */
let reopenAfterEditor = false;
function onEditCustom(id) {
  reopenAfterEditor = true;
  ui.symbolOpen = false;
  openEditor(id || null);
}
watch(() => ui.editorOpen, v => {
  if (v || !reopenAfterEditor) return;
  reopenAfterEditor = false;
  ui.symbolOpen = true;
});
</script>

<template>
  <div v-if="ui.symbolOpen" class="fixed inset-0 bg-black/30 items-center justify-center"
    style="z-index:50;display:flex" @mousedown.self="ui.symbolOpen = false">
    <div class="bg-white rounded-xl shadow-2xl w-[1120px] max-w-[calc(100vw-32px)] max-h-[93vh]
      overflow-hidden flex flex-col">
      <!-- 头部 -->
      <div class="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-dashed border-rose-200"
        style="background:linear-gradient(180deg,var(--acc-surface),var(--acc-surface-2))">
        <span class="text-lg">🧩</span>
        <div class="min-w-0">
          <h2 class="font-bold text-sm tracking-wide">符号库 · 针法字典</h2>
          <p class="text-[11px] text-gray-400 mt-0.5">左侧选符号，右侧配教程图 / 反面织法 / 移除恢复；文字解里悬停针法名即可查看教程</p>
        </div>
        <button id="symClose" class="ml-auto text-xl leading-none px-2 text-gray-400 hover:text-gray-700"
          @click="ui.symbolOpen = false">×</button>
      </div>

      <div class="flex min-h-0 flex-1">
        <!-- 左：符号字典 -->
        <div class="w-[340px] flex-none border-r border-stone-100 flex flex-col min-h-0">
          <div class="px-3 pt-3 pb-2 space-y-2">
            <div class="flex gap-2">
              <input id="symSearch" v-model="q" type="search" placeholder="搜符号名或 id，如 麻花 / c22L"
                class="flex-1 min-w-0 text-xs border border-stone-200 rounded-md px-2.5 py-1.5 bg-stone-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-200">
              <button id="symNew" class="flex-none text-[11px] rounded-md px-2.5 bg-rose-700 text-white hover:bg-rose-800"
                title="打开自定义符号编辑器，画一个新符号" @click="onEditCustom(null)">＋ 新建</button>
            </div>
            <div class="flex gap-1 items-center flex-wrap">
              <button v-for="f in [['all','全部'],['builtin','内置'],['custom','自定义'],['mine','我配置的'],['none','未配置'],['hidden','已移除']]" :key="f[0]"
                class="text-[11px] rounded-full px-2 py-1 border transition-colors"
                :class="filter === f[0] ? 'bg-rose-500 text-white border-rose-500'
                  : 'bg-white text-gray-500 border-stone-200 hover:border-rose-300'"
                @click="filter = f[0]">{{ f[1] }}</button>
              <span class="ml-auto text-[11px] text-gray-400">{{ items.length }} 个</span>
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
                <img :src="symDataUrl(it.sym)" alt="" class="h-8 max-w-full object-contain pointer-events-none"
                  :style="it.isHidden ? 'opacity:.4' : ''">
                <span class="text-[10px] w-full truncate text-center leading-tight"
                  :class="it.isHidden ? 'text-gray-400' : 'text-gray-600'">{{ it.name }}</span>
                <span v-if="!it.isHidden" class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                  :class="(mineMap.get(it.id) || {}).url ? 'bg-rose-500'
                    : (tutorialTextForSid(it.id) ? 'bg-rose-100 border border-rose-400'
                    : (tutorialUrlForSid(it.id) ? 'bg-stone-300' : 'border border-dashed border-stone-300'))"></span>
              </button>
            </div>
            <p v-if="!items.length" class="text-xs text-gray-400 text-center py-8">
              {{ q.trim() ? `没有匹配「${q.trim()}」的符号` : '没有可显示的符号' }}
            </p>
          </div>
        </div>

        <!-- 右：选中符号详情 -->
        <div class="flex-1 min-w-0 overflow-y-auto" v-if="sel">
          <div class="p-5 space-y-4">
            <!-- 选中符号头部 -->
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-lg border border-stone-200 bg-stone-50 flex items-center justify-center flex-none">
                <img :src="symDataUrl(sel.sym)" alt="" class="h-9 max-w-[40px] object-contain"
                  :style="sel.isHidden ? 'opacity:.4' : ''">
              </div>
              <div class="min-w-0">
                <div class="font-bold text-sm">{{ sel.sym.name || sel.id }}<span v-if="sel.isHidden" class="ml-1.5 text-[11px] font-normal text-gray-400">（已从面板移除）</span></div>
                <div class="text-[11px] text-gray-400 font-mono">{{ sel.id }}<span v-if="sel.isCustom"> · 自定义符号</span></div>
              </div>
              <div class="ml-auto flex-none flex items-center gap-1.5 flex-wrap justify-end">
                <span v-if="sel.hasMineImg" class="text-[11px] rounded-full bg-rose-100 text-rose-600 px-2 py-0.5">我的图 · 优先显示</span>
                <span v-else-if="sel.tutUrl" class="text-[11px] rounded-full bg-stone-100 text-stone-500 px-2 py-0.5">内置图</span>
                <span v-else class="text-[11px] rounded-full bg-amber-50 text-amber-600 px-2 py-0.5">还没有教程</span>
                <span v-if="sel.tutText" class="text-[11px] rounded-full bg-rose-100 text-rose-600 px-2 py-0.5">带文字</span>
              </div>
            </div>

            <!-- ① 教程图 + 文字说明 -->
            <section>
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-bold text-gray-700">① 织法教程</span>
                <span class="text-[11px] text-gray-400">图片可拖入，文字可换行；文字解里悬停针法名即可查看</span>
              </div>
              <div class="rounded-xl border-2 border-dashed flex items-center justify-center p-3 transition-colors relative min-h-[160px]"
                :class="dropOver ? 'border-rose-400 bg-rose-50/60'
                  : (sel.tutUrl ? 'border-stone-200 bg-stone-50/60' : 'border-stone-300 bg-stone-50/40')"
                @dragover.prevent="dropOver = true" @dragleave="dropOver = false" @drop.prevent="onDrop">
                <img v-if="sel.tutUrl" :src="sel.tutUrl" alt="" draggable="false"
                  class="max-h-[38vh] max-w-full object-contain rounded pointer-events-none select-none">
                <div v-else class="text-center text-gray-400 text-xs leading-relaxed pointer-events-none">
                  <div class="text-2xl mb-1">🪄</div>
                  还没有「{{ sel.sym.name || sel.id }}」的教程图<br>点击下方按钮上传，或把图片直接拖到这里
                </div>
                <div v-if="sel.tutUrl && dropOver"
                  class="absolute inset-0 rounded-xl bg-rose-50/70 border-2 border-rose-400 flex items-center justify-center text-xs text-rose-600">
                  松手替换
                </div>
              </div>
              <textarea id="tutText" v-model="txtDraft" rows="3" @blur="saveText"
                placeholder="文字说明（可不填）：例如 右针从前方插入第 2 针绕线带出……"
                class="mt-2 w-full text-xs leading-relaxed border border-stone-200 rounded-md px-2.5 py-2 bg-stone-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-200 resize-y"></textarea>
              <div class="mt-2 flex items-center gap-2 flex-wrap">
                <button id="tutUpload" class="bg-rose-700 text-white rounded-md px-3.5 py-1.5 text-xs hover:bg-rose-800"
                  @click="pickFor(sel.id)">{{ sel.hasMineImg ? '替换图片' : '上传图片' }}</button>
                <button v-if="sel.hasMineImg" id="tutDelete"
                  class="border border-red-200 rounded-md px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                  @click="onDel">删除我的图</button>
                <span v-if="okMsg" class="text-xs text-green-600">{{ okMsg }}</span>
                <span v-if="errMsg" class="text-xs text-red-600">{{ errMsg }}</span>
              </div>
            </section>

            <!-- ② 反面织法 -->
            <section class="pt-1 border-t border-stone-100">
              <div class="flex items-center gap-2 mt-3 mb-2">
                <span class="text-xs font-bold text-gray-700">② 反面织法</span>
                <span class="text-[11px] text-gray-400">该符号在反面行的实际织法（文字解换算用，全局生效）</span>
              </div>
              <select id="symWsMap" class="ws-map-sel w-full text-xs border border-stone-200 rounded-md px-2.5 py-2
                bg-stone-50 text-gray-600 focus:outline-none focus:ring-2 focus:ring-rose-200"
                :value="wsValue(sel.id)" :title="'「' + (sel.sym.name || sel.id) + '」在反面行的实际织法'"
                @change="onWsChange(sel.id, $event)">
                <option v-if="WS_SYM[sel.id]" value="__d">默认：{{ (wsTargets.find(t => t.id === WS_SYM[sel.id]) || {}).name || WS_SYM[sel.id] }}</option>
                <option value="">正反面通用</option>
                <template v-for="t in wsTargets" :key="t.id">
                  <option v-if="t.id !== sel.id" :value="t.id">{{ t.name }}</option>
                </template>
              </select>
            </section>

            <!-- ③ 管理 -->
            <section class="pt-1 border-t border-stone-100">
              <div class="flex items-center gap-2 mt-3 mb-2">
                <span class="text-xs font-bold text-gray-700">③ 管理</span>
                <span class="text-[11px] text-gray-400">符号库对所有作品生效</span>
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                <template v-if="sel.isCustom">
                  <button class="border border-stone-200 rounded-md px-3 py-1.5 text-xs text-gray-600 hover:border-rose-300 hover:text-rose-600 bg-white"
                    title="打开自定义符号编辑器修改此符号" @click="onEditCustom(sel.id)">编辑符号</button>
                  <button id="symDeleteCustom"
                    class="border border-red-200 rounded-md px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 bg-white"
                    @click="onRemove(sel)">删除自定义符号（彻底删除）</button>
                </template>
                <button v-else-if="sel.isHidden" id="symRestore"
                  class="border border-stone-200 rounded-md px-3 py-1.5 text-xs text-gray-600 hover:border-rose-300 hover:text-rose-600 bg-white"
                  @click="restoreSymbol(sel.id); toast(`已恢复「${sel.sym.name}」`, 'ok')">恢复到符号面板</button>
                <button v-else id="symHide"
                  class="border border-stone-200 rounded-md px-3 py-1.5 text-xs text-gray-600 hover:border-rose-300 hover:text-rose-600 bg-white"
                  title="从图解页符号面板隐藏（可随时恢复）" @click="onRemove(sel)">从符号面板移除</button>
              </div>
            </section>
          </div>
        </div>

        <!-- 右侧空态：未选中符号 -->
        <div class="flex-1 min-w-0 p-5 flex flex-col items-center justify-center text-center" v-else>
          <div class="text-4xl mb-3">🧷</div>
          <p class="text-sm text-gray-500">在左侧选一个符号</p>
          <p class="text-[11px] text-gray-400 mt-1">可为它配教程图 / 文字说明、设置反面织法，或管理面板显示</p>
        </div>
      </div>

      <div class="px-5 py-2.5 border-t border-stone-100 text-[11px] text-gray-400 leading-relaxed">
        🧩 内置符号「移除」只影响图解页符号面板的显示，可恢复；删除自定义符号会从所有作品图解中清除（现有 {{ state.customSymbols.length }} 个自定义符号）。
        🖼 教程图片与文字说明保存在本机浏览器；导出作品 zip 时会一并打包，对方导入 zip 即可获得。
      </div>
    </div>
    <input ref="fileInput" type="file" accept="image/*" style="display:none" @change="onFiles">
  </div>
</template>
