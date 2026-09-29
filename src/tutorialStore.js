/* 用户上传的织法教程图库（IndexedDB 本机存储；zip 作品包导入时也写回这里）。
   - 记录 {sid, name, blob}：sid=符号 id（或背景针织法 id 如 knit/purl），name=原始文件名
   - 启动时 initTutorials() 全量载入内存：urlMap 供 popover 同步取图（objectURL），
     metaMap 携带 blob 供 zip 打包（tutorialU8Entries 对未就绪的 u8 兜底异步读取）
   - IndexedDB 不可用（如无痕模式限制）时降级为纯内存，刷新即失 */
const DB_NAME = 'knitChartTutor';
const STORE = 'tutor';

let dbPromise = null;
const urlMap = new Map();   // sid → objectURL（<img> 显示用）
const metaMap = new Map();  // sid → {name, blob, u8|null, type}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => {
      if (!rq.result.objectStoreNames.contains(STORE)) {
        rq.result.createObjectStore(STORE, { keyPath: 'sid' });
      }
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => { dbPromise = null; reject(rq.error || new Error('IndexedDB 打开失败')); };
  });
  return dbPromise;
}

function reqDone(rq) {
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
  return blob.arrayBuffer().then(buf => { m.u8 = new Uint8Array(buf); }, () => {});
}

/* 启动时调用：库里全部记录载入内存。失败静默，不阻塞应用 */
export async function initTutorials() {
  try {
    const db = await openDb();
    const all = await reqDone(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
    for (const r of all) {
      if (r && typeof r.sid === 'string' && r.sid && r.blob instanceof Blob) {
        adoptRecord(r.sid, r.name || r.sid, r.blob);
      }
    }
  } catch (e) { /* IndexedDB 不可用时教程图静默缺席 */ }
}

export function tutorialObjectUrl(sid) { return (sid && urlMap.get(sid)) || null; }
export function listTutorials() {
  return [...urlMap.keys()].map(sid => ({
    sid, name: (metaMap.get(sid) || {}).name || sid, url: urlMap.get(sid),
  }));
}

/* 上传/覆盖一条教程图；持久层失败抛错（内存已生效），由调用方提示 */
export async function putTutorial(sid, blob, name) {
  sid = String(sid || '').trim();
  if (!sid || !(blob instanceof Blob)) throw new Error('无效的教程图');
  await adoptRecord(sid, name || sid, blob);
  const db = await openDb();
  await reqDone(db.transaction(STORE, 'readwrite').objectStore(STORE)
    .put({ sid, name: name || sid, blob }));
}

export async function deleteTutorial(sid) {
  const old = urlMap.get(sid);
  if (old) URL.revokeObjectURL(old);
  urlMap.delete(sid); metaMap.delete(sid);
  try {
    const db = await openDb();
    await reqDone(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(sid));
  } catch (e) { /* 内存已删即可，持久层失败下次启动最多复活旧图 */ }
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

/* zip 导入用：批量写回教程库（单条失败跳过），返回成功条数 */
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
