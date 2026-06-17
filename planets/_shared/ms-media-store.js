/**
 * Memory Sparks · 媒体存储胶水（ms-media-store）
 *
 * 用途：
 *   把「治愈星」跑通并真机验证过的那套「读取水合 / 防数据丢失 / 删除联动」逻辑
 *   抽成一个公共零件，让其他媒体星（繁星 / 云 / 海 …）共用，
 *   避免每颗星各抄一遍、各踩一遍坑（尤其是 saveRecords 抹空 fsa 引用导致重启白屏丢数据）。
 *
 * 依赖：必须先加载 ms-media-vault.js（本模块通过 MS.mediaVault 读写真文件）。
 *
 * 设计要点（与治愈星行为对齐）：
 *   - 记录里媒体字段永远只存「引用字符串」：'fsa:相对路径' | 'data:...base64' | ''。
 *   - 读取水合：把 'fsa:' 引用就地换成可显示的 blob: URL，
 *     并在 record._fsaRefs 里逐字段留底原始引用（哪些字段原来是 fsa）。
 *   - 写回 localStorage 前：用 serializeForStorage 把内存里的 blob: URL
 *     按 _fsaRefs 还原成持久的 'fsa:' 引用，否则刷新即丢。
 *   - 删除：trashRecordMedia 把记录涉及的 fsa 引用搬进回收站 + 释放 blob URL 缓存。
 *   - 无盘（hasBackend()=false）：以上全部短路，记录原样进出，行为和改造前完全一致。
 *
 * 与治愈星的差异：
 *   治愈星用单字段 _fsaSrc + 按 type 分发；本公共件用 _fsaRefs 逐字段映射，
 *   与字段名/type 体系解耦，因此能直接服务 type 体系不同的繁星 / 云。
 *   治愈星暂不切换（已验证，保持现状），新星统一用本公共件。
 */

(function () {
  if (window.MS && window.MS.mediaStore) return; // 已加载
  window.MS = window.MS || {};

  const LOG = '[ms-media-store]';
  const vault = () => window.MS && window.MS.mediaVault;

  // 默认参与水合/还原的媒体字段名。星球可通过 opts.mediaFields 覆盖。
  // 'images'（数组）始终单独处理，不必列在这里。
  const DEFAULT_FIELDS = ['src', 'image', 'video', 'audio'];

  // fsa: 引用 → blob: URL 的会话级缓存，避免重复 resolve 同一文件。
  const urlCache = new Map();

  /* ── 工具 ─────────────────────────────────────────── */

  function isFsa(v) { return typeof v === 'string' && v.startsWith('fsa:'); }
  function isBlob(v) { return typeof v === 'string' && v.startsWith('blob:'); }

  function hasBackend() {
    const v = vault();
    return !!(v && v.hasFileBackend && v.hasFileBackend());
  }

  // 按引用取回可显示 URL（带缓存）。'data:'/'' 原样返回；'fsa:' 返回 blob: URL。
  async function resolveRef(ref) {
    if (!ref || ref.startsWith('data:')) return ref || '';
    if (!isFsa(ref)) return ref; // 未知前缀，防御性原样返回
    if (urlCache.has(ref)) return urlCache.get(ref);
    const v = vault();
    if (!v) { console.warn(`${LOG} resolveRef 无 vault：`, ref); return ''; }
    try {
      const url = await v.resolve(ref);
      if (url) urlCache.set(ref, url);
      return url || '';
    } catch (err) {
      console.warn(`${LOG} resolveRef 失败：`, ref, err);
      return '';
    }
  }

  /* ── 读取水合 ─────────────────────────────────────── */

  /**
   * 就地水合单条记录：把 fsa: 媒体字段换成 blob: URL，
   * 并在 record._fsaRefs 逐字段留底原始 fsa 引用（供 serializeForStorage 还原）。
   * @param {Object} rec
   * @param {Object} [opts] { mediaFields?: string[] }
   * @returns {Promise<Object>} 同一个 rec（就地修改，与治愈星一致）
   */
  async function hydrateRecord(rec, opts = {}) {
    if (!rec) return rec;
    const fields = opts.mediaFields || DEFAULT_FIELDS;
    const backup = {};

    for (const f of fields) {
      if (isFsa(rec[f])) {
        backup[f] = rec[f];
        rec[f] = await resolveRef(rec[f]);
      }
    }

    if (Array.isArray(rec.images) && rec.images.some(isFsa)) {
      backup.images = rec.images.slice(); // 留底原始数组（含 fsa 引用）
      rec.images = await Promise.all(
        rec.images.map(x => (isFsa(x) ? resolveRef(x) : x))
      );
    }

    if (Object.keys(backup).length) rec._fsaRefs = backup;
    return rec;
  }

  /**
   * 就地水合整个记录数组。
   * @param {Array} records
   * @param {Object} [opts] { mediaFields?: string[] }
   * @returns {Promise<Array>} 同一个数组
   */
  async function hydrateRecords(records, opts = {}) {
    const list = Array.isArray(records) ? records : [];
    for (const r of list) await hydrateRecord(r, opts);
    return list;
  }

  /* ── 写回前序列化（防数据丢失，治愈星踩过的坑封装于此）─── */

  /**
   * 把一条记录转成「可安全写进 localStorage 的版本」：
   *   - 若水合时留过底（_fsaRefs）：把对应字段还原成持久 'fsa:' 引用；
   *   - 否则（无盘 / 老数据 / 新写入的 fsa 引用）：只清掉会话级 blob: URL，
   *     fsa:/data:/'' 一律原样保留。
   * 注意：返回新对象（不可变），且剥掉 _fsaRefs 内部字段。
   * @param {Object} rec
   * @param {Object} [opts] { mediaFields?: string[] }
   */
  function serializeRecord(rec, opts = {}) {
    if (!rec) return rec;
    const fields = opts.mediaFields || DEFAULT_FIELDS;
    const { _fsaRefs, ...out } = rec;

    if (_fsaRefs) {
      // 有留底：逐字段还原成 fsa: 引用（覆盖内存里的 blob: URL）
      for (const f of Object.keys(_fsaRefs)) out[f] = _fsaRefs[f];
      return out;
    }

    // 无留底：清会话级 blob:（刷新即失，不该进 storage），其余原样
    for (const f of fields) {
      if (isBlob(out[f])) out[f] = '';
    }
    if (Array.isArray(out.images)) {
      out.images = out.images.map(x => (isBlob(x) ? '' : x));
    }
    return out;
  }

  /**
   * 序列化整个记录数组（写 localStorage 前调用）。
   * @param {Array} records
   * @param {Object} [opts] { mediaFields?: string[] }
   * @returns {Array} 新数组
   */
  function serializeForStorage(records, opts = {}) {
    return (Array.isArray(records) ? records : []).map(r => serializeRecord(r, opts));
  }

  /* ── 写入媒体（beforeSave 用）─────────────────────── */

  /**
   * 把一份媒体源写成真文件，返回引用结果。无盘 / 失败时回退原 source。
   * @param {Object} p { planetKey, id, kind, dateStr, source }
   *        source 可为 Blob/File（原图，落盘不压缩）或 dataUrl 字符串
   * @returns {Promise<{ref:string, wroteFile:boolean}>}
   */
  async function putMedia({ planetKey, id, kind, dateStr, source, group }) {
    const v = vault();
    if (!source || !v || !v.hasFileBackend()) {
      return { ref: typeof source === 'string' ? source : '', wroteFile: false };
    }
    try {
      const ref = await v.put({ planetKey, id, kind, dateStr, source, group });
      if (isFsa(ref)) {
        // STORE-008：同一引用被重新写入（如行星二次编辑滤镜，覆盖同一路径）→ 失效旧 blob 缓存，
        // 否则 resolveRef 命中旧缓存，界面仍显示旧图（要退出重进才刷新）。
        if (urlCache.has(ref)) {
          try { URL.revokeObjectURL(urlCache.get(ref)); } catch (_) {}
          urlCache.delete(ref);
        }
        return { ref, wroteFile: true };
      }
      return { ref: ref || (typeof source === 'string' ? source : ''), wroteFile: false };
    } catch (err) {
      console.warn(`${LOG} putMedia 失败：`, err);
      return { ref: typeof source === 'string' ? source : '', wroteFile: false };
    }
  }

  /* ── 删除联动（beforeDelete 用）───────────────────── */

  /**
   * 把一条被删记录涉及的所有 fsa 真文件搬进回收站，并释放其 blob URL 缓存。
   * 会同时扫描记录当前字段、_fsaRefs 留底、images 数组。
   * @param {Object} rec
   * @param {Object} [opts] { mediaFields?: string[], planetKey?: string }
   */
  async function trashRecordMedia(rec, opts = {}) {
    const v = vault();
    if (!rec || !v) return;
    const refs = new Set();
    const collect = (val) => { if (isFsa(val)) refs.add(val); };

    // 扫描整条记录的所有字段（不限 mediaFields）：任何指向 U盘真文件的 fsa: 引用都搬进回收站，
    // 避免像行星 source 这种非标准字段名被漏删。opts.mediaFields 仅作签名兼容保留，不再依赖。
    for (const k of Object.keys(rec)) {
      if (k === '_fsaRefs') continue;
      const val = rec[k];
      if (Array.isArray(val)) val.forEach(collect);
      else collect(val);
    }
    if (rec._fsaRefs) {
      Object.values(rec._fsaRefs).forEach(val => {
        if (Array.isArray(val)) val.forEach(collect);
        else collect(val);
      });
    }

    for (const ref of refs) {
      try {
        // 约定：落在 <planetKey>/filtered/ 下的是「可从原件再生的衍生品」（如行星滤镜成品），
        // 删除时直接清除、不占回收站；其它（原件，如原图）进回收站可恢复。
        if (typeof ref === 'string' && ref.includes('/filtered/') && v.remove) {
          await v.remove(ref);
        } else {
          await v.trash(ref, { planetKey: opts.planetKey });
        }
      } catch (err) { console.warn(`${LOG} trashRecordMedia 失败：`, ref, err); }
      const blob = urlCache.get(ref);
      if (blob) {
        try { URL.revokeObjectURL(blob); } catch {}
        urlCache.delete(ref);
      }
    }
  }

  /* ── 句柄监听（可选 helper）────────────────────────── */

  /**
   * 安装 'memory-sparks:fsa-handle' 监听：父级传来目录句柄时
   * setDirHandle，并回调让星球重新水合 + 重建。
   * 星球若已有自己的 message handler，也可不用本 helper，
   * 直接在已有 handler 里加同样的分支。
   * @param {Function} onHandleChange 句柄变化后的回调（通常重新水合+重建卡片）
   */
  function installHandleListener(onHandleChange) {
    window.addEventListener('message', (e) => {
      if (e && e.data && e.data.type === 'memory-sparks:fsa-handle') {
        const v = vault();
        if (v) v.setDirHandle(e.data.dirHandle || null);
        try { if (onHandleChange) onHandleChange(); }
        catch (err) { console.warn(`${LOG} onHandleChange 出错：`, err); }
      }
    });
  }

  /* ── 文字记录建库 + 总索引（STORE-006）──────────────────
   * 目标：文字记录也写成 U盘真文件（<planetKey>/records.json），
   * 加根级总索引 index.json（未来本地 RAG 检索入口）。
   * U盘为底、浏览器为缓存；换电脑插盘即恢复。无盘时全部 no-op。
   */

  function nowIso() {
    try { return new Date().toISOString(); } catch (_) { return ''; }
  }

  // 通用摘要：从一条记录抽出 RAG 检索需要的轻量信息。
  // 字段名各星不同，扫一组常见候选；媒体路径从 fsa: 引用还原成相对路径。
  // 入参 rec 是「序列化后的持久形式」（媒体字段是 fsa:/data:/''，已剥 blob/_fsaRefs）。
  function summarizeRecord(rec, fields) {
    // 去重：有的星历史兼容字段会把同一句存进多个字段（如花星把 text 抄进 content），
    // 摘要里同一句只留一遍，避免未来 RAG 检索时同句重复。
    const parts = [];
    const seen = new Set();
    for (const k of ['title', 'text', 'body', 'caption', 'content', 'word', 'note', 'desc']) {
      const v = rec[k];
      if (v && typeof v === 'string' && !seen.has(v)) { seen.add(v); parts.push(v); }
    }
    let text = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (text.length > 140) text = text.slice(0, 140) + '…';

    const media = [];
    const seenMedia = new Set(); // 同一文件可能挂在多个字段(src/image/images)，索引里只留一份（盘点 M1）
    const collect = (val) => {
      if (!isFsa(val)) return;
      const p = val.slice('fsa:'.length);
      if (!seenMedia.has(p)) { seenMedia.add(p); media.push(p); }
    };
    for (const f of fields) collect(rec[f]);
    if (Array.isArray(rec.images)) rec.images.forEach(collect);

    // !! 收口成纯布尔，避免 rec.video==='' 时短路出空串（盘点 M2）
    const filled = (v) => !!(typeof v === 'string' && v && (isFsa(v) || v.startsWith('data:')));
    const hasImage = filled(rec.image) || (Array.isArray(rec.images) && rec.images.some(filled));
    const hasVideo = filled(rec.video);
    const hasAudio = filled(rec.audio);

    return { id: rec.id, date: rec.date || '', text, media, hasImage, hasVideo, hasAudio };
  }

  // 读现有 index.json；无 / 解析失败返回空骨架。
  async function readIndex() {
    const v = vault();
    if (!v || !v.readText) return { version: 1, updatedAt: '', planets: {} };
    const raw = await v.readText('index.json');
    if (!raw) return { version: 1, updatedAt: '', planets: {} };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('index 非对象');
      if (!parsed.planets) parsed.planets = {};
      return parsed;
    } catch (err) {
      console.warn(`${LOG} index.json 解析失败，重建：`, err);
      return { version: 1, updatedAt: '', planets: {} };
    }
  }

  /**
   * 读某颗星的 records.json（U盘建库的权威源）。
   * 无盘 / 文件不存在 / 解析失败返回 null（调用方据此判断「U盘还没有库」）。
   * @param {string} planetKey
   * @returns {Promise<Array|null>}
   */
  async function loadRecordsFile(planetKey) {
    const v = vault();
    if (!v || !v.readText) return null;
    const raw = await v.readText(`${planetKey}/records.json`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (err) {
      console.warn(`${LOG} ${planetKey}/records.json 解析失败：`, err);
      return null;
    }
  }

  /**
   * 写某颗星的 records.json + 刷新根 index.json（只替换该星段，其余星不动）。
   * records 必须是「序列化后的持久形式」（先过 serializeForStorage）。
   * 无盘为 no-op。建议 fire-and-forget 调用，失败只 warn 不抛。
   * @param {string} planetKey
   * @param {Array} records
   * @param {Object} [opts] { meta?: {name,keyword}, mediaFields?: string[] }
   * @returns {Promise<boolean>}
   */
  async function saveRecordsFile(planetKey, records, opts = {}) {
    const v = vault();
    if (!v || !v.putText || !hasBackend()) return false;
    const list = Array.isArray(records) ? records : [];
    const fields = opts.mediaFields || DEFAULT_FIELDS;
    try {
      const okRecords = await v.putText(
        `${planetKey}/records.json`,
        JSON.stringify(list, null, 2),
      );
      const index = await readIndex();
      index.version = index.version || 1;
      index.updatedAt = nowIso();
      index.planets[planetKey] = {
        name: (opts.meta && opts.meta.name) || planetKey,
        keyword: (opts.meta && opts.meta.keyword) || '',
        count: list.length,
        recordsFile: `${planetKey}/records.json`,
        entries: list.map(r => summarizeRecord(r, fields)),
      };
      await v.putText('index.json', JSON.stringify(index, null, 2));
      return okRecords;
    } catch (err) {
      console.warn(`${LOG} saveRecordsFile 失败：`, planetKey, err);
      return false;
    }
  }

  /**
   * 合并本地记录与 U盘记录（恢复 / 对账用）。
   * 策略（用户拍板「U盘为底」）：按 id 并集，同 id 以 U盘(disk) 为准；
   * 本地独有的新 id 一律保留（绝不丢新录入），追加在 disk 之后。
   * disk 为空时原样返回 local（首次建库前不动本地）。
   * @param {Array} localList
   * @param {Array} diskList
   * @returns {Array}
   */
  function mergeRecords(localList, diskList) {
    const local = Array.isArray(localList) ? localList : [];
    const disk = Array.isArray(diskList) ? diskList : [];
    if (!disk.length) return local;
    const diskIds = new Set(disk.map(r => r && r.id).filter(Boolean));
    const localOnly = local.filter(r => r && r.id && !diskIds.has(r.id));
    return [...disk, ...localOnly];
  }

  /**
   * 通用「同步到 U盘」：读 localStorage[storageKey] 里已写好的记录 → saveRecordsFile。
   * 给各星统一挂在「记录已落 localStorage」的节点（onSaved / __msReloadAll / 自己的 save）调用，
   * 一行搞定建库，不必每颗星各抄一遍。无盘为 no-op。
   * @param {string} planetKey
   * @param {string} storageKey  该星 localStorage 的键
   * @param {Object} [opts] { meta?:{name,keyword}, mediaFields?:string[] }
   * @returns {Promise<boolean>}
   */
  async function syncRecordsFromStorage(planetKey, storageKey, opts = {}) {
    if (!hasBackend()) return false;
    let list = [];
    try { list = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch (_) {}
    return saveRecordsFile(planetKey, Array.isArray(list) ? list : [], opts);
  }

  /**
   * 通用「插盘恢复」：读 U盘 records.json → 与 localStorage 按 id 合并（U盘为准）→ 写回 localStorage。
   * 返回是否真的恢复了（U盘有库才 true）。通知父级 + 重渲由各星在 true 后自行处理。
   * 无盘 / U盘还没库 时返回 false。
   * @param {string} planetKey
   * @param {string} storageKey
   * @returns {Promise<boolean>}
   */
  async function restoreToStorage(planetKey, storageKey) {
    if (!hasBackend()) return false;
    const disk = await loadRecordsFile(planetKey);
    if (!disk) return false; // U盘还没有库（首次），不动本地
    let local = [];
    try { local = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch (_) {}
    const merged = mergeRecords(local, disk);
    localStorage.setItem(storageKey, JSON.stringify(merged));
    return true;
  }

  /**
   * STORE-006d 统一回收站：把整条被删记录追加进**唯一一个** _回收站/records-trash.json。
   * 每条带 {planetKey, deletedAt, record}（文字 + 媒体引用都留底）。无盘 no-op，失败只 warn。
   * @param {string} planetKey
   * @param {Object} record  被删的整条记录
   * @returns {Promise<boolean>}
   */
  async function trashRecord(planetKey, record) {
    const v = vault();
    if (!record || !v || !v.putText || !v.readText || !hasBackend()) return false;
    try {
      const path = '_回收站/records-trash.json';
      let bin = { version: 1, items: [] };
      const raw = await v.readText(path);
      if (raw) {
        try { const p = JSON.parse(raw); if (p && Array.isArray(p.items)) bin = p; } catch (_) {}
      }
      bin.items.push({ planetKey: planetKey || '', deletedAt: nowIso(), record });
      await v.putText(path, JSON.stringify(bin, null, 2));
      return true;
    } catch (err) {
      console.warn(`${LOG} trashRecord 失败：`, err);
      return false;
    }
  }

  // 父级（React 列表页）删除时 postMessage 'memory-sparks:trash-record' 进来 → 由 iframe 写回收站
  // （iframe 持有 U盘句柄，父级没有）。各星引入本公共件即自动支持，无需额外配置。
  window.addEventListener('message', (e) => {
    if (e && e.data && e.data.type === 'memory-sparks:trash-record' && e.data.record) {
      // 列表页删除走这条：文字记录进回收站 + 媒体真文件也搬进回收站。
      // （iframe 内「星里直接删」各星自己已 trash 媒体，不走这条，不会重复。）
      trashRecord(e.data.planetKey, e.data.record).catch(() => {});
      trashRecordMedia(e.data.record, { planetKey: e.data.planetKey }).catch(() => {});
    }
  });

  /* ── 导出 ─────────────────────────────────────────── */

  window.MS.mediaStore = {
    hasBackend,
    resolveRef,
    hydrateRecord,
    hydrateRecords,
    serializeRecord,
    serializeForStorage,
    putMedia,
    trashRecordMedia,
    installHandleListener,
    loadRecordsFile,
    saveRecordsFile,
    mergeRecords,
    syncRecordsFromStorage,
    restoreToStorage,
    trashRecord,
  };
})();
