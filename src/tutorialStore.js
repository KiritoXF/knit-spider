/* 用户上传的织法教程库（IndexedDB 本机存储；zip 作品包导入时也写回这里）。
   - 记录 {sid, name, blob, text}：sid=符号 id（或背景针织法 id 如 knit/purl），
     name=原始文件名，blob=图片（可 null，纯文字记录），text=可选文字说明
   - 启动时 initTutorials() 全量载入内存：urlMap 供 popover 同步取图（objectURL），
     metaMap 携带 blob 供 zip 打包（tutorialU8Entries 对未就绪的 u8 兜底异步读取），
     textMap 携带文字说明（tutorialTextEntries 供 zip 打包）
   - IndexedDB 不可用（如无痕模式限制）时降级为纯内存，刷新即失 */
const DB_NAME = 'knitChartTutor';
const STORE = 'tutor';

import { reactive } from 'vue';

let dbPromise = null;
const urlMap = new Map();   // sid → objectURL（<img> 显示用）
const metaMap = new Map();  // sid → {name, blob, u8|null, type}
const textMap = new Map();  // sid → 文字说明
/* 教程库版本号：内存 Map 是非响应式的，IDB 异步载入/增删完成后 bump 一下，
   让依赖教程数据的 computed（文字解弹窗 / 歌词浮窗的 view）重新求值。
   没有它，浮窗 mount 时 IDB 尚未载入完，教程数据永久停留在「未配置」状态 */
export const tutRev = reactive({ n: 0 });
function bumpTutRev() { tutRev.n++; }

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, 2);
    rq.onupgradeneeded = () => {
      // 升级只补建缺失的 store，绝不动既有数据
      if (!rq.result.objectStoreNames.contains(STORE)) {
        rq.result.createObjectStore(STORE, { keyPath: 'sid' });
      }
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => { dbPromise = null; reject(rq.error || new Error('IndexedDB 打开失败')); };
  });
  return dbPromise;
}

export function reqDone(rq) {
  return new Promise((resolve, reject) => {
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}

/* 一条记录进内存：换新 objectURL（旧的回收），u8 延迟读出（zip 打包用） */
function adoptRecord(sid, name, blob) {
  const old = urlMap.get(sid);
  if (old) URL.revokeObjectURL(old);
  urlMap.set(sid, URL.createObjectURL(blob));
  const m = metaMap.get(sid) || {};
  m.name = name; m.blob = blob; m.u8 = null;
  m.type = blob.type || 'image/png';
  metaMap.set(sid, m);
  bumpTutRev();
  return blob.arrayBuffer().then(buf => { m.u8 = new Uint8Array(buf); }, () => {});
}

/* 一条文字进内存：空白串视为无文字 */
function adoptText(sid, text) {
  const v = (text == null) ? '' : String(text);
  if (v.trim()) textMap.set(sid, v);
  else textMap.delete(sid);
  bumpTutRev();
}

/* 启动时调用：库里全部记录载入内存。失败静默，不阻塞应用 */
export async function initTutorials() {
  try {
    const db = await openDb();
    const all = await reqDone(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
    for (const r of all) {
      if (!r || typeof r.sid !== 'string' || !r.sid) continue;
      if (r.blob instanceof Blob) adoptRecord(r.sid, r.name || r.sid, r.blob);
      adoptText(r.sid, r.text);
    }
  } catch (e) { /* IndexedDB 不可用时教程静默缺席 */ }
}

export function tutorialObjectUrl(sid) { return (sid && urlMap.get(sid)) || null; }
export function tutorialText(sid) { return (sid && textMap.get(sid)) || null; }
export function listTutorials() {
  const sids = [...new Set([...urlMap.keys(), ...textMap.keys()])];
  return sids.map(sid => ({
    sid,
    name: (metaMap.get(sid) || {}).name || sid,
    url: urlMap.get(sid) || null,
    text: textMap.get(sid) || null,
  }));
}

/* 上传/覆盖一条教程图（保留已有文字）；持久层失败抛错（内存已生效），由调用方提示 */
export async function putTutorial(sid, blob, name) {
  sid = String(sid || '').trim();
  if (!sid || !(blob instanceof Blob)) throw new Error('无效的教程图');
  await adoptRecord(sid, name || sid, blob);
  const db = await openDb();
  await reqDone(db.transaction(STORE, 'readwrite').objectStore(STORE)
    .put({ sid, name: name || sid, blob, text: textMap.get(sid) || null }));
}

/* 保存/清除一条文字说明（保留已有图片）：text 为空白串即清除。
   该符号可能没有图片（纯文字记录，blob 存 null）；无字无图时顺带删掉残留的空记录 */
export async function putTutorialText(sid, text) {
  sid = String(sid || '').trim();
  if (!sid) throw new Error('无效的符号 id');
  const v = (text == null) ? '' : String(text).slice(0, 2000);
  adoptText(sid, v);
  const db = await openDb();
  const st = db.transaction(STORE, 'readwrite').objectStore(STORE);
  const m = metaMap.get(sid) || {};
  if (!textMap.has(sid) && !(m.blob instanceof Blob)) { await reqDone(st.delete(sid)); return; }
  await reqDone(st.put({
    sid, name: m.name || sid,
    blob: m.blob instanceof Blob ? m.blob : null,
    text: textMap.get(sid) || null,
  }));
}

/* 只删我的图片（保留文字说明）；若两者皆无则整条删除 */
export async function deleteTutorial(sid) {
  const old = urlMap.get(sid);
  if (old) URL.revokeObjectURL(old);
  urlMap.delete(sid); metaMap.delete(sid);
  try {
    const db = await openDb();
    const st = db.transaction(STORE, 'readwrite').objectStore(STORE);
    if (textMap.has(sid)) await reqDone(st.put({ sid, name: sid, blob: null, text: textMap.get(sid) }));
    else await reqDone(st.delete(sid));
  } catch (e) { /* 内存已删即可，持久层失败下次启动最多复活旧图 */ }
}

/* 只删文字说明（保留图片）；若两者皆无则整条删除 */
export async function deleteTutorialText(sid) {
  sid = String(sid || '').trim();
  if (!sid) return;
  textMap.delete(sid);
  try {
    const db = await openDb();
    const st = db.transaction(STORE, 'readwrite').objectStore(STORE);
    if (metaMap.has(sid)) {
      const m = metaMap.get(sid);
      await reqDone(st.put({ sid, name: m.name || sid, blob: m.blob, text: null }));
    } else await reqDone(st.delete(sid));
  } catch (e) { /* 同上 */ }
}

/* zip 打包用：[{sid, name, u8, type}]；u8 未就绪时兜底异步读 blob */
export async function tutorialU8Entries() {
  const out = [];
  for (const [sid, m] of metaMap) {
    if (!m || !(m.blob instanceof Blob)) continue;
    let u8 = m.u8;
    if (!u8) {
      try { u8 = new Uint8Array(await m.blob.arrayBuffer()); } catch (e) { continue; }
    }
    out.push({ sid, name: m.name || sid, u8, type: m.type || m.blob.type || 'image/png' });
  }
  return out;
}

/* zip 打包用：[{sid, text}]（文字说明，与图片条目分开打包成 .txt） */
export function tutorialTextEntries() {
  return [...textMap].map(([sid, text]) => ({ sid, text }));
}

/* zip 导入用：批量写回教程图（单条失败跳过），返回成功条数 */
export async function importTutorials(entries) {
  let n = 0;
  for (const it of entries || []) {
    if (!it || typeof it.sid !== 'string' || !it.sid || !(it.u8 instanceof Uint8Array)) continue;
    try {
      await putTutorial(it.sid, new Blob([it.u8], { type: it.type || 'image/png' }), it.name || it.sid);
      n++;
    } catch (e) { /* 单条失败继续 */ }
  }
  return n;
}

/* zip 导入用：批量写回文字说明，返回成功条数 */
export async function importTutorialTexts(entries) {
  let n = 0;
  for (const it of entries || []) {
    if (!it || typeof it.sid !== 'string' || !it.sid || typeof it.text !== 'string') continue;
    try {
      await putTutorialText(it.sid, it.text);
      n++;
    } catch (e) { /* 单条失败继续 */ }
  }
  return n;
}
