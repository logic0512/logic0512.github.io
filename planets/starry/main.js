const starterAchievements = [
  {
    id: 'star-1',
    date: '05.04',
    title: '完成第一次长线整理',
    text: '把零散的想法收进了一个清晰的结构里。',
    size: 3,
    brightness: 3,
    x: 48,
    y: 25,
  },
  {
    id: 'star-2',
    date: '05.09',
    title: '学会慢一点判断',
    text: '没有急着给自己答案，而是先把感受留住。',
    size: 2,
    brightness: 2,
    x: 62,
    y: 18,
  },
  {
    id: 'star-3',
    date: '05.12',
    title: '把一个复杂页面做出来',
    text: '从故事、交互到视觉，终于有了可以体验的版本。',
    size: 5,
    brightness: 5,
    x: 73,
    y: 35,
  },
  {
    id: 'star-4',
    date: '05.18',
    title: '完成一次认真复盘',
    text: '看见了自己走过的路，也看见了下一步。',
    size: 4,
    brightness: 4,
    x: 86,
    y: 23,
  },
  {
    id: 'star-5',
    date: '今天',
    title: '又点亮了一颗星',
    text: '哪怕只是小小的一步，也值得被天空保存。',
    size: 3,
    brightness: 3,
    x: 58,
    y: 42,
  },
];

const elements = {
  achievementLayer: document.getElementById('achievementLayer'),
  floatingAdd: document.getElementById('floatingAdd'),
};

// ── 点星弹窗 rcard（居中，支持图/文/视频 + 横竖）──
const rcard = document.getElementById('rcard');
const rcInner = document.getElementById('rcard-inner');
let _currentCardRec = null;
const RC_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
const RC_VIDICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>';

function escHtml(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function starryMedia(rec){
  if (rec.video) return { kind: 'video', src: rec.video };
  const img = (rec.images && rec.images.length) ? rec.images[0] : (rec.image || rec.src || '');
  if (img) return { kind: 'image', src: img };
  return { kind: null, src: '' };
}

const storageKey = 'memory-sparks:starry-records';
// ── U盘真文件存储（与治愈星同方案，统一走公共件 MS.mediaStore）──
const STARRY_PLANET_KEY = 'starry';
const STARRY_MEDIA_FIELDS = ['src', 'image', 'video']; // 无音频；images 数组由公共件单独处理
function msStore() { return window.MS && window.MS.mediaStore; }
function msHasBackend() { const s = msStore(); return !!(s && s.hasBackend && s.hasBackend()); }
// 启动迁移旧 key（同时修复 TDZ：storageKey 必须在 loadAchievements 之前定义）
(function() {
  try {
    if (!localStorage.getItem(storageKey)) {
      const old = localStorage.getItem('starryAchievementsV3');
      if (old) localStorage.setItem(storageKey, old);
    }
  } catch (_) {}
})();

let achievements = loadAchievements();
let selectedId = null;

function loadAchievements() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

// 有盘时：读出记录后就地水合（fsa: → blob: URL），失败降级为原始记录。
// 无盘时不会被调用（调用方按 hasBackend 分叉），保持同步老路径。
async function loadHydratedAchievements() {
  const list = loadAchievements();
  const s = msStore();
  if (s && s.hydrateRecords) {
    try { await s.hydrateRecords(list, { mediaFields: STARRY_MEDIA_FIELDS }); }
    catch (err) { console.warn('[starry] hydrate 失败，降级直接渲染：', err); }
  }
  return list;
}

function saveAchievements() {
  // 剥掉运行时字段（media / _mVertical 横竖缓存），不写进存储
  const storable = achievements.map(({ media, _mVertical, ...achievement }) => achievement);
  // 防数据丢失：有盘时内存里媒体字段是 blob: URL，写 localStorage 前必须按 _fsaRefs
  // 还原成持久的 'fsa:' 引用，否则刷新即丢图。无盘时为 no-op，行为与改造前一致。
  const s = msStore();
  const safe = (s && s.serializeForStorage)
    ? s.serializeForStorage(storable, { mediaFields: STARRY_MEDIA_FIELDS })
    : storable;
  localStorage.setItem(storageKey, JSON.stringify(safe));
  syncRecordsFile(); // U盘建库（STORE-006）：同步写 records.json + 刷新索引；无盘 no-op
}

// 把当前 localStorage 里的记录同步写进 U盘 records.json + 刷新总索引（STORE-006）。
// 关键：录入走 ms-composer（它自己写 localStorage 后才回调 onSaved），不经过 saveAchievements，
// 所以建库必须挂在「记录已落 localStorage」的每个节点统一调用本函数。无盘为 no-op。
function syncRecordsFile() {
  const s = msStore();
  if (!s || !s.saveRecordsFile || !msHasBackend()) return;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch (_) {}
  s.saveRecordsFile(STARRY_PLANET_KEY, Array.isArray(list) ? list : [], {
    meta: { name: '繁星', keyword: '成就' },
    mediaFields: STARRY_MEDIA_FIELDS,
  }).catch(() => {});
}

// U盘建库恢复（STORE-006）：有盘时从 records.json 读回记录、与本地按 id 合并、写回 localStorage，
// 并通知父级列表重读。换电脑 / 清缓存后插盘即恢复。无盘 / U盘还没库 时为 no-op。
async function restoreFromDisk() {
  const s = msStore();
  if (!s || !s.loadRecordsFile || !msHasBackend()) return false;
  try {
    const disk = await s.loadRecordsFile(STARRY_PLANET_KEY);
    if (!disk) return false; // U盘还没有库（首次），跳过，等首次保存时自动建库
    const local = loadAchievements();
    const merged = s.mergeRecords ? s.mergeRecords(local, disk) : disk;
    localStorage.setItem(storageKey, JSON.stringify(merged));
    try {
      if (window.parent) window.parent.postMessage(
        { type: 'memory-sparks:storage-changed', key: storageKey }, '*',
      );
    } catch (_) {}
    return true;
  } catch (err) {
    console.warn('[starry] restoreFromDisk 失败：', err);
    return false;
  }
}

function formatToday() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function getStarDistance(first, second) {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function renderAchievements(newId = null) {
  elements.achievementLayer.innerHTML = '';

  let newButton = null;
  // STORE-008：只渲染最新 180 颗（存档/日志页仍是全部，saveAchievements 写全量，不丢）
  newestForDisplay(achievements).forEach(achievement => {
    const button = document.createElement('button');
    const size = Number(achievement.size || achievement.weight || 3);
    const brightness = Number(achievement.brightness || achievement.weight || 3);
    const core = 2 + size * 1.9;
    const glow = 8 + brightness * 10;
    const brightAlpha = brightness / 5;
    button.type = 'button';
    button.className = `achievement-star${achievement.id === selectedId ? ' active' : ''}`;
    button.style.left = `${achievement.x}%`;
    button.style.top = `${achievement.y}%`;
    button.style.setProperty('--core', core.toFixed(1));
    button.style.setProperty('--glow', glow.toFixed(1));
    button.style.setProperty('--bright-alpha', brightAlpha.toFixed(2));
    button.style.setProperty('--delay', Math.random().toFixed(2));
    button.setAttribute('aria-label', `查看收获：${achievement.title}`);
    button.addEventListener('click', () => selectAchievement(achievement.id));
    elements.achievementLayer.appendChild(button);
    if (achievement.id === newId) newButton = button;
  });

  if (newButton) flyInNewStar(newButton);
}

/* ── 新星注入：流星划入（定稿）
   一颗带拖尾的流星从随机方位划过夜空，落到新星该在的位置，
   落点一记光爆，随后真正的星浮现 + 星光叮响。
   方向随机但排除「从上方进来」（行进方向 sin<=0 → 出发点不在落点上方）。 */
function flyInNewStar(button) {
  if (typeof gsap === 'undefined') return;
  const layer = elements.achievementLayer;
  // 立即藏起真正的星，避免等待期间闪现
  gsap.set(button, { opacity: 0, scale: 0.2 });
  // 录入窗口期间整个场景被 display:none（防卡顿），此刻画布尺寸为 0 →
  // 必须等场景恢复显示、画布有了真实尺寸再开跑，否则坐标全算成 (0,0) 卡左上角
  let tries = 0;
  const launch = () => {
    const rect = layer.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      if (tries++ < 40) { requestAnimationFrame(launch); return; }
      gsap.set(button, { opacity: 1, scale: 1 });   // 兜底：画布始终拿不到尺寸就直接显示星
      return;
    }
    runMeteorFlyIn(button, layer, rect);
  };
  launch();
}

function runMeteorFlyIn(button, layer, rect) {
  // 落点（button 在 layer 内的目标中心）
  const tx = parseFloat(button.style.left) / 100 * rect.width;
  const ty = parseFloat(button.style.top)  / 100 * rect.height;

  // 随机方向，排除从上方：行进方向角 180°~360°（sin<=0）→ 出发点在两侧/下方
  const deg = Math.round(gsap.utils.random(180, 360));
  const ang = deg * Math.PI / 180;
  const reach = Math.hypot(rect.width, rect.height) * 0.55;
  const sx = tx - Math.cos(ang) * reach;
  const sy = ty - Math.sin(ang) * reach;

  const TRAIL = 160, HEAD = 12, DUR = 1.05;

  // 造流星：头 + 拖尾
  const meteor = document.createElement('div');
  meteor.className = 'star-meteor';
  const head = document.createElement('div');
  head.className = 'm-head';
  head.style.width = HEAD + 'px'; head.style.height = HEAD + 'px';
  head.style.boxShadow = `0 0 ${HEAD * 1.4}px rgba(255,246,214,0.9), 0 0 ${HEAD * 3}px rgba(255,216,130,0.5)`;
  const trail = document.createElement('div');
  trail.className = 'm-trail';
  trail.style.width = TRAIL + 'px';
  meteor.appendChild(trail); meteor.appendChild(head);
  layer.appendChild(meteor);

  // 飞行期间先藏起真正的星
  gsap.set(button, { opacity: 0, scale: 0.2 });
  gsap.set(meteor, { x: sx, y: sy, rotation: deg, transformOrigin: '0px 0px', opacity: 1 });
  gsap.set(trail, { scaleX: 1, opacity: 0.95 });

  const tl = gsap.timeline({
    onComplete: () => {
      meteor.remove();
      // 真正的星浮现 + 叮响
      gsap.fromTo(button, { opacity: 0, scale: 0.2 }, { opacity: 1, scale: 1, duration: 0.42, ease: 'back.out(2)' });
      if (window.MS_SOUND && MS_SOUND.play) MS_SOUND.play('twinkle');
    }
  });
  // 主体划向落点
  tl.to(meteor, { x: tx, y: ty, duration: DUR, ease: 'power3.out' }, 0);
  // 尾巴最后收进落点
  tl.to(trail, { scaleX: 0.15, opacity: 0.3, duration: DUR * 0.32, ease: 'power2.out' }, DUR * 0.68);
  // 落点光爆
  tl.add(() => {
    const b = document.createElement('div');
    b.className = 'star-burst';
    b.style.left = tx + 'px'; b.style.top = ty + 'px';
    layer.appendChild(b);
    gsap.fromTo(b, { scale: 0.3, opacity: 0.7 }, { scale: 3.2, opacity: 0, duration: 0.6, ease: 'power2.out', onComplete: () => b.remove() });
  }, DUR * 0.92);
}

function selectNearestStar(event) {
  if (!achievements.length) return;

  const bounds = elements.achievementLayer.getBoundingClientRect();
  const pointer = {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
  const nearest = achievements.reduce((closest, achievement) => {
    const size = Number(achievement.size || achievement.weight || 3);
    const brightness = Number(achievement.brightness || achievement.weight || 3);
    const star = {
      x: bounds.width * achievement.x / 100,
      y: bounds.height * achievement.y / 100,
    };
    const distance = Math.hypot(pointer.x - star.x, pointer.y - star.y);
    const radius = 9 + size * 1.4 + brightness * 1.2;
    if (!closest || distance < closest.distance) {
      return { achievement, distance, radius };
    }
    return closest;
  }, null);

  if (nearest && nearest.distance <= nearest.radius) {
    selectAchievement(nearest.achievement.id);
  }
}

function selectAchievement(id) {
  const rec = achievements.find(item => item.id === id);
  if (!rec) return;
  openStarCard(rec);
}

// 按「有无文字 / 媒体类型 / 横竖」拼出对应版式（图与视频共用版式）
function buildStarCard(rec, media, hasText, vertical) {
  const dateStr = escHtml(rec.date || '');
  const textStr = escHtml(rec.text || '');
  const isVideo = media.kind === 'video';
  const acts = `<button class="rc-edit" type="button" data-act="edit">编辑</button><button class="rc-del" type="button" data-act="del">熄灭</button>`;
  const foot = `<div class="rc-foot"><span class="rc-date">${dateStr}</span><div class="rc-acts">${acts}</div></div>`;
  const body = `<div class="rc-body"><div class="rc-text">${textStr}</div></div>`;
  const badge = isVideo ? `<span class="rc-badge">${RC_VIDICON} 视频</span>` : '';
  const play  = isVideo ? `<button class="rc-play" type="button" data-act="play">${RC_PLAY}</button>` : '';
  const mEl = isVideo
    ? `<video src="${media.src}" preload="metadata" playsinline></video>`
    : `<img src="${media.src}" alt="">`;
  const mediaIn   = (o) => `<div class="rc-media ${o}">${mEl}${play}${badge}</div>`;                 // 图/视频 + 文：媒体干净
  const mediaOnly = (o) => `<div class="rc-media ${o}">${mEl}${play}<div class="grad"></div><span class="rc-on-date">${dateStr}</span><div class="rc-on-acts">${acts}</div>${badge}</div>`;

  let cls, html;
  if (media.kind && hasText && vertical)  { cls = 'rc--text-media-v'; html = mediaIn('v') + `<div class="rc-right">${body}${foot}</div>`; }
  else if (media.kind && hasText)         { cls = 'rc--text-media-h'; html = mediaIn('h') + body + foot; }
  else if (media.kind && vertical)        { cls = 'rc--media-v';      html = mediaOnly('v'); }
  else if (media.kind)                    { cls = 'rc--media-h';      html = mediaOnly('h'); }
  else                                    { cls = 'rc--text';         html = body + foot; }
  rcard.className = 'rcard ' + cls;
  rcInner.innerHTML = html;
}

function openStarCard(rec) {
  // 始终按 id 取最新数据（星星 DOM 会被复用，闭包里的 rec 可能是编辑前的旧对象）
  rec = achievements.find(a => a.id === rec.id) || rec;
  _currentCardRec = rec;
  selectedId = rec.id;
  const media = starryMedia(rec);
  const hasText = (rec.text || '').trim().length > 0;
  const finish = (vertical) => { buildStarCard(rec, media, hasText, vertical); showStarCard(); };
  if (media.kind === 'image') {
    if (typeof rec._mVertical === 'boolean') return finish(rec._mVertical);
    const probe = new Image();
    probe.onload  = () => { rec._mVertical = probe.naturalHeight > probe.naturalWidth * 1.05; finish(rec._mVertical); };
    probe.onerror = () => finish(false);
    probe.src = media.src;
  } else if (media.kind === 'video') {
    if (typeof rec._mVertical === 'boolean') return finish(rec._mVertical);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { rec._mVertical = v.videoHeight > v.videoWidth * 1.05; finish(rec._mVertical); };
    v.onerror = () => finish(false);
    v.src = media.src;
  } else {
    finish(false);
  }
}

function showStarCard() {
  rcard.classList.add('show');
  document.body.classList.add('modal-open');
  renderAchievements();
}

function stopRcardMedia() {
  if (rcard) rcard.querySelectorAll('video, audio').forEach(m => { try { m.pause(); } catch (_) {} });
}
function closeCard() {
  selectedId = null;
  _currentCardRec = null;
  stopRcardMedia(); // 关闭弹窗时停住视频，否则关掉后仍在后台继续播
  rcard.classList.remove('show');
  // ms-composer 关时自己会处理 modal-open；这里只在弹窗单独关时清掉
  if (!document.body.classList.contains('starry-composer-open') &&
      !document.body.classList.contains('ms-composer-open')) {
    document.body.classList.remove('modal-open');
  }
  renderAchievements();
}

function doDeleteStar(rec) {
  if (!rec) return;
  const del = () => {
    // 有盘时把这颗星涉及的真文件挪进回收站（无盘为 no-op）
    const s = msStore();
    if (s && s.trashRecordMedia) {
      try { s.trashRecordMedia(rec, { mediaFields: STARRY_MEDIA_FIELDS, planetKey: STARRY_PLANET_KEY }); }
      catch (err) { console.warn('[starry] 熄灭时 trash 失败：', err); }
    }
    if (s && s.trashRecord) { try { s.trashRecord(STARRY_PLANET_KEY, rec); } catch (_) {} } // 整条进回收站（STORE-006d）
    achievements = achievements.filter(item => item.id !== rec.id);
    selectedId = null;
    _currentCardRec = null;
    saveAchievements();
    rcard.classList.remove('show');
    document.body.classList.remove('modal-open');
    renderAchievements();
  };
  if (typeof window.msConfirm === 'function') {
    window.msConfirm('熄灭这颗星？', { yes: '熄灭', no: '保留', danger: true })
      .then(ok => { if (ok) del(); });
  } else {
    del();
  }
}

// 弹窗内操作：改 / 熄灭 / 播放（事件委托）
rcard.addEventListener('click', e => {
  const actEl = e.target.closest('[data-act]');
  if (!actEl) return;
  e.stopPropagation();
  const rec = _currentCardRec;
  if (!rec) return;
  const act = actEl.dataset.act;
  if (act === 'play') {
    const wrap = actEl.closest('.rc-media');
    const vid = wrap && wrap.querySelector('video');
    if (vid) { wrap.classList.add('playing'); vid.controls = true; vid.play().catch(() => {}); }
  } else if (act === 'edit') {
    closeCard();
    const idx = achievements.findIndex(a => a.id === rec.id);
    if (window.MS && MS.composer) MS.composer.open(idx >= 0 ? idx : -1);
  } else if (act === 'del') {
    doDeleteStar(rec);
  }
});
const rcardX = document.getElementById('rcard-x');
if (rcardX) rcardX.addEventListener('click', closeCard);

let _editingAchievementId = null;
// 添加界面：交给 ms-composer 统一渲染
function _bootStarryComposer() {
  if (!window.MS || !MS.composer) { setTimeout(_bootStarryComposer, 60); return; }
  // 大小 + 亮度两个滑动条（无级：可在任意区间停留，不再卡 5 档）
  const extraHTML = `
    <div class="msc-slider-group">
      <div class="msc-slider-row">
        <span class="msc-extra-label">大小</span>
        <input class="msc-slider" data-msc-slider="size" type="range" min="1" max="5" step="any" value="3">
        <span class="msc-slider-val" data-msc-slider-val="size">3.0</span>
      </div>
      <div class="msc-slider-row">
        <span class="msc-extra-label">亮度</span>
        <input class="msc-slider" data-msc-slider="brightness" type="range" min="1" max="5" step="any" value="3">
        <span class="msc-slider-val" data-msc-slider-val="brightness">3.0</span>
      </div>
    </div>
  `;
  MS.composer.init({
    planet: 'starry',
    storageKey: storageKey,
    capabilities: { image: true, video: true, audio: false },
    textareaPlaceholder: '这一次，你做到了什么……',
    textareaMaxLength: 150,
    extraHTML,
    extraInit: (extraEl, editingRec) => {
      const wireSlider = (key) => {
        const slider = extraEl.querySelector(`[data-msc-slider="${key}"]`);
        const valEl = extraEl.querySelector(`[data-msc-slider-val="${key}"]`);
        // 编辑时取原值（任意小数，夹到 1~5），新建默认 3
        const raw = Number(editingRec?.[key]);
        const init = (editingRec && raw >= 1 && raw <= 5) ? raw : 3;
        slider.value = String(init);
        if (valEl) valEl.textContent = init.toFixed(1);
        slider.addEventListener('input', () => {
          if (valEl) valEl.textContent = Number(slider.value).toFixed(1);
        });
      };
      wireSlider('size');
      wireSlider('brightness');
    },
    extraGet: (extraEl) => {
      const sizeS = extraEl.querySelector('[data-msc-slider="size"]');
      const briS = extraEl.querySelector('[data-msc-slider="brightness"]');
      // 无级取值：保留 2 位小数，避免存超长浮点
      const round2 = (v) => Math.round(v * 100) / 100;
      return {
        size: sizeS ? round2(parseFloat(sizeS.value)) : 3,
        brightness: briS ? round2(parseFloat(briS.value)) : 3,
      };
    },
    onOpened: () => {
      document.body.classList.add('starry-composer-open');
      document.body.classList.add('modal-open');
      try { rcard.classList.remove('show'); } catch (_) {}
      // 直接把繁星交互页主体 display:none — 浏览器完全不计算这部分任何 layout/paint
      // textarea 输入触发的 reflow 绝对不会涉及任何星星 DOM
      try { document.querySelector('main.star-page').style.display = 'none'; } catch (_) {}
    },
    onClosed: () => {
      document.body.classList.remove('starry-composer-open');
      document.body.classList.remove('modal-open');
      try { document.querySelector('main.star-page').style.display = ''; } catch (_) {}
    },
    beforeSave: async (payload, editingIdx) => {
      // 不动 ms-composer 已经算好的 type（'text' / 'image-text-h' / 'video-text-h'）
      // 否则 V2 列表卡片走错模板（只显示图不显示文）
      // 繁星交互页只用 src 字段判断有没有媒体，不依赖 type
      payload.src = payload.video || payload.image || null;
      if (editingIdx == null) {
        payload.id = `star-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        payload.date = formatToday();
        const pos = getNewStarPosition();
        payload.x = pos.x;
        payload.y = pos.y;
      }

      // ── 媒体走真文件存储（仅在有盘时；无盘保持 base64 老行为）──
      const kind = payload.video ? 'video' : (payload.image ? 'image' : null);
      const baseSrc = payload.video || payload.image || '';
      const s = msStore();
      if (kind && baseSrc && s && s.hasBackend && s.hasBackend()) {
        // 画质优化：图片若用户本次新选了原 File（imageFiles[0]），优先用原 File 落盘（不压缩）
        const hasNewImageFile = kind === 'image' && payload.imageFiles && payload.imageFiles[0];
        const source = hasNewImageFile ? payload.imageFiles[0] : baseSrc;
        try {
          const { ref, wroteFile } = await s.putMedia({
            planetKey: STARRY_PLANET_KEY,
            id: payload.id,
            kind,
            dateStr: payload.date || formatToday(),
            source,
          });
          if (wroteFile) {
            // 真写了文件：相关媒体字段换成 fsa: 引用，其它媒体字段清空，
            // 避免大 base64 仍被写进 localStorage（视频尤其会撑爆）。
            payload.src = ref;
            payload.image = kind === 'image' ? ref : '';
            payload.images = kind === 'image' ? [ref] : [];
            payload.video = kind === 'video' ? ref : '';
          }
          // 非 wroteFile（写盘失败兜底）：保持原 base64，不动其它字段
        } catch (err) {
          console.warn('[starry] putMedia 失败，保留 base64：', err);
        }
      }

      // 临时字段：原 File 数组不可 JSON 化，绝不能进 localStorage
      delete payload.imageFiles;
      return payload;
    },
    beforeDelete: async (removedRecord) => {
      // 共用 ms-composer 删除入口（V2 列表里编辑删除）：把真文件挪进回收站。
      // 无盘 / base64 时为 no-op。
      const s = msStore();
      if (s && s.trashRecordMedia) {
        await s.trashRecordMedia(removedRecord, {
          mediaFields: STARRY_MEDIA_FIELDS,
          planetKey: STARRY_PLANET_KEY,
        });
      }
    },
    onSaved: (payload, editingIdx) => {
      // 重读 + 重渲（新建带飞入动画）
      selectedId = payload.id;
      syncRecordsFile(); // 录入主路径在此建库：此刻 composer 已写好 localStorage（STORE-006）
      const afterLoad = (list) => {
        achievements = list;
        if (editingIdx == null) {
          renderAchievements(payload.id);
          if (window.msToast) window.msToast('记下了');
        } else {
          renderAchievements();
          setTimeout(() => selectAchievement(payload.id), 200);
        }
      };
      // 无盘：同步老路径，行为完全不变。有盘：先水合 fsa: 引用再渲染。
      if (msHasBackend()) {
        loadHydratedAchievements().then(afterLoad).catch(() => afterLoad(loadAchievements()));
      } else {
        afterLoad(loadAchievements());
      }
    },
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bootStarryComposer);
else _bootStarryComposer();

// 父 App 列表删除/编辑后同步：重读 + 重渲所有 achievement 星（C4）
window.__msReloadAll = function() {
  syncRecordsFile(); // 父级列表删除/编辑后同步 records.json（STORE-006）
  const apply = (list) => {
    achievements = list;
    if (selectedId && !achievements.some(a => a.id === selectedId)) selectedId = null;
    renderAchievements();
  };
  if (msHasBackend()) {
    loadHydratedAchievements().then(apply).catch(() => apply(loadAchievements()));
  } else {
    apply(loadAchievements());
  }
};

// STORE-008：定稿参数 —— 夜空最多同时显示「最新 180 颗」，星星之间最小间距 2（画面%）。
const DISPLAY_MAX = 180;
const STAR_MIN_GAP = 2;
// 取最新 N 颗用于显示：新星 id 形如 star-<13位时间戳>，据此稳定排序（无时间戳的初始星算最旧）。
function newestForDisplay(list) {
  const tsOf = (a) => { const m = /(\d{10,})/.exec(a && a.id || ''); return m ? Number(m[1]) : 0; };
  return [...list].sort((a, b) => tsOf(b) - tsOf(a)).slice(0, DISPLAY_MAX);
}

// STORE-008：点是否在多边形内（射线法），坐标都用画面百分比。
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// STORE-008：星星出现范围（用户用「画范围」工具圈定，2026-06-05 定稿）。坐标为画面百分比。
const DEFAULT_STAR_ZONE = [
  {x:1.7,y:13.7},{x:1.5,y:17.1},{x:1.4,y:24.3},{x:1,y:32.3},{x:0.9,y:44.3},{x:0.8,y:56.2},
  {x:1.2,y:66.6},{x:3.5,y:66.5},{x:7.3,y:65.7},{x:10.5,y:68.9},{x:18.3,y:70.6},{x:26.3,y:69.9},
  {x:30.9,y:71.3},{x:35.8,y:69.5},{x:40.5,y:69.3},{x:47.3,y:67.7},{x:53.6,y:64.8},{x:62.4,y:60.9},
  {x:71.5,y:60.4},{x:78.5,y:61.3},{x:84.7,y:58.8},{x:92,y:56.2},{x:97.5,y:54.7},{x:99.2,y:45.2},
  {x:98.4,y:33.3},{x:95.6,y:27.9},{x:93.4,y:21.6},{x:92.2,y:12.8},{x:91.5,y:3.8},{x:75.6,y:4.3},
  {x:73.9,y:10.3},{x:64.1,y:7.8},{x:62.5,y:3.1},{x:40.3,y:4.3},{x:31.3,y:5.4},{x:25.4,y:12.2},{x:19.7,y:16.1},
];

// STORE-008：星星落点 —— 只在出现范围多边形内随机取点。
function randomStarPos() {
  const zone = DEFAULT_STAR_ZONE;
  if (zone && zone.length >= 3) {
    const xs = zone.map(p => p.x), ys = zone.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    for (let i = 0; i < 80; i += 1) {
      const x = randomBetween(minX, maxX), y = randomBetween(minY, maxY);
      if (pointInPoly(x, y, zone)) return { x, y };
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }
  let x, y, guard = 0;
  do {
    x = randomBetween(7, 93);
    y = randomBetween(10, 90);
    guard += 1;
  } while (guard < 40 && x < 38 && y < 62); // 落在左上角介绍卡区域则重摇
  return { x, y };
}

function getNewStarPosition() {
  let best = null;
  let bestDistance = -1;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = randomStarPos();
    const nearest = achievements.length
      ? Math.min(...achievements.map(item => getStarDistance(candidate, item)))
      : Infinity;

    if (nearest >= STAR_MIN_GAP) return candidate;
    if (nearest > bestDistance) {
      best = candidate;
      bestDistance = nearest;
    }
  }

  return best || randomStarPos();
}

// addAchievement / readSelectedMedia 已下线：录入走 ms-composer，写入交给 onSaved（重读 + 重渲）
function initEvents() {
  elements.achievementLayer.addEventListener('click', selectNearestStar);
  elements.floatingAdd.addEventListener('click', () => {
    if (window.MS && MS.composer) MS.composer.open();
  });

  // 点遮罩关 achievement-card（ms-composer 自己管自己的 backdrop）
  const backdrop = document.getElementById('backdrop');
  if (backdrop) backdrop.addEventListener('click', () => {
    closeCard();
  });

  // hint-row: 收起卡片（body 同步切类，让模态对齐）
  document.querySelectorAll('.hint-row').forEach(row => {
    row.addEventListener('click', e => {
      e.stopPropagation();
      row.closest('.intro-card').classList.add('collapsed');
      document.body.classList.add('card-collapsed');
    });
  });
  document.querySelectorAll('.intro-card').forEach(card => {
    card.addEventListener('click', () => {
      if (card.classList.contains('collapsed')) {
        card.classList.remove('collapsed');
        document.body.classList.remove('card-collapsed');
      }
    });
  });
  // 关闭/删除按钮现在由 rcard 内部事件委托处理（见 openStarCard 区域）

  // ESC 关 card（ms-composer 自己处理自己的 ESC）
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeCard();
  });
}

/* ── 卡片入场动画（标题逐字浮现） ── */
function animateCardEntrance() {
  if (typeof gsap === 'undefined') return;
  const card = document.querySelector('.intro-card');
  if (!card) return;

  const nameEl  = card.querySelector('h1, .p-name');
  const eyebrow = card.querySelector('.p-eyebrow, .eyebrow');
  const story   = card.querySelector('.p-story, .story');
  const orb     = card.querySelector('.planet-orb');
  const hint    = card.querySelector('.hint-row');

  let chars = [];
  if (nameEl) {
    const text = nameEl.textContent;
    nameEl.innerHTML = '';
    for (const ch of text) {
      const span = document.createElement('span');
      span.textContent = ch;
      span.style.display = 'inline-block';
      nameEl.appendChild(span);
      chars.push(span);
    }
  }

  if (orb)     gsap.set(orb,     { autoAlpha: 0, scale: 0.88 });
  if (eyebrow) gsap.set(eyebrow, { autoAlpha: 0, y: -4 });
  if (chars.length) gsap.set(chars, { autoAlpha: 0, y: 14, filter: 'blur(8px)' });
  if (story)   gsap.set(story,   { autoAlpha: 0, y: 6 });
  if (hint)    gsap.set(hint,    { autoAlpha: 0 });

  const tl = gsap.timeline({ delay: 0.25 });
  if (orb)     tl.to(orb, { autoAlpha: 1, scale: 1, duration: 1.0, ease: 'power2.out' });
  if (eyebrow) tl.to(eyebrow, { autoAlpha: 0.45, y: 0, duration: 0.5, ease: 'power2.out' }, '-=0.55');
  if (chars.length) tl.to(chars, {
    autoAlpha: 1, y: 0, filter: 'blur(0px)',
    duration: 0.6, ease: 'power2.out', stagger: 0.06
  }, '-=0.30');
  if (story)   tl.to(story, { autoAlpha: 0.72, y: 0, duration: 0.7, ease: 'power2.out' }, '-=0.35');
  if (hint)    tl.to(hint,  { autoAlpha: 0.72, duration: 0.4, ease: 'power2.out' }, '-=0.45');
}

function init() {
  // 初始化分叉：
  //   无盘（开发期默认）：同步 render，行为与改造前逐像素一致，零新增 await/渲染。
  //   有盘：先水合 fsa: 引用再 render；水合失败已在 loadHydratedAchievements 内降级。
  if (msHasBackend()) {
    restoreFromDisk()
      .then(() => loadHydratedAchievements())
      .then(list => { achievements = list; renderAchievements(); })
      .catch(() => { renderAchievements(); });
  } else {
    renderAchievements();
  }
  initEvents();
  animateCardEntrance();
}

// 监听 U盘目录句柄：父级打开 iframe 时通过 postMessage 传来。
// 收到后重新水合 records + 重新渲染（句柄可能在 init 之后才到）。
(function installFsaHandleListener() {
  const s = msStore();
  if (s && s.installHandleListener) {
    s.installHandleListener(() => {
      // 插盘真正发生在这里（句柄通常 init 之后才到）：先从 U盘恢复 + 合并，再水合重渲。
      restoreFromDisk()
        .then(() => loadHydratedAchievements())
        .then(list => {
          achievements = list;
          if (selectedId && !achievements.some(a => a.id === selectedId)) selectedId = null;
          renderAchievements();
        })
        .catch(() => {});
    });
  }
})();

init();

