/**
 * Memory Sparks · 媒体保险箱（ms-media-vault）
 *
 * 用途：
 *   把媒体（图/视/音）存成 U 盘上的真文件（File System Access API），
 *   没有 U 盘句柄时退回原本的 base64。记录里永远只存一个「引用字符串」，
 *   读取时按引用取回可显示的 URL。后端从 IndexedDB 换成 FSA 文件，
 *   思路与 sea/main.js 的 AudioDB 一致（只存引用、媒体另存、读时取回）。
 *
 * 引用字符串约定（记录里就存这一个字符串）：
 *   - 真文件：'fsa:<相对路径>'，例如 'fsa:healing/2026-06-05/abc123.jpg'
 *   - 兜底 base64：原样的 'data:image/jpeg;base64,....'（不加前缀 → 老记录天然兼容）
 *   - 空：''
 *
 * API（全部挂在 MS.mediaVault 上）：
 *   - setDirHandle(handle)                         存入父级传来的目录句柄（null=没有）
 *   - hasFileBackend() → boolean                   当前是否有可用句柄
 *   - put({planetKey,id,kind,dateStr,source}) → Promise<引用>    存媒体，返回引用字符串
 *       source 可以是 Blob/File（原图，写真文件时直接落盘、不压缩）
 *       或 dataUrl 字符串（现状 base64 兜底，向后兼容旧的 dataUrl 字段名）
 *   - resolve(ref) → Promise<可显示URL>            按引用取回 src（blob: 或 data:）
 *   - trash(ref, {planetKey}) → Promise<boolean>   删媒体（先进回收站再删原件）
 *
 * 重要：resolve 对 'fsa:' 引用返回的是 blob: URL，
 *   调用方用完后必须自己 URL.revokeObjectURL(url)，否则内存泄漏。
 *
 * 回收站策略：
 *   trash 删真文件时不直接删，先把文件内容复制到 '_回收站/<原相对路径>'，
 *   回收站写成功后才 removeEntry 删原件；任一步失败则保留原件并返回 false，
 *   宁可不删也不丢数据。
 */

(function () {
  if (window.MS && window.MS.mediaVault) return; // 已加载
  window.MS = window.MS || {};

  const LOG = '[ms-media-vault]';
  const TRASH_DIR = '_回收站';

  // 模块内状态：当前 U 盘目录句柄。默认 null = 没有 → 走 base64 兜底。
  let dirHandle = null;

  /* ── 内部工具（不导出） ───────────────────────────── */

  // mime → 文件扩展名
  const MIME_TO_EXT = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
  };
  // mime 认不出时，按 kind 给默认扩展名
  const KIND_DEFAULT_EXT = { image: 'jpg', video: 'mp4', audio: 'm4a' };

  function mimeToExt(mime, kind) {
    return MIME_TO_EXT[mime] || KIND_DEFAULT_EXT[kind] || 'bin';
  }

  // 把日期/路径片段里的 '.' 和 '/' 统一替换成 '-'
  // （'2026.06.05' / '2026/06/05' → '2026-06-05'）
  function safeSegment(str) {
    return String(str || '').replace(/[./]/g, '-');
  }

  // dataURL → { mime, bytes:Uint8Array }
  // 形如 'data:image/jpeg;base64,xxxx'：逗号前是 header，逗号后是 base64 体
  function dataUrlToBytes(dataUrl) {
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx < 0) throw new Error('非法 dataURL：找不到逗号分隔');
    const header = dataUrl.slice(0, commaIdx); // data:image/jpeg;base64
    const body = dataUrl.slice(commaIdx + 1);  // base64 内容
    const mimeMatch = header.match(/^data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : '';
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { mime, bytes };
  }

  // 把 'healing/2026-06-05/abc.jpg' 拆成 { dirs:['healing','2026-06-05'], file:'abc.jpg' }
  function splitPath(relPath) {
    const parts = String(relPath).split('/').filter(Boolean);
    const file = parts.pop();
    return { dirs: parts, file };
  }

  // 逐级 getDirectoryHandle({create:true})，返回最末层目录句柄
  async function ensureDir(rootHandle, pathParts) {
    let current = rootHandle;
    for (const name of pathParts) {
      current = await current.getDirectoryHandle(name, { create: true });
    }
    return current;
  }

  // 沿相对路径找到目录链（不创建），返回最末层目录句柄；中途缺失会抛错
  async function walkDir(rootHandle, pathParts) {
    let current = rootHandle;
    for (const name of pathParts) {
      current = await current.getDirectoryHandle(name, { create: false });
    }
    return current;
  }

  // 把字节写到 <root>/<relPath>，逐级建目录
  async function writeFileAt(rootHandle, relPath, bytes) {
    const { dirs, file } = splitPath(relPath);
    const dirHandleLast = await ensureDir(rootHandle, dirs);
    const fileHandle = await dirHandleLast.getFileHandle(file, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(bytes);
    await writable.close();
  }

  /* ── 导出 API ─────────────────────────────────────── */

  // 存入父级通过 postMessage 传来的目录句柄（null = 没有 → 走兜底）
  function setDirHandle(handle) {
    dirHandle = handle || null;
    _dataRoot = null; _dataRootFor = null; // 句柄变了，作废数据根缓存
  }

  // 当前是否有可用的真文件后端
  function hasFileBackend() {
    return !!dirHandle;
  }

  // STORE-006e 自动归集：所有真文件统一写进 <用户选的目录>/memory-sparks-data/ 下，
  // 避免连接时选错层级（如选到某颗星的子文件夹）导致结构嵌套错乱。
  // 句柄不变（setDirHandle 仍同步、调用方零改），仅在真正读写时下沉一层并缓存。
  const DATA_ROOT_DIR = 'memory-sparks-data';
  let _dataRoot = null;
  let _dataRootFor = null;
  async function getDataRoot() {
    if (!dirHandle) return null;
    if (_dataRootFor === dirHandle && _dataRoot) return _dataRoot;
    _dataRoot = await dirHandle.getDirectoryHandle(DATA_ROOT_DIR, { create: true });
    _dataRootFor = dirHandle;
    return _dataRoot;
  }

  // 判断是不是 Blob/File（原图源）。File 继承自 Blob，统一用 Blob 判定。
  function isBlobSource(source) {
    return typeof Blob !== 'undefined' && source instanceof Blob;
  }

  // 从 source 解出 { mime, bytes }：Blob/File 直接读二进制（不压缩、原画质）；
  // 字符串 dataUrl 走现有解码逻辑（向后兼容）。
  async function sourceToBytes(source) {
    if (isBlobSource(source)) {
      const bytes = new Uint8Array(await source.arrayBuffer());
      return { mime: source.type || '', bytes };
    }
    return dataUrlToBytes(source);
  }

  /**
   * 存一份媒体。
   * @param {Object} p
   * @param {string} p.planetKey   星球 key（如 'healing'），作为顶层子目录
   * @param {string} p.id          记录 id，用作文件名
   * @param {string} p.kind        'image' | 'video' | 'audio'
   * @param {string} p.dateStr     日期（如 '2026-06-05'），作为二级子目录；内部会把 '.'/'/' 统一成 '-'
   * @param {Blob|File|string} [p.source]  媒体源：Blob/File（原图，落盘不压缩）或 base64 dataUrl 字符串
   * @param {string} [p.dataUrl]   向后兼容：旧字段名，等价于 source=dataUrl（只在没传 source 时生效）
   * @returns {Promise<string>}    引用字符串：'fsa:<相对路径>' 或 原 dataUrl（兜底）
   */
  async function put({ planetKey, id, kind, dateStr, source, dataUrl, group }) {
    // 向后兼容：调用方只传了旧的 dataUrl 没传 source 时，等价于 source=dataUrl
    const src = source !== undefined ? source : dataUrl;
    if (!src) return ''; // 没有媒体

    // 无句柄：base64 兜底
    if (!dirHandle) {
      // 字符串 dataUrl：原样返回（现状）
      if (typeof src === 'string') return src;
      // Blob/File：理论上调用方应保证无盘时传 dataUrl；防御性 warn，绝不把原图转巨大 base64
      console.warn(`${LOG} put 无盘却收到 Blob/File 源，无法兜底，返回空：`, kind);
      return '';
    }

    try {
      const { mime, bytes } = await sourceToBytes(src);
      const ext = mimeToExt(mime, kind);
      // group（可选）：在 planetKey 下再分一层子目录，如 'original' / 'filtered'，
      // 让同一条记录的不同媒体（原图/滤镜图）落到不同文件夹，不互相覆盖。
      const groupSeg = group ? `${safeSegment(group)}/` : '';
      const relPath = `${safeSegment(planetKey)}/${groupSeg}${safeSegment(dateStr)}/${safeSegment(id)}.${ext}`;
      await writeFileAt(await getDataRoot(), relPath, bytes);
      return `fsa:${relPath}`;
    } catch (err) {
      // 写文件失败：不静默吞，warn 出来。字符串源仍降级返回 base64 让上层能存下去；
      // Blob/File 源无法降级（不转巨大 base64），返回空让上层走自己的兜底分支。
      console.warn(`${LOG} put 写文件失败：`, err);
      return typeof src === 'string' ? src : '';
    }
  }

  /**
   * 按引用取回可显示的 URL。
   * @param {string} ref  'data:...' / '' / 'fsa:<相对路径>'
   * @returns {Promise<string>}  可直接当 src 的 URL；'data:'/'' 原样返回，
   *                             'fsa:' 返回 blob: URL（调用方用完需 revokeObjectURL）
   */
  async function resolve(ref) {
    // base64 或空：原样返回，能直接当 src
    if (!ref || ref.startsWith('data:')) return ref || '';

    if (ref.startsWith('fsa:')) {
      if (!dirHandle) {
        console.warn(`${LOG} resolve 遇到 fsa 引用但当前无目录句柄：`, ref);
        return '';
      }
      try {
        const relPath = ref.slice('fsa:'.length);
        const { dirs, file } = splitPath(relPath);
        const dir = await walkDir(await getDataRoot(), dirs);
        const fileHandle = await dir.getFileHandle(file, { create: false });
        const fileObj = await fileHandle.getFile();
        return URL.createObjectURL(fileObj); // blob: URL，调用方负责释放
      } catch (err) {
        // 文件被删 / 句柄失效
        console.warn(`${LOG} resolve 读不到文件：`, ref, err);
        return '';
      }
    }

    // 未知前缀：原样返回（防御性，不应出现）
    console.warn(`${LOG} resolve 遇到未知引用格式：`, ref);
    return ref;
  }

  /**
   * 删除一份媒体（真文件先进回收站再删原件）。
   * @param {string} ref  'data:...' / '' / 'fsa:<相对路径>'
   * @param {Object} [opts]
   * @param {string} [opts.planetKey]  预留参数（当前实现不需要，签名保持一致）
   * @returns {Promise<boolean>}  是否处理成功
   */
  async function trash(ref, { planetKey } = {}) {
    // base64 或空：跟记录一起删，无需动文件
    if (!ref || ref.startsWith('data:')) return true;

    if (!ref.startsWith('fsa:')) {
      console.warn(`${LOG} trash 遇到未知引用格式：`, ref);
      return false;
    }

    if (!dirHandle) {
      console.warn(`${LOG} trash 遇到 fsa 引用但当前无目录句柄：`, ref);
      return false;
    }

    const relPath = ref.slice('fsa:'.length);
    const { dirs, file } = splitPath(relPath);

    try {
      const root = await getDataRoot();
      // 1. 读出原文件内容
      const srcDir = await walkDir(root, dirs);
      const srcFileHandle = await srcDir.getFileHandle(file, { create: false });
      const srcFile = await srcFileHandle.getFile();
      const bytes = new Uint8Array(await srcFile.arrayBuffer());

      // 2. 写到 '_回收站/<相对路径>'（先写成功，确保不丢数据）。
      //    回收站不保留媒体分组层（original/filtered 等变体子目录），与无分组的星回收站结构一致：
      //    'hiking/original/2026-06-05/id.jpg' → '_回收站/hiking/2026-06-05/id.jpg'
      const trashParts = relPath.split('/');
      if (trashParts.length >= 2 && (trashParts[1] === 'original' || trashParts[1] === 'filtered')) {
        trashParts.splice(1, 1);
      }
      const trashRelPath = `${TRASH_DIR}/${trashParts.join('/')}`;
      await writeFileAt(root, trashRelPath, bytes);

      // 3. 回收站写成功后，再删原件
      await srcDir.removeEntry(file);
      return true;
    } catch (err) {
      // 任一步失败：不删原件，避免数据丢失
      console.warn(`${LOG} trash 失败，已保留原文件：`, ref, err);
      return false;
    }
  }

  /**
   * 直接删除一份媒体（不进回收站）。用于可再生的衍生文件（如行星滤镜成品）。
   * @param {string} ref  'data:...' / '' / 'fsa:<相对路径>'
   * @returns {Promise<boolean>}  是否处理成功
   */
  async function remove(ref) {
    if (!ref || ref.startsWith('data:')) return true; // base64/空：跟记录一起删即可
    if (!ref.startsWith('fsa:')) { console.warn(`${LOG} remove 遇到未知引用格式：`, ref); return false; }
    if (!dirHandle) { console.warn(`${LOG} remove 遇到 fsa 引用但当前无目录句柄：`, ref); return false; }
    const relPath = ref.slice('fsa:'.length);
    const { dirs, file } = splitPath(relPath);
    try {
      const dir = await walkDir(await getDataRoot(), dirs);
      await dir.removeEntry(file);
      return true;
    } catch (err) {
      console.warn(`${LOG} remove 删除失败：`, ref, err);
      return false;
    }
  }

  /**
   * 写一个文本文件到 <root>/<relPath>（逐级建目录）。
   * 用于 records.json / index.json 等结构化数据落盘（STORE-006）。
   * 无句柄返回 false；写失败 warn 后返回 false（不静默吞）。
   * @param {string} relPath  相对路径，如 'starry/records.json' / 'index.json'
   * @param {string} text     文本内容（通常是 JSON.stringify 结果）
   * @returns {Promise<boolean>}
   */
  async function putText(relPath, text) {
    if (!dirHandle) return false;
    try {
      const bytes = new TextEncoder().encode(String(text == null ? '' : text));
      await writeFileAt(await getDataRoot(), relPath, bytes);
      return true;
    } catch (err) {
      console.warn(`${LOG} putText 写文件失败：`, relPath, err);
      return false;
    }
  }

  /**
   * 读 <root>/<relPath> 文本。
   * 无句柄 / 文件不存在 / 失败一律返回 null（首次使用文件不存在是正常情况，不 warn）。
   * @param {string} relPath
   * @returns {Promise<string|null>}
   */
  async function readText(relPath) {
    if (!dirHandle) return null;
    try {
      const { dirs, file } = splitPath(relPath);
      const dir = await walkDir(await getDataRoot(), dirs);
      const fileHandle = await dir.getFileHandle(file, { create: false });
      const fileObj = await fileHandle.getFile();
      return await fileObj.text();
    } catch (_) {
      return null; // 文件不存在 / 读不到：正常返回 null，调用方据此判断「U盘还没有库」
    }
  }

  // 挂上全局命名空间（与 ms-composer 同风格）
  window.MS.mediaVault = {
    setDirHandle,
    hasFileBackend,
    put,
    resolve,
    trash,
    remove,
    putText,
    readText,
  };
})();
