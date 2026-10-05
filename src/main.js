import './style.css';
import { createApp } from 'vue';
import App from './App.vue';
import { load, resetHistory } from './store.js';
import { initTutorials } from './tutorialStore.js';
import { runSelfTest } from './selftest.js';
import { initInpProbe } from './inpProbe.js';
import { initSync } from './widgetSync.js';
import LyricPip from './components/LyricPip.vue';
import PopDoc from './components/PopDoc.vue';
import { ui } from './ui.js';
import { togglePip } from './pipLyrics.js';

/* ---------------- 启动 ---------------- */
initInpProbe(); // INP 自检探针：仅 ?inp=1 时启用（性能诊断用，普通使用零开销）
load(); // 载入 localStorage（自动迁移旧档），并清理引用了不存在符号的放置

/* 桌面端教程 popover 的承载窗（?popdoc=1）：透明置顶小窗，内容由主浮窗 emit 过来 */
if (location.search.indexOf('popdoc=1') >= 0) {
  document.body.classList.add('lp-popdoc');
  createApp(PopDoc).mount('#app');
  initTutorials(); // objectURL 虽由主浮窗创建，但文字教程兜底查内存库
/* 桌面端歌词浮窗是独立窗口，加载同一份 HTML 带 ?widget=1：只挂 LyricPip，
   数据经 widgetSync 通过 localStorage storage 事件与主窗口互通 */
} else if (location.search.indexOf('widget=1') >= 0) {
  initSync('widget');
  ui.pipOpen = true; // knitEta 据此开启剩余时间采样
  resetHistory();
  createApp(LyricPip, { win: window }).mount('#app');
  initTutorials(); // 教程图（IndexedDB 同源共享）
  if (location.search.indexOf('test=1') >= 0) runSelfTest();
} else {
  initSync('main');
  resetHistory(); // 以载入后的状态作为撤销起点

  createApp(App).mount('#app');

  /* 系统托盘「打开 / 关闭歌词浮窗」菜单：Rust 发事件，这里执行开关 */
  if (window.__TAURI__) {
    window.__TAURI__.event.listen('lp-tray-pip', () => togglePip()).catch(() => {});
  }

  initTutorials(); // 后台载入本机上传的教程图（IndexedDB → 内存 Map，popover 同步查询用）

  // 自测试：访问 ?test=1 时自动跑断言
  if (location.search.indexOf('test=1') >= 0) runSelfTest();
}
