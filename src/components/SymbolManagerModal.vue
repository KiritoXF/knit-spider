<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { ui, dlg, toast, appConfirm } from '../ui.js';
import { state, getSym, hideSymbol, restoreSymbol, hiddenSyms, deleteCustom, openEditor, setWsMapping, removeWsMapping } from '../store.js';
import { SYMBOLS, PALETTE_ORDER } from '../symbols.js';
import { WS_SYM } from '../textChart.js';
import SymbolArt from './SymbolArt.vue';

/* ---- 符号库管理（只在首页使用）----
   符号库是全局的：内置符号「移除」= 从图解页符号面板隐藏，定义仍在、图上已放置的不受影响，
   可随时恢复；自定义符号「删除」= 彻底移除，并清理所有作品所有图解里的引用（见 store.deleteCustom）。
   新建自定义符号仍在图解页「＋ 自定义」。 */

const q = ref('');
const filter = ref('all'); // 'all' 全部 | 'builtin' 内置 | 'custom' 自定义

/* Esc 关闭（应用内对话框 dlg.open 让路） */
function onKey(e) {
  if (e.key !== 'Escape' || !ui.symbolOpen || dlg.open) return;
  ui.symbolOpen = false;
}
onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => document.removeEventListener('keydown', onKey));

const hidden = computed(() => hiddenSyms());

/* 全部在库符号：内置按 PALETTE_ORDER 顺序在前，自定义在后；已移除的不进主网格 */
const items = computed(() => {
  const kw = q.value.trim().toLowerCase();
  const hiddenSet = new Set(state.hiddenSymbols);
  const seen = new Set();
  const out = [];
  for (const id of [...PALETTE_ORDER, ...state.customSymbols.map(s => s.id)]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const sym = getSym(id);
    if (!sym || hiddenSet.has(id)) continue;
    const custom = !SYMBOLS[id];
    if (filter.value === 'builtin' && custom) continue;
    if (filter.value === 'custom' && !custom) continue;
    const name = sym.name || id;
    if (kw && !name.toLowerCase().includes(kw) && !id.toLowerCase().includes(kw)) continue;
    out.push({
      id, sym, custom, name,
      title: name + (custom ? '（自定义）' : ''),
      iconSize: Math.min(34, Math.max(sym.w, sym.h) * 17),
    });
  }
  return out;
});

const customCount = computed(() => (state.customSymbols || []).length);

/* ---- 反面织法配置模式 ----
   每个符号可指定它在反面行的实际织法（文字解换算用）。全局本机偏好，
   默认规则：下针↔上针、扭针↔上针的扭针（见 textChart.WS_SYM），
   未配置的符号正反面通用 */
const mapMode = ref(false);
/* 候选目标：全部在库符号（含已移除面板的内置符号，它们仍是合法织法） */
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
const wsChanged = id => id in state.wsMap; // 有用户覆盖（含「改通用」/「换目标」）
function onWsChange(id, ev) {
  const v = ev.target.value;
  if (v === '__d') removeWsMapping(id);
  else setWsMapping(id, v);
}

/* 新建/编辑自定义符号借图解页的自定义符号编辑器（全局弹窗，见 App.vue）。
   打开时先收起符号库，编辑器关闭后自动把符号库打开，方便直接看到新符号。 */
let reopenAfterEditor = false;
function onNewCustom() {
  reopenAfterEditor = true;
  ui.symbolOpen = false;
  openEditor(null);
}
watch(() => ui.editorOpen, v => {
  if (v || !reopenAfterEditor) return;
  reopenAfterEditor = false;
  ui.symbolOpen = true;
});

async function onRemove(it) {
  if (it.custom) {
    const ok = await appConfirm({
      title: '删除自定义符号',
      message: `删除自定义符号「${it.sym.name}」？\n图上已放置的也会一并删除，且影响所有作品，不可恢复。`,
      okText: '删除', danger: true,
    });
    if (!ok) return;
    deleteCustom(it.id);
    toast(`已删除自定义符号「${it.sym.name}」`, 'ok');
  } else {
    hideSymbol(it.id);
    toast(`已移除「${it.sym.name}」，可在下方「已移除」里恢复`, 'ok');
  }
}
</script>

<template>
  <div v-if="ui.symbolOpen" class="fixed inset-0 bg-black/30 items-center justify-center"
    style="z-index:50;display:flex" @mousedown.self="ui.symbolOpen = false">
    <div class="bg-white rounded-xl shadow-2xl w-[900px] max-w-[calc(100vw-24px)] max-h-[88vh]
      overflow-hidden flex flex-col">
      <!-- 头部 -->
      <div class="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-dashed border-rose-200"
        style="background:linear-gradient(180deg,var(--acc-surface),var(--acc-surface-2))">
        <span class="text-lg">🧩</span>
        <div class="min-w-0">
          <h2 class="font-bold text-sm tracking-wide">符号库</h2>
          <p class="text-[11px] text-gray-400 mt-0.5">悬停符号点右上角 × 移除；内置符号可恢复，自定义符号为彻底删除</p>
        </div>
        <button id="symClose" class="ml-auto text-xl leading-none px-2 text-gray-400 hover:text-gray-700"
          @click="ui.symbolOpen = false">×</button>
      </div>

      <!-- 工具条 -->
      <div class="px-5 pt-3 pb-2 flex items-center gap-2 flex-wrap">
        <div class="relative w-[220px]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
            class="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300 pointer-events-none">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input id="symSearch" v-model="q" type="search" placeholder="搜符号：名称 / id，如 麻花"
            class="w-full text-xs border border-stone-200 rounded-md pl-7 pr-2 py-1.5 bg-stone-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-200"
            @keydown.esc.prevent="q = ''">
        </div>
        <button v-for="f in [['all','全部'],['builtin','内置'],['custom','自定义']]" :key="f[0]"
          class="text-[11px] rounded-full px-2.5 py-1 border transition-colors"
          :class="filter === f[0] ? 'bg-rose-500 text-white border-rose-500'
            : 'bg-white text-gray-500 border-stone-200 hover:border-rose-300'"
          @click="filter = f[0]">{{ f[1] }}</button>
        <span class="ml-auto text-[11px] text-gray-400">{{ items.length }} 个符号</span>
        <button id="symWsMode" class="text-[11px] rounded-md px-2.5 py-1 border transition-colors"
          :class="mapMode ? 'bg-rose-700 text-white border-rose-700'
            : 'bg-white text-gray-500 border-stone-200 hover:border-rose-300'"
          title="为每个符号指定它在反面行的实际织法（文字解换算用，全局生效）"
          @click="mapMode = !mapMode">反面织法</button>
        <button id="symNew" class="text-[11px] rounded-md px-2.5 py-1 bg-rose-700 text-white hover:bg-rose-800"
          title="打开自定义符号编辑器，画一个新符号" @click="onNewCustom">＋ 新建自定义符号</button>
      </div>

      <!-- 符号网格（可滚动） -->
      <div class="flex-1 min-h-0 overflow-y-auto px-5 pb-3">
        <div class="grid grid-cols-6 gap-2">
          <div v-for="it in items" :key="it.id"
            class="sym-card relative rounded-lg border bg-white hover:shadow-sm
              flex flex-col items-center gap-1.5 p-2.5 transition-all"
            :class="mapMode && wsChanged(it.id) ? 'border-rose-400' : 'border-stone-200 hover:border-rose-300'"
            :title="it.title">
            <span v-if="it.custom"
              class="absolute top-1 left-1 text-[9px] leading-none rounded-full bg-amber-100 text-amber-700 px-1.5 py-0.5">自定义</span>
            <svg :viewBox="`0 0 ${it.sym.w} ${it.sym.h}`"
              :style="{ width: it.iconSize + 'px', height: it.iconSize + 'px' }">
              <SymbolArt :sym="it.sym"/>
            </svg>
            <span class="text-[10.5px] text-gray-600 w-full truncate text-center leading-tight">{{ it.name }}</span>
            <!-- 反面织法：mapMode 下显示换算目标下拉；「改通用」/「换目标」的卡描边高亮 -->
            <select v-if="mapMode" class="ws-map-sel w-full text-[10px] leading-tight border border-stone-200
              rounded px-1 py-0.5 bg-stone-50 text-gray-600 focus:outline-none focus:ring-1 focus:ring-rose-200"
              :value="wsValue(it.id)"
              :title="'「' + it.name + '」在反面行的实际织法'"
              @change="onWsChange(it.id, $event)" @click.stop>
              <option v-if="WS_SYM[it.id]" value="__d">默认：{{ (wsTargets.find(t => t.id === WS_SYM[it.id]) || {}).name || WS_SYM[it.id] }}</option>
              <option value="">正反面通用</option>
              <template v-for="t in wsTargets" :key="t.id">
                <option v-if="t.id !== it.id" :value="t.id">{{ t.name }}</option>
              </template>
            </select>
            <button v-else class="sym-remove" :data-id="it.id"
              :title="it.custom ? '删除自定义符号（彻底删除）' : '从符号面板移除（可恢复）'"
              @click.stop="onRemove(it)">×</button>
          </div>
        </div>
        <p v-if="!items.length" class="text-xs text-gray-400 text-center py-10">
          {{ q.trim() ? `没有匹配「${q.trim()}」的符号`
            : (filter === 'custom' ? '还没有自定义符号，点上方「＋ 新建自定义符号」' : '没有可显示的符号') }}
        </p>

        <!-- 已移除区（内置符号可恢复） -->
        <div v-if="hidden.length" class="mt-4 border border-dashed border-stone-300 rounded-lg p-2.5">
          <div class="text-[11px] text-gray-400 mb-2 px-0.5">
            已从符号面板移除 {{ hidden.length }} 个（定义仍保留，图上已放置的不受影响）
          </div>
          <div class="flex flex-wrap gap-2">
            <div v-for="h in hidden" :key="'hid-' + h.id"
              class="flex items-center gap-1.5 border border-stone-200 rounded-md bg-stone-50 pl-1.5 pr-1 py-1">
              <svg :viewBox="`0 0 ${h.sym.w} ${h.sym.h}`" style="width:20px;height:20px">
                <SymbolArt :sym="h.sym"/>
              </svg>
              <span class="text-[11px] text-gray-500">{{ h.sym.name }}</span>
              <button class="text-[11px] text-rose-600 hover:underline sym-restore" :data-id="h.id"
                @click="restoreSymbol(h.id)">恢复</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部说明 -->
      <div class="px-5 py-2.5 border-t border-stone-100 text-[11px] text-gray-400 leading-relaxed">
        🧩 符号库对所有作品生效：移除只影响图解页符号面板的显示；删除自定义符号会从所有作品图解中清除。
        <template v-if="customCount">现有 {{ customCount }} 个自定义符号。</template>
        <template v-if="mapMode"><br>🔁 反面织法模式：为符号指定它在反面行的实际织法（文字解换算用），配置为本机全局偏好，对所有图解生效；描边高亮 = 已修改（默认：下针↔上针、扭针↔上针的扭针）。</template>
      </div>
    </div>
  </div>
</template>
