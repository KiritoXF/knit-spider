<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  state, saveJson, saveChartJson, importJson, importArchive, activeWork, activeChart,
  switchWork, clearAll, THEMES, setTheme,
} from '../store.js';
import { ui, withLoading, appConfirm, toast } from '../ui.js';
import { exportSvg } from '../exportSvg.js';
import ChartTabs from './ChartTabs.vue';
import ChartSettings from './ChartSettings.vue';

/* 顶栏只承担「导航 + 关键信息」：
   回首页 · 切换作品（增删改在首页）· 图解页签 · 最后更改时间 · 文字解 · 文件（打开/导出）· 帮助 · 更多 */
const fileInput = ref(null);
const menu = ref('');          // '' | 'work' | 'file' | 'more' | 'settings'
const workWrap = ref(null);
const rightWrap = ref(null);

const work = computed(() => activeWork());
const workName = computed(() => (work.value ? work.value.name : '作品'));

/* 图解「最后更改」——关键信息，常驻顶栏（原本收在图解设置里，太深） */
const upd = computed(() => {
  const c = activeChart();
  const t = c && c.updatedAt;
  if (!t) return { short: '未保存', full: '' };
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  const hm = p(d.getHours()) + ':' + p(d.getMinutes());
  const md = (d.getMonth() + 1) + '-' + p(d.getDate());
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return {
    short: sameYear ? md + ' ' + hm : d.getFullYear() + '-' + md + ' ' + hm,
    full: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + hm,
  };
});

function toggleMenu(k) { menu.value = menu.value === k ? '' : k; }
function closeMenu() { menu.value = ''; }
function goHome() { closeMenu(); ui.view = 'home'; }

/* ---- 作品：顶栏只切换，增删改回首页 ---- */
function onSwitchWork(id) {
  closeMenu();
  if (id === state.activeWorkId) return;
  withLoading(() => switchWork(id));
}

/* ---- 文字解 / 文件 / 帮助 ---- */
function menuTextChart() { closeMenu(); ui.textChartOpen = true; }
function menuChangelog() { closeMenu(); ui.changelogOpen = true; }
function menuSaveChart() { closeMenu(); saveChartJson(); }
function menuExportSvg() { closeMenu(); exportSvg(); }
function menuSaveWork() { closeMenu(); saveJson(); }
function menuLoad() { closeMenu(); fileInput.value.click(); }
function menuSettings() { menu.value = 'settings'; }
function menuHelp() { closeMenu(); ui.helpOpen = true; }

function onDocDown(e) {
  if (!menu.value) return;
  const inWork = workWrap.value && workWrap.value.contains(e.target);
  const inRight = rightWrap.value && rightWrap.value.contains(e.target);
  if (!inWork && !inRight) closeMenu();
}
function onDocKey(e) { if (e.key === 'Escape') closeMenu(); }
onMounted(() => {
  document.addEventListener('mousedown', onDocDown);
  document.addEventListener('keydown', onDocKey);
});
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocDown);
  document.removeEventListener('keydown', onDocKey);
});

async function onLoadJson(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    // zip 作品包（含教程图）与 json 存档按扩展名/类型分流
    if (/\.zip$/i.test(file.name) || /zip/i.test(file.type)) {
      await importArchive(file);
    } else {
      await importJson(await file.text());
    }
  } catch (err) {
    toast('载入失败：' + (err && err.message ? err.message : '文件解析错误'), 'warn');
  }
}

async function onClear() {
  closeMenu();
  const ok = await appConfirm({
    title: '清空图解',
    message: '清空当前图解的全部符号和粗边框？\n（自定义符号与列号设置保留）',
    okText: '清空', danger: true,
  });
  if (ok) clearAll();
}
</script>

<template>
  <header class="topbar">
    <!-- 品牌：回作品管理页（作品的增删改都在那一页） -->
    <button class="tb-home" title="返回作品管理页" @click="goHome">
      <span class="tb-home-logo" aria-hidden="true">🧶</span>
      <span class="tb-home-txt">蜘蛛织毛线</span>
    </button>

    <!-- 作品名 ▾：只做切换 -->
    <div ref="workWrap" class="tb-menu-wrap">
      <button id="btnWorkMenu" class="tb-btn tb-work" :class="{ 'tb-btn-on': menu === 'work' }"
        aria-haspopup="menu" :aria-expanded="menu === 'work'"
        title="切换作品" @click="toggleMenu('work')">
        <span class="tb-work-name">{{ workName }}</span>
        <svg class="tb-chev" :class="{ 'tb-chev-open': menu === 'work' }" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </button>
      <!-- 左侧锚点：菜单向左展开会被裁掉，所以这里贴左对齐 -->
      <div v-if="menu === 'work'" class="tb-menu tb-menu-left" role="menu" aria-label="切换作品">
        <div class="tb-menu-cap">切换作品</div>
        <button v-for="w in state.works" :key="w.id" class="tb-menu-item" role="menuitem"
          :class="{ 'tb-menu-item-on': w.id === state.activeWorkId }" @click="onSwitchWork(w.id)">
          <span class="tb-menu-check">
            <svg v-if="w.id === state.activeWorkId" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m5 13 4 4L19 7"/>
            </svg>
          </span>
          <span class="tb-menu-txt">
            <span class="tb-menu-title">{{ w.name }}</span>
            <span class="tb-menu-desc">{{ w.charts.length }} 个图解</span>
          </span>
        </button>
      </div>
    </div>

    <span class="tb-crumb" aria-hidden="true">›</span>

    <!-- 图解页签（内联，含新建 / 锁定） -->
    <ChartTabs/>

    <div ref="rightWrap" class="tb-right">
      <!-- 关键信息：当前图解的保存时间 -->
      <span class="tb-upd" :title="'最后更改：' + (upd.full || '—')">
        <svg class="tb-upd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
        </svg>
        {{ upd.short }}
      </span>

      <!-- 文字解：招牌功能，常驻 -->
      <button id="btnTextChart" class="tb-btn"
        title="把当前图解转换为逐行文字解（反面行自动换算，可复制 / 下载 txt）" @click="menuTextChart">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
          <path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>
        </svg>文字解
      </button>

      <!-- 文件：打开与导出放在一起 -->
      <div class="tb-menu-wrap">
        <button id="btnFileMenu" class="tb-btn" :class="{ 'tb-btn-on': menu === 'file' }"
          aria-haspopup="menu" :aria-expanded="menu === 'file'"
          title="打开 / 导出 / 存档" @click="toggleMenu('file')">
          <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
          </svg>文件
          <svg class="tb-chev" :class="{ 'tb-chev-open': menu === 'file' }" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
        <div v-if="menu === 'file'" class="tb-menu" role="menu" aria-label="文件">
          <div class="tb-menu-cap">打开</div>
          <button id="btnLoadJson" class="tb-menu-item" role="menuitem"
            title="载入 zip 作品包或 JSON 存档（追加为新作品）" @click="menuLoad">
            <span class="tb-mi-ico ico-green">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>
              </svg>
            </span>
            <span class="tb-menu-txt">
              <span class="tb-menu-title">载入文件…</span>
              <span class="tb-menu-desc">zip 作品包 / JSON · 追加为新作品</span>
            </span>
          </button>
          <div class="tb-menu-sep"></div>
          <div class="tb-menu-cap">导出与存档</div>
          <button id="btnSaveChartJson" class="tb-menu-item" role="menuitem"
            title="仅导出当前图解为 JSON 文件" @click="menuSaveChart">
            <span class="tb-mi-ico ico-slate">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/>
                <path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>
              </svg>
            </span>
            <span class="tb-menu-txt">
              <span class="tb-menu-title">导出图解 JSON</span>
              <span class="tb-menu-desc">仅当前图解 · v1 兼容格式</span>
            </span>
          </button>
          <button id="btnExport" class="tb-menu-item" role="menuitem"
            title="导出当前图解为 SVG 矢量图（打印 / 分享）" @click="menuExportSvg">
            <span class="tb-mi-ico ico-teal">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/>
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
              </svg>
            </span>
            <span class="tb-menu-txt">
              <span class="tb-menu-title">导出 SVG</span>
              <span class="tb-menu-desc">矢量图 · 打印 / 分享</span>
            </span>
          </button>
          <button id="btnSaveJson" class="tb-menu-item" role="menuitem"
            title="把整个作品（全部图解 + 本机教程图）保存为 zip 作品包" @click="menuSaveWork">
            <span class="tb-mi-ico ico-amber">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>
                <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>
              </svg>
            </span>
            <span class="tb-menu-txt">
              <span class="tb-menu-title">存档作品</span>
              <span class="tb-menu-desc">整包 zip · 全部图解＋教程图</span>
            </span>
          </button>
        </div>
      </div>

      <!-- 操作说明：右上角问号 -->
      <button id="btnHelp" class="tb-btn tb-btn-sq" title="操作说明（工具用法 · 快捷键）"
        aria-label="操作说明" @click="menuHelp">
        <svg class="tb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4"/>
          <path d="M12 17.5h.01"/>
        </svg>
      </button>

      <div class="tb-menu-wrap">
        <button id="btnMoreMenu" class="tb-btn tb-btn-sq" :class="{ 'tb-btn-on': menu === 'more' }"
          aria-haspopup="menu" :aria-expanded="menu === 'more'" title="更多" @click="toggleMenu('more')">
          <svg class="tb-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>
          </svg>
        </button>
        <div v-if="menu === 'more'" class="tb-menu" role="menu" aria-label="更多">
          <button id="btnSettings" class="tb-menu-item" role="menuitem"
            title="网格尺寸 / 第 1 行起始侧 / 清除列号" @click="menuSettings">
            <span class="tb-mi-ico ico-slate">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>
              </svg>
            </span>
            <span class="tb-menu-txt">
              <span class="tb-menu-title">图解设置…</span>
              <span class="tb-menu-desc">网格尺寸 · 行向 · 列号</span>
            </span>
          </button>
          <div class="tb-menu-sep"></div>
          <div class="tb-menu-cap">外观配色</div>
          <button v-for="t in THEMES" :key="t.id" :id="'btnTheme-' + t.id" class="tb-menu-item"
            :class="{ 'tb-menu-item-on': state.theme === t.id }"
            role="menuitemradio" :aria-checked="state.theme === t.id"
            :title="`切换到「${t.name}」配色`" @click="setTheme(t.id)">
            <span class="tb-menu-check">
              <svg v-if="state.theme === t.id" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m5 12.5 4.5 4.5L19 7"/>
              </svg>
            </span>
            <span class="tb-mi-ico" :class="'tb-sw-' + t.id"></span>
            <span class="tb-menu-txt">
              <span class="tb-menu-title">{{ t.name }}</span>
              <span class="tb-menu-desc">{{ t.desc }}</span>
            </span>
          </button>
          <div class="tb-menu-sep"></div>
          <button id="btnChangelog" class="tb-menu-item" role="menuitem"
            title="版本更新记录" @click="menuChangelog">
            <span class="tb-mi-ico ico-slate">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 8v4l2.5 2.5"/><circle cx="12" cy="12" r="9"/>
              </svg>
            </span>
            <span class="tb-menu-txt">
              <span class="tb-menu-title">更新日志</span>
              <span class="tb-menu-desc">每次更新做了什么</span>
            </span>
          </button>
          <div class="tb-menu-sep"></div>
          <button id="btnClear" class="tb-menu-item tb-menu-danger" role="menuitem"
            title="清空当前图解的全部符号和粗边框（自定义符号与列号设置保留）" @click="onClear">
            <span class="tb-mi-ico ico-red">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>
              </svg>
            </span>
            <span class="tb-menu-txt">
              <span class="tb-menu-title">清空图解…</span>
              <span class="tb-menu-desc">移除图上全部符号与边框</span>
            </span>
          </button>
        </div>

        <!-- 图解设置（与 ⋯ 同锚点，切换显示） -->
        <ChartSettings v-if="menu === 'settings'"/>
      </div>
    </div>

    <input ref="fileInput" type="file" accept=".json,.zip,application/json,application/zip"
      style="display:none" @change="onLoadJson">
  </header>
</template>
