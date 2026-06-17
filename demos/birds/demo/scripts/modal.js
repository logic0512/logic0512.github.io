/* ==========================================================================
   modal.js · 数据加载 + 小弹窗（popup-bubble）+ 大弹窗（modal）+ 热点接入
   数据源：data/content.json（content-freeze v1.2）
   参考：handoff §4.4/4.5/§6.3/6.4/6.5
   ========================================================================== */

(() => {
  const STAGE_W = 1920;
  const POPUP_W = 300;
  const POPUP_GAP = 24;   // 热点与弹窗之间的间隙（画布像素）

  /* ---------- 数据 ---------- */
  const Data = {
    popups: {},
    modals: {},
    async load() {
      const res = await fetch('data/content.json');
      const json = await res.json();
      json.popups_small.forEach(p => { this.popups[p.id] = p; });
      json.modals.forEach(m => { this.modals[m.id] = m; });
    },
  };

  /* ---------- 画布坐标系工具 ---------- */
  const stage = document.getElementById('stage');
  function canvasRectOfEl(el) {
    /* 返回 el 相对画布（1920×1080 坐标系）的矩形 */
    const s = stage.getBoundingClientRect();
    const scale = s.width / STAGE_W;
    const r = el.getBoundingClientRect();
    return {
      x: (r.left - s.left) / scale,
      y: (r.top - s.top) / scale,
      w: r.width / scale,
      h: r.height / scale,
    };
  }

  /* ==========================================================================
     Popup · 小弹窗
     ========================================================================== */
  const Popup = (() => {
    let bubble = null;
    let currentId = null;

    function build() {
      bubble = document.createElement('div');
      bubble.className = 'popup-bubble';
      bubble.innerHTML = `
        <div class="popup-bubble__cover"><img alt=""></div>
        <div class="popup-bubble__body">
          <span class="popup-bubble__kind" hidden></span>
          <div class="popup-bubble__title"></div>
          <div class="popup-bubble__subtitle" hidden></div>
          <div class="popup-bubble__text"></div>
          <button class="popup-bubble__more" hidden>查看详细 →</button>
        </div>`;
      stage.appendChild(bubble);
      bubble.querySelector('.popup-bubble__more')
        .addEventListener('click', e => {
          e.stopPropagation();
          const data = Data.popups[currentId];
          if (data && data.more_ref) {
            const modalId = data.more_ref.replace(/^modal\./, '');
            Modal.open(modalId);
            close();
          }
        });
    }

    function fill(id) {
      const d = Data.popups[id];
      if (!d) return false;
      bubble.querySelector('.popup-bubble__cover img').src = d.image;
      bubble.querySelector('.popup-bubble__title').textContent = d.title_zh || '';
      const sub = bubble.querySelector('.popup-bubble__subtitle');
      if (d.title_latin) { sub.textContent = d.title_latin; sub.hidden = false; }
      else { sub.hidden = true; }
      const kind = bubble.querySelector('.popup-bubble__kind');
      if (d.kind === 'bird') {
        kind.textContent = kindLabel(d.id);
        kind.hidden = false;
      } else { kind.hidden = true; }
      bubble.querySelector('.popup-bubble__text').textContent = d.body || '';
      const more = bubble.querySelector('.popup-bubble__more');
      more.hidden = !d.more_ref;
      return true;
    }

    function kindLabel(id) {
      if (id.startsWith('B-climb-'))     return '攀 禽';
      if (id.startsWith('B-wader-'))     return '涉 禽';
      if (id.startsWith('B-waterfowl-')) return '游 禽';
      if (id.startsWith('B-raptor-'))    return '猛 禽';
      if (id.startsWith('B-song-'))      return '鸣 禽';
      if (id.startsWith('B-land-'))      return '陆 禽';
      return '';
    }

    function position(anchorEl) {
      const r = canvasRectOfEl(anchorEl);
      /* 默认弹在右侧（arrow-left）。若右侧放不下，弹在左侧（arrow-right）*/
      let preferRight = (r.x + r.w + POPUP_GAP + POPUP_W) <= (STAGE_W - 40);
      bubble.classList.toggle('arrow-left',  preferRight);
      bubble.classList.toggle('arrow-right', !preferRight);
      const x = preferRight
        ? (r.x + r.w + POPUP_GAP)
        : (r.x - POPUP_W - POPUP_GAP);
      /* 垂直让弹窗箭头对齐热点中心（箭头 ::before 约在 top:72px + 6px） */
      const anchorCenterY = r.y + r.h / 2;
      const y = Math.max(20, anchorCenterY - 78);
      bubble.style.left = x + 'px';
      bubble.style.top  = y + 'px';
    }

    function open(id, anchorEl) {
      if (!bubble) build();
      if (currentId === id) { close(); return; }
      if (!fill(id)) return;
      currentId = id;
      position(anchorEl);
      /* 强制 reflow 后再加 is-open，触发 transition */
      void bubble.offsetWidth;
      bubble.classList.add('is-open');
      if (window.AudioFX) window.AudioFX.play('S-UI-03-popup-open');
      /* 模块 B：小弹窗打开时其他鸟减弱，当前鸟保持 */
      if (id.startsWith('B-')) {
        const mb = document.getElementById('module-b');
        mb.classList.add('is-dimmed');
        mb.querySelectorAll('.bird').forEach(b =>
          b.classList.toggle('is-focus', b.dataset.id === id));
      }
    }

    function close() {
      if (!bubble || !currentId) return;
      bubble.classList.remove('is-open');
      if (window.AudioFX) window.AudioFX.play('S-UI-04-popup-close');
      const mb = document.getElementById('module-b');
      mb.classList.remove('is-dimmed');
      mb.querySelectorAll('.bird.is-focus').forEach(b => b.classList.remove('is-focus'));
      currentId = null;
    }

    return { open, close, get current() { return currentId; } };
  })();

  /* ==========================================================================
     Modal · 大弹窗
     ========================================================================== */
  const Modal = (() => {
    let backdrop = null, modal = null;
    let currentId = null, currentPage = 0;

    function build() {
      backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      stage.appendChild(backdrop);

      modal = document.createElement('div');
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal__header">
          <div class="modal__title"></div>
          <div class="modal__tabs"></div>
          <button class="modal__close" aria-label="关闭">✕</button>
        </div>
        <div class="modal__body"></div>
        <div class="modal__footer">
          <div class="page-indicator"><span class="idx">Page</span><span class="cur">1</span><span class="sep">/</span><span class="total">1</span></div>
        </div>`;
      stage.appendChild(modal);

      modal.querySelector('.modal__close').addEventListener('click', close);
      backdrop.addEventListener('click', close);
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && currentId) close();
      });
      modal.querySelector('.modal__tabs').addEventListener('click', e => {
        const t = e.target.closest('.modal__tab');
        if (!t) return;
        const idx = parseInt(t.dataset.page, 10);
        if (idx !== currentPage) switchPage(idx);
      });
    }

    /* 渲染一页：根据页章节数决定用 layout-rows（少章节）还是 layout-scroll-x（横向 5 种）*/
    function renderPage(page) {
      const body = modal.querySelector('.modal__body');
      const useScrollX = /常见/.test(page.heading) && page.chapters.length >= 4;
      const layout = useScrollX ? 'layout-scroll-x' : 'layout-rows';
      const html = useScrollX ? renderScrollX(page.chapters) : renderRows(page.chapters);
      body.innerHTML = `<div class="${layout}">${html}</div>
        ${useScrollX ? '<div class="scroll-hint"><span>左 右 滑 动</span><span class="arrow">→</span></div>' : ''}`;
    }

    function renderRows(chapters) {
      return chapters.map((c, i) => `
        <div class="row-card">
          <div class="row-fig">
            <div class="mc-fig">
              <img src="${c.figures[0].src}" alt="">
            </div>
            ${c.figures[0].caption ? `<p class="mc-cap">${c.figures[0].caption}</p>` : ''}
          </div>
          <div class="row-txt">
            <p class="mc-no">${String(i + 1).padStart(2, '0')}</p>
            <div class="mc-rule"></div>
            <h3 class="mc-title">${c.heading || ''}</h3>
            <p class="mc-body">${c.body || ''}</p>
          </div>
          <span class="row-seq">${i + 1} / ${chapters.length}</span>
        </div>
      `).join('');
    }

    function renderScrollX(chapters) {
      return chapters.map((c, i) => `
        <div class="mc-card">
          <div class="mc-fig"><img src="${c.figures[0].src}" alt=""></div>
          <p class="mc-no">${String(i + 1).padStart(2, '0')}</p>
          <div class="mc-rule"></div>
          <h3 class="mc-title">${c.heading || ''}</h3>
          <p class="mc-body">${c.body || ''}</p>
          ${c.figures[0].caption ? `<p class="mc-cap">${c.figures[0].caption}</p>` : ''}
        </div>
      `).join('');
    }

    function open(id) {
      if (!modal) build();
      const d = Data.modals[id];
      if (!d) return;
      currentId = id;
      modal.querySelector('.modal__title').innerHTML =
        `${d.title_zh || ''}${d.title_sub ? `<span class="sub">${d.title_sub}</span>` : ''}`;

      /* 双页 tabs */
      const tabsEl = modal.querySelector('.modal__tabs');
      tabsEl.innerHTML = d.pages.map((p, i) =>
        `<button class="modal__tab${i === 0 ? ' is-active' : ''}" data-page="${i}">${p.heading}</button>`
      ).join('');
      modal.querySelector('.page-indicator .total').textContent = d.pages.length;

      switchPage(0);
      backdrop.classList.add('is-open');
      void modal.offsetWidth;
      modal.classList.add('is-open');
      if (window.AudioFX) window.AudioFX.play('S-UI-03-popup-open');
    }

    function switchPage(idx) {
      const d = Data.modals[currentId];
      if (!d || !d.pages[idx]) return;
      currentPage = idx;
      modal.querySelectorAll('.modal__tab').forEach((t, i) =>
        t.classList.toggle('is-active', i === idx));
      modal.querySelector('.page-indicator .cur').textContent = idx + 1;
      renderPage(d.pages[idx]);
    }

    function close() {
      if (!currentId) return;
      modal.classList.remove('is-open');
      backdrop.classList.remove('is-open');
      if (window.AudioFX) window.AudioFX.play('S-UI-04-popup-close');
      currentId = null;
    }

    return { open, close, get current() { return currentId; } };
  })();

  /* ==========================================================================
     热点接入 · 事件委托到 #stage
     ========================================================================== */
  function hotspotId(target) {
    const bone    = target.closest('.bone-hotspot');    if (bone)    return bone.dataset.id;
    const organ   = target.closest('.organ-hotspot');   if (organ)   return organ.dataset.id;
    const plumage = target.closest('.plumage-hotspot'); if (plumage) return plumage.dataset.id;
    const bird    = target.closest('.bird');            if (bird)    return bird.dataset.id;
    return null;
  }

  function initHotspots() {
    stage.addEventListener('click', e => {
      /* 点 popup 内部不触发关闭 */
      if (e.target.closest('.popup-bubble')) return;
      /* 点模态内部不触发关闭（模态有自己 close 按钮） */
      if (e.target.closest('.modal') || e.target.closest('.modal-backdrop')) return;

      const id = hotspotId(e.target);
      if (id && Data.popups[id]) {
        const anchor = e.target.closest('.bone-hotspot, .organ-hotspot, .plumage-hotspot, .bird');
        Popup.open(id, anchor);
      } else {
        Popup.close();
      }
    });
  }

  /* ==========================================================================
     启动
     ========================================================================== */
  Data.load()
    .then(initHotspots)
    .catch(err => console.error('[modal.js] content.json load failed:', err));
})();
