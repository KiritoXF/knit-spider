<script setup>
import { computed, onMounted, onUnmounted } from 'vue';
import {
  state, selectTool, undo, redo, histState,
  copySelection, deleteSelection, addAnnotation, clipSel, clipBoard,
  stepDoneRows, flushPersist,
} from '../store.js';
import { appPrompt, toast } from '../ui.js';

/* 织进度：当前待织行 = doneRows + 1（行号自下而上，与织的方向一致） */
const donePct = computed(() => state.rows ? Math.min(100, (state.doneRows / state.rows) * 100) : 0);
const doneTitle = computed(() => (state.doneRows >= state.rows
  ? `已织完全部 ${state.rows} 行`
  : `已织完 ${state.doneRows} 行，当前待织第 ${state.doneRows + 1} 行`));

function onCopy() {
  if (!clipSel.rect) { flashHint('请先用“框选”选中要复制的区域'); return; }
  copySelection();
}
function onDelete() {
  if (!clipSel.rect) return;
  deleteSelection();
}
async function onAnnotate() {
  if (!clipSel.rect) return;
  const t = await appPrompt({
    title: '区域标注',
    message: '给框选区域添加文字标注，显示在区域上方。',
    placeholder: '如：花样A · 12针重复',
  });
  if (t === null) return;
  addAnnotation(t);
}
function onPaste() {
  if (!clipBoard.data) return;
  selectTool('paste');
}
function flashHint(text) { clipBoard.info = text; toast(text, 'info'); }

/* 全局快捷键：Ctrl+Z / Ctrl+Y(或 Ctrl+Shift+Z) / Ctrl+C / Ctrl+V / Ctrl+S / Delete / Esc */
function onKey(e) {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const k = (e.key || '').toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (k === 'y') { e.preventDefault(); redo(); return; }
    if (k === 'c') { if (clipSel.rect) { e.preventDefault(); copySelection(); } return; }
    if (k === 'v') { if (clipBoard.data) { e.preventDefault(); selectTool('paste'); } return; }
    if (k === 's') { e.preventDefault(); flushPersist(); toast('已保存到本地', 'ok'); return; }
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (clipSel.rect) { e.preventDefault(); deleteSelection(); }
  } else if (e.key === 'Escape') {
    clipSel.rect = null;
    if (state.tool === 'paste') selectTool('knit');
  }
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="toolbar">
    <!-- 工具组 -->
    <div class="tb-group">
      <span class="tb-label">工具</span>
      <button class="tb-btn" data-toolbtn="select" title="框选：拖选矩形区域，配合复制/粘贴使用"
        :class="{ 'tb-btn-on': state.tool === 'select' }"
        @click="selectTool('select')">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3.5" y="3.5" width="17" height="17" rx="2" stroke-dasharray="4 3"/>
        </svg>框选</button>
      <button class="tb-btn" data-toolbtn="erase" title="消去：点击或拖动删除符号与边框"
        :class="{ 'tb-btn-on': state.tool === 'erase' }"
        @click="selectTool('erase')">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/>
          <path d="M22 21H7"/><path d="m5 11 9 9"/>
        </svg>消去</button>
      <button class="tb-btn" data-toolbtn="border" title="边框：拖选矩形画粗外框"
        :class="{ 'tb-btn-on': state.tool === 'border' }"
        @click="selectTool('border')">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="1.5"/>
        </svg>边框</button>
    </div>

    <span class="tb-sep"></span>

    <!-- 剪贴板组 -->
    <div class="tb-group">
      <button id="btnCopy" class="tb-btn" title="复制选区内容（Ctrl+C）"
        :disabled="!clipSel.rect" @click="onCopy">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="12" height="12" rx="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>复制</button>
      <button id="btnDelete" class="tb-btn" title="删除选区内容（Delete 键）"
        :disabled="!clipSel.rect" @click="onDelete">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6h18"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          <path d="M10 11v6"/><path d="M14 11v6"/>
        </svg>删除</button>
      <button id="btnAnnotate" class="tb-btn" title="给框选区域添加文字标注（显示在区域上方）；用消去工具点区域内可删除"
        :disabled="!clipSel.rect" @click="onAnnotate">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/>
          <circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>
        </svg>标注</button>
      <button id="btnPaste" class="tb-btn" title="粘贴：以复制块左下角对齐所点击的格（Ctrl+V）"
        :class="{ 'tb-btn-on': state.tool === 'paste' }"
        :disabled="!clipBoard.data" @click="onPaste">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="8" y="2" width="8" height="4" rx="1"/>
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
        </svg>粘贴</button>
      <span v-if="clipBoard.info" class="text-[11px] text-rose-600">{{ clipBoard.info }}</span>
    </div>

    <span class="tb-sep"></span>

    <!-- 历史组 -->
    <div class="tb-group">
      <button id="btnUndo" class="tb-btn" title="撤销（Ctrl+Z）"
        :disabled="!histState.canUndo" @click="undo">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 14 4 9l5-5"/>
          <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>
        </svg>撤销</button>
      <button id="btnRedo" class="tb-btn" title="重做（Ctrl+Y 或 Ctrl+Shift+Z）"
        :disabled="!histState.canRedo" @click="redo">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m15 14 5-5-5-5"/>
          <path d="M20 9H9.5a5.5 5.5 0 0 0-5.5 5.5v0a5.5 5.5 0 0 0 5.5 5.5H13"/>
        </svg>重做</button>
    </div>

    <!-- 织进度组：贴工具条右端，与左侧三组用分隔线隔开 -->
    <div class="tb-prog" :title="doneTitle">
      <span class="tb-label">织完</span>
      <button id="btnDonePrev" class="tb-btn tb-step" title="回退一行"
        :disabled="state.doneRows <= 0" @click="stepDoneRows(-1)">−</button>
      <span id="doneRowsText" class="tb-prog-count">
        <b>{{ state.doneRows }}</b><span class="tb-prog-slash"> / {{ state.rows }}</span>
      </span>
      <button id="btnDoneNext" class="tb-btn tb-step" :title="doneTitle"
        :disabled="state.doneRows >= state.rows" @click="stepDoneRows(1)">+</button>
      <span class="tb-prog-bar" aria-hidden="true">
        <span class="tb-prog-fill" :style="{ width: donePct + '%' }"></span>
      </span>
    </div>
  </div>
</template>
