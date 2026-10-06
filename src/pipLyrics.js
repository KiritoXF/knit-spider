/* 歌词浮窗（桌面端专属，Tauri）：把当前待织行做成置顶小窗，
   切到别的软件（微信等）都悬浮可见。网页端画中画已移除（窗口不透明、内容裁切、
   双路径难维护），文字解弹窗的「浮窗」按钮仅在 Tauri 环境显示。
   两个辅助窗口都由这里管理：
   - lyric-pip：歌词主浮窗，加载 knitting-chart.html?widget=1，
     经 widgetSync（localStorage storage 事件）与主窗口互通进度/图面数据
   - lyric-pop：教程 popover 承载窗，WebView 内容无法画出窗外，
     教程图靠它贴着主浮窗边缘显示：showTauriPop 发内容 → PopDoc 渲染并回报高度 →
     placeTauriPop 按锚点定位 + 调窗口尺寸 */
import { ui, toast } from './ui.js';
import { flushPersist } from './store.js';

let pipWin = null;
let popDocWin = null;   // 教程 popover 承载窗（lyric-pop）
let popDocReady = false;
let pendingPop = null;  // 承载窗就绪前到达的 popover 内容
let popAnchor = null;   // { x, y0, above, W } —— popover 相对主浮窗视口的锚点（CSS px）

export function isTauri() {
  return typeof window !== 'undefined' && !!window.__TAURI__;
}
/* v2 的全局 API：WebviewWindow 类在 __TAURI__.webviewWindow 下（v1 才在 __TAURI__.window） */
function tauriWebviewWindow() {
  const T = window.__TAURI__;
  return T.webviewWindow?.WebviewWindow || T.window?.WebviewWindow || null;
}
export function pipSupported() {
  return isTauri();
}

export async function openPip() {
  if (!pipSupported()) return;
  const WW = tauriWebviewWindow();
  if (!WW) { toast('桌面浮窗 API 不可用（检查 withGlobalTauri 配置）', 'warn'); return; }
  /* 关键：主窗口落盘有最长 12s 的节流，先强制刷出再开窗，
     否则浮窗启动 load() 读到的是旧档（进度/图面陈旧，还会反过来覆盖新进度） */
  flushPersist();
  const existing = await WW.getByLabel('lyric-pip');
  if (existing) {
    pipWin = existing;
    ui.pipOpen = true;
    attachPipWinListeners(); // 复用路径同样要注册（focus/destroyed），见下
    await existing.setFocus(); await existing.show();
    return;
  }
  /* 应用上次记住的位置和大小（LyricPip 在移动/缩放时防抖存入，物理像素）。
     不能塞进创建参数（x 字段不接受 Physical 实例，会反序列化失败导致窗口创建不出来）：
     先以 visible:false 创建，创建成功后再 setPosition/setSize/show。
     校验：坐标必须落在某块显示器的范围内 —— Windows 最小化时坐标会报 -32000，
     若存了这种值开窗就“消失”在屏幕外 */
  let bounds = null;
  try { bounds = JSON.parse(localStorage.getItem('lp-win-bounds')); } catch (e) {}
  const T0 = window.__TAURI__;
  if (bounds && [bounds.x, bounds.y, bounds.w, bounds.h].every(n => Number.isFinite(n))) {
    try {
      const mons = await T0.window.availableMonitors();
      const inAnyMonitor = mons.some(m => {
        const a = m.workArea ? m.workArea.position : m.position;
        const s = m.workArea ? m.workArea.size : m.size;
        return bounds.x >= a.x - 40 && bounds.y >= a.y - 40 &&
               bounds.x <= a.x + s.width && bounds.y <= a.y + s.height;
      });
      if (!inAnyMonitor) bounds = null;
    } catch (e) {
      if (bounds.x < -1000 || bounds.y < -1000) bounds = null; // 拿不到显示器信息时至少挡掉最小化哨兵值
    }
  } else bounds = null;
  const hasBounds = !!bounds;
  ui.pipOpen = true;
  pipWin = new WW('lyric-pip', {
    url: 'knitting-chart.html?widget=1',
    title: '织浮窗',
    width: 420, height: 300, minWidth: 280, minHeight: 40,
    // minHeight 必须小于「标题栏+一行」的内容高（约 60-70px）：
    // LyricPip.fitHeight 会把窗口高度钉到内容高，min 过大时会钳住留出底部空白
    decorations: false,           // 无系统边框（标题栏区域自绘 + 可拖拽）
    transparent: true,            // 窗口真透明（空闲态只留歌词文字）
    alwaysOnTop: true,            // 置顶于其他软件
    skipTaskbar: true, shadow: false, resizable: true, visible: false,
  });
  pipWin.once('tauri://error', e => { // 窗口创建失败不再静默，给出可见提示
    toast('浮窗创建失败：' + JSON.stringify(e.payload || '未知错误'), 'warn');
    pipWin = null;
    ui.pipOpen = false;
  });
  pipWin.once('tauri://created', async () => {
    try {
      if (hasBounds) {
        await pipWin.setPosition(new T0.window.PhysicalPosition(bounds.x, bounds.y));
        await pipWin.setSize(new T0.window.PhysicalSize(bounds.w, bounds.h));
      }
    } catch (e) {}
    await ensureOnScreen();
  });
  attachPipWinListeners();
  /* 看门狗：无论 created/记忆/显示哪一环出问题，2.5s 后强制检查——
     不可见就 show，位置在显示器外就拉回主屏工作区居中。杜绝“开在看不见的地方” */
  setTimeout(async () => {
    try {
      if (!pipWin) return;
      if (!(await pipWin.isVisible())) await ensureOnScreen(true);
    } catch (e) {}
  }, 2500);
  /* LyricPip 不在这里 mount：浮窗窗口自己加载 ?widget=1 页面，
     main.js 的 widget 分支挂载组件（独立 WebView、独立 JS 上下文） */
}

/* pipWin 实例级监听：创建/复用两条路径都必须注册 ——
   focus 时把教程承载窗重新顶上去（两个窗口都 alwaysOnTop，主浮窗获焦
   会把它压到下面）；destroyed 时同步开关状态。此前只在创建路径注册，
   重开复用的浮窗上没有 focus 监听 → 教程窗“偶尔”被压在主浮窗下方 */
function attachPipWinListeners() {
  if (!pipWin) return;
  pipWin.listen('tauri://focus', () => {
    if (popDocWin && popDocReady) {
      popDocWin.setAlwaysOnTop(false).then(() => popDocWin.setAlwaysOnTop(true)).catch(() => {});
    }
  });
  pipWin.once('tauri://destroyed', () => { // 用户关掉浮窗
    pipWin = null;
    ui.pipOpen = false;
  });
}

export async function closePip() {
  const WW = tauriWebviewWindow();
  const win = WW ? await WW.getByLabel('lyric-pip') : null;
  if (win) await win.close();
  ui.pipOpen = false;
  await hideTauriPop(); // 主浮窗关了，教程窗一起收
}

export function togglePip() {
  if (ui.pipOpen) closePip();
  else openPip();
}

/* ---- 桌面端教程 popover 承载窗 ---- */
const POP_PAD = 14; // 承载窗四周留白（卡片阴影不被裁切；其余区域全透明且鼠标穿透）

/* 确保歌词浮窗落在某块显示器的工作区内并显示：
   位置在屏外 → 拉回第一块屏工作区居中。任何一步失败都不能吞掉 show()——
   窗口以 visible:false 创建，这里不 show 它就永远不可见 */
async function ensureOnScreen(alwaysShow = false) {
  if (!pipWin) return;
  try {
    const T = window.__TAURI__;
    const mons = await T.window.availableMonitors();
    const [pos, size] = await Promise.all([pipWin.outerPosition(), pipWin.outerSize()]);
    let onScreen = false;
    let a = null;
    for (const m of mons) {
      const mp = m.workArea ? m.workArea.position : m.position;
      const ms = m.workArea ? m.workArea.size : m.size;
      if (pos.x + size.width > mp.x && pos.x < mp.x + ms.width &&
          pos.y + size.height > mp.y && pos.y < mp.y + ms.height) { onScreen = true; break; }
      if (!a) a = { position: mp, size: ms };
    }
    if (!onScreen && a) {
      await pipWin.setPosition(new T.window.PhysicalPosition(
        Math.round(a.position.x + (a.size.width - size.width) / 2),
        Math.round(a.position.y + (a.size.height - size.height) / 2)));
    }
    await pipWin.show();
  } catch (e) {
    try { await pipWin.show(); } catch (e2) {} // 校验失败也必须显示出来
  }
}
async function ensurePopDoc() {
  if (popDocWin) return popDocWin;
  const WW = tauriWebviewWindow();
  if (!WW) return null;
  const T = window.__TAURI__;
  /* 复用已存在的承载窗：承载窗只被隐藏、从不销毁，旧浮窗关闭后再开新浮窗时，
     label 仍被旧窗占用——重新 new 会失败，且旧窗不会再发 lp-pop-ready。
     注意复用也要把下面的事件监听注册全（lp-pop-size 等在本上下文里还没有），
     否则量完高度没人定位/显示，浮窗依旧出不来 */
  let win = null;
  try { win = await WW.getByLabel('lyric-pop'); } catch (e) {}
  if (win) {
    popDocWin = win;
    popDocReady = true; // 旧窗 mount 时就发过 ready，直接按就绪处理
  } else {
    popDocWin = new WW('lyric-pop', {
      url: 'knitting-chart.html?popdoc=1',
      title: '织法教程',
      width: 660, height: 320,
      decorations: false, transparent: true, alwaysOnTop: true,
      skipTaskbar: true, shadow: false, resizable: false, focus: false, visible: false,
    });
    popDocWin.once('tauri://error', () => { popDocWin = null; popDocReady = false; });
    popDocWin.once('tauri://destroyed', () => { popDocWin = null; popDocReady = false; });
  }
  await T.event.listen('lp-pop-ready', () => {
    popDocReady = true;
    if (pendingPop) { const p = pendingPop; pendingPop = null; T.event.emit('lp-pop-data', p); }
  });
  await T.event.listen('lp-pop-size', e => { placeTauriPop(e.payload.h); });
  /* 承载窗的鼠标进出：移入 = 取消主浮窗的隐藏倒计时（用户在看图），
     移出到桌面 = 通知主浮窗收起（回调由 LyricPip 注册） */
  await T.event.listen('lp-pop-hover', () => { popHoverCb && popHoverCb(); });
  await T.event.listen('lp-pop-leave', () => { popLeaveCb && popLeaveCb(); });
  return popDocWin;
}
async function placeTauriPop(cardH) {
  if (!popAnchor || !popDocWin) return;
  if (!cardH) cardH = 260; // 内容量高失败时的保底高度，宁可多不可无
  const T = window.__TAURI__;
  const cur = T.window.getCurrentWindow();
  const pos = await cur.outerPosition();   // 物理像素
  const sf = await cur.scaleFactor();
  const x = Math.round(pos.x + (popAnchor.x - POP_PAD) * sf);
  const cardTop = popAnchor.above ? popAnchor.y0 - cardH : popAnchor.y0;
  const y = Math.round(pos.y + (cardTop - POP_PAD) * sf);
  const w = Math.round((popAnchor.W + POP_PAD * 2) * sf);
  const h = Math.round((cardH + POP_PAD * 2) * sf);
  /* PopDoc 会回报两次高度（图加载完 + 500ms 补量），placeTauriPop 因此被调多次。
     对已显示的窗口重复 show()/alwaysOnTop 摘除恢复会肉眼可见地闪 ——
     位置尺寸都没变就整段跳过；z 序校正只在「隐藏 → 显示」的那一次做 */
  const wasVisible = await popDocWin.isVisible();
  if (wasVisible) {
    const [cp, cs] = await Promise.all([popDocWin.outerPosition(), popDocWin.outerSize()]);
    if (cp.x === x && cp.y === y && cs.width === w && cs.height === h) return;
  }
  await popDocWin.setPosition(new T.window.PhysicalPosition(x, y));
  await popDocWin.setSize(new T.window.PhysicalSize(w, h));
  await popDocWin.show();
  if (!wasVisible) {
    /* 保证教程窗压在歌词浮窗之上（两者都 alwaysOnTop，相对层级会被焦点变化打乱） */
    await popDocWin.setAlwaysOnTop(false);
    await popDocWin.setAlwaysOnTop(true);
  }
}
export async function showTauriPop(payload, anchor) {
  popAnchor = anchor;
  const win = await ensurePopDoc();
  if (!win) return;
  const T = window.__TAURI__;
  if (popDocReady) await T.event.emit('lp-pop-data', payload);
  else pendingPop = payload; // 承载窗首次还在加载，就绪后由 lp-pop-ready 补发
}
export async function hideTauriPop() {
  popAnchor = null;
  if (popDocWin) await popDocWin.hide();
}
/* 主浮窗注册的两个回调：hover=用户移入了承载窗（取消隐藏倒计时）；leave=已离开 */
let popHoverCb = null, popLeaveCb = null;
export function onPopHover(cb) { popHoverCb = cb; }
export function onPopLeave(cb) { popLeaveCb = cb; }
