/**
 * Memory Sparks · 通用添加界面（ms-composer）
 *
 * 设计：app/public/composer-design-v3.html
 * 文字主体 + 媒体按需补充，不分类型
 *
 * 用法（每个 iframe 自己引入）：
 *   <link rel="stylesheet" href="../_shared/ms-composer.css">
 *   <script src="../_shared/ms-composer.js" defer></script>
 *
 *   MS.composer.init({
 *     planet: 'flower',            // 配色 = body data-planet
 *     storageKey: 'memory-sparks:flower-records',
 *     capabilities: { image: true, video: false, audio: false },
 *     onSaved: (record) => { ... },   // 保存完后回调（让 iframe 内场景重画）
 *     onDeleted: (idx) => { ... },
 *   });
 *
 *   // 打开（添加新）
 *   MS.composer.open();
 *   // 打开（编辑）
 *   MS.composer.open(2);   // 编辑 idx=2 的记录
 *
 * 数据契约：
 *   - 真源：localStorage[storageKey]
 *   - 保存后：触发 onSaved + postMessage 给父 App 让 V2 列表层重读
 */

(function () {
  if (window.MS && window.MS.composer) return; // 已加载
  window.MS = window.MS || {};

  // 字体：直接用系统自带中文字体（苹方/微软雅黑），不再从 Google Fonts 下载。
  // 原因：① Google Fonts 在国内常被墙/极慢，加载时会让打字卡顿（字出来慢）
  //      ② U 盘离线封装后 Google 字体根本加载不了
  // 系统字体即时可用、离线、零网络依赖，字体栈见 ms-composer.css .msc-backdrop。
  function ensureFonts() { /* no-op：改用系统字体，见上方说明 */ }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  function formatHeaderDate(iso) {
    if (!iso) iso = todayISO();
    const d = new Date(iso);
    // 兜底：无法解析的日期（如旧版云星的「2026年6月」中文格式）直接原样显示，不出现 NaN
    if (isNaN(d.getTime())) return String(iso);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${m}·${dd}<span class="msc-dot">·</span>${weekdays[d.getDay()]}`;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  // 图片专用：压到 maxDim 内 + JPEG，存 localStorage（持久化）
  // 优先用 OffscreenCanvas + convertToBlob（完全异步，不阻塞主线程，打字/上传不卡）
  // 降级：不支持 OffscreenCanvas 的旧浏览器走同步 canvas.toDataURL
  async function fileToCompressedImage(file, maxDim = 800, quality = 0.80) {
    try {
      if (typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined') {
        // 异步路径：全程不阻塞主线程
        const bitmap = await createImageBitmap(file);
        let { width: w, height: h } = bitmap;
        if (w > maxDim || h > maxDim) {
          const scale = maxDim / Math.max(w, h);
          w = Math.round(w * scale); h = Math.round(h * scale);
        }
        const oc = new OffscreenCanvas(w, h);
        oc.getContext('2d').drawImage(bitmap, 0, 0, w, h);
        bitmap.close();
        const blob = await oc.convertToBlob({ type: 'image/jpeg', quality });
        // blob → base64 dataURL，可存 localStorage，刷新不丢
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
    } catch (_) { /* 降级到同步路径 */ }
    // 同步降级：旧浏览器兜底
    const raw = await fileToDataUrl(file);
    return new Promise((resolve) => {
      const img = new Image();
      img.onerror = () => resolve(raw);
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w > maxDim || h > maxDim) {
          const scale = maxDim / Math.max(w, h);
          w = Math.round(w * scale); h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        try { resolve(canvas.toDataURL('image/jpeg', quality)); }
        catch (_) { resolve(raw); }
      };
      img.src = raw;
    });
  }
  function readRecords(key) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  }
  function writeRecords(key, arr) {
    try {
      localStorage.setItem(key, JSON.stringify(arr));
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        window.alert('图片太大，本地存储空间不够了。\n可以删一些旧记录后再试。');
      } else {
        window.alert('保存失败：' + (e && e.message || e));
      }
      throw e;
    }
    // 通知父 App：刷新列表层
    try {
      window.parent && window.parent !== window && window.parent.postMessage({
        type: 'memory-sparks:storage-changed',
        key,
      }, '*');
      window.parent && window.parent !== window && window.parent.postMessage({
        type: 'memory-sparks:records-saved',
      }, '*');
    } catch (_) {}
  }
  function randomId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // SVG 图标
  const SVG = {
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></svg>',
    xMini: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  // 模板
  function buildTemplate(caps, extraHTML, opts = {}) {
    const placeholder = opts.placeholder || '写下你想留住的';
    const maxLengthAttr = opts.maxLength ? ` maxlength="${opts.maxLength}"` : '';
    return `
      <div class="msc-paper">
        <div class="msc-top">
          <div class="msc-date" data-msc="date"></div>
          <button class="msc-close" data-msc="close" title="关闭">${SVG.close}</button>
        </div>

        <div class="msc-write">
          <textarea class="msc-textarea" data-msc="textarea" placeholder="${placeholder}"${maxLengthAttr}></textarea>
          ${opts.maxLength ? `<div class="msc-counter" data-msc="counter"><span data-msc="counter-num">0</span> / ${opts.maxLength}</div>` : ''}
        </div>

        ${extraHTML ? `<div class="msc-extra" data-msc="extra">${extraHTML}</div>` : ''}

        <div class="msc-media" data-msc="media">
          <div class="msc-video" data-msc="video"></div>
          <div class="msc-audio" data-msc="audio-display"></div>
          <div class="msc-images" data-msc="images"></div>
        </div>

        <div class="msc-bottom">
          ${caps.image ? `
            <label class="msc-add-tool">
              <input type="file" accept="image/*" data-msc="img-input">
              ${SVG.image}
              图片
            </label>
          ` : ''}
          ${caps.video ? `
            <label class="msc-add-tool">
              <input type="file" accept="video/*" data-msc="video-input">
              ${SVG.video}
              视频
            </label>
          ` : ''}
          ${caps.audio ? `
            <label class="msc-add-tool">
              <input type="file" accept="audio/*" data-msc="audio-input">
              ${SVG.audio}
              声音
            </label>
          ` : ''}

          <div class="msc-spacer"></div>

          <button class="msc-delete" data-msc="delete" style="display:none">删除</button>
          <button class="msc-cancel" data-msc="cancel">取消</button>
          <button class="msc-save" data-msc="save">记下</button>
        </div>
      </div>
    `;
  }

  let cfg = null;
  let root = null;
  // images[]：压缩 base64（预览 + 无盘兜底）。imageFiles[]：与 images 一一对应的原 File，
  // 仅本次会话内存在（编辑旧记录回填时为空），保存时供有盘场景写原画质真文件用，绝不进 localStorage。
  let state = { editing: null, text: '', images: [], imageFiles: [], video: null, audio: null, audioName: '', date: todayISO() };

  function ensureRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.className = 'msc-backdrop';
    document.body.appendChild(root);
    return root;
  }

  function refreshMediaVisibility() {
    const media = root.querySelector('[data-msc="media"]');
    const imgWrap = root.querySelector('[data-msc="images"]');
    const vidWrap = root.querySelector('[data-msc="video"]');
    const audWrap = root.querySelector('[data-msc="audio-display"]');
    const hasImg = state.images.length > 0;
    const hasVid = !!state.video;
    const hasAud = !!state.audio;
    imgWrap.classList.toggle('msc-show', hasImg);
    vidWrap.classList.toggle('msc-show', hasVid);
    if (audWrap) audWrap.classList.toggle('msc-show', hasAud);
    media.classList.toggle('msc-has-content', hasImg || hasVid || hasAud);
  }
  // 媒体预览：编辑回填时记录里存的是 'fsa:' 引用，<img>/<video> 不认识 → 破图。
  // 这里把 fsa: 引用异步解析成可显示 URL 再塞回元素；data:/blob: 已可显示，原样。
  // 只动「显示」，不动 state（保存仍沿用原始引用，不破坏已存真文件）。无盘/base64 时为 no-op。
  const MSC_BLANK_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  function mscIsFsa(s) { return typeof s === 'string' && s.startsWith('fsa:'); }
  function mscHydrateSrc(el, ref) {
    if (!el || !mscIsFsa(ref)) return;
    const store = window.MS && window.MS.mediaStore;
    if (!store || !store.resolveRef) return;
    store.resolveRef(ref).then(url => { if (url) el.src = url; }).catch(() => {});
  }
  function refreshImages() {
    const imgWrap = root.querySelector('[data-msc="images"]');
    // 用 <img> 元素而不是 background-image — 后者让浏览器在每次 textarea reflow 时重新解码 dataURL，文字输入卡顿
    imgWrap.innerHTML = state.images.map((src, idx) => `
      <div class="msc-thumb"><img src="${mscIsFsa(src) ? MSC_BLANK_IMG : src}" data-msc-img="${idx}" alt="" loading="eager" decoding="async">
        <button class="msc-x" data-msc-rm-img="${idx}">×</button>
      </div>
    `).join('');
    state.images.forEach((src, idx) => { if (mscIsFsa(src)) mscHydrateSrc(imgWrap.querySelector(`img[data-msc-img="${idx}"]`), src); });
    imgWrap.querySelectorAll('[data-msc-rm-img]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.mscRmImg, 10);
        state.images.splice(i, 1);
        state.imageFiles.splice(i, 1); // 与 images 同步删，避免两数组错位
        refreshImages();
        refreshMediaVisibility();
      });
    });
    refreshMediaVisibility();
  }
  function refreshVideo() {
    const vidWrap = root.querySelector('[data-msc="video"]');
    if (state.video) {
      vidWrap.innerHTML = `
        <video src="${mscIsFsa(state.video) ? '' : state.video}" muted autoplay loop playsinline></video>
        <button class="msc-x" data-msc-rm-vid>${SVG.xMini}</button>
      `;
      if (mscIsFsa(state.video)) mscHydrateSrc(vidWrap.querySelector('video'), state.video);
      vidWrap.querySelector('[data-msc-rm-vid]').addEventListener('click', () => {
        state.video = null;
        refreshVideo();
        refreshMediaVisibility();
      });
    } else {
      vidWrap.innerHTML = '';
    }
    refreshMediaVisibility();
  }
  function refreshAudio() {
    const audWrap = root.querySelector('[data-msc="audio-display"]');
    if (!audWrap) return;
    if (state.audio) {
      audWrap.innerHTML = `
        <div class="msc-audio-row">
          ${SVG.audio}
          <span class="msc-audio-name">${state.audioName || '音频'}</span>
          <audio src="${state.audio}" controls preload="metadata"></audio>
          <button class="msc-x" data-msc-rm-aud>${SVG.xMini}</button>
        </div>
      `;
      const rm = audWrap.querySelector('[data-msc-rm-aud]');
      if (rm) rm.addEventListener('click', () => {
        state.audio = null;
        state.audioName = '';
        refreshAudio();
        refreshMediaVisibility();
      });
    } else {
      audWrap.innerHTML = '';
    }
    refreshMediaVisibility();
  }
  function refreshSaveDisabled() {
    const save = root.querySelector('[data-msc="save"]');
    if (!save) return;
    const ok = state.text.trim().length > 0 || state.images.length > 0 || !!state.video || !!state.audio;
    save.toggleAttribute('disabled', !ok);
  }

  function bindEvents() {
    const close = root.querySelector('[data-msc="close"]');
    const cancel = root.querySelector('[data-msc="cancel"]');
    const save = root.querySelector('[data-msc="save"]');
    const delBtn = root.querySelector('[data-msc="delete"]');
    const ta = root.querySelector('[data-msc="textarea"]');
    const imgInput = root.querySelector('[data-msc="img-input"]');
    const videoInput = root.querySelector('[data-msc="video-input"]');
    const audioInput = root.querySelector('[data-msc="audio-input"]');

    close && close.addEventListener('click', closeComposer);
    cancel && cancel.addEventListener('click', closeComposer);
    save && save.addEventListener('click', doSave);
    delBtn && delBtn.addEventListener('click', doDelete);

    const counter = root.querySelector('[data-msc="counter-num"]');
    // rAF throttle：高频 input（如连续打字）合并到一帧内执行一次，避免每个 keystroke 都触发 layout
    let _inputRaf = null;
    ta.addEventListener('input', () => {
      if (_inputRaf) return;
      _inputRaf = requestAnimationFrame(() => {
        _inputRaf = null;
        state.text = ta.value;
        if (counter) counter.textContent = String(ta.value.length);
        refreshSaveDisabled();
      });
    });
    if (counter) counter.textContent = String(ta.value.length);

    if (imgInput) {
      imgInput.addEventListener('change', async (e) => {
        const files = [...e.target.files].filter(f => f.type.startsWith('image/'));
        if (!files.length) return;
        // 处理中：禁用保存按钮 + 显示提示，避免用户以为卡死
        const save = root.querySelector('[data-msc="save"]');
        if (save) save.setAttribute('disabled', '');
        const mediaEl = root.querySelector('[data-msc="media"]');
        const loadingEl = document.createElement('div');
        loadingEl.className = 'msc-img-loading';
        loadingEl.textContent = '处理图片中…';
        if (mediaEl) mediaEl.appendChild(loadingEl);
        // 一条记录只放一张图：只取第一张，且「新选的替换旧的」（不累积），避免多图只存第一张造成丢图
        const f = files[0];
        try {
          const url = await fileToCompressedImage(f);
          state.images = [url];
          state.imageFiles = [f]; // 留住原 File：有盘时写原画质真文件
        } catch (_) {}
        loadingEl.remove();
        refreshImages();
        refreshSaveDisabled();
        e.target.value = '';
      });
    }
    if (videoInput) {
      videoInput.addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          state.video = await fileToDataUrl(f);
        } catch (_) {}
        refreshVideo();
        refreshSaveDisabled();
        e.target.value = '';
      });
    }
    if (audioInput) {
      audioInput.addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          state.audio = await fileToDataUrl(f);
          state.audioName = f.name || '';
        } catch (_) {}
        refreshAudio();
        refreshSaveDisabled();
        e.target.value = '';
      });
    }

    // 点 backdrop 关闭
    root.addEventListener('click', (e) => { if (e.target === root) closeComposer(); });
    // ESC 关
    document.addEventListener('keydown', escHandler);
  }
  function escHandler(e) {
    if (e.key === 'Escape' && root && root.classList.contains('msc-open')) closeComposer();
  }

  function openComposer(editIdx) {
    if (!cfg) {
      console.warn('[ms-composer] init() 还没调用');
      return;
    }
    ensureFonts();
    ensureRoot();
    root.setAttribute('data-planet', cfg.planet);
    root.innerHTML = buildTemplate(cfg.capabilities || { image: true }, cfg.extraHTML || '', {
      placeholder: cfg.textareaPlaceholder,
      maxLength: cfg.textareaMaxLength,
    });

    // 编辑模式 vs 新增
    const records = readRecords(cfg.storageKey);
    if (typeof editIdx === 'number' && editIdx >= 0 && records[editIdx]) {
      const r = records[editIdx];
      state = {
        editing: editIdx,
        text: r.text || r.content || r.body || r.caption || '',
        images: r.images || (r.image ? [r.image] : []),
        // 编辑旧记录只有引用/base64、没有原 File → imageFiles 留空，
        // 该记录走「没重选图」分支，保存时沿用现有引用、不破坏已存真文件。
        imageFiles: [],
        video: r.video || null,
        audio: r.audio || null,
        audioName: r.audioName || '',
        date: r.date || todayISO(),
      };
      const delBtn = root.querySelector('[data-msc="delete"]');
      if (delBtn) delBtn.style.display = '';
    } else {
      state = { editing: null, text: '', images: [], imageFiles: [], video: null, audio: null, audioName: '', date: todayISO() };
    }

    // 渲染初始
    const ta = root.querySelector('[data-msc="textarea"]');
    ta.value = state.text;
    root.querySelector('[data-msc="date"]').innerHTML = formatHeaderDate(state.date);
    refreshImages();
    refreshVideo();
    refreshAudio();
    refreshSaveDisabled();
    bindEvents();
    // 扩展槽：让每颗星塞自己的额外字段（如花星选花种类）
    if (cfg.extraInit) {
      const extraEl = root.querySelector('[data-msc="extra"]');
      if (extraEl) {
        try {
          const editingRec = state.editing != null ? records[state.editing] : null;
          cfg.extraInit(extraEl, editingRec);
        } catch (e) { console.warn('[ms-composer] extraInit failed', e); }
      }
    }

    // 打开（不用 requestAnimationFrame：iframe 在列表模式下 RAF 被父 App 暂停，
    // 用 RAF 会让 msc-open 永远不生效，添加窗口永远弹不出）
    root.classList.add('msc-open');
    setTimeout(() => ta.focus(), 80);

    // 通知父 App 暂停背景动效
    document.body.classList.add('ms-composer-open');
    try {
      window.parent && window.parent !== window && window.parent.postMessage({
        type: 'memory-sparks:composer-opened',
      }, '*');
    } catch (_) {}

    // 本星钩子：场景准备（暂停拖拽、关掉冲突 UI 等）
    if (cfg.onOpened) {
      try { cfg.onOpened(state.editing); } catch (e) { console.warn('[ms-composer] onOpened failed', e); }
    }
  }

  function closeComposer() {
    if (!root) return;
    root.classList.remove('msc-open');
    setTimeout(() => {
      if (root && !root.classList.contains('msc-open')) {
        root.innerHTML = '';
      }
    }, 320);
    document.body.classList.remove('ms-composer-open');
    document.removeEventListener('keydown', escHandler);
    try {
      window.parent && window.parent !== window && window.parent.postMessage({
        type: 'memory-sparks:composer-closed',
        dirty: false,
      }, '*');
    } catch (_) {}

    // 本星钩子：场景恢复
    if (cfg && cfg.onClosed) {
      try { cfg.onClosed(); } catch (e) { console.warn('[ms-composer] onClosed failed', e); }
    }
  }

  async function doSave() {
    const text = state.text.trim();
    const hasMedia = state.images.length > 0 || !!state.video || !!state.audio;

    // 扩展槽：取额外字段（如花星花种类）
    let extra = {};
    if (cfg.extraGet) {
      const extraEl = root.querySelector('[data-msc="extra"]');
      if (extraEl) {
        try { extra = cfg.extraGet(extraEl) || {}; }
        catch (e) { console.warn('[ms-composer] extraGet failed', e); }
      }
    }
    // 扩展校验
    if (cfg.extraValidate) {
      const errMsg = cfg.extraValidate(extra);
      if (errMsg) { window.alert(errMsg); return; }
    }

    if (!text && !hasMedia && !Object.keys(extra).length) return;

    const records = readRecords(cfg.storageKey);
    const id = state.editing != null ? records[state.editing]?.id : null;
    let payload = {
      id: id || randomId(),
      date: state.date,
      text,
      images: state.images,
      image: state.images[0] || '',
      // 临时字段：原图 File 数组，仅供 beforeSave 写真文件用。
      // beforeSave 必须在写 localStorage 前删掉它（File 不可 JSON 化，绝不能进存储）。
      imageFiles: state.imageFiles,
      video: state.video || '',
      audio: state.audio || '',
      audioName: state.audio ? state.audioName : '',
      // 类型推断优先级：视频+文 > 图+文 > 音频 > 文
      // 注：V2 inferCardType 已支持智能升级（image+text 自动升到 image-text-h），所以这里宽松一点
      type: state.video ? (text ? 'video-text-h' : 'video-h')
          : state.images.length ? (text ? 'image-text-h' : 'image')
          : state.audio ? 'audio'
          : 'text',
      ...extra,
    };

    // 保存前钩子：每颗星可以补本星专属字段（如云星的 _zoneIdx / _pageIdx）
    // await 兼容同步返回值，不破坏其它星的同步 beforeSave
    if (cfg.beforeSave) {
      try {
        const patched = await cfg.beforeSave(payload, state.editing);
        if (patched && typeof patched === 'object') payload = patched;
      } catch (e) { console.warn('[ms-composer] beforeSave failed', e); }
    }

    // 兜底清理：imageFiles 是 File 数组、不可 JSON 化，绝不能进 localStorage。
    // 治愈的 beforeSave 已主动删；这里再防御一次，覆盖没有 beforeSave 的星。
    if ('imageFiles' in payload) delete payload.imageFiles;

    let next;
    if (state.editing != null && records[state.editing]) {
      next = records.slice();
      next[state.editing] = { ...records[state.editing], ...payload };
    } else {
      next = [payload, ...records];
    }
    writeRecords(cfg.storageKey, next);

    const wasNew = state.editing == null;
    try { cfg.onSaved && cfg.onSaved(payload, state.editing); } catch (_) {}

    // 通知父 App composer 已关，且记录已 dirty；isNew 用于让列表层自动切回 3D 场景
    document.body.classList.remove('ms-composer-open');
    try {
      window.parent && window.parent !== window && window.parent.postMessage({
        type: 'memory-sparks:composer-closed',
        dirty: true,
        isNew: wasNew,
        savedId: payload.id,
        planet: cfg.planet,
      }, '*');
    } catch (_) {}

    closeComposer();
  }

  async function doDelete() {
    if (state.editing == null) return;
    if (!window.confirm('删除这条记录？')) return;
    const records = readRecords(cfg.storageKey);
    const idx = state.editing;
    if (idx < 0 || idx >= records.length) return;
    const removedRecord = records[idx];
    // 删除前钩子：每颗星可以做媒体真文件回收等清理（如治愈把 fsa 媒体挪进回收站）
    if (cfg.beforeDelete) {
      try { await cfg.beforeDelete(removedRecord); }
      catch (e) { console.warn('[ms-composer] beforeDelete failed', e); }
    }
    // STORE-006d：整条记录（文字 + 媒体引用）进统一回收站
    try {
      if (window.MS && window.MS.mediaStore && window.MS.mediaStore.trashRecord) {
        await window.MS.mediaStore.trashRecord(cfg.planet, removedRecord);
      }
    } catch (_) {}
    const next = records.slice();
    next.splice(idx, 1);
    writeRecords(cfg.storageKey, next);
    // STORE-006c/d：删除后让本星重渲 + 同步 records.json。
    // 复用各星的 __msReloadAll（已挂带星名/关键词的建库 sync），避免 onDeleted 各星没配导致不同步。
    try { if (typeof window.__msReloadAll === 'function') window.__msReloadAll(); } catch (_) {}

    try { cfg.onDeleted && cfg.onDeleted(idx); } catch (_) {}

    document.body.classList.remove('ms-composer-open');
    try {
      window.parent && window.parent !== window && window.parent.postMessage({
        type: 'memory-sparks:composer-closed',
        dirty: true,
      }, '*');
    } catch (_) {}

    closeComposer();
  }

  function init(opts) {
    cfg = Object.assign({
      planet: 'cloud',
      storageKey: '',
      capabilities: { image: true, video: false, audio: false },
    }, opts || {});
    // 让父 App 的 open-composer 消息能直接触发
    if (!window.__msOpenComposer) {
      window.__msOpenComposer = (editIdx) => openComposer(typeof editIdx === 'number' ? editIdx : -1);
    }
    // 监听父 App 发来的 open-composer
    window.addEventListener('message', (e) => {
      if (!e.data || e.data.type !== 'memory-sparks:open-composer') return;
      openComposer(typeof e.data.editIdx === 'number' ? e.data.editIdx : -1);
    });
  }

  window.MS.composer = {
    init,
    open: openComposer,
    close: closeComposer,
  };
})();
