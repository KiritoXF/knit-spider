<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { dlg, dlgSettle } from '../ui.js';

const inputRef = ref(null);
const okRef = ref(null);

/* 打开时聚焦：prompt 聚输入框并全选，confirm 聚确认按钮 */
watch(() => dlg.open, async o => {
  if (!o) return;
  await nextTick();
  const el = dlg.mode === 'prompt' ? inputRef.value : okRef.value;
  if (el) { el.focus(); if (el.select) el.select(); }
});

/* Enter=确认 / Esc=取消（document 级；其他弹窗的 Esc 处理会先看 dlg.open 让路） */
function onKey(e) {
  if (!dlg.open) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    dlgSettle(dlg.mode === 'prompt' ? dlg.value : true);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    dlgSettle(null);
  }
}
onMounted(() => document.addEventListener('keydown', onKey, true));
onUnmounted(() => document.removeEventListener('keydown', onKey, true));
</script>

<template>
  <div v-if="dlg.open" class="fixed inset-0 bg-black/30 items-center justify-center"
    style="z-index:80;display:flex" @mousedown.self="dlgSettle(null)">
    <div class="modal-shell w-[360px]" style="animation: tbMenuIn .15s ease-out">
      <div class="modal-head">
        <h2 class="modal-title">{{ dlg.title }}</h2>
      </div>
      <div class="p-4 pt-3">
        <p class="text-[12.5px] text-stone-600 leading-relaxed whitespace-pre-line">{{ dlg.message }}</p>
        <input v-if="dlg.mode === 'prompt'" ref="inputRef" v-model="dlg.value"
          spellcheck="false" :placeholder="dlg.placeholder"
          class="mt-2.5 w-full border border-stone-300 rounded px-2 py-1.5 text-[13px] bg-white focus:outline-none focus:border-rose-400"
          @keydown.enter.stop>
      </div>
      <div class="flex justify-end gap-2 px-4 pb-4">
        <button class="border border-stone-300 rounded px-3 py-1.5 bg-white text-[12px] hover:bg-stone-50"
          @click="dlgSettle(null)">取消</button>
        <button ref="okRef"
          class="rounded px-3 py-1.5 text-[12px] text-white"
          :class="dlg.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-rose-700 hover:bg-rose-800'"
          @click="dlgSettle(dlg.mode === 'prompt' ? dlg.value : true)">{{ dlg.okText }}</button>
      </div>
    </div>
  </div>
</template>
