<script setup>
import { ref, computed } from 'vue';
import { state, isChartLocked, resizeGrid, clearColLabels, setRowStartSide } from '../store.js';
import { appConfirm, toast } from '../ui.js';

/* 图解属性（设一次基本不动）：网格尺寸、第 1 行起始侧、清除列号。
   挂在顶栏 ⋯ 的同一锚点上，属于低频操作，不该常驻顶栏。
   注：「最后更改」是关键信息，已移到顶栏常驻显示，不在这里。 */
const inCols = ref(state.cols);
const inRows = ref(state.rows);
const locked = computed(() => isChartLocked());

async function applyResize() {
  const cols = Math.min(400, Math.max(4, +inCols.value || state.cols));
  const rows = Math.min(400, Math.max(4, +inRows.value || state.rows));
  inCols.value = cols; inRows.value = rows;
  if (cols === state.cols && rows === state.rows) { toast('网格尺寸没有变化'); return; }
  /* 缩小网格会裁掉超出的内容：先算清影响范围再确认 */
  if (cols < state.cols || rows < state.rows) {
    const kept = p => p.col + (p.w || 1) <= cols && p.row + (p.h || 1) - 1 <= rows;
    const lostP = state.placements.filter(p => !kept(p)).length;
    const lostB = state.borders.filter(p => !kept(p)).length;
    const lostA = state.annotations.filter(p => !kept(p)).length;
    const detail = [lostP && `${lostP} 个符号`, lostB && `${lostB} 个边框`, lostA && `${lostA} 个标注`]
      .filter(Boolean).join('、');
    const ok = await appConfirm({
      title: '缩小网格',
      message: detail ? `缩小后 ${detail}会被移出画布。\n（本次会话仍可撤销）` : '缩小后画布外没有内容受到影响。',
      okText: '仍要缩小', danger: !!detail,
    });
    if (!ok) { inCols.value = state.cols; inRows.value = state.rows; return; }
  }
  resizeGrid(cols, rows);
}
function onClearCol() {
  clearColLabels();
}
</script>

<template>
  <div id="chartSettings" class="tb-menu tb-panel" role="dialog" aria-label="图解设置">
    <div class="tb-panel-head">
      图解设置
      <span v-if="locked" class="tb-panel-lock">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>
        </svg>
        已锁定
      </span>
    </div>

    <div v-if="locked" class="tb-panel-hint tb-panel-warn">
      图解已锁定，以下设置暂不可改：先在页签右侧点「锁定」解锁。
    </div>

    <div class="tb-panel-row">
      <span class="tb-panel-label">网格尺寸</span>
      <input id="inCols" v-model.number="inCols" type="number" class="tb-input w-14" min="4" max="400"
        :disabled="locked" title="网格宽（针数，4–400）"
        @keydown.enter="applyResize" @focus="$event.target.select()">
      <span class="tb-x">×</span>
      <input id="inRows" v-model.number="inRows" type="number" class="tb-input w-14" min="4" max="400"
        :disabled="locked" title="网格行数（4–400）"
        @keydown.enter="applyResize" @focus="$event.target.select()">
      <button id="btnResize" class="tb-btn tb-btn-primary ml-auto" :disabled="locked"
        title="应用新网格尺寸（也可在输入框按 Enter）" @click="applyResize">应用</button>
    </div>
    <p class="tb-panel-hint">列 × 行，4–400。缩小网格会移除超出的符号。</p>

    <div class="tb-panel-row">
      <span class="tb-panel-label">第 1 行起</span>
      <select id="inRowSide" class="tb-input flex-1" :disabled="locked"
        title="第 1 行从哪一侧开始（决定行号位置与文字解的读写方向）"
        :value="state.rowStartSide" @change="setRowStartSide($event.target.value)">
        <option value="right">右侧（从右往左）</option>
        <option value="left">左侧（从左往右）</option>
      </select>
    </div>
    <p class="tb-panel-hint">行号从第 1 行起逐行左右交替，该侧也决定文字解的读取方向。</p>

    <div class="tb-panel-row">
      <span class="tb-panel-label">列号标注</span>
      <button id="btnClearCol" class="tb-btn" :disabled="locked"
        title="清除全部手动列号标注" @click="onClearCol">清除列号</button>
      <span class="tb-panel-hint mb-0">单击画布列下方可逐个标注</span>
    </div>
  </div>
</template>
