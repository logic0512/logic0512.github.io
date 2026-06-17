/**
 * Memory Sparks · 共用组件挂载助手
 * 用法：
 *   <link rel="stylesheet" href="../_shared/ms-shared.css">
 *   <script src="../_shared/ms-icons.js"></script>
 *   <script src="../_shared/ms-feedback.js"></script>
 *   <script src="../_shared/ms-mount.js"></script>
 *
 * ─── 介绍卡入场动画（GSAP back.out(1.4) · 1.6s · delay 0.2s） ───
 * GSAP 不存在时自动从 CDN 加载，加载失败时 3 秒兜底直接显示卡片。
 *
 * ─────────────────────────────────────────────────────────
 *
 *   MS.mountAddFab({ planet: 'beizi', onClick: () => openComposer() });
 *   MS.mountIntroCard({
 *     planet: 'beizi',
 *     orbitNo: '01',
 *     name: '被子星',
 *     story: '...',
 *     emptyHint: '给悲伤盖一床被子',
 *     img: '../../assets/planets/beizi.png',
 *   });
 *   const bar = MS.mountHistoryBar({ type: 'time' }); // or 'thumb'
 *   bar.render([{ id, label, thumb, active }]);
 */
window.MS = window.MS || {};

/** hex → rgba 字符串（用于动态生成 soft / glow） */
function _hexA(hex, alpha) {
  const m = (hex || '#ffd070').replace('#', '');
  const r = parseInt(m.substr(0, 2), 16);
  const g = parseInt(m.substr(2, 2), 16);
  const b = parseInt(m.substr(4, 2), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 主题注入 — 用 design-system 里每颗星各自的真实配色（不是统一暗色） */
MS.applyTheme = function(planetKey) {
  const cfg = (window.MS_PLANETS || {})[planetKey];
  if (!cfg) return;
  const root = document.documentElement.style;
  const p = cfg.palette || {};

  // 介绍卡 —— 每颗星各自的浅/深底
  root.setProperty('--ms-card-bg',     p.bg     || 'rgba(15,22,36,0.55)');
  root.setProperty('--ms-card-border', p.border || 'rgba(255,255,255,0.18)');
  root.setProperty('--ms-card-text',   p.text   || 'rgba(245,250,255,0.92)');
  root.setProperty('--ms-card-mute',   p.mute   || 'rgba(245,250,255,0.55)');
  root.setProperty('--ms-card-shadow', p.shadow || 'rgba(0,0,0,0.42)');

  // 引导行 hover 底（用 text 色淡淡一层）
  const _toRgbaLow  = (rgba) => rgba.replace(/[\d.]+\)$/, '0.06)');
  const _toRgbaHover= (rgba) => rgba.replace(/[\d.]+\)$/, '0.10)');
  root.setProperty('--ms-hint-bg',       _toRgbaLow(p.text || 'rgba(0,0,0,0.05)'));
  root.setProperty('--ms-hint-bg-hover', _toRgbaHover(p.text || 'rgba(0,0,0,0.08)'));

  // FAB —— 每颗星各自的描边/底/图标色
  root.setProperty('--ms-fab-bg',     p.fabBg     || 'rgba(0,0,0,0.55)');
  root.setProperty('--ms-fab-border', p.fabBorder || cfg.accent || '#ffd070');
  root.setProperty('--ms-fab-icon',   p.fabIcon   || cfg.accent || '#ffd070');
  root.setProperty('--ms-fab-glow',   _hexA(cfg.accent || '#ffd070', 0.42));

  // 列表卡用的不透明底色（不用 backdrop-filter，由 palette.bg 衍生）
  // 把原半透明 rgba 转成接近不透明，避免 GPU blur 卡顿
  const _solidify = (rgba) => {
    if (!rgba) return 'rgba(255,255,255,0.94)';
    return rgba.replace(/[\d.]+\)$/, '0.94)');
  };
  root.setProperty('--ms-card-bg-solid', _solidify(p.bg));
};

/** 尝试触发本 iframe 内已存在的"打开写入"按钮 */
MS.tryOpenComposer = function() {
  const SELECTORS = [
    '[data-open-composer]',
    '.float-btn', '.btn-add', '.write-trigger', '.floating-add',
    '.scene-upload', '.float-add', '.plus-icon', '.add-fab',
    '#btn-add', '#openComposer', '[data-action="add"]',
  ];
  for (const sel of SELECTORS) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) { el.click(); return true; }
    // 即使被 display:none，也试着触发 click（事件依然能传递）
    if (el) { el.click(); return true; }
  }
  // 没找到：先弹个 toast 让用户知道，开发期定位用
  if (typeof window.msToast === 'function') {
    window.msToast('暂未接入这颗星的写入入口');
  }
  return false;
};

/** 一行调用：根据 planetKey 自动 apply theme + intro + fab + 隐藏旧按钮 */
MS.bootstrap = function(planetKey, options = {}) {
  const cfg = (window.MS_PLANETS || {})[planetKey];
  if (!cfg) { console.warn('[MS] unknown planet', planetKey); return; }
  MS.applyTheme(planetKey);

  // 隐藏旧的介绍卡（用 ms-intro-card 取代）
  if (options.replaceIntroCard !== false) {
    document.querySelectorAll('.intro-card').forEach(c => c.style.display = 'none');
  }
  // 挂新的介绍卡
  if (options.mountIntroCard !== false) {
    MS.mountIntroCard({
      planet: planetKey,
      orbitNo: cfg.orbit,
      name: cfg.name,
      story: cfg.story,
      emptyHint: cfg.emptyHint,
      img: cfg.img,
      video: cfg.video,
    });
  }

  // 隐藏旧的添加按钮（防止重复）
  if (options.replaceAddBtn !== false) {
    document.querySelectorAll([
      '.float-btn', '.btn-add', '.write-trigger', '.floating-add',
      '.scene-upload', '.float-add', '.plus-icon',
    ].join(',')).forEach(b => {
      // 行星的 scene-upload 是"互动入口"不能完全隐藏，只移到画面外
      // 这里全部用 visibility hidden 保留事件触发能力
      if (b.classList.contains('scene-upload')) {
        b.style.position = 'absolute';
        b.style.left = '-9999px';
      } else {
        b.style.display = 'none';
      }
    });
  }

  // 挂新的 + 按钮
  const handler = options.onAdd || MS.tryOpenComposer;
  // 包一层：点添加自动折叠介绍卡（让 composer 居中显示，不被卡盖住）
  const wrappedHandler = (...args) => {
    const ic = document.querySelector('.ms-intro-card');
    if (ic && !ic.classList.contains('collapsed')) {
      ic.classList.add('collapsed');
      document.body.classList.add('ms-card-collapsed', 'card-collapsed');
    }
    return handler(...args);
  };
  MS.mountAddFab({
    planet: planetKey,
    title: cfg.addTitle,
    onClick: wrappedHandler,
  });

  // 介绍卡上的空状态行 → 已经在 hint-row 自己里处理（会折叠 + 调 _emptyHintHandler）
  MS.onEmptyHintClick(() => handler());

  // 列表展示模式（[LIST-001]）：如果 options 传了 storageKey 就自动挂上
  // 不传则不挂（兼容旧星）
  if (options.listMode && options.listMode.storageKey && typeof MS.installListMode === 'function') {
    MS.installListMode({
      planet: planetKey,
      storageKey: options.listMode.storageKey,
      mapper: options.listMode.mapper,
      onEdit: options.listMode.onEdit,
      onDelete: options.listMode.onDelete,
      onOpen: options.listMode.onOpen,
    });
  }

  // 列表桥接（[LIST-001-bridge]）：自动接入父 App 列表模式信号
  // 所有 8 颗星都自动获得 list-mode message 处理（隐藏星球本体 + composer 移到 body）
  // 不需要每颗星手动调，前提：iframe head 加载了 ms-list-bridge.js
  if (typeof MS.bridgeListMode === 'function') {
    MS.bridgeListMode({
      storageKey: `memory-sparks:${planetKey}-records`,
      onReload: () => {
        // 每颗星可暴露 window.__msReloadAll 实现细粒度刷新
        // 没实现的星：什么都不做（等用户切回交互页时自然看不到旧记录，因为下次进会重读 storage）
        // 不再 location.reload()——粗暴刷新让用户感觉"卡死"
        if (typeof window.__msReloadAll === 'function') {
          try { window.__msReloadAll(); } catch (e) {
            console.warn('[MS] __msReloadAll failed:', e);
          }
        }
      },
    });
  }
};

/** 添加按钮 — 右下角固定金圆，图标按星主题 */
MS.mountAddFab = function({ planet, onClick, title }) {
  // 移除旧的（多次调用安全）
  document.querySelectorAll('.ms-add-fab').forEach(n => n.remove());
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ms-add-fab';
  btn.setAttribute('aria-label', title || '添加');
  if (title) btn.title = title;
  const ic = (window.MS_ICONS && window.MS_ICONS[planet]) || window.MS_ICONS?.starry || '＋';
  btn.innerHTML = ic;
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick?.(e); });
  document.body.appendChild(btn);
  return btn;
};

/** 介绍卡 — 左上角统一样式 + 故事 + 空状态行 */
MS.mountIntroCard = function({ planet, orbitNo, name, story, emptyHint, img, video, foldable = true }) {
  document.querySelectorAll('.ms-intro-card').forEach(n => n.remove());
  const card = document.createElement('aside');
  card.className = 'ms-intro-card';
  card.dataset.planet = planet;
  // 圆球：有视频就放视频(无声循环)，否则放静态图。纯黑底视频靠 CSS screen 混合透出
  const orbInner = video
    ? `<video class="ms-orb-media" autoplay loop muted playsinline preload="auto" src="${video}"></video>`
    : (img ? `<img class="ms-orb-media" src="${img}" alt="">` : '');
  card.innerHTML = `
    ${(img || video) ? `<div class="ms-orb">${orbInner}</div>` : ''}
    <h1 class="ms-name">${name}</h1>
    ${story ? `<p class="ms-story">${story}</p>` : ''}
    ${emptyHint ? `
      <div class="ms-empty-hint">
        <span class="ic">${(window.MS_ICONS && window.MS_ICONS[planet]) || '✦'}</span>
        <span>${emptyHint}</span>
      </div>
    ` : ''}
  `;
  if (foldable) {
    // 用户原意：只有点"hint-row 引导行"才折叠介绍卡 + 弹添加
    card.querySelector('.ms-empty-hint')?.addEventListener('click', (e) => {
      e.stopPropagation();
      card.classList.add('collapsed');
      // 同时加两个：ms-card-collapsed（共享 css）+ card-collapsed（各星原 css 选择器）
      document.body.classList.add('ms-card-collapsed', 'card-collapsed');
      MS._emptyHintHandler?.(planet);
    });
    // 折叠态下 → 点卡片任意处展开（让用户能找回）
    card.addEventListener('click', (e) => {
      if (!card.classList.contains('collapsed')) return; // 展开态什么都不做
      if (e.target.closest('.ms-empty-hint')) return;
      card.classList.remove('collapsed');
      document.body.classList.remove('ms-card-collapsed', 'card-collapsed');
    });
  }
  document.body.appendChild(card);
  // 入场动画：由 CSS animation 自动播放（msIntroDrop · 1.6s · cubic-bezier 模拟 back.out(1.4)）
  return card;
};
/** 空状态引导行点击时触发的回调（统一交给 fab 的同一函数） */
MS.onEmptyHintClick = (fn) => { MS._emptyHintHandler = fn; };

/** 触发介绍卡掉落动画（父 App 转场结束后调用） */
MS.playIntroAnim = function() {
  const card = document.querySelector('.ms-intro-card');
  if (!card) return;
  // 先移除再添加，强制重置动画（用户重新进入同一星球时也能再播）
  card.classList.remove('ms-intro-show');
  void card.offsetHeight; // reflow
  card.classList.add('ms-intro-show');
};

// 监听父 App 的「进入星球完成」消息
window.addEventListener('message', (e) => {
  if (!e.data) return;
  if (e.data.type === 'memory-sparks:show-intro') {
    requestAnimationFrame(() => MS.playIntroAnim?.());
  }
});

// 兜底：如果 5 秒内没收到父 App 通知（比如单独打开 iframe URL 测试），自动播
setTimeout(() => {
  const card = document.querySelector('.ms-intro-card');
  if (card && !card.classList.contains('ms-intro-show')) {
    MS.playIntroAnim?.();
  }
}, 5000);

/** 历史条 — 底部居中胶囊条 */
MS.mountHistoryBar = function({ type = 'time' }) {
  document.querySelectorAll('.ms-history-bar').forEach(n => n.remove());
  const bar = document.createElement('div');
  bar.className = 'ms-history-bar empty';
  bar.dataset.type = type;
  bar.textContent = type === 'thumb' ? '还没有带回任何照片' : '还没有任何记录';
  document.body.appendChild(bar);

  return {
    el: bar,
    /**
     * items: [{ id, label?, thumb?, active? }]
     * type='time'  → { label: '08.12', active }
     * type='thumb' → { thumb: 'url', active }
     */
    render(items, options = {}) {
      bar.innerHTML = '';
      if (!items || items.length === 0) {
        bar.classList.add('empty');
        bar.textContent = options.emptyText || (type === 'thumb' ? '还没有带回任何照片' : '还没有任何记录');
        return;
      }
      bar.classList.remove('empty');
      items.forEach((it, idx) => {
        if (idx > 0) {
          const line = document.createElement('div');
          line.className = 'ms-history-line';
          bar.appendChild(line);
        }
        if (type === 'thumb') {
          const t = document.createElement('div');
          t.className = 'ms-history-thumb' + (it.active ? ' active' : '');
          t.innerHTML = it.thumb ? `<img src="${it.thumb}" alt="">` : '';
          t.dataset.id = it.id;
          t.addEventListener('click', () => options.onClick?.(it.id));
          bar.appendChild(t);
        } else {
          const d = document.createElement('div');
          d.className = 'ms-history-dot' + (it.active ? ' active' : '');
          d.innerHTML = `<span class="pt"></span>${it.label ? `<span class="lb">${it.label}</span>` : ''}`;
          d.dataset.id = it.id;
          d.addEventListener('click', () => options.onClick?.(it.id));
          bar.appendChild(d);
        }
      });
    },
    setEmpty(text) {
      bar.classList.add('empty');
      bar.textContent = text;
    },
    destroy() { bar.remove(); }
  };
};

/**
 * 给任意"详情卡"容器挂一个统一的"删除"按钮（右上角小红垃圾桶）
 *   container: 详情卡 DOM 容器（position:relative 或 fixed）
 *   getId:     () => string  返回当前展示的记录 id（动态读取）
 *   onDelete:  (id) => void  实际从 storage 删除并刷新视图
 *   question:  '删除这条记录？' 默认确认文案
 *   yes:       '删除' 默认确认按钮文案
 */
MS.bindDelete = function({ container, getId, onDelete, question = '删除这条记录？', yes = '删除' }) {
  if (!container) return;
  if (container.querySelector('.ms-card-del-btn')) return; // 防重复
  const cs = getComputedStyle(container);
  if (cs.position === 'static') container.style.position = 'relative';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ms-card-del-btn';
  btn.title = '删除这条记录';
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>';
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const id = typeof getId === 'function' ? getId() : getId;
    if (!id) return;
    if (typeof window.msConfirm !== 'function') {
      if (window.confirm(question)) onDelete(id);
      return;
    }
    // 关键：删除前先临时隐藏 container（reader 等），避免 reader 的 backdrop-filter +
    // transform 创建的 stacking context 让 msConfirm 看似"没弹出"。取消时再恢复。
    const wasOpen = container.classList.contains('open');
    if (wasOpen) container.classList.remove('open');
    const ok = await window.msConfirm(question, { yes, no: '取消', danger: true });
    if (ok) {
      onDelete(id);
      // 删除成功无需恢复 container（onDelete 通常会自己 closeReader）
    } else if (wasOpen) {
      // 用户取消：恢复 container 原状
      container.classList.add('open');
    }
  });
  container.appendChild(btn);
  return btn;
};

/**
 * 编辑按钮 — 跟 bindDelete 类似，挂在详情卡右上角（删除按钮左边）
 *   container: 详情卡 DOM
 *   getId:     () => string 当前展示的记录 id
 *   onEdit:    (id) => void  调用方负责打开 composer 预填数据
 *   label:     可选按钮文案（hover 显示），默认 '编辑'
 */
MS.bindEdit = function({ container, getId, onEdit, label = '编辑' }) {
  if (!container) return;
  if (container.querySelector('.ms-card-edit-btn')) return;
  const cs = getComputedStyle(container);
  if (cs.position === 'static') container.style.position = 'relative';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ms-card-edit-btn';
  btn.title = label;
  // 铅笔图标
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = typeof getId === 'function' ? getId() : getId;
    if (!id) return;
    onEdit(id);
  });
  container.appendChild(btn);
  return btn;
};

/** 详情卡 — 骨架统一，外观各异（star 自己注入 class 主题化） */
MS.mountDetailCard = function({ eyebrow, name, meta, body, media, mediaType = 'photo', themeClass, onEdit, onDelete, onClose }) {
  // 一个时刻只显示一张
  document.querySelectorAll('.ms-detail-card').forEach(n => n.remove());
  const card = document.createElement('aside');
  card.className = 'ms-detail-card' + (themeClass ? ` ${themeClass}` : '');
  card.innerHTML = `
    <button type="button" class="ms-close" aria-label="关闭">×</button>
    <div class="ms-detail-head">
      ${eyebrow ? `<div class="ms-detail-eyebrow">${eyebrow}</div>` : ''}
      ${name ? `<div class="ms-detail-name">${name}</div>` : ''}
      ${meta ? `<div class="ms-detail-meta">${meta}</div>` : ''}
    </div>
    ${media ? `
      <div class="ms-detail-media">
        ${mediaType === 'video' ? `<video src="${media}" controls></video>` : `<img src="${media}" alt="">`}
      </div>` : ''}
    ${body ? `<div class="ms-detail-body">${body}</div>` : ''}
    <div class="ms-detail-actions">
      <button type="button" class="edit">编辑</button>
      <button type="button" class="del">删除</button>
    </div>
  `;
  const close = () => { card.remove(); onClose?.(); };
  card.querySelector('.ms-close').onclick = close;
  card.querySelector('.edit').onclick = () => { onEdit?.(); close(); };
  card.querySelector('.del').onclick = async () => {
    const ok = await window.msConfirm?.('要删除这条记录吗？', { yes: '删除', no: '取消', danger: true });
    if (ok) { onDelete?.(); close(); window.msToast?.('已删除'); }
  };
  document.body.appendChild(card);
  return card;
};
