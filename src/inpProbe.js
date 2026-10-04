/* INP 自检探针（诊断工具，仅在地址栏带 ?inp=1 时启用）。
   用浏览器官方 Event Timing API 按 INP 口径记录真实交互：
   duration = 输入延迟 + 事件处理 + 呈现（下一次绘制完成）。
   同时抓 longtask / long-animation-frame（含脚本归因）用于定位长任务来源。
   最差交互显示在左下角浮层，window.__inpLog 供程序化读取。 */
export function initInpProbe() {
  if (typeof window === 'undefined' || location.search.indexOf('inp=1') < 0) return;
  const log = [];
  window.__inpLog = log;
  const push = e => {
    log.push(e);
    log.sort((a, b) => b.dur - a.dur);
    if (log.length > 20) log.length = 20;
    render();
  };
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        push({
          kind: e.name || 'event',
          start: Math.round(e.startTime),
          dur: Math.round(e.duration),
          delay: Math.round((e.processingStart || e.startTime) - e.startTime),
          proc: Math.round((e.processingEnd || e.startTime) - (e.processingStart || e.startTime)),
        });
      }
    }).observe({ type: 'event', durationThreshold: 40, buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        push({ kind: 'longtask', start: Math.round(e.startTime), dur: Math.round(e.duration) });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        const src = (e.scripts || [])
          .map(s => (s.sourceFunctionName || s.sourceURL || '?').split('/').pop())
          .slice(0, 2)
          .join(',');
        push({ kind: 'loaf', start: Math.round(e.startTime), dur: Math.round(e.duration), src });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) {}

  const div = document.createElement('div');
  div.id = 'inpProbe';
  div.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;background:#0f172ae6;color:#e2e8f0;' +
    'font:11px/1.5 Consolas,monospace;padding:8px 10px;border-radius:8px;max-width:420px;' +
    'pointer-events:none;white-space:pre;';
  document.body.appendChild(div);
  let last = '';
  function render() {
    if (!log.length) return;
    const lines = ['INP 探针（最差交互，单位 ms）', '交互=输入延迟+处理+呈现'];
    for (const e of log.slice(0, 8)) {
      if (e.kind === 'longtask' || e.kind === 'loaf') {
        lines.push(`${e.kind} ${e.dur}ms @${e.start}${e.src ? ' ← ' + e.src : ''}`);
      } else {
        lines.push(`${e.kind} ${e.dur}ms（延迟${e.delay}+处理${e.proc}+呈现${e.dur - e.delay - e.proc}）@${e.start}`);
      }
    }
    const s = lines.join('\n');
    if (s !== last) { last = s; div.textContent = s; }
  }
  render();
}
