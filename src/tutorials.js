/* 织法教程图配置：符号 id → public/tutorials/ 下的文件名。
   图片是外置文件（public/ 原样拷贝进 dist），线上 Pages 与本地 dist 均按相对路径引用，
   vite base './' 保证 /knit-spider/ 子路径部署不 404。
   加教程图两步：图片放进 public/tutorials/，下面加一行 id→文件名。
   用户也可在本机上传自定义教程图（tutorialStore.js，IndexedDB），上传的优先显示。 */
import { tutorialObjectUrl } from './tutorialStore.js';

const TUTORIALS = {
  // 暂无内置教程图。需要时加一行：符号 id → public/tutorials/ 下的文件名
};

/* 文字解里无符号 id 的名称 → 符号 id（背景针等按织法物理动作映射）。
   分组自带 sid 时优先用 sid，查不到再按名称兜底。 */
const NAME_TUT = {
  下针: 'knit',
  上针: 'purl',
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

/* 文字解分组 {sid, name} → 教程图 URL；未配置返回 null（悬停无感） */
export function tutorialUrlForGroup(g) {
  if (!g) return null;
  return tutorialUrlForSid(g.sid) || tutorialUrlForSid(NAME_TUT[g.name]);
}
