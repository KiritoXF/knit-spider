import './style.css';
import { createApp } from 'vue';
import App from './App.vue';
import { load, resetHistory } from './store.js';
import { initTutorials } from './tutorialStore.js';
import { runSelfTest } from './selftest.js';
import { initInpProbe } from './inpProbe.js';

/* ---------------- 启动 ---------------- */
initInpProbe(); // INP 自检探针：仅 ?inp=1 时启用（性能诊断用，普通使用零开销）
load(); // 载入 localStorage（自动迁移旧档），并清理引用了不存在符号的放置
resetHistory(); // 以载入后的状态作为撤销起点

createApp(App).mount('#app');

initTutorials(); // 后台载入本机上传的教程图（IndexedDB → 内存 Map，popover 同步查询用）

// 自测试：访问 ?test=1 时自动跑断言
if (location.search.indexOf('test=1') >= 0) runSelfTest();
