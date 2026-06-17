const waveVariants = [
  {
    name: 'soft-left',
    d: 'M-160,-54 C-82,-64 -60,2 -22,76 C28,176 56,236 118,284 C184,336 278,342 376,356 C484,372 510,462 596,486 C688,512 760,506 830,514 C912,526 946,604 1038,636 C1128,668 1200,654 1260,668 C1316,684 1318,730 1372,748 C1446,774 1498,824 1570,856',
  },
  {
    name: 'diagonal-right',
    d: 'M-160,-24 C-92,-46 -56,28 -18,104 C34,206 82,260 148,306 C224,358 316,362 414,384 C520,410 548,488 640,514 C728,540 818,522 892,540 C976,562 1002,626 1092,660 C1186,696 1250,674 1308,698 C1364,724 1366,762 1424,786 C1484,812 1520,842 1570,868',
  },
  {
    name: 'middle-swell',
    d: 'M-160,-84 C-84,-96 -46,-8 -4,72 C52,178 88,236 170,288 C252,340 342,326 444,366 C556,410 578,502 690,520 C782,534 858,516 936,554 C1018,594 1040,652 1138,676 C1234,700 1288,688 1344,728 C1406,772 1480,812 1570,858',
  },
  {
    name: 'quiet-right',
    d: 'M-160,4 C-96,-20 -66,44 -28,118 C24,220 66,280 134,324 C204,370 302,374 402,394 C510,416 542,482 630,512 C720,542 792,532 870,546 C958,562 994,626 1080,654 C1172,684 1240,682 1302,704 C1364,728 1368,766 1426,790 C1488,816 1524,844 1570,870',
  },
];

const waveMotion = {
  restOffset: 80,
  stagedOffset: 100,
  coverOffset: -300,
  heavyCoverOffset: -340,
  retreatOffset: 92,
};

const starterRecords = [
  {
    id: 'demo-1',
    date: '05.08',
    weight: 2,
    text: '一些说不出口的小担心，先交给今天的海风。',
  },
  {
    id: 'demo-2',
    date: '05.13',
    weight: 4,
    text: '最近事情太多，脑子里总像有一团打不开的线。',
  },
  {
    id: 'demo-3',
    date: '05.18',
    weight: 3,
    text: '有些期待没有发生，所以心里一直有一点空。',
  },
  {
    id: 'demo-4',
    date: '今天',
    weight: 1,
    text: '现在我想把这件事放在沙滩上，让潮水慢慢带走。',
  },
];

const elements = {
  body: document.body,
  oceanGroup: document.getElementById('oceanGroup'),
  washMaskWave: document.getElementById('wash-mask-wave'),
  waterFill: document.getElementById('waterFill'),
  waterTextureFill: document.getElementById('waterTextureFill'),
  foamFill: document.getElementById('foamFill'),
  foamBubbles: document.getElementById('foamBubbles'),
  foamEdge: document.getElementById('foamEdge'),
  maskWave: document.querySelector('.mask-wave'),
  worrySvgText: document.querySelector('.worry-svg-text'),
  worryText: document.getElementById('worryText'),
  writeTrigger: document.getElementById('writeTrigger'),
  timelineNodes: document.getElementById('timelineNodes'),
};

const STORAGE_KEY = 'memory-sparks:sea-records';
// 启动迁移旧 key
(function() {
  try {
    if (!localStorage.getItem(STORAGE_KEY)) {
      const old = localStorage.getItem('seaStarWorries');
      if (old) localStorage.setItem(STORAGE_KEY, old);
    }
  } catch (_) {}
})();

// U盘建库（STORE-006）：海星文字记录（语音另算，mediaFields:[]）
function seaSyncFile() {
  const s = window.MS && window.MS.mediaStore;
  if (s && s.syncRecordsFromStorage) {
    s.syncRecordsFromStorage('sea', STORAGE_KEY, {
      meta: { name: '海星', keyword: '烦恼' }, mediaFields: ['audio'],
    }).catch(() => {});
  }
}
function seaRestoreFile() {
  const s = window.MS && window.MS.mediaStore;
  if (!s || !s.restoreToStorage) return Promise.resolve(false);
  return s.restoreToStorage('sea', STORAGE_KEY).then(restored => {
    if (restored) {
      try { window.parent && window.parent.postMessage({ type: 'memory-sparks:storage-changed', key: STORAGE_KEY }, '*'); } catch (_) {}
    }
    return restored;
  });
}

/* ══════════════════════════════════════════════
   IndexedDB 封装（音频文件存储）
   db: memory-sparks-audio  store: audio
   ══════════════════════════════════════════════ */
const AudioDB = (() => {
  const DB_NAME = 'memory-sparks-audio';
  const STORE   = 'audio';
  const VERSION = 1;
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess  = e => { _db = e.target.result; resolve(_db); };
      req.onerror    = e => reject(e.target.error);
    });
  }

  async function save(key, blob) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key, blob });
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function load(key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = e => resolve(e.target.result ? e.target.result.blob : null);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function remove(key) {
    try {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror    = e => reject(e.target.error);
      });
    } catch (_) {}
  }

  return { save, load, remove };
})();

function loadRecords() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

let records = loadRecords();
let activeId = records[records.length - 1]?.id;
let selectedWeight = 3;  // 重量字段已下线，固定值控制默认波浪强度
let activeTimers = [];

function saveRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  seaSyncFile();
}

function buildFillPath(waveD) {
  return `${waveD} L1570,1600 L-160,1600 Z`;
}

function buildFoamPath(waveD) {
  return `${waveD} L1570,900 C1462,858 1400,812 1326,790 C1260,770 1240,736 1176,718 C1072,688 1022,690 928,646 C836,604 772,582 676,578 C566,574 532,520 450,492 C350,460 278,446 182,402 C88,358 34,292 -28,182 C-70,108 -110,42 -160,22 Z`;
}

function setWave(variant) {
  const fillPath = buildFillPath(variant.d);
  elements.waterFill.setAttribute('d', fillPath);
  elements.waterTextureFill.setAttribute('d', fillPath);
  // elements.maskWave 不再更新：mask 已移除，无需维护
  elements.foamEdge.setAttribute('d', variant.d);
  elements.foamBubbles.setAttribute('d', variant.d);
  elements.foamFill.setAttribute('d', buildFoamPath(variant.d));
}

function getWaveByWeight(weight) {
  if (weight >= 5) return waveVariants[2];
  if (weight >= 4) return waveVariants[1];
  if (weight >= 3) return waveVariants[3];
  return waveVariants[0];
}

function setOceanOffset(offset, duration = 0) {
  const transition = duration ? `transform ${duration}ms cubic-bezier(0.22, 0.72, 0.18, 1)` : 'none';
  elements.oceanGroup.style.transition = transition;
  elements.oceanGroup.style.transform = `translateY(${offset}px)`;
  // washMaskWave 不再随 ocean 移动：mask 已从 worry-svg-text 移除，消除每帧 mask 重算
}

function queueStep(callback, delay) {
  const timer = window.setTimeout(callback, delay);
  activeTimers.push(timer);
  return timer;
}

function clearWashTimers() {
  activeTimers.forEach(timer => window.clearTimeout(timer));
  activeTimers = [];
}

function renderTimeline() {
  elements.timelineNodes.innerHTML = '';
  // 语音和文字同级，都算可加载内容，一起上时间线气泡（点文字洗上沙滩 / 点语音海面重播）
  // records 约定：新记录插在开头（新→旧），取开头 7 条 = 最新 7 条，渲染后最左即最新
  const latest = records.slice(0, 7);

  latest.forEach(record => {
    const item = document.createElement('div');
    item.className = `timeline-node${record.id === activeId ? ' active' : ''}`;
    item.style.position = 'relative';

    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', `重播 ${record.date} 的烦恼`);
    button.addEventListener('click', () => replayRecord(record.id));

    const label = document.createElement('span');
    label.textContent = record.date;

    // 长按 600ms 删除（绕过 sprite 没空间放 X 的限制）
    let pressTimer = null;
    const startPress = () => {
      pressTimer = setTimeout(async () => {
        pressTimer = null;
        const ok = typeof window.msConfirm === 'function'
          ? await window.msConfirm('让海水彻底带走这条烦恼？', { yes: '带走', no: '保留', danger: true })
          : window.confirm('删除这条烦恼？');
        if (!ok) return;
        { const s = window.MS && window.MS.mediaStore;
          if (s && record) {
            try { if (s.trashRecord) s.trashRecord('sea', record); } catch (_) {}
            try { if (s.trashRecordMedia) s.trashRecordMedia(record, { planetKey: 'sea' }); } catch (_) {}
          }
        } // 整条进回收站 + 语音真文件进回收站（STORE-005/006d）
        records = records.filter(r => r.id !== record.id);
        saveRecords();
        if (activeId === record.id) activeId = null;
        renderTimeline();
      }, 600);
    };
    const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
    button.addEventListener('mousedown', startPress);
    button.addEventListener('touchstart', startPress, { passive: true });
    button.addEventListener('mouseup', cancelPress);
    button.addEventListener('mouseleave', cancelPress);
    button.addEventListener('touchend', cancelPress);
    button.addEventListener('touchcancel', cancelPress);

    item.append(button, label);
    elements.timelineNodes.appendChild(item);
  });
}

function formatToday() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
}

function setText(text) {
  elements.worryText.textContent = text;
  // STORE-008：沙滩上的字——单行居中；多行整块仍居中、每行左对齐（块绝对居中，不会左飘）。
  const el = elements.worryText;
  el.style.fontSize = ''; // 先复位到 CSS 基准字号，再按需缩小
  const r = document.createRange(); r.selectNodeContents(el);
  el.style.textAlign = r.getClientRects().length > 1 ? 'left' : 'center';
  // 自动缩字号：让旋转 20° 后的文字块不超出 foreignObject(880×480)，长文字也不会被裁切
  const FO_W = 880, FO_H = 480;
  const rad = 20 * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
  let size = parseFloat(getComputedStyle(el).fontSize) || 40;
  for (let i = 0; i < 40 && size > 14; i += 1) {
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w * c + h * s <= FO_W && w * s + h * c <= FO_H) break;
    size -= 2;
    el.style.fontSize = size + 'px';
  }
}

/* ── GSAP 字符冲散 ──
   把烦恼文字打散成单字符，海水退潮时让字符被水"带走"：
   随机方向下沉 + 旋转 + 淡出，从中间向两侧分批离开。*/
function splitWorryChars() {
  const el = elements.worryText;
  const text = el.textContent;
  el.innerHTML = '';
  const chars = [];
  for (const ch of text) {
    const span = document.createElement('span');
    span.textContent = ch;
    span.style.display = 'inline-block';
    if (ch === ' ') span.style.width = '0.3em';
    el.appendChild(span);
    if (ch.trim()) chars.push(span);
  }
  return chars;
}

function washTextAway() {
  const chars = splitWorryChars();
  if (!chars.length || typeof gsap === 'undefined') return;
  gsap.set(chars, { transformOrigin: 'center', willChange: 'transform, opacity' });
  gsap.to(chars, {
    y: () => gsap.utils.random(70, 200),
    x: () => gsap.utils.random(-60, 110),
    rotation: () => gsap.utils.random(-50, 50),
    opacity: 0,
    duration: 1.3,
    ease: 'power2.in',
    stagger: { each: 0.02, from: 'random' }
  });
}

function playWash(record) {
  clearWashTimers();
  activeId = record.id;
  renderTimeline();

  elements.body.classList.add('is-washing');
  elements.worrySvgText.classList.remove('is-covered');
  setWave(getWaveByWeight(record.weight));

  // 文字浮现：先隐藏，设完文字再整体淡入（沙面渗出感）
  if (typeof gsap !== 'undefined') gsap.set(elements.worryText, { opacity: 0 });
  setText(record.text || '');
  if (typeof gsap !== 'undefined') {
    gsap.to(elements.worryText, { opacity: 1, duration: 1.5, ease: 'power1.inOut' });
  }

  setOceanOffset(waveMotion.stagedOffset, 0);

  const waitBeforeSurge = 850;
  const surgeDuration = 3300 + record.weight * 260;
  const coverHold = 760;
  const retreatDuration = 1700;
  const cleanDelay = 1900;
  const coverOffset = record.weight >= 4 ? waveMotion.heavyCoverOffset : waveMotion.coverOffset;

  queueStep(() => {
    setOceanOffset(coverOffset, surgeDuration);
    // 交互层：海水涌上沙滩这一刻，叠加一记冲沙音（受静音控制）
    if (window.MS_SOUND && MS_SOUND.wash) MS_SOUND.wash();
  }, waitBeforeSurge);

  queueStep(() => {
    elements.worrySvgText.classList.add('is-covered');
  }, waitBeforeSurge + surgeDuration - 520);

  queueStep(() => {
    washTextAway();
    setOceanOffset(waveMotion.retreatOffset, retreatDuration);
  }, waitBeforeSurge + surgeDuration + coverHold);

  queueStep(() => {
    setText('');
    elements.worrySvgText.classList.remove('is-covered');
    elements.body.classList.remove('is-washing');
    setOceanOffset(waveMotion.restOffset, 1400);
  }, waitBeforeSurge + surgeDuration + coverHold + cleanDelay);
}

function replayRecord(id) {
  const record = records.find(item => item.id === id);
  if (!record) return;
  stopVoicePlayback(); // 切到任何一条都先停掉正在播的语音（声音 + 声纹）
  if (record.type === 'audio') { playVoiceOnBeach(record); return; } // 语音：海面重播（声纹+播放+海浪卷走）
  playWash(record);
}

// addRecord 已下线：录入走 ms-composer，写入交给 onSaved（重读 records + playWash）

// 添加界面：交给 ms-composer 统一渲染
function _bootSeaComposer() {
  if (!window.MS || !MS.composer) { setTimeout(_bootSeaComposer, 60); return; }
  MS.composer.init({
    planet: 'sea',
    storageKey: 'memory-sparks:sea-records',
    capabilities: { image: false, video: false, audio: false },
    textareaPlaceholder: '有什么烦恼，想说给大海听……',
    textareaMaxLength: 100,
    onOpened: () => {
      document.body.classList.add('modal-open');
      document.body.classList.add('ms-composer-open'); // 同步让 style.css 波浪暂停规则生效
    },
    onClosed: () => {
      document.body.classList.remove('modal-open');
      document.body.classList.remove('ms-composer-open');
    },
    beforeSave: (payload, editingIdx) => {
      if (editingIdx == null) {
        // 海星 record 字段：date 用 "MM.DD"、weight 默认 3（已下线但仍保留以驱动波浪强度）
        payload.date = formatToday();
        payload.weight = selectedWeight;
      }
      return payload;
    },
    onSaved: (payload, editingIdx) => {
      // 重读 records + 重渲
      records = loadRecords();
      activeId = payload.id;
      renderTimeline();
      renderHistory();
      // 新增模式才播洗去动画（编辑模式只更新文字）
      if (editingIdx == null) {
        try { playWash(payload); } catch (_) {}
      }
      seaSyncFile();
    },
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bootSeaComposer);
else _bootSeaComposer();

// 父 App 列表点 +/编辑触发
window.__msOpenComposer = function(editIdx) {
  if (!window.MS || !MS.composer) { setTimeout(() => window.__msOpenComposer(editIdx), 80); return; }
  MS.composer.open(typeof editIdx === 'number' && editIdx >= 0 ? editIdx : -1);
};

// 父 App 列表删除/编辑后同步：重读 storage + 重渲染交互页（C4 同步）
window.__msReloadAll = function() {
  records = loadRecords();
  if (activeId && !records.some(r => r.id === activeId)) {
    activeId = records.length ? records[records.length - 1].id : null;
  }
  renderTimeline();
  renderHistory();
  seaSyncFile();
};

function initEvents() {
  elements.writeTrigger.addEventListener('click', () => {
    if (window.MS && MS.composer) MS.composer.open();
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

  // ESC 关 composer 已由 ms-composer 自己处理
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

  // 把名字拆字符
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

  // 起始态
  if (orb)     gsap.set(orb,     { autoAlpha: 0, scale: 0.88 });
  if (eyebrow) gsap.set(eyebrow, { autoAlpha: 0, y: -4 });
  if (chars.length) gsap.set(chars, { autoAlpha: 0, y: 14, filter: 'blur(8px)' });
  if (story)   gsap.set(story,   { autoAlpha: 0, y: 6 });
  if (hint)    gsap.set(hint,    { autoAlpha: 0 });

  // 时间轴
  const tl = gsap.timeline({ delay: 0.25 });
  if (orb)     tl.to(orb, { autoAlpha: 1, scale: 1, duration: 1.0, ease: 'power2.out' });
  if (eyebrow) tl.to(eyebrow, { autoAlpha: 0.45, y: 0, duration: 0.5, ease: 'power2.out' }, '-=0.55');
  if (chars.length) tl.to(chars, {
    autoAlpha: 1, y: 0, filter: 'blur(0px)',
    duration: 0.6, ease: 'power2.out', stagger: 0.06
  }, '-=0.30');
  if (story)   tl.to(story, { autoAlpha: 0.72, y: 0, duration: 0.7, ease: 'power2.out' }, '-=0.35');
  if (hint)    tl.to(hint,  { autoAlpha: 0.52, duration: 0.4, ease: 'power2.out' }, '-=0.45');
}

function init() {
  setWave(waveVariants[1]);
  setOceanOffset(waveMotion.restOffset, 0);
  renderTimeline();
  initEvents();
  animateCardEntrance();

  // 进入页面沙滩留空，不自动重播上次内容
  setText('');
}

/* ── 历史 modal（参考被子星） ─────────────────────── */
const historyModal = document.getElementById('historyModal');
const historyList = document.getElementById('historyList');
const historyTitleEl = document.getElementById('historyTitle');
const backdropEl = document.getElementById('backdrop');

const HISTORY_MAX = 20;  // STORE-008：弹层只展示最近 20 条（全部内容仍在日志页）
function renderHistory() {
  historyTitleEl.textContent = `最近 ${Math.min(records.length, HISTORY_MAX)} 条烦恼`;
  if (records.length === 0) {
    historyList.innerHTML = '<div class="empty">还没有写下过烦恼</div>';
    return;
  }
  // records 最新在前 → 直接取前 20 条，最上面即最新
  const sorted = [...records].slice(0, HISTORY_MAX);
  historyList.innerHTML = sorted.map(r => {
    const isVoice = r.type === 'audio';
    const delBtn = `<button type="button" class="ms-card-del-btn" data-del-id="${r.id}" style="top:8px;right:8px;" title="带走">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
    </button>`;
    if (isVoice) {
      const durSec = r.duration != null ? Math.round(r.duration) : 0;
      const durLabel = durSec > 0 ? `${durSec} 秒` : '语音';
      return `<div class="item voice-record${r.id === activeId ? ' active' : ''}" data-id="${r.id}">
        <div class="date">${r.date}</div>
        <div class="content">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0014 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>
          <span class="voice-duration">${durLabel}</span>
          <button type="button" class="voice-play-btn" data-play-id="${r.id}" title="播放" aria-label="播放录音">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg>
          </button>
        </div>
        ${delBtn}
      </div>`;
    }
    return `<div class="item${r.id === activeId ? ' active' : ''}" data-id="${r.id}">
      <div class="date">${r.date}</div>
      <div class="content">${r.text.replace(/</g, '&lt;')}</div>
      ${delBtn}
    </div>`;
  }).join('');

  historyList.querySelectorAll('.item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.ms-card-del-btn')) return;
      if (e.target.closest('.voice-play-btn')) return;
      replayRecord(el.dataset.id);
      closeHistory();
    });
  });

  // 语音播放按钮：只播音频，不触发海浪动画
  historyList.querySelectorAll('.voice-play-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rid = btn.dataset.playId;
      const record = records.find(r => r.id === rid);
      // STORE-005：在交互页重播——收起历史面板，声纹随播放跳动，放完海浪卷走
      playVoiceOnBeach(record);
    });
  });

  historyList.querySelectorAll('.ms-card-del-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const rid = btn.dataset.delId;
      const record = records.find(r => r.id === rid);
      const ok = typeof window.msConfirm === 'function'
        ? await window.msConfirm('让海水彻底带走这条烦恼？', { yes: '带走', no: '保留', danger: true })
        : window.confirm('删除这条烦恼？');
      if (!ok) return;
      // 整条进回收站（文字）+ 语音真文件进回收站（STORE-005/006d）
      { const s = window.MS && window.MS.mediaStore;
        if (s && record) {
          try { if (s.trashRecord) s.trashRecord('sea', record); } catch (_) {}
          try { if (s.trashRecordMedia) s.trashRecordMedia(record, { planetKey: 'sea' }); } catch (_) {}
        }
      }
      records = records.filter(r => r.id !== rid);
      saveRecords();
      if (activeId === rid) activeId = null;
      renderTimeline();
      renderHistory();
    });
  });
}

function openHistory() {
  renderHistory();
  historyModal.classList.add('open');
  if (backdropEl) backdropEl.classList.add('open');
}
function closeHistory() {
  historyModal.classList.remove('open');
  // 关历史面板时停掉正在播的语音（否则切走后还在后台响）
  if (window._seaAudio) {
    try { window._seaAudio.el.pause(); URL.revokeObjectURL(window._seaAudio.url); } catch (_) {}
    window._seaAudio = null;
  }
  // ms-composer 由自身管理 backdrop，这里只在 history 单独关时清掉
  if (backdropEl) backdropEl.classList.remove('open');
}

document.getElementById('openHistory')?.addEventListener('click', openHistory);
document.getElementById('closeHistory')?.addEventListener('click', closeHistory);
backdropEl?.addEventListener('click', closeHistory);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && historyModal.classList.contains('open')) closeHistory();
});

// ── 声音对位工具用：外部触发一次冲洗动画（不写入数据） ──
// 暴露给 /tools/sea-audio-sync.html，让调音台能边看动画边对位音频
window.__msSeaDemoWash = function (weight) {
  playWash({ id: 'sync-demo', text: '这是一条用来对位的烦恼文字', weight: weight || 2 });
};
window.__msSeaTimings = {
  waitBeforeSurge: 850,     // 起步到海水涌起
  surgeBase: 3300,          // 涌起时长基数（实际 = surgeBase + weight*surgePerWeight）
  surgePerWeight: 260,
  coverHold: 760,           // 完全覆盖保持
  retreatDuration: 1700,    // 退潮时长
  cleanDelay: 1900,         // 退潮后到"沙滩变干净"
};

/* ══════════════════════════════════════════════
   沙滩声纹（SVG path，位置与 worry-text 对齐）
   ══════════════════════════════════════════════ */

// SVG viewBox 1440×900，文字区域：x=520 y=190 w=780 h=360，中心 y=370
const WAVE_X0 = 540, WAVE_X1 = 1280, WAVE_CY = 370, WAVE_MAX_AMP = 70;

let _sandWaveformCanvas = null; // 沿用变量名，值为 waveformPath 元素或 null

function createSandWaveformCanvas() {
  const pathEl = document.getElementById('waveformPath');
  _sandWaveformCanvas = pathEl || null;
  return pathEl;
}


function washWaveformAway() {
  const pathEl = document.getElementById('waveformPath');
  if (!pathEl || !pathEl.getAttribute('d')) return;
  if (typeof gsap !== 'undefined') {
    gsap.to(pathEl, {
      opacity: 0, duration: 1.4, ease: 'power2.in',
      onComplete: () => { pathEl.setAttribute('d', ''); _sandWaveformCanvas = null; }
    });
  } else {
    pathEl.setAttribute('d', '');
    pathEl.style.opacity = '0';
    _sandWaveformCanvas = null;
  }
}

/* ══════════════════════════════════════════════
   沙滩声纹 · 样式 B（单线，SVG path，大振幅）
   ══════════════════════════════════════════════ */
function drawSandWaveformStyleB(timeDomainData) {
  const pathEl = document.getElementById('waveformPath');
  if (!pathEl) return;

  const pts = timeDomainData ? timeDomainData.length : 80;
  let d = '';
  for (let i = 0; i < pts; i++) {
    const x = WAVE_X0 + (i / (pts - 1)) * (WAVE_X1 - WAVE_X0);
    let y;
    if (timeDomainData) {
      // 0-255，128=静音；放大 8 倍让轻声细语也明显
      const dev = (timeDomainData[i] - 128) / 128; // -1 ~ +1，静音 ≈ ±0.02
      const amp = Math.max(-1, Math.min(1, dev * 8));  // 8x 放大，限幅
      y = WAVE_CY + amp * WAVE_MAX_AMP;
    } else {
      // 冻结：轻微起伏静态线
      y = WAVE_CY + Math.sin(i * 0.25) * 14;
    }
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
  }
  pathEl.setAttribute('d', d.trim());
}

/* ══════════════════════════════════════════════
   STORE-005：声纹冻结 + 海浪卷走序列（录音完成 / 语音重播结束 共用）
   ══════════════════════════════════════════════ */
function runWashSequence() {
  drawSandWaveformStyleB(null); // 声纹冻结为静态
  clearWashTimers();
  elements.body.classList.add('is-washing');
  setWave(waveVariants[1]);
  setOceanOffset(waveMotion.stagedOffset, 0);
  const surge = 3560;
  queueStep(() => {
    setOceanOffset(waveMotion.coverOffset, surge);
    if (window.MS_SOUND && MS_SOUND.wash) MS_SOUND.wash();
    washWaveformAway(); // 海浪涌来，波形同步淡出
  }, 850);
  queueStep(() => {
    setOceanOffset(waveMotion.retreatOffset, 1700);
  }, 850 + surge + 760);
  queueStep(() => {
    elements.body.classList.remove('is-washing');
    setOceanOffset(waveMotion.restOffset, 1400);
  }, 850 + surge + 760 + 1900);
}

/* ══════════════════════════════════════════════
   STORE-005：在交互页「重播」一条已存语音
   声纹随播放中的音频实时跳动 → 放完 → 海浪卷走（复刻录音时的视听效果）
   ══════════════════════════════════════════════ */
let _voicePlayback = null; // { audio, ctx, rafId }

function stopVoicePlayback() {
  if (!_voicePlayback) return;
  const p = _voicePlayback;
  _voicePlayback = null;
  try { if (p.rafId) cancelAnimationFrame(p.rafId); } catch (_) {}
  try { p.audio.pause(); p.audio.src = ''; } catch (_) {}
  try { if (p.ctx) p.ctx.close(); } catch (_) {}
  const wf = document.getElementById('waveformPath'); // 停播即清掉沙滩上的声纹
  if (wf) { wf.setAttribute('d', ''); wf.style.opacity = '0'; }
}

async function playVoiceOnBeach(record) {
  if (!record || !record.audio) return;
  const s = window.MS && window.MS.mediaStore;
  const url = (s && s.resolveRef) ? await s.resolveRef(record.audio) : '';
  if (!url) { try { alert('录音文件已丢失，或 U 盘未连接'); } catch (_) {} return; }

  stopVoicePlayback();      // 停掉上一段
  closeHistory();           // 收起历史面板，露出海面
  activeId = record.id;     // 点谁谁高亮（深色），其余变浅——与文字气泡一致
  renderTimeline();

  // 清场：清掉沙滩上原有文字 + 中断进行中的海浪动画 + 海面拉回平静
  //（避免文字与声纹重叠、海浪盖住声纹——问题 1 & 3）
  clearWashTimers();
  elements.body.classList.remove('is-washing');
  setOceanOffset(waveMotion.restOffset, 400);
  if (typeof gsap !== 'undefined') {
    gsap.killTweensOf(elements.worryText);
    gsap.to(elements.worryText, { opacity: 0, duration: 0.4, ease: 'power1.in' });
  } else {
    elements.worryText.style.opacity = '0';
  }

  // 声纹淡入
  createSandWaveformCanvas();
  const pathEl = document.getElementById('waveformPath');
  if (pathEl) {
    pathEl.setAttribute('d', '');
    if (typeof gsap !== 'undefined') gsap.fromTo(pathEl, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power1.inOut' });
    else pathEl.style.opacity = '1';
  }

  const audio = new Audio(url);
  let ctx = null, analyser = null, buf = null;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const srcNode = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    srcNode.connect(analyser);
    analyser.connect(ctx.destination); // 必须接 destination，否则听不到声音
    buf = new Uint8Array(analyser.fftSize);
  } catch (err) {
    console.warn('[sea] 重播声纹分析初始化失败，降级纯播放：', err);
  }

  _voicePlayback = { audio, ctx, rafId: null };

  let lastMs = 0;
  function loop() {
    if (!_voicePlayback || _voicePlayback.audio !== audio) return;
    _voicePlayback.rafId = requestAnimationFrame(loop);
    const now = performance.now();
    if (now - lastMs < 33) return; // 30fps
    lastMs = now;
    if (analyser && buf) { analyser.getByteTimeDomainData(buf); drawSandWaveformStyleB(buf); }
  }

  audio.addEventListener('ended', () => {
    if (_voicePlayback && _voicePlayback.audio === audio) {
      if (_voicePlayback.rafId) cancelAnimationFrame(_voicePlayback.rafId);
      try { if (ctx) ctx.close(); } catch (_) {}
      _voicePlayback = null;
    }
    runWashSequence(); // 放完 → 海浪卷走声纹
  });

  try { await audio.play(); } catch (_) {}
  if (analyser) loop();
}

/* ══════════════════════════════════════════════
   录音模块（U盘模式存储 / 无盘纯体验）
   ══════════════════════════════════════════════ */
const VoiceRecorder = (() => {
  const MAX_DURATION = 60;

  let controlBar, startBtn, doneBtn, cancelBtn;
  let mediaRecorder = null;
  let chunks        = []; // STORE-005：录音数据块（有盘时合成 Blob 落盘）
  let recStartMs    = 0;  // 录音开始时间，用于算 duration
  let audioCtx      = null;
  let analyser      = null;
  let rafId         = null;
  let autoTimer     = null;
  let _barOpen      = false;
  let _recording    = false;

  /* ── 控制条开关 ── */
  function openBar() {
    if (_barOpen) return;
    _barOpen = true;
    controlBar = document.getElementById('voiceControlBar');
    startBtn   = document.getElementById('voiceStart');
    doneBtn    = document.getElementById('voiceDone');
    cancelBtn  = document.getElementById('voiceCancel');
    if (!controlBar) return;
    controlBar.classList.add('open');
    if (startBtn) startBtn.disabled = false;
    if (doneBtn)  doneBtn.disabled  = true;
    const t = document.getElementById('voiceTrigger');
    if (t) t.classList.add('active');
  }

  function closeBar() {
    _barOpen = false;
    if (controlBar) controlBar.classList.remove('open');
    const t = document.getElementById('voiceTrigger');
    if (t) { t.classList.remove('active'); t.classList.remove('recording'); }
  }

  /* ── RAF：沙滩波形实时更新（节流 30fps，足够跟声音，减少 SVG setAttribute 频率）── */
  let _lastDrawMs = 0;
  function rafLoop() {
    if (!analyser) return;
    rafId = requestAnimationFrame(rafLoop);
    const now = performance.now();
    if (now - _lastDrawMs < 33) return; // 30fps 上限
    _lastDrawMs = now;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    drawSandWaveformStyleB(buf);
  }

  /* ── 开始录制 ── */
  async function startRecording() {
    // 清除沙滩上的文字（录音时沙滩空白）+ 停掉可能在播的语音重播
    stopVoicePlayback();
    clearWashTimers();
    elements.body.classList.remove('is-washing');
    // 关键：把海面拉回平静位置——否则上一次「海浪卷走」动画还没退回时开始录音，
    // 海浪会停在盖住声纹的位置（问题1）。
    setOceanOffset(waveMotion.restOffset, 400);
    if (typeof gsap !== 'undefined') {
      gsap.killTweensOf(elements.worryText);
      gsap.to(elements.worryText, { opacity: 0, duration: 0.4, ease: 'power1.in' });
    } else {
      elements.worryText.style.opacity = '0';
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      source.connect(analyser);
      mediaRecorder = new MediaRecorder(stream);
      chunks = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recStartMs = performance.now();
      mediaRecorder.start();

      _recording = true;
      // 录音期间把背景音乐压到很低（让位给录音 / 减少串音）
      if (window.MS_SOUND && MS_SOUND.duckBg) MS_SOUND.duckBg(0.03, 0.25);
      if (startBtn) startBtn.disabled = true;
      if (doneBtn)  doneBtn.disabled  = false;
      const t = document.getElementById('voiceTrigger');
      if (t) t.classList.add('recording');

      // 初始化声纹 path + 淡入
      createSandWaveformCanvas();
      const pathEl = document.getElementById('waveformPath');
      if (pathEl) {
        pathEl.setAttribute('d', '');
        if (typeof gsap !== 'undefined') {
          gsap.fromTo(pathEl, { opacity: 0 }, { opacity: 1, duration: 0.8, ease: 'power1.inOut' });
        } else {
          pathEl.style.opacity = '1';
        }
      }
      rafId = requestAnimationFrame(rafLoop);

      // 60 秒自动完成
      autoTimer = setTimeout(() => finishRecording(), MAX_DURATION * 1000);
    } catch (err) {
      closeBar();
      const msg = (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
        ? '需要麦克风权限才能录音，请在浏览器设置里允许。'
        : '无法启动录音：' + err.message;
      alert(msg);
    }
  }

  /* ── 停止录音硬件 ── */
  function stopHardware() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
      mediaRecorder.stop();
    }
    if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
    analyser = null;
    mediaRecorder = null;
    _recording = false;
    // 录音结束 → 背景音乐恢复正常音量
    if (window.MS_SOUND && MS_SOUND.restoreBg) MS_SOUND.restoreBg(1.0);
  }

  /* ── 完成录制 ── */
  function finishRecording() {
    if (!_recording) return;
    // STORE-005：有盘时把这段录音存成 U盘真文件 + 建语音记录；无盘保持纯体验（不存，只放动画）。
    const durationSec = Math.max(0, (performance.now() - recStartMs) / 1000);
    const mr = mediaRecorder; // 捕获引用：stopHardware() 会把 mediaRecorder 置 null
    const s = window.MS && window.MS.mediaStore;
    if (mr && s && s.hasBackend && s.hasBackend()) {
      mr.onstop = () => {
        try {
          const mime = (mr.mimeType || 'audio/webm').split(';')[0]; // 剥掉 codecs，让扩展名映射命中
          const blob = new Blob(chunks, { type: mime });
          chunks = [];
          if (blob.size > 0) saveVoiceRecord(blob, durationSec);
        } catch (err) { console.warn('[sea] 录音保存失败：', err); }
      };
    }
    stopHardware();
    closeBar();

    // 声纹冻结 + 海浪卷走（抽成模块级 runWashSequence，与语音重播结束共用）
    runWashSequence();
  }

  /* ── STORE-005：把录音 Blob 存成 U盘真文件 + 建语音记录 ── */
  async function saveVoiceRecord(blob, durationSec) {
    const s = window.MS && window.MS.mediaStore;
    if (!s || !s.hasBackend || !s.hasBackend()) return; // 双保险：无盘不存
    const id = `sea-voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    const dateForFile = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let audioRef = '';
    try {
      const r = await s.putMedia({ planetKey: 'sea', id, kind: 'audio', dateStr: dateForFile, source: blob });
      if (r.wroteFile) audioRef = r.ref;
    } catch (err) { console.warn('[sea] 语音落盘失败：', err); }
    if (!audioRef) { try { alert('录音没能存到 U 盘，请确认 U 盘已连接。'); } catch (_) {} return; }
    const record = { id, type: 'audio', date: formatToday(), duration: durationSec, audio: audioRef };
    records = [record, ...records]; // 和文字一致：新记录插到开头（最新在前），时间线最左即最新
    activeId = id;
    saveRecords();
    renderTimeline();
    renderHistory();
  }

  /* ── 取消 ── */
  function cancelRecording() {
    if (_recording) stopHardware();
    const pathEl = document.getElementById('waveformPath');
    if (pathEl) { pathEl.setAttribute('d', ''); pathEl.style.opacity = '0'; }
    _sandWaveformCanvas = null;
    closeBar();
  }

  /* ── 初始化 ── */
  function init() {
    document.addEventListener('DOMContentLoaded', () => {}, { once: true });

    const triggerBtn = document.getElementById('voiceTrigger');
    if (triggerBtn) {
      triggerBtn.addEventListener('click', () => {
        if (document.body.classList.contains('is-washing')) return;
        if (_barOpen) { cancelRecording(); return; }
        openBar();
      });
    }

    // 事件绑定用事件委托（control bar 在 openBar 时才创建引用）
    document.addEventListener('click', e => {
      if (e.target.id === 'voiceStart')  startRecording();
      if (e.target.id === 'voiceDone')   finishRecording();
      if (e.target.id === 'voiceCancel') cancelRecording();
    });
  }

  return { init };
})();

/* ── 初始化入口 ── */

init();
VoiceRecorder.init();

// U盘插盘恢复（STORE-006）：父级传句柄 → 从 U盘读回文字记录并重渲
// STORE-005：父级切走（切 tab / 列表页 / 星图）会发 visibility:false →
// 停掉正在播的语音，避免切走后声音还在响、声纹还留在沙滩上。
window.addEventListener('message', (e) => {
  if (e && e.data && e.data.type === 'memory-sparks:visibility' && e.data.visible === false) {
    stopVoicePlayback();
  }
});

(function installSeaFsaHandle(){
  const s = window.MS && window.MS.mediaStore;
  if (s && s.installHandleListener) {
    s.installHandleListener(() => {
      seaRestoreFile().then(restored => {
        if (restored) {
          records = loadRecords();
          if (activeId && !records.some(r => r.id === activeId)) {
            activeId = records.length ? records[records.length - 1].id : null;
          }
          renderTimeline();
          renderHistory();
        }
      }).catch(()=>{});
    });
  }
})();
