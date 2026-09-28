import './style.css';
import { createApp } from 'vue';
import App from './App.vue';
import { load, resetHistory } from './store.js';
import { runSelfTest } from './selftest.js';

/* ---------------- 启动 ---------------- */
load(); // 载入 localStorage（自动迁移旧档），并清理引用了不存在符号的放置
resetHistory(); // 以载入后的状态作为撤销起点

createApp(App).mount('#app');

// 自测试：访问 ?test=1 时自动跑断言
if (location.search.indexOf('test=1') >= 0) runSelfTest();
