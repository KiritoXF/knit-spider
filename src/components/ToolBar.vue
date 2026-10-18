<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  state, selectTool, undo, redo, histState,
  copySelection, deleteSelection, addAnnotation, clipSel, clipBoard,
  stepDoneRows, flushPersist,
  setColorIdx, editPaletteColor, addPaletteColor, removePaletteColor, toggleShowBlocks,
} from '../store.js';
import { appPrompt, toast, ui } from '../ui.js';

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

/* ---- 多色编织：调色板弹层 ---- */
const palOpen = ref(false);
const curEntry = computed(() => state.palette[state.colorIdx] || { hex: '#111111', name: '默认' });
const curLabel = computed(() => curEntry.value.name || curEntry.value.hex);
/* 弹层里的编辑缓冲：hex 手输框与原生取色器联动（只在本色被选中时回填） */
const edHex = ref(curEntry.value.hex);
const edName = ref(curEntry.value.name);
const selIdx = ref(0); // 弹层正在编辑的颜色（可与绘制色不同）
function syncEd(i) {
  selIdx.value = i;
  edHex.value = state.palette[i] ? state.palette[i].hex : '';
  edName.value = state.palette[i] ? state.palette[i].name : '';
}
function onPickColor(i) {
  setColorIdx(i);
  syncEd(i);
}
function onHexInput() {
  const v = edHex.value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) editPaletteColor(selIdx.value, v, edName.value);
}
function onNameInput() {
  editPaletteColor(selIdx.value, state.palette[selIdx.value].hex, edName.value);
}
function onPickInput(e) { // 原生取色器 → 同步 hex 框 + 应用
  edHex.value = e.target.value.toUpperCase();
  onHexInput();
}
function onAddColor() {
  addPaletteColor('#888888', '');
  syncEd(state.colorIdx);
}
function onDelColor() {
  if (!state.palette[selIdx.value] || state.palette[selIdx.value].d) {
    toast('默认颜色不允许删除，以免误删', 'info');
    return;
  }
  removePaletteColor(selIdx.value);
  syncEd(Math.min(selIdx.value, state.palette.length - 1));
}
/* 弹层用 Teleport 挂到 body + fixed 定位：.main 有 overflow:hidden，
   绝对定位弹层超出 .main 左缘（侧栏分界处）的部分会被裁掉，看起来像被挡住。
   打开时记下按钮屏幕矩形，面板右对齐按钮、贴按钮下方 */
const palPos = ref({ top: '0px', right: '0px' });
const viewPos = ref({ top: '0px', right: '0px' });
function panelPos(btnEl) {
  const r = btnEl.getBoundingClientRect();
  return {
    top: r.bottom + 8 + 'px',
    right: Math.max(8, window.innerWidth - r.right) + 'px',
  };
}
function togglePal() {
  palOpen.value = !palOpen.value;
  if (palOpen.value) {
    syncEd(state.colorIdx);
    palPos.value = panelPos(palBtn.value);
  }
}
function toggleView() {
  viewOpen.value = !viewOpen.value;
  if (viewOpen.value) viewPos.value = panelPos(viewBtn.value);
}
/* 窗口尺寸变化时面板位置失效，直接收起 */
function onWinResize() { palOpen.value = false; viewOpen.value = false; }
/* 视图菜单：显示类开关集合（checkbox），后续视图选项往这里加 */
const viewOpen = ref(false);
const palBtn = ref(null);
const viewBtn = ref(null);
const viewItems = [
  { key: 'viewHoverSame', label: '悬浮高亮同色', tip: '鼠标悬浮任意符号格，图解里所有同色符号一起高亮' },
  { key: 'showBlocks', label: '半透明色块底', tip: '在符号下方垫半透明颜色块，多色花样的颜色分区一目了然' },
];
function onViewToggle(key) {
  if (key === 'showBlocks') { toggleShowBlocks(); }
  else {
    state[key] = !state[key];
    if (key === 'viewHoverSame' && !state[key]) state.hoverC = null;
  }
  viewOpen.value = false; // 选中/取消后立即收起菜单
}

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
    palOpen.value = false;
    if (state.tool === 'paste') selectTool('knit');
  }
}
/* 点弹层外关闭调色板/视图菜单 */
function onDocDown(e) {
  if (!(e.target.closest && e.target.closest('.tb-menu-wrap'))) {
    palOpen.value = false;
    viewOpen.value = false;
  }
}
onMounted(() => {
  window.addEventListener('keydown', onKey);
  document.addEventListener('mousedown', onDocDown);
  window.addEventListener('resize', onWinResize);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKey);
  document.removeEventListener('mousedown', onDocDown);
  window.removeEventListener('resize', onWinResize);
});
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
        </svg></button>
      <button class="tb-btn" data-toolbtn="erase" title="消去：点击或拖动删除符号与边框"
        :class="{ 'tb-btn-on': state.tool === 'erase' }"
        @click="selectTool('erase')">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/>
          <path d="M22 21H7"/><path d="m5 11 9 9"/>
        </svg></button>
      <button class="tb-btn" data-toolbtn="brush" title="染刷：点击或拖过已有符号，把它整只染成当前颜色（多色编织用）"
        :class="{ 'tb-btn-on': state.tool === 'brush' }"
        @click="selectTool('brush')">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/>
          <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" fill="currentColor" stroke="none"/>
        </svg></button>
      <button class="tb-btn" data-toolbtn="picker" title="取色器：点击格子，把当前颜色换成那格符号的颜色"
        :class="{ 'tb-btn-on': state.tool === 'picker' }"
        @click="selectTool('picker')">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m2 22 1-1h3l9-9"/>
          <path d="M3 21v-3l9-9"/>
          <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>
        </svg></button>
      <button class="tb-btn" data-toolbtn="border" title="边框：拖选矩形画粗外框"
        :class="{ 'tb-btn-on': state.tool === 'border' }"
        @click="selectTool('border')">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="1.5"/>
        </svg>边框</button>
    </div>

    <span class="tb-sep"></span>

    <!-- 颜色组：当前绘制色 + 调色板弹层（多色编织）。
         弹层 Teleport 到 body：.main overflow:hidden 会裁掉超出左缘的部分 -->
    <div class="tb-menu-wrap">
      <button ref="palBtn" class="tb-btn" :class="{ 'tb-btn-on': palOpen }"
        title="颜色：选当前绘制色（放置的符号按此色显示），可编辑/新增调色板颜色" @click="togglePal">
        <span class="tb-cur-dot" :style="{ background: curEntry.hex }"></span><span class="tb-cur-name">{{ curLabel }}</span>
      </button>
      <Teleport to="body">
        <div v-if="palOpen" class="tb-menu tb-panel pal-panel" :style="{ position: 'fixed', ...palPos }" @mousedown.stop>
        <div class="tb-panel-head">调色板
          <span class="tb-panel-lock">{{ state.palette.length }} 色</span>
          <button class="pal-add pal-add-head" title="新增颜色" @click="onAddColor">+</button>
        </div>
        <div class="pal-grid">
          <button v-for="(col, i) in state.palette" :key="i" class="pal-swatch"
            :class="{ 'pal-swatch-on': i === state.colorIdx }" :style="{ background: col.hex }"
            :title="(col.name || col.hex) + '（点击选为当前绘制色）'" @click="onPickColor(i)"></button>
        </div>
        <div class="pal-edit">
          <input type="color" :value="state.palette[selIdx] && state.palette[selIdx].hex"
            title="取色器" @input="onPickInput">
          <input class="tb-input pal-hex" :value="edHex" placeholder="#RRGGBB" spellcheck="false"
            title="16 进制色值（#RRGGBB，输入合法即生效）" @input="edHex = $event.target.value; onHexInput()">
          <input class="tb-input pal-name" :value="edName" placeholder="颜色名（如：枣红）" maxlength="16"
            title="颜色名（最长 16 字）" @input="edName = $event.target.value; onNameInput()">
          <button class="tb-btn" :disabled="!state.palette[selIdx] || state.palette[selIdx].d"
            title="删除该颜色（默认颜色不可删除；已用该色的符号回退默认色）" @click="onDelColor">删除</button>
        </div>
        </div>
      </Teleport>
    </div>

    <!-- 视图菜单：显示类开关（checkbox），同样 Teleport 防裁剪 -->
    <div class="tb-menu-wrap">
      <button ref="viewBtn" class="tb-btn" :class="{ 'tb-btn-on': viewOpen }"
        title="视图：控制画布上的辅助显示效果" @click="toggleView">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>视图</button>
      <Teleport to="body">
        <div v-if="viewOpen" class="tb-menu tb-panel view-panel" :style="{ position: 'fixed', ...viewPos }" @mousedown.stop>
          <div class="tb-panel-head">视图选项</div>
          <label v-for="it in viewItems" :key="it.key" class="view-item" :title="it.tip">
            <input type="checkbox" :checked="state[it.key]" @change="onViewToggle(it.key)">
            <span>{{ it.label }}</span>
          </label>
        </div>
      </Teleport>
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
        </svg></button>
      <button id="btnDelete" class="tb-btn" title="删除选区内容（Delete 键）"
        :disabled="!clipSel.rect" @click="onDelete">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6h18"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          <path d="M10 11v6"/><path d="M14 11v6"/>
        </svg></button>
      <button id="btnAnnotate" class="tb-btn" title="给框选区域添加文字标注（显示在区域上方）；用消去工具点区域内可删除"
        :disabled="!clipSel.rect" @click="onAnnotate">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/>
          <circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>
        </svg></button>
      <button id="btnPaste" class="tb-btn" title="粘贴：以复制块左下角对齐所点击的格（Ctrl+V）"
        :class="{ 'tb-btn-on': state.tool === 'paste' }"
        :disabled="!clipBoard.data" @click="onPaste">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="8" y="2" width="8" height="4" rx="1"/>
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
        </svg></button>
      <!-- 镜像粘贴：只影响粘贴时的变换（水平/垂直可叠加=旋转180°），预览框同步照实显示 -->
      <button id="btnMirrorH" class="tb-btn" :class="{ 'tb-btn-on': ui.mirrorH }"
        :disabled="!clipBoard.data" title="镜像粘贴：水平翻转复制块（再点一次取消）"
        :aria-pressed="ui.mirrorH" @click="ui.mirrorH = !ui.mirrorH">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3v18" stroke-dasharray="2.5 2.5"/><path d="M8 8 4 12l4 4"/><path d="M16 8l4 4-4 4"/>
        </svg>左右</button>
      <button id="btnMirrorV" class="tb-btn" :class="{ 'tb-btn-on': ui.mirrorV }"
        :disabled="!clipBoard.data" title="镜像粘贴：垂直翻转复制块（再点一次取消）"
        :aria-pressed="ui.mirrorV" @click="ui.mirrorV = !ui.mirrorV">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12h18" stroke-dasharray="2.5 2.5"/><path d="M8 8l4-4 4 4"/><path d="M8 16l4 4 4-4"/>
        </svg>上下</button>
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
        </svg></button>
      <button id="btnRedo" class="tb-btn" title="重做（Ctrl+Y 或 Ctrl+Shift+Z）"
        :disabled="!histState.canRedo" @click="redo">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m15 14 5-5-5-5"/>
          <path d="M20 9H9.5a5.5 5.5 0 0 0-5.5 5.5v0a5.5 5.5 0 0 0 5.5 5.5H13"/>
        </svg></button>
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
