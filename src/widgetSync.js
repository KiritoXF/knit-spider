/* 桌面端双窗口同步（Tauri）：主窗口与歌词浮窗是两个独立 WebView，没有共享 JS 上下文，
   但同一 WebView2 用户目录下同源 localStorage 是共享的，跨窗口写入会触发 storage 事件。
   同步策略（不对称，避免互相覆盖整棵作品树）：
   - 主 → 浮窗：主窗口编辑图解后本来就会把整档写 LS_KEY（节流）；
     浮窗收到 LS_KEY 的 storage 事件 → 整档 load() 重读 + contentRev++（行文字/进度全部跟上）
   - 浮窗 → 主：浮窗推进织进度只写独立小键 PIP_KEY（绝不整树落盘，
     否则浮窗的旧快照会覆盖主窗口未落盘的编辑）；主窗口收到 PIP_KEY → 只 setDoneRows */
import { state, load, setDoneRows, resetHistory, contentRev, LS_KEY } from './store.js';

export const PIP_KEY = LS_KEY + '.pip';

/* 浮窗侧推进进度：只改内存 + 写小键，不走 store 的整树落盘 */
export function pipSetDoneRows(n) {
  const v = Math.min(state.rows, Math.max(0, Math.round(+n) || 0));
  state.doneRows = v;
  try {
    localStorage.setItem(PIP_KEY, JSON.stringify({
      chartId: state.activeChartId, doneRows: v, t: Date.now(),
    }));
  } catch (e) {}
}

/* mode: 'main' 主窗口 | 'widget' 浮窗。两端各调一次（入口处） */
export function initSync(mode) {
  if (mode === 'widget') {
    try { localStorage.removeItem(PIP_KEY); } catch (e) {} // 残留的旧进度键清掉
    window.addEventListener('storage', e => {
      if (e.key !== LS_KEY || !e.newValue) return;
      try {
        load();            // 整档重读（换作品/换图解/图面编辑都跟得上）
        resetHistory();
        contentRev.n++;    // 触发歌词行重算
      } catch (err) {}
    });
  } else {
    window.addEventListener('storage', e => {
      if (e.key !== PIP_KEY || !e.newValue) return;
      try {
        const d = JSON.parse(e.newValue);
        if (d.chartId === state.activeChartId && d.doneRows !== state.doneRows) {
          setDoneRows(d.doneRows); // 走正常进度入口：写回 LS_KEY、刷新行高亮
        }
      } catch (err) {}
    });
  }
}
