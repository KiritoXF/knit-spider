<script setup>
import { onMounted, onUnmounted } from 'vue';
import { ui } from '../ui.js';
import { CHANGELOG } from '../changelog.js';

function close() { ui.changelogOpen = false; }
function onKey(e) { if (e.key === 'Escape') close(); }
onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <div v-if="ui.changelogOpen" class="fixed inset-0 bg-black/30 items-center justify-center"
    style="z-index:50;display:flex" @mousedown.self="close">
    <div class="modal-shell w-[min(440px,calc(100vw-24px))]">
      <div class="modal-head">
        <div class="min-w-0">
          <span class="text-[13.5px] font-bold" style="color:var(--acc-ink)">更新日志</span>
          <span class="modal-sub">— 蜘蛛织毛线</span>
        </div>
        <button id="clClose" class="modal-x" title="关闭" aria-label="关闭更新日志" @click="close">×</button>
      </div>

      <div class="p-4 pt-3 max-h-[70vh] overflow-y-auto">
        <div v-for="(v, i) in CHANGELOG" :key="v.version" class="relative pl-5"
          :class="i < CHANGELOG.length - 1 ? 'pb-5' : ''">
          <!-- 时间轴线 -->
          <span v-if="i < CHANGELOG.length - 1" class="absolute left-[4.5px] top-4 bottom-0 w-px"
            style="background:var(--acc-border)"></span>
          <span class="absolute left-0 top-[5px] w-[10px] h-[10px] rounded-full border-2"
            :style="i === 0
              ? 'background:var(--acc-500);border-color:var(--acc-200)'
              : 'background:var(--acc-surface);border-color:var(--acc-300)'"></span>

          <div class="flex items-baseline gap-2 mb-1.5">
            <span class="text-[13px] font-extrabold" style="color:var(--acc-700)">{{ v.version }}</span>
            <span class="text-[11px]" style="color:var(--acc-ink-3)">{{ v.date }}</span>
            <span v-if="i === 0" class="text-[10px] font-bold px-1.5 py-px rounded-full"
              style="background:var(--acc-50);color:var(--acc-700);border:1px solid var(--acc-200)">最新</span>
          </div>
          <ul class="space-y-1.5">
            <li v-for="it in v.items" :key="it" class="text-[12px] leading-relaxed flex gap-1.5"
              style="color:var(--acc-ink-2)">
              <span class="flex-none mt-[7px] w-1 h-1 rounded-full" style="background:var(--acc-300)"></span>
              <span>{{ it }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
