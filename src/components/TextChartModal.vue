<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { state, activeWork } from '../store.js';
import { ui } from '../ui.js';
import { chartToTextRows } from '../textChart.js';
import { tutorialUrlForGroup } from '../tutorials.js';

const copied = ref(false);
let copiedTimer = null;

const close = () => { hidePop(); ui.textChartOpen = false; };

const rows = computed(() => chartToTextRows(state));
const text = computed(() => rows.value.map(x => x.text).join('\n'));
/* 展示用：分组自带 sid（符号 id），附教程图 URL；未配置教程的名称 tut=null，悬停无感 */
const view = computed(() => rows.value.map(x => ({
  r: x.r, ws: x.ws,
  groups: (x.groups || []).map(g => ({ ...g, tut: tutorialUrlForGroup(g) })),
})));

/* ---- 织法教程 popover：悬停有教程的针法名称约 300ms 后弹出 ----
   fixed 定位（视口坐标），宽 640px 尽量大地显示教程图；下方空间不足时向上翻，
   图框高度按剩余空间与 62vh 收缩；移入弹窗保持显示（200ms 宽限期），点击图片看原图 */
const pop = ref(null); // { name, sid, url, left, top, ax, imgH, above }
let popTimer = null;
const POP_GRACE = 200;
function hidePop() {
  clearTimeout(popTimer);
  popTimer = null;
  pop.value = null;
}
function delayHide() {
  clearTimeout(popTimer);
  popTimer = setTimeout(() => { pop.value = null; }, POP_GRACE);
}
function onPopEnter() { clearTimeout(popTimer); }
function onImgClick() { if (pop.value) window.open(pop.value.url, '_blank'); }
function onNameEnter(ev, g) {
  if (!g.tut) return;
  const el = ev.currentTarget;
  clearTimeout(popTimer);
  popTimer = setTimeout(() => {
    const W = Math.min(640, window.innerWidth - 24);
    const vh = window.innerHeight;
    const r = el.getBoundingClientRect();
    const below = vh - r.bottom;
    let top, imgH, above = false;
    if (below >= 150) { imgH = Math.min(Math.round(vh * 0.62), below - 64); top = r.bottom + 6; }
    else { above = true; imgH = Math.min(Math.round(vh * 0.62), Math.max(120, r.top - 70)); top = Math.max(8, r.top - 6 - imgH - 56); }
    const left = Math.max(12, Math.min(r.left + r.width / 2 - W / 2, window.innerWidth - W - 12));
    const ax = Math.max(12, Math.min(r.left + r.width / 2 - left - 5, W - 22));
    pop.value = { name: g.name, sid: g.sid, url: g.tut, left, top, ax, imgH, above };
  }, 300);
}
function onNameLeave() { delayHide(); }
const onKey = e => { if (e.key === 'Escape') hidePop(); };
onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => { document.removeEventListener('keydown', onKey); hidePop(); });

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
        class="w-full h-[55vh] overflow-y-auto overflow-x-hidden border rounded p-3 bg-gray-50 space-y-1.5"
        @scroll.passive="hidePop">
        <p v-for="row in view" :key="row.r" class="text-[13px] leading-relaxed">
          <span class="inline-block min-w-[2.4rem] font-mono font-bold"
            :class="row.ws ? 'text-pink-600' : 'text-blue-700'">r{{ row.r }}</span>
          <span v-if="row.ws"
            class="inline-block text-[10px] leading-none bg-pink-100 text-pink-600 rounded px-1 py-0.5 mr-2">反面</span>
          <span v-for="(g, i) in row.groups" :key="i" class="whitespace-normal">
            <b class="text-gray-900">{{ g.n }}</b><span class="text-gray-700" :class="{ 'tc-name-tut': g.tut }"
              @mouseenter="onNameEnter($event, g)" @mouseleave="onNameLeave">{{ g.name }}</span><span
              v-if="i < row.groups.length - 1" class="text-gray-300">，</span>
          </span>
        </p>
      </div>
      <!-- 织法教程 popover：fixed 定位，Esc/滚动内容区/移开关闭；移入弹窗保持显示，点图片看原图 -->
      <div v-if="pop" class="tc-pop" :class="{ 'tc-pop-above': pop.above }"
        :style="{ left: pop.left + 'px', top: pop.top + 'px', '--ax': pop.ax + 'px' }"
        @mouseenter="onPopEnter" @mouseleave="delayHide">
        <div class="tc-pop-head">
          <span class="tc-pop-chip">织法教程</span>
          <span class="tc-pop-name">{{ pop.name }}</span>
          <span v-if="pop.sid" class="tc-pop-id">{{ pop.sid }}</span>
        </div>
        <div class="tc-pop-imgbox" :style="{ maxHeight: pop.imgH + 'px' }">
          <img :src="pop.url" alt="" title="点击查看原图" @click="onImgClick">
        </div>
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
