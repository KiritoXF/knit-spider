<script setup>
import { onMounted, onUnmounted } from 'vue';
import { ui, dlg } from '../ui.js';

const close = () => { ui.helpOpen = false; };
/* Esc：应用内对话框优先（dlg.open 让路）→ 关帮助 */
const onKey = e => {
  if (e.key !== 'Escape' || !ui.helpOpen || dlg.open) return;
  close();
};
onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => document.removeEventListener('keydown', onKey));

/* 图标（静态字符串，直接 v-html 进 <svg>） */
const ICONS = {
  brush: '<path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01"/><path d="M10 10h.01"/><path d="M14 10h.01"/><path d="M18 10h.01"/><path d="M7 14h10"/>',
  layers: '<path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
};

/* 三步上手：先给流程，再给细节 */
const FLOW = ['左侧选一个针法', '单击 / 拖动格子作画', '文字解 · 导出 SVG'];

/* 五组说明：与侧栏原先那几行文字同源，补上散落在各处的细节 */
const SECTIONS = [
  {
    t: '画图', ico: 'brush', tone: 'ico-rose',
    items: [
      '在左侧符号面板选一个针法，单击格子放入',
      '按住不放拖动，可连续画出一整行 / 一整片',
      '用「消去」工具，删除格子里的符号',
      '点行号高亮当前行，方便对着行数织',
    ],
  },
  {
    t: '区域操作', ico: 'crop', tone: 'ico-teal',
    items: [
      '「框选」拖出矩形区域，再复制 / 删除 / 标注',
      '「粘贴」以复制块左下角对齐你点的格子',
      '「标注」给区域命名（如：花样A · 12针重复）',
      '「边框」拖出矩形，给图解画粗外框',
    ],
  },
  {
    t: '行列与标注', ico: 'grid', tone: 'ico-slate', wide: true,
    items: [
      '行列数、第 1 行起始侧在顶栏 ⋯ › 图解设置里',
      '行号从第 1 行起逐行左右交替，也决定文字解的读取方向',
      '单击画布列下方可标注列号，留空即清除',
    ],
  },
  {
    t: '快捷键', ico: 'keyboard', tone: 'ico-amber', wide: true,
    keys: [
      { k: ['Ctrl', 'Z'], d: '撤销' },
      { k: ['Ctrl', 'Y'], d: '重做（也支持 Ctrl+Shift+Z）' },
      { k: ['Ctrl', 'C'], d: '复制选区' },
      { k: ['Ctrl', 'V'], d: '粘贴到指定格子' },
      { k: ['Ctrl', 'S'], d: '立即保存到本地' },
      { k: ['Delete'], d: '删除选区内容' },
      { k: ['Esc'], d: '取消选区 / 关闭弹窗' },
      { k: ['Ctrl', '滚轮'], d: '缩放画布' },
    ],
  },
  {
    t: '图解与作品', ico: 'layers', tone: 'ico-green', wide: true,
    items: [
      '顶栏页签切换图解，双击页签名可重命名',
      '图解画完点页签右侧「锁定」，防止误改；锁定的图解要先解锁才能删除',
      '「文件」里可打开存档，也可导出文字解 / JSON / SVG / 整包 zip',
      '图稿自动保存在浏览器本地，换机器用存档 zip',
    ],
  },
];
</script>

<template>
  <div v-if="ui.helpOpen" class="fixed inset-0 bg-black/30 items-center justify-center"
    style="z-index:50;display:flex" @mousedown.self="close">
    <div class="modal-shell help-shell w-[720px] max-w-[calc(100vw-32px)]">
      <div class="modal-head">
        <h2 class="modal-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4"/>
            <path d="M12 17.5h.01"/>
          </svg>
          操作说明
          <span class="modal-sub">怎么画 · 快捷键 · 图解与作品</span>
        </h2>
        <button id="helpClose" class="modal-x" title="关闭" @click="close">×</button>
      </div>

      <div class="help-body">
        <!-- 三步上手 -->
        <div class="help-flow">
          <template v-for="(f, i) in FLOW" :key="f">
            <span class="help-flow-step"><b>{{ i + 1 }}</b>{{ f }}</span>
            <span v-if="i < FLOW.length - 1" class="help-flow-arrow" aria-hidden="true">→</span>
          </template>
        </div>

        <div class="help-grid">
          <section v-for="s in SECTIONS" :key="s.t" class="help-card" :class="{ 'help-card-wide': s.wide }">
            <div class="help-card-head">
              <span class="help-ico" :class="s.tone">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="ICONS[s.ico]"></svg>
              </span>
              <h3>{{ s.t }}</h3>
            </div>

            <ul v-if="s.items" class="help-list">
              <li v-for="(it, i) in s.items" :key="i">{{ it }}</li>
            </ul>

            <div v-else class="help-keys">
              <div v-for="(row, i) in s.keys" :key="i" class="help-keyrow">
                <span class="help-kbd-group">
                  <template v-for="(kk, j) in row.k" :key="j">
                    <span class="help-kbd">{{ kk }}</span>
                    <span v-if="j < row.k.length - 1" class="help-kbd-plus">+</span>
                  </template>
                </span>
                <span class="help-keydesc">{{ row.d }}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
