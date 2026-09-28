<script setup>
import { ref, computed } from 'vue';
import { state, activeWork } from '../store.js';
import { ui } from '../ui.js';
import { chartToTextRows } from '../textChart.js';

const copied = ref(false);
let copiedTimer = null;

const close = () => { ui.textChartOpen = false; };

const rows = computed(() => chartToTextRows(state));
const text = computed(() => rows.value.map(x => x.text).join('\n'));
/* 展示用：把每行拆成 {r, ws, groups:[{n, name}]}，渲染成带样式的富文本 */
const view = computed(() => rows.value.map(x => {
  const body = x.text.slice(x.text.indexOf('：') + 1);
  return {
    r: x.r, ws: x.ws,
    groups: body ? body.split('，').map(g => {
      const m = g.match(/^(\d+)([\s\S]*)$/);
      return m ? { n: m[1], name: m[2] } : { n: '', name: g };
    }) : [],
  };
}));

function flashCopied() {
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { copied.value = false; }, 2000);
}

function onCopy() {
  const done = () => { flashCopied(); };
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text.value;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    done();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text.value).then(done).catch(fallback);
  } else fallback();
}

function onDownload() {
  const w = activeWork();
  const c = w && w.charts.find(x => x.id === state.activeChartId);
  const name = (w ? w.name : '作品') + '_' + (c ? c.name : '图解') + '.txt';
  const blob = new Blob([text.value], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
</script>

<template>
  <div v-if="ui.textChartOpen" class="fixed inset-0 bg-black/30 items-center justify-center"
    style="z-index:50;display:flex">
    <div class="bg-white rounded-lg shadow-xl w-[760px] max-h-[92vh] overflow-auto p-4">
      <div class="flex justify-between items-center mb-2">
        <h2 class="font-bold text-sm">文字解 — {{ title }}</h2>
        <button id="tcClose" class="text-xl leading-none px-2 text-gray-500 hover:text-black"
          @click="close">×</button>
      </div>
      <p class="text-[11px] text-gray-500 mb-2 leading-relaxed">
        正面行从右往左织（按图解原样读）；反面行从左往右织，下针↔上针互换、扭针织成上针的扭针。
        空白格为背景针：正面织上针、反面织下针。每行读取方向与该行行号所在侧一致。
      </p>
      <div id="textChartView"
        class="w-full h-[55vh] overflow-y-auto overflow-x-hidden border rounded p-3 bg-gray-50 space-y-1.5">
        <p v-for="row in view" :key="row.r" class="text-[13px] leading-relaxed">
          <span class="inline-block min-w-[2.4rem] font-mono font-bold"
            :class="row.ws ? 'text-pink-600' : 'text-blue-700'">r{{ row.r }}</span>
          <span v-if="row.ws"
            class="inline-block text-[10px] leading-none bg-pink-100 text-pink-600 rounded px-1 py-0.5 mr-2">反面</span>
          <span v-for="(g, i) in row.groups" :key="i" class="whitespace-normal">
            <b class="text-gray-900">{{ g.n }}</b><span class="text-gray-700">{{ g.name }}</span><span
              v-if="i < row.groups.length - 1" class="text-gray-300">，</span>
          </span>
        </p>
      </div>
      <div class="flex gap-2 pt-2 items-center">
        <button id="tcCopy" class="bg-blue-600 text-white rounded px-3 py-1" @click="onCopy">复制全文</button>
        <button id="tcDownload" class="border rounded px-3 py-1 bg-white" @click="onDownload">下载 txt</button>
        <span v-if="copied" class="text-xs text-green-600">已复制到剪贴板</span>
        <span class="ml-auto text-[11px] text-gray-400">共 {{ state.rows }} 行</span>
      </div>
    </div>
  </div>
</template>
