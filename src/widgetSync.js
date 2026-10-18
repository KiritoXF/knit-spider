/* 桌面端双窗口同步（Tauri）：主窗口与歌词浮窗是两个独立 WebView，没有共享 JS 上下文，
   但同一 WebView2 用户目录下同源 localStorage 是共享的，跨窗口写入会触发 storage 事件。
   同步策略（不对称，避免互相覆盖整棵作品树）：
   - 主 → 浮窗 进度：主窗口 setDoneRows 写专用小键 PROG_KEY（即时、几十字节），
     浮窗静默对齐数字；progT 时间戳用于丢弃快速连点时迟到的旧回声
   - 主 → 浮窗 内容：主窗口整档写 IndexedDB（节流）后 bumpRev 写 REV_KEY 信号键；
     浮窗收到信号从 IndexedDB 重读全档，先比内容指纹（updatedAt+wsMap+theme），
     真变了才整档 load() + contentRev++ 重建文字解，纯进度落盘则静默对齐、不闪不重建
   - 浮窗 → 主：浮窗推进织进度只写独立小键 PIP_KEY（相对步进 delta，绝不整树落盘，
     否则浮窗的旧快照会覆盖主窗口未落盘的编辑）；主窗口收到 PIP_KEY → 只叠加 delta */
import { state, load, setDoneRows, resetHistory, contentRev, LS_KEY, REV_KEY, PROG_KEY, readPersistJson } from './store.js';

export const PIP_KEY = LS_KEY + '.pip';

/* 浮窗侧推进进度：只改内存 + 写小键，不走 store 的整树落盘。
   传相对步进 delta 而非绝对值：浮窗内存可能滞后于主窗口，若传绝对值，
   滞后的旧进度会经主窗口的 PIP_KEY 监听把新进度拉回去 */
let lastLocalT = 0; // 本端最近一次本地进度操作时间：据此丢弃主窗口的过期回声
export function pipSetDoneRows(n) {
  const v = Math.min(state.rows, Math.max(0, Math.round(+n) || 0));
  const delta = v - state.doneRows;
  state.doneRows = v;
  lastLocalT = Math.max(lastLocalT + 1, Date.now());
  try {
    localStorage.setItem(PIP_KEY, JSON.stringify({
      chartId: state.activeChartId, delta, t: Date.now(),
    }));
  } catch (e) {}
}

/* mode: 'main' 主窗口 | 'widget' 浮窗。两端各调一次（入口处） */
/* 浮窗侧内容指纹：图解 updatedAt 只在图面内容真变时被 save() 更新（织进度、
   收藏等落盘不动它），叠加 wsMap（反面织法换算）与 theme（配色）。
   上次事件留下的指纹存这里，进度-only 变更即可整档免读、免重建 */
let lastContentFp = '';
export function initSync(mode) {
  if (mode === 'widget') {
    try { localStorage.removeItem(PIP_KEY); } catch (e) {} // 残留的旧进度键清掉
    /* 织进度专线：主窗口改进度时写 PROG_KEY。静默同步数字，不 load、不
       contentRev++（全量重建文字解会闪）。progT 比本端最近本地操作旧 →
       是快速连点时迟到的主窗口回声，丢弃，别把新进度拉回去 */
    window.addEventListener('storage', e => {
      if (e.key !== PROG_KEY || !e.newValue) return;
      try {
        const d = JSON.parse(e.newValue);
        if (d.chartId !== state.activeChartId) return;
        if (+(d.progT || 0) < lastLocalT) return;
        const v = Math.min(state.rows, Math.max(0, Math.round(+d.doneRows) || 0));
        if (v !== state.doneRows) state.doneRows = v;
      } catch (err) {}
    });
    /* 内容同步专线：主窗口 IndexedDB 落盘成功后 bumpRev 写 REV_KEY。
       收到信号从 IndexedDB 重读全档再做指纹判定。rev 单调递增：
       事件可能与异步读乱序（重读期间又来新信号），比 lastRev 旧的直接丢弃 */
    let lastRev = 0;
    window.addEventListener('storage', e => {
      if (e.key !== REV_KEY || !e.newValue) return;
      let rev = 0;
      try { rev = +(JSON.parse(e.newValue).rev) || 0; } catch (err) { return; }
      if (rev <= lastRev) return;
      lastRev = rev;
      readPersistJson().then(d => {
        if (!d || rev < lastRev) return; // 读档期间又有更新的信号：本次作废
        const w = Array.isArray(d.works) && d.works.find(x => x.id === d.activeWorkId);
        const c = w && w.charts.find(x => x.id === d.activeChartId);
        const fp = c ? c.updatedAt + '|' + JSON.stringify(d.wsMap || {}) + '|' + d.theme : '';
        /* 同作品·同图解·内容指纹未变：只是织进度随整档落盘捎带了过来
           （实时进度已由 PROG_KEY 专线同步），静默对齐即可，免整档重建。
           progT 过期（本端更新）同样丢弃 */
        if (fp && w.id === state.activeWorkId && c.id === state.activeChartId &&
            fp === lastContentFp) {
          if (+(d.progT || 0) >= lastLocalT) {
            const v = Math.min(state.rows, Math.max(0, Math.round(+c.doneRows) || 0));
            if (v !== state.doneRows) state.doneRows = v;
          }
          return;
        }
        lastContentFp = fp;
        /* load 现在是异步读 IndexedDB：读档间隙（大图解 MB 级 parse 可达数百毫秒）
           用户可能在浮窗连点 ✓/◀。这些点击已按 delta 经 PIP_KEY 被主窗口吸收，
           但 load 落地时 projectActive 会用快照里的 doneRows 整体覆盖内存——
           快照落盘早于这些点击，刚点的进度会被吃掉（计数器回跳，下次落盘又
           拉回来，表现为计数器来回震荡）。快照 progT 比本端最近一次本地操作
           旧时，load 完成后把本地值重新按上（换图解则随 load，不恢复） */
        const localPending = (state.activeChartId === c.id && lastLocalT > +(d.progT || 0))
          ? state.doneRows : null;
        load().then(() => {
          if (localPending != null && state.activeChartId === c.id) {
            state.doneRows = Math.min(state.rows, Math.max(0, localPending));
          }
          resetHistory();
          contentRev.n++;    // 触发歌词行重算
        });
      }).catch(() => {});
    });
  } else {
    window.addEventListener('storage', e => {
      if (e.key !== PIP_KEY || !e.newValue) return;
      try {
        const d = JSON.parse(e.newValue);
        /* delta 为相对步进：与本端进度无关，直接叠加（绝不用浮窗的绝对值回写，
           那会把浮窗滞后快照里的旧进度盖回主窗口） */
        if (d.chartId === state.activeChartId && Number.isFinite(+d.delta) && +d.delta !== 0) {
          setDoneRows(state.doneRows + (+d.delta)); // 走正常进度入口：写回 LS_KEY、刷新行高亮
        }
      } catch (err) {}
    });
  }
}
