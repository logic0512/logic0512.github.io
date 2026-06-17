/**
 * Memory Sparks · 列表展示模式 [LIST-001]
 *
 * 给每颗星增加一个「列表展示模式」，跟现有的「交互模式」（场景）数据完全共享。
 *
 * 入口：右上角 + 按钮正下方加一个网格按钮，点了进入列表
 * 返回：列表模式右上角的列表按钮变成「返回」，点了回到交互模式
 *
 * 用法（接入示例）：
 *   MS.installListMode({
 *     planet:     'hiking',                          // 用于 palette / 状态记忆
 *     storageKey: 'memory-sparks:hiking-records',    // 该星记录的 localStorage key
 *     mapper:     (record) => ({ ... })              // 可选；不传则用默认推断
 *   });
 *
 * 卡片类型（type）自动推断：
 *   - 有 audio 字段 → 'audio'
 *   - 有 video + text → 'video-text-h'   有 video 没 text → 'video-h'
 *   - 有 image + text → 'image-text-h'   有 image 没 text → 'image'
 *   - 只有 text → 'text'
 */
window.MS = window.MS || {};

(function() {
  const MS_LIST_VERSION = 'v20260528e';
  const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

  // 开发期：屏幕左上角显示版本徽标，方便确认浏览器加载的是不是最新代码
  function showVersionBadge() {
    if (document.querySelector('.ms-version-badge')) return;
    const b = document.createElement('div');
    b.className = 'ms-version-badge';
    b.textContent = 'list-mode ' + MS_LIST_VERSION;
    b.style.cssText = 'position:fixed;top:8px;left:8px;z-index:9999;font-size:10px;color:rgba(255,255,255,0.5);background:rgba(0,0,0,0.6);padding:3px 8px;border-radius:4px;font-family:monospace;letter-spacing:0.05em;pointer-events:none;';
    document.body.appendChild(b);
  }
  if (document.body) showVersionBadge();
  else document.addEventListener('DOMContentLoaded', showVersionBadge);
  console.log('[MS list-mode]', MS_LIST_VERSION, 'loaded');

  /** 数据归一化：把各星 record 转成列表卡数据 */
  function defaultMapper(record) {
    const date = formatDate(record.date);
    const title = record.title || record.name || '未命名';
    const text = record.text || record.content || record.body || record.message || '';
    const weight = clampWeight(record.weight || record.brightness || record.warmth || 3);
    const image = record.image || record.src || record.cover || record.photo;
    const audio = record.audio || record.voice;
    const video = record.video;
    const duration = record.duration || record.dur;

    // 类型推断（优先级：音频 > 视频 > 图片 > 纯文字）
    if (audio) {
      return { type: 'audio', d: date, t: title, dur: duration || '', w: weight };
    }
    if (video) {
      const orientation = record.orientation || (record.videoWidth >= record.videoHeight ? 'h' : 'v');
      if (text) {
        return { type: 'video-text-h', d: date, t: title, p: text, dur: duration || '', w: weight, m: mediaCss(video) };
      }
      return { type: orientation === 'v' ? 'video-v' : 'video-h', d: date, t: title, dur: duration || '', w: weight, m: mediaCss(video) };
    }
    if (image) {
      if (text) {
        return { type: 'image-text-h', d: date, t: title, p: text, w: weight, m: mediaCss(image) };
      }
      return { type: 'image', d: date, t: title, w: weight, m: mediaCss(image) };
    }
    return { type: 'text', d: date, t: title, body: text || title, w: weight };
  }

  function mediaCss(src) {
    if (!src) return 'linear-gradient(135deg, #4a5566, #2a3140)';
    if (typeof src === 'string' && (src.startsWith('url(') || src.startsWith('linear-') || src.startsWith('radial-'))) return src;
    return `url("${src}")`;
  }

  function formatDate(d) {
    if (!d) return '';
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(5).replace('-', '.');
    if (typeof d === 'string' && /^\d{2}[.\-]\d{2}/.test(d)) return d.replace('-', '.');
    try {
      const dt = new Date(d);
      if (!isNaN(dt)) {
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const dd = String(dt.getDate()).padStart(2, '0');
        return `${m}.${dd}`;
      }
    } catch {}
    return String(d).slice(0, 10);
  }

  function clampWeight(w) {
    const n = parseInt(w, 10);
    if (isNaN(n)) return 3;
    return Math.max(1, Math.min(5, n));
  }

  function dotsHtml(n) {
    let s = '';
    for (let i = 0; i < 5; i++) s += `<span class="${i < n ? 'on' : ''}"></span>`;
    return s;
  }

  function waveHtml() {
    const seeds = [0.4, 0.7, 0.5, 0.9, 0.65, 0.85, 0.5, 0.75, 0.6, 0.9, 0.7, 0.55, 0.8, 0.45, 0.65, 0.7];
    return seeds.map(h => `<span style="height:${h * 100}%"></span>`).join('');
  }

  const TOOLS = `
    <div class="ms-card-tools">
      <button class="edit" title="编辑">✎</button>
      <button class="del" title="删除">×</button>
    </div>
  `;

  const TMPL = {
    'text': (r) => `
      ${TOOLS}
      <div class="ms-card-date">${r.d}</div>
      <div class="ms-quote">
        <div class="ms-mark">"</div>
        <div class="ms-body-text">${escapeHtml(r.body || r.t)}</div>
        <div class="ms-title-mini">${escapeHtml(r.t)}</div>
      </div>
      <div class="ms-card-dots">${dotsHtml(r.w)}</div>`,
    'audio': (r) => `
      ${TOOLS}
      <div class="ms-card-date">${r.d}</div>
      <div class="ms-play-btn">${PLAY_SVG}</div>
      <div class="ms-audio-right">
        <div class="ms-title-line">${escapeHtml(r.t)}</div>
        <div class="ms-wave-row">
          <div class="ms-wave">${waveHtml()}</div>
          <div class="ms-duration">${r.dur || '0:00'}</div>
        </div>
      </div>
      <div class="ms-card-dots">${dotsHtml(r.w)}</div>`,
    'video-h': (r) => `
      ${TOOLS}
      <div class="ms-card-date">${r.d}</div>
      <div class="ms-frame-16-9" style="--media:${r.m};">
        <div class="ms-play-overlay">${PLAY_SVG}</div>
        <div class="ms-duration-chip">${r.dur || '0:00'}</div>
        <div class="ms-title-inside">${escapeHtml(r.t)}</div>
      </div>
      <div class="ms-card-dots">${dotsHtml(r.w)}</div>`,
    'video-v': (r) => `
      ${TOOLS}
      <div class="ms-card-date">${r.d}</div>
      <div class="ms-frame-9-16" style="--media:${r.m};">
        <div class="ms-play-overlay">${PLAY_SVG}</div>
        <div class="ms-duration-chip">${r.dur || '0:00'}</div>
        <div class="ms-title-inframe">${escapeHtml(r.t)}</div>
      </div>
      <div class="ms-card-dots">${dotsHtml(r.w)}</div>`,
    'image': (r) => `
      ${TOOLS}
      <div class="ms-card-date">${r.d}</div>
      <div class="ms-media-bg" style="--media:${r.m};"></div>
      <div class="ms-title-overlay">${escapeHtml(r.t)}</div>
      <div class="ms-card-dots">${dotsHtml(r.w)}</div>`,
    'video-text-h': (r) => `
      ${TOOLS}
      <div class="ms-card-date">${r.d}</div>
      <div class="ms-media-bg" style="--media:${r.m};"></div>
      <div class="ms-play-overlay">${PLAY_SVG}</div>
      <div class="ms-duration-chip">${r.dur || '0:00'}</div>
      <div class="ms-text-overlay">
        <div class="ms-preview-line">${escapeHtml(r.p || '')}</div>
        <div class="ms-title-line">${escapeHtml(r.t)}</div>
      </div>
      <div class="ms-card-dots">${dotsHtml(r.w)}</div>`,
    'image-text-h': (r) => `
      ${TOOLS}
      <div class="ms-card-date">${r.d}</div>
      <div class="ms-media-bg" style="--media:${r.m};"></div>
      <div class="ms-text-overlay">
        <div class="ms-preview-line">${escapeHtml(r.p || '')}</div>
        <div class="ms-title-line">${escapeHtml(r.t)}</div>
      </div>
      <div class="ms-card-dots">${dotsHtml(r.w)}</div>`,
    'media-text-v': (r) => `
      ${TOOLS}
      <div class="ms-card-date">${r.d}</div>
      <div class="ms-media-side" style="background:${r.m};">
        ${r.dur ? `<div class="ms-play-overlay-small">${PLAY_SVG}</div><div class="ms-duration-chip-small">${r.dur}</div>` : ''}
      </div>
      <div class="ms-text-side">
        <div class="ms-title">${escapeHtml(r.t)}</div>
        <div class="ms-preview">${escapeHtml(r.p || '')}</div>
      </div>
      <div class="ms-card-dots">${dotsHtml(r.w)}</div>`,
  };

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** 渲染列表网格 */
  function renderGrid(layer, records, mapper, callbacks) {
    const grid = layer.querySelector('.ms-list-grid');
    if (!grid) return;
    if (!records || !records.length) {
      grid.innerHTML = `
        <div class="ms-list-empty">
          <div class="txt">这颗星还没有任何记录</div>
          <div class="sub">点右上 + 写下第一条，会同时出现在场景里和这里</div>
        </div>`;
      return;
    }
    grid.innerHTML = records.map(r => {
      const card = mapper(r) || defaultMapper(r);
      const t = TMPL[card.type] || TMPL.text;
      return `<div class="ms-card" data-type="${card.type}" data-id="${escapeHtml(r.id || '')}">${t(card)}</div>`;
    }).join('');

    // hover 工具事件绑定
    grid.querySelectorAll('.ms-card').forEach(card => {
      const id = card.dataset.id;
      card.querySelector('.ms-card-tools .edit')?.addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.onEdit?.(id);
      });
      card.querySelector('.ms-card-tools .del')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = typeof window.msConfirm === 'function'
          ? await window.msConfirm('删除这条记录？', { yes: '删除', no: '取消', danger: true })
          : window.confirm('删除这条记录？');
        if (ok) callbacks.onDelete?.(id);
      });
      card.addEventListener('click', () => callbacks.onOpen?.(id));
    });
  }

  /** 主接入函数 */
  MS.installListMode = function({ planet, storageKey, mapper, onAdd, onEdit, onDelete, onOpen } = {}) {
    if (!planet || !storageKey) {
      console.warn('[MS] installListMode 缺少 planet 或 storageKey');
      return;
    }

    // 先清理可能的旧实例（多次调用安全）
    document.querySelectorAll('.ms-list-btn, .ms-list-layer').forEach(n => n.remove());

    // ── 列表层（覆盖层）──
    const layer = document.createElement('div');
    layer.className = 'ms-list-layer';
    layer.dataset.planet = planet;
    layer.innerHTML = '<div class="ms-list-grid"></div>';
    document.body.appendChild(layer);

    // ── 列表按钮（在 + 按钮正下方）──
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ms-list-btn';
    btn.setAttribute('aria-label', '查看列表');
    btn.title = '查看记录列表';
    btn.innerHTML = gridIcon();
    document.body.appendChild(btn);

    // 每次进星球都从交互模式开始（不记忆上次模式）
    let isListOpen = false;

    function readRecords() {
      try {
        const raw = JSON.parse(localStorage.getItem(storageKey) || '[]');
        return Array.isArray(raw) ? raw : [];
      } catch { return []; }
    }

    function refresh() {
      const records = readRecords();
      renderGrid(layer, records, mapper || defaultMapper, { onEdit, onDelete, onOpen });
    }

    // 切换 + 按钮的图标：列表模式下用通用 +，交互模式下恢复星球图标
    function setAddFabPlusMode(on) {
      const fab = document.querySelector('.ms-add-fab');
      if (!fab) return;
      if (on) {
        if (!fab._msOriginalIcon) fab._msOriginalIcon = fab.innerHTML;
        fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
        fab.setAttribute('aria-label', '在列表里新增一条');
        fab.title = '新增记录';
      } else if (fab._msOriginalIcon) {
        fab.innerHTML = fab._msOriginalIcon;
        fab._msOriginalIcon = null;
      }
    }

    // 给 hiking 内部发 visibility 信号，触发 RAF/setInterval 暂停
    function pauseHikingInternals(pause) {
      window.postMessage({ type: 'memory-sparks:visibility', visible: !pause }, '*');
    }

    // 把 composer 移到 body 下（绕过 hike-page display:none）
    function moveComposerToBody() {
      const cb = document.querySelector('.composer-backdrop');
      if (!cb || cb.parentElement === document.body) return;
      cb._msOriginalParent = cb.parentElement;
      cb._msOriginalNext = cb.nextSibling;
      document.body.appendChild(cb);
    }
    function restoreComposer() {
      const cb = document.querySelector('.composer-backdrop');
      if (!cb || !cb._msOriginalParent) return;
      if (cb._msOriginalNext) cb._msOriginalParent.insertBefore(cb, cb._msOriginalNext);
      else cb._msOriginalParent.appendChild(cb);
      cb._msOriginalParent = null;
      cb._msOriginalNext = null;
    }

    function openList() {
      isListOpen = true;
      moveComposerToBody();
      pauseHikingInternals(true);  // 停 hiking 内部 RAF/setInterval（关键性能优化）
      refresh();
      requestAnimationFrame(() => {
        layer.classList.add('show');
        document.body.classList.add('ms-list-open');
      });
      btn.classList.add('is-back');
      btn.innerHTML = closeIcon();
      btn.setAttribute('aria-label', '关闭列表回到交互模式');
      btn.title = '关闭列表回到交互模式';
      setAddFabPlusMode(true);
    }

    function closeList() {
      document.querySelectorAll('.ms-card-detail-backdrop').forEach(n => n.remove());
      isListOpen = false;
      layer.classList.remove('show');
      document.body.classList.remove('ms-list-open');
      restoreComposer();
      pauseHikingInternals(false); // 恢复 hiking 内部 RAF/setInterval
      btn.classList.remove('is-back');
      btn.innerHTML = gridIcon();
      btn.setAttribute('aria-label', '查看列表');
      btn.title = '查看记录列表';
      setAddFabPlusMode(false);
    }

    btn.addEventListener('click', () => isListOpen ? closeList() : openList());

    // ── 默认详情 modal（点卡片放大查看）──
    function showDetail(record) {
      // 先清理已有
      document.querySelectorAll('.ms-card-detail-backdrop').forEach(n => n.remove());
      const card = mapper ? mapper(record) : defaultMapper(record);
      const mediaUrl = (record.image || record.src || record.video || record.cover) || '';
      const text = record.text || record.content || record.body || record.message || card.body || card.p || '';
      const title = record.title || record.name || card.t || '未命名';
      const date = card.d;
      const place = record.place || record.location || '';

      const back = document.createElement('div');
      back.className = 'ms-card-detail-backdrop';
      const editSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
      const delSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>';
      const closeSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>';
      back.innerHTML = `
        <div class="ms-card-detail" data-id="${escapeHtml(record.id || '')}">
          <div class="ms-card-detail-bar">
            <button class="edit" title="编辑">${editSvg}</button>
            <button class="del" title="删除">${delSvg}</button>
            <button class="close" title="关闭">${closeSvg}</button>
          </div>
          ${mediaUrl ? `<div class="ms-card-detail-media" style="--detail-media:url('${mediaUrl}');"></div>` : ''}
          <div class="ms-card-detail-body">
            <div class="det-date">${date || ''}</div>
            <div class="det-title">${escapeHtml(title)}</div>
            ${text ? `<div class="det-text">${escapeHtml(text)}</div>` : ''}
            ${place ? `<div class="det-meta">${escapeHtml(place)}</div>` : ''}
          </div>
        </div>
      `;
      document.body.appendChild(back);
      requestAnimationFrame(() => back.classList.add('show'));

      const close = () => {
        back.classList.remove('show');
        setTimeout(() => back.remove(), 220);
      };
      back.querySelector('.ms-card-detail-bar .close').addEventListener('click', close);
      back.addEventListener('click', (e) => { if (e.target === back) close(); });
      back.querySelector('.ms-card-detail-bar .edit').addEventListener('click', () => {
        close();
        onEdit?.(record.id);
      });
      back.querySelector('.ms-card-detail-bar .del').addEventListener('click', async () => {
        const ok = typeof window.msConfirm === 'function'
          ? await window.msConfirm('删除这条记录？', { yes: '删除', no: '取消', danger: true })
          : window.confirm('删除这条记录？');
        if (ok) {
          close();
          onDelete?.(record.id);
        }
      });
    }
    // 把 showDetail 注入 onOpen 默认行为
    const _onOpen = onOpen;
    onOpen = (id) => {
      const r = readRecords().find(x => String(x.id) === String(id));
      if (!r) return;
      if (_onOpen) _onOpen(r);
      else showDetail(r);
    };

    // ── 监听 localStorage 写入 → 列表自动刷新 ──
    // 1) 同标签页：wrap setItem
    const _setItem = localStorage.setItem.bind(localStorage);
    if (!localStorage.__msListWrapped) {
      localStorage.setItem = function(k, v) {
        _setItem(k, v);
        window.dispatchEvent(new CustomEvent('ms-storage-set', { detail: { key: k } }));
      };
      localStorage.__msListWrapped = true;
    }
    window.addEventListener('ms-storage-set', (e) => {
      if (e.detail?.key === storageKey && isListOpen) refresh();
    });
    // 2) 跨标签页：storage 事件
    window.addEventListener('storage', (e) => {
      if (e.key === storageKey && isListOpen) refresh();
    });

    // ── 恢复上次状态（同 session）──
    try {
      if (sessionStorage.getItem(STATE_KEY) === 'list') {
        // 让 add-fab / intro-card 等先挂好再开
        setTimeout(() => openList(), 100);
      }
    } catch {}

    // 暴露给调用方手动刷新
    return { open: openList, close: closeList, refresh, layer, btn };
  };

  function gridIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
  }
  // 关闭列表 = 叉号（跟父 App 的"返回星图"弯箭头区分）
  function closeIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  }
})();
