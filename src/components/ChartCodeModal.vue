<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { state, activeChart, importChartCode } from '../store.js';
import { chartToCode, codeToChart } from '../chartCode.js';
import { ui, toast } from '../ui.js';

const mode = computed(() => ui.chartCodeMode);
const headTitle = computed(() => {
  const c = activeChart();
  return c ? `${state.works.find(w => w.id === state.activeWorkId)?.name ?? ''} · ${c.name}` : '';
});

/* ---- copy 模式：生成代码 + 复制 ---- */
const code = ref('');
const busy = ref(false);
async function genCode() {
  const c = activeChart();
  if (!c) return;
  busy.value = true;
  try {
    code.value = await chartToCode(c, state.customSymbols);
    await nextTick();
  } catch (e) {
    toast('生成图解代码失败：' + (e.message || e), 'warn');
    close();
  } finally { busy.value = false; }
}

const copied = ref(false);
let copiedTimer = null;
function flashCopied() {
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { copied.value = false; }, 1600);
}
async function onCopy() {
  try {
    await navigator.clipboard.writeText(code.value);
  } catch (e) {
    // 降级：隐藏 textarea + execCommand（照抄 TextChartModal 的兜底）
    const ta = document.createElement('textarea');
    ta.value = code.value;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e2) { toast('复制失败，请手动全选复制', 'warn'); }
    ta.remove();
  }
  flashCopied();
}

/* ---- import 模式：输入 + 即时预览 + 导入 ---- */
const input = ref('');
const importing = ref(false);
const preview = ref(null); // {ok, rows, cols, customs:[name], chars} 或 {ok:false, message}
let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(doPreview, 300);
}
async function doPreview() {
  const text = input.value.trim();
  if (!text) { preview.value = null; return; }
  try {
    const { chart, customRefs } = await codeToChart(text);
    preview.value = {
      ok: true,
      rows: chart.rows, cols: chart.cols,
      n: chart.placements.length, b: chart.borders.length, a: chart.annotations.length,
      customs: customRefs.map(r => r.name),
      chars: text.length,
    };
  } catch (e) {
    preview.value = { ok: false, message: e.message || String(e) };
  }
}
async function onImport() {
  if (importing.value || !input.value.trim()) return;
  importing.value = true;
  try {
    const id = await importChartCode(input.value);
    const c = state.works.find(w => w.id === state.activeWorkId)?.charts.find(x => x.id === id);
    close();
    toast(`已添加为新图解「${c ? c.name : ''}」`, 'ok');
  } catch (e) {
    toast(e.message || '导入失败', 'warn');
  } finally { importing.value = false; }
}

function close() { ui.chartCodeOpen = false; }
/* 组件随编辑页常驻挂载，onMounted 只跑一次——必须在每次打开时重新生成/清空，
   否则切换图解后再打开会显示上一次的陈旧代码 */
watch(() => [ui.chartCodeOpen, ui.chartCodeMode], ([open, mode]) => {
  if (!open) return;
  if (mode === 'copy') genCode();
  else { input.value = ''; preview.value = null; }
});
function onKey(e) { if (e.key === 'Escape') close(); }
onMounted(() => {
  document.addEventListener('keydown', onKey);
  if (mode.value === 'copy') genCode();
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKey);
  clearTimeout(copiedTimer); clearTimeout(previewTimer);
});
</script>

<template>
  <div v-if="ui.chartCodeOpen" class="fixed inset-0 bg-black/30 items-center justify-center"
    style="z-index:50;display:flex" @mousedown.self="close">
    <div class="modal-shell w-[min(560px,calc(100vw-24px))]">
      <div class="modal-head">
        <div class="min-w-0">
          <span class="text-[13.5px] font-bold" style="color:var(--acc-ink)">
            {{ mode === 'copy' ? '图解代码' : '从代码导入图解' }}</span>
          <span class="modal-sub">— {{ headTitle }}</span>
        </div>
        <button id="ccClose" class="modal-x" title="关闭" aria-label="关闭图解代码弹窗" @click="close">×</button>
      </div>

      <div class="p-4 pt-3">
        <!-- 复制模式 -->
        <template v-if="mode === 'copy'">
          <p class="text-[11.5px] mb-2 leading-relaxed" style="color:var(--acc-ink-2)">
            这串代码完整记录当前图解（含边框、标注、列号）。发给朋友导入即可还原；
            末尾 8 位是校验码（与顶栏显示的一致）——两串代码校验码相同 = 图解内容完全一致。
          </p>
          <textarea id="ccCode" readonly :value="code" spellcheck="false"
            class="w-full h-40 text-[11px] font-mono p-2.5 rounded-lg resize-y select-all"
            style="background:var(--acc-n50);color:var(--acc-ink);border:1px solid var(--acc-border-strong)"></textarea>
          <div class="flex items-center justify-between mt-2.5">
            <span class="text-[11px]" style="color:var(--acc-ink-3)">
              {{ code.length }} 字符<span v-if="code" class="ml-2">校验码
                <b class="font-mono" style="color:var(--acc-700)">{{ code.slice(-8) }}</b></span>
            </span>
            <button id="ccCopyBtn" class="tb-btn-primary" :disabled="!code || copied" @click="onCopy">
              {{ copied ? '已复制' : '复制全文' }}</button>
          </div>
        </template>

        <!-- 导入模式 -->
        <template v-else>
          <p class="text-[11.5px] mb-2 leading-relaxed" style="color:var(--acc-ink-2)">
            粘贴图解代码（KC2 开头），导入后会作为<b>新图解</b>追加到当前作品，不覆盖现有内容。
          </p>
          <textarea id="ccInput" v-model="input" spellcheck="false" placeholder="KC2!…"
            class="w-full h-40 text-[11px] font-mono p-2.5 rounded-lg resize-y"
            style="background:var(--acc-n50);color:var(--acc-ink);border:1px solid var(--acc-border-strong)"
            @input="schedulePreview"></textarea>
          <div v-if="preview" id="ccPreview"
            class="mt-2 text-[11.5px] rounded-lg px-2.5 py-2 leading-relaxed"
            :style="preview.ok
              ? 'background:var(--acc-50);color:var(--acc-ink-2);border:1px solid var(--acc-200)'
              : 'background:#fef2f2;color:#b91c1c;border:1px solid #fecaca'">
            <template v-if="preview.ok">
              ✔ 校验通过 · {{ preview.cols }}×{{ preview.rows }} 网格 ·
              {{ preview.n }} 个符号<span v-if="preview.b"> · {{ preview.b }} 个边框</span><span v-if="preview.a"> ·
                {{ preview.a }} 个标注</span><span v-if="preview.customs.length"> ·
                自定义符号：{{ preview.customs.join('、') }}</span>
            </template>
            <template v-else>✘ {{ preview.message }}</template>
          </div>
          <div class="flex justify-end mt-2.5">
            <button id="ccImportBtn" class="tb-btn-primary"
              :disabled="!preview || !preview.ok || importing" @click="onImport">
              {{ importing ? '导入中…' : '导入为新图解' }}</button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
