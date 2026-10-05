/* 桌面端自动更新（Tauri updater 插件）：主窗口启动 ~15s 后检查 GitHub Releases，
   有新版就弹应用内确认框，确认后应用内下载安装（passive 模式）并重启。
   网页端 / 浮窗 / 承载窗不执行；updater 全局 API 缺失或网络失败一律静默跳过。 */
import { appConfirm, toast } from './ui.js';
import { openExternal } from './util.js';

const CHECK_DELAY = 15000;   // 启动后延迟检查，避免抢启动带宽
const RELEASES_URL = 'https://github.com/KiritoXF/knit-spider/releases/latest';

export function initUpdater() {
  const T = typeof window !== 'undefined' ? window.__TAURI__ : null;
  if (!T || !T.updater || !T.updater.check) return; // 仅桌面端主窗口
  setTimeout(() => {
    checkOnce(T).catch(() => {});
  }, CHECK_DELAY);
}

async function checkOnce(T) {
  const update = await T.updater.check();
  if (!update) return;
  const v = update.version || '新版本';
  const ok = await appConfirm({
    title: `发现新版本 v${v}`,
    message: '是否下载并安装更新？安装完成后应用会自动重启，正在编辑的内容已自动保存。',
    okText: '下载并更新',
  });
  if (!ok) {
    // 不想现在更新：引导去 Releases 页手动下载
    openExternal(RELEASES_URL);
    return;
  }
  try {
    toast('正在下载更新…', 'info');
    await update.downloadAndInstall();
    toast('更新完成，即将重启…', 'ok');
    setTimeout(() => {
      try { T.process.relaunch(); } catch (e) { location.reload(); }
    }, 800);
  } catch (e) {
    toast('更新下载失败，可到发布页手动下载', 'warn');
    openExternal(RELEASES_URL);
  }
}
