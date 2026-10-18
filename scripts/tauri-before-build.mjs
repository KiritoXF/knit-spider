// tauri beforeBuildCommand：仅当前端源码比 dist 新时才重新 vite build，
// 只改 Rust 代码时直接复用现有 dist，省掉 ~12s。
import { statSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const distFile = path.join(root, "dist", "knitting-chart.html");
// generate-symbols 的数据源（在本项目之外，也要参与新鲜度判断）
const symbolSrcDir = "D:/patterns/knitting_symbols-0.7.2/JIS";

import { readdirSync } from "node:fs";
function newest(dir, best = 0) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git", "src-tauri", ".baseline-tmp"].includes(name.name)) continue;
    const p = path.join(dir, name.name);
    if (name.isDirectory()) best = newest(p, best);
    else best = Math.max(best, statSync(p).mtimeMs);
  }
  return best;
}

let newestSrc = newest(root);
if (existsSync(symbolSrcDir)) newestSrc = Math.max(newestSrc, newest(symbolSrcDir));

if (existsSync(distFile) && statSync(distFile).mtimeMs >= newestSrc) {
  console.log("[before-build] dist 已是最新，跳过 vite build");
} else {
  execSync("npm run build", { stdio: "inherit" });
}
