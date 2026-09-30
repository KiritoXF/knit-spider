/* 织法教程图配置：符号 id → public/tutorials/ 下的文件名。
   图片是外置文件（public/ 原样拷贝进 dist），线上 Pages 与本地 dist 均按相对路径引用，
   vite base './' 保证 /knit-spider/ 子路径部署不 404。
   加教程图两步：图片放进 public/tutorials/，下面加一行 id→文件名。
   用户也可在本机上传自定义教程图（tutorialStore.js，IndexedDB），上传的优先显示。
   文字解分组的 sid 已统一为「实际织法符号 id」（反面行经 textChart.js 的 WS_SYM 映射，
   背景针正面=purl/反面=knit），所以这里只按 sid 直查，不做名称兜底。 */
import { tutorialObjectUrl } from './tutorialStore.js';

const TUTORIALS = {
  // 暂无内置教程图。需要时加一行：符号 id → public/tutorials/ 下的文件名
};

const BASE = (import.meta.env && import.meta.env.BASE_URL) || './';

/* 取图优先级：用户上传（IndexedDB 教程库，本机 objectURL）→ 内置静态文件；
   都没有返回 null（悬停无感） */
export function tutorialUrlForSid(sid) {
  if (!sid) return null;
  const up = tutorialObjectUrl(sid);
  if (up) return up;
  const f = TUTORIALS[sid];
  return f ? BASE + 'tutorials/' + f : null;
}

/* 文字解分组 {sid, name} → 教程图 URL；sid 即实际织法符号 id，未配置返回 null */
export function tutorialUrlForGroup(g) {
  return g ? tutorialUrlForSid(g.sid) : null;
}
