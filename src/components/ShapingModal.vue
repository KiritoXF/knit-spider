<script setup>
/* 加减针（塑形）规则面板：
   一条规则占一行——
   [类型▾] [针法图案▾] 每[-2+]行减[-1+]针×[-4+]次 第[87]行起 [范围▾] ×
   · 数字用步进器（−/＋），实时速记 2-2-5；
   · 针法点当前符号图标弹出图案选择器（和符号面板同款渲染）；
   · 底部唯一「应用到图解」按顺序应用全部规则（可叠加、可撤销）。
   引擎侧减针游标自动接续之前规则减掉的边缘（跳过不编织列）。 */
import { ref, onMounted, onUnmounted } from 'vue';
import { ui, toast } from '../ui.js';
import { state, getSym } from '../store.js';
import {
  shaping, addRule, removeRule, applyRules, resetBaseline, ruleCode,
  DEC_METHODS, INC_METHODS,
} from '../shaping.js';
import SymbolArt from './SymbolArt.vue';

function close() { ui.shapingOpen = false; }
function onKey(e) { if (e.key === 'Escape') { pickId.value = null; close(); } }
onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => document.removeEventListener('keydown', onKey));

const pickId = ref(null); // 正在展开针法选择器的规则 id
function togglePick(rule) { pickId.value = pickId.value === rule.id ? null : rule.id; }
/* 针法候选：[{id, sym}]，卡片类型对应的内置符号（存在才显示） */
function methodList(type) {
  return (type === 'inc' ? INC_METHODS : DEC_METHODS)
    .map(id => ({ id, sym: getSym(id) })).filter(x => x.sym);
}
function setType(rule, t) {
  rule.type = t;
  rule.method = t === 'inc' ? 'inL' : 'bindOff';
}
function bump(rule, key, delta) {
  const v = (Math.round(+rule[key]) || 1) + delta;
  rule[key] = Math.min(99, Math.max(1, v));
}
function applyAll() {
  pickId.value = null;
  const n = applyRules();
  if (n) toast(`已重放 ${shaping.rules.length} 条规则，绘制 ${n} 个符号`, 'ok');
}
function rebase() {
  resetBaseline();
  toast('已以当前图面为基线，下次「应用到图解」从这里重放', 'info');
}
</script>

<template>
  <div v-if="ui.shapingOpen" class="fixed inset-0 bg-black/30 items-center justify-center"
    style="z-index:50;display:flex" @mousedown.self="close">
    <div class="modal-shell w-[min(700px,calc(100vw-24px))]">
      <div class="modal-head">
        <div class="min-w-0">
          <span class="text-[13.5px] font-bold" style="color:var(--acc-ink)">加减针</span>
          <span class="modal-sub">— 按规则自动绘制到当前图解</span>
        </div>
        <button id="shapingClose" class="modal-x" title="关闭" aria-label="关闭加减针面板" @click="close">×</button>
      </div>

      <div class="p-4 pt-3 max-h-[70vh] overflow-y-auto">
        <p class="text-[11px] leading-relaxed mb-3" style="color:var(--acc-ink-3)">
          规则列表是一份完整的塑形计划：从第一条规则开始按顺序重放，另一侧自动镜像（伏针的镜像侧画在下一行）。
          新规则的起始行默认接上一条规则的结束行。「应用到图解」可重复点击，总是从基线重放、不会叠加；
          手动改过图面后点「重设基线」以当前图面为准。
        </p>

        <div v-if="!shaping.rules.length" class="text-[12px] py-6 text-center"
          style="color:var(--acc-ink-3)">还没有规则，点下方「＋ 新增规则」开始。</div>

        <!-- 一行一条规则 -->
        <div v-for="rule in shaping.rules" :key="rule.id"
          class="mb-1.5 flex items-center gap-1 flex-wrap rounded-md border px-2 py-1.5"
          style="border-color:var(--acc-200);background:var(--acc-surface)">
          <select class="tb-input" :value="rule.type" title="类型" @change="setType(rule, $event.target.value)">
            <option value="dec">减针</option>
            <option value="inc">加针</option>
          </select>

          <!-- 针法：当前符号图案 + 点击弹出图案选择器 -->
          <div class="relative">
            <button class="tb-input flex items-center gap-1" :title="'针法：' + (getSym(rule.method)?.name || '?')"
              @click="togglePick(rule)">
              <svg v-if="getSym(rule.method)" :viewBox="`0 0 ${getSym(rule.method).w} ${getSym(rule.method).h}`"
                style="width:16px;height:16px"><SymbolArt :sym="getSym(rule.method)"/></svg>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" style="width:10px;height:10px;flex:none" aria-hidden="true">
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>
            <div v-if="pickId === rule.id" class="absolute left-0 top-full mt-1 z-10 p-1.5 rounded-lg border shadow-lg grid grid-cols-5 gap-1"
              style="background:var(--acc-surface);border-color:var(--acc-300);width:max-content">
              <button v-for="m in methodList(rule.type)" :key="m.id"
                class="border rounded p-1 flex items-center justify-center"
                :class="rule.method === m.id ? 'bg-gray-100' : 'bg-white hover:bg-gray-50'"
                :style="rule.method === m.id ? 'border-color:var(--acc-500);box-shadow:0 0 0 1px var(--acc-500)' : 'border-color:var(--acc-200)'"
                :title="m.sym.name" @click="rule.method = m.id; pickId = null">
                <svg :viewBox="`0 0 ${m.sym.w} ${m.sym.h}`" :style="{ width: m.sym.w * 18 + 'px', height: m.sym.h * 18 + 'px' }">
                  <SymbolArt :sym="m.sym"/>
                </svg>
              </button>
            </div>
          </div>

          <span class="text-[11px]" style="color:var(--acc-ink-2)">每</span>
          <span class="inline-flex items-center rounded border overflow-hidden" style="border-color:var(--acc-200)">
            <button class="w-5 h-6 text-[12px] bg-white hover:bg-gray-100 leading-none" @click="bump(rule, 'everyRows', -1)">−</button>
            <span class="w-6 text-center text-[12px] font-bold" style="color:var(--acc-ink)">{{ rule.everyRows }}</span>
            <button class="w-5 h-6 text-[12px] bg-white hover:bg-gray-100 leading-none" @click="bump(rule, 'everyRows', 1)">＋</button>
          </span>
          <span class="text-[11px]" style="color:var(--acc-ink-2)">行{{ rule.type === 'dec' ? '减' : '加' }}</span>
          <span class="inline-flex items-center rounded border overflow-hidden" style="border-color:var(--acc-200)">
            <button class="w-5 h-6 text-[12px] bg-white hover:bg-gray-100 leading-none" @click="bump(rule, 'sts', -1)">−</button>
            <span class="w-6 text-center text-[12px] font-bold" style="color:var(--acc-ink)">{{ rule.sts }}</span>
            <button class="w-5 h-6 text-[12px] bg-white hover:bg-gray-100 leading-none" @click="bump(rule, 'sts', 1)">＋</button>
          </span>
          <span class="text-[11px]" style="color:var(--acc-ink-2)">针×</span>
          <span class="inline-flex items-center rounded border overflow-hidden" style="border-color:var(--acc-200)">
            <button class="w-5 h-6 text-[12px] bg-white hover:bg-gray-100 leading-none" @click="bump(rule, 'times', -1)">−</button>
            <span class="w-6 text-center text-[12px] font-bold" style="color:var(--acc-ink)">{{ rule.times }}</span>
            <button class="w-5 h-6 text-[12px] bg-white hover:bg-gray-100 leading-none" @click="bump(rule, 'times', 1)">＋</button>
          </span>
          <span class="text-[11px] font-bold px-1.5 py-0.5 rounded-full"
            style="background:var(--acc-50);color:var(--acc-700)">{{ ruleCode(rule) }}</span>

          <span class="text-[11px]" style="color:var(--acc-ink-2)">第</span>
          <input v-model.number="rule.startRow" type="number" min="1" max="400"
            class="tb-input w-14" title="起始行" @focus="$event.target.select()">
          <span class="text-[11px]" style="color:var(--acc-ink-2)">行起</span>
          <select v-model="rule.scope" class="tb-input" title="应用范围（另一侧自动镜像）">
            <option value="both">两侧</option>
            <option value="left">仅左侧</option>
            <option value="right">仅右侧</option>
          </select>
          <button class="ml-auto w-6 h-6 rounded text-[13px] leading-none hover:bg-red-50"
            style="color:#b91c1c" title="删除这条规则（不影响已绘制的内容）"
            @click="removeRule(rule.id)">×</button>
        </div>

        <div class="flex items-center gap-2 mt-3">
          <button id="btnAddRule" class="tb-btn" @click="addRule()">＋ 新增规则</button>
          <button id="btnApplyRules" class="tb-btn tb-btn-primary" title="从第一条规则开始，按顺序重放全部规则（重复点击不叠加）"
            @click="applyAll">应用到图解</button>
          <button id="btnRebase" class="tb-btn" title="以当前图面为基线：之后的重放从这里开始"
            @click="rebase">重设基线</button>
        </div>
      </div>
    </div>
  </div>
</template>
