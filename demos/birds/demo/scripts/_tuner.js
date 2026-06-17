/* ==========================================================================
   _tuner.js · 临时调参工具（URL `?tuner` 激活）
   - 骨架层：调 5 个 bone-hotspot 的 tagX/tagY（slot 吸附区 cx/cy 不动）
   - 透视层：调 4 个 organ-hotspot 的 HTML inline top/left
   正常访问不影响；调参完按「复制 JSON」把结果贴给开发。
   ========================================================================== */
(() => {
  if (!new URLSearchParams(location.search).has('tuner')) return;

  const LAYER_OFFSET_X = 320;  // .layer--skeleton 容器 left
  const LAYER_OFFSET_Y = 130;  // .layer--skeleton 容器 top

  let currentMode = null;   // 'skeleton' | 'xray'

  window.addEventListener('load', () => {
    setTimeout(init, 300);  // 等 module-a.js / main.js 初始化完
  });

  function init() {
    buildPanel();
    switchMode('skeleton');
  }

  /* ---------- 面板 ---------- */
  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'tuner';
    panel.innerHTML = `
      <style>
        #tuner { position: fixed; right: 16px; bottom: 16px; width: 320px; max-height: 80vh; overflow: auto;
                 background: rgba(31,26,20,.94); color: #fff; font-family: monospace; font-size: 12px;
                 padding: 12px; border-radius: 8px; z-index: 9999;
                 box-shadow: 0 8px 24px rgba(0,0,0,.4); }
        #tuner h4 { margin: 0 0 8px; font-size: 13px; color: #C8A35A; letter-spacing: 2px; }
        #tuner button { background: #2a2520; color: #fff; border: 1px solid #555; padding: 5px 10px;
                        border-radius: 4px; cursor: pointer; margin: 2px; font-family: inherit; font-size: 11px; }
        #tuner button:hover { background: #3a3430; }
        #tuner button.is-active { background: #C8A35A; color: #1a1512; border-color: #C8A35A; }
        #tuner-hint { color: #888; font-size: 10px; margin: 8px 0; }
        #tuner-list .row { padding: 3px 0; border-bottom: 1px dashed #444; }
        #tuner-list .row b { color: #C8A35A; }
        #t-export { margin-top: 8px; width: 100%; background: #C8A35A; color: #1a1512; font-weight: bold; }
        .tuner-handle { outline: 2px dashed rgba(200,163,90,.9) !important; outline-offset: 3px; }
        .tuner-handle:hover { outline-color: #fff !important; }
      </style>
      <h4>🎯 热点调参（仅 ?tuner）</h4>
      <div>
        <button id="t-skeleton" class="is-active">骨架层 · 5 标签</button>
        <button id="t-xray">透视层 · 4 器官</button>
      </div>
      <div id="tuner-hint">拖动热点调整位置 · Alt+拖动 精细 1px · 默认 5px 网格</div>
      <div id="tuner-list"></div>
      <button id="t-export">📋 复制 JSON（两层数据）</button>
    `;
    document.body.appendChild(panel);
    panel.querySelector('#t-skeleton').addEventListener('click', () => switchMode('skeleton'));
    panel.querySelector('#t-xray').addEventListener('click', () => switchMode('xray'));
    panel.querySelector('#t-export').addEventListener('click', exportJSON);
  }

  function switchMode(mode) {
    currentMode = mode;
    const moduleA = document.getElementById('module-a');
    /* 强制切到 A 模块 + 对应层 */
    document.querySelector('[data-tab="module-a"]').click();
    if (mode === 'skeleton') {
      moduleA.dataset.activeLayer = 'skeleton';
      moduleA.classList.add('is-bones-complete');
      ensureBoneHotspots();
    } else {
      moduleA.dataset.activeLayer = 'xray';
    }
    enableDragForMode();
    refreshPanel();
    document.getElementById('t-skeleton').classList.toggle('is-active', mode === 'skeleton');
    document.getElementById('t-xray').classList.toggle('is-active', mode === 'xray');
  }

  /* 骨架层正常要拖完才出热点，调参时强制生成 5 个 */
  function ensureBoneHotspots() {
    const skeletonLayer = document.querySelector('.layer--skeleton');
    const targets = window.__TUNER_TARGETS;
    if (!targets || !skeletonLayer) return;
    Object.entries(targets).forEach(([id, t]) => {
      if (skeletonLayer.querySelector(`.bone-hotspot[data-id="${id}"]`)) return;
      const hs = document.createElement('button');
      hs.className = 'bone-hotspot is-revealed';
      hs.dataset.id = id;
      hs.style.left = (t.tagX - LAYER_OFFSET_X) + 'px';
      hs.style.top  = (t.tagY - LAYER_OFFSET_Y) + 'px';
      hs.innerHTML = `<span class="bone-hotspot__dot" aria-hidden="true"></span><span>${t.label}</span>`;
      skeletonLayer.appendChild(hs);
    });
  }

  /* ---------- 拖拽 ---------- */
  function enableDragForMode() {
    document.querySelectorAll('.tuner-handle').forEach(h => h.classList.remove('tuner-handle'));
    const selector = currentMode === 'skeleton' ? '.bone-hotspot' : '.organ-hotspot';
    document.querySelectorAll(selector).forEach(bindDrag);
  }

  function bindDrag(el) {
    if (el.__tunerBound) {
      el.classList.add('tuner-handle');
      return;
    }
    el.__tunerBound = true;
    el.classList.add('tuner-handle');
    el.addEventListener('pointerdown', onDown);
    /* 吞掉 click，防止 modal.js 在调参时弹窗 */
    el.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }

  function onDown(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const startLeft = parseFloat(el.style.left) || 0;
    const startTop  = parseFloat(el.style.top)  || 0;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const stage = document.getElementById('stage');
    const scale = stage.getBoundingClientRect().width / 1920;

    function onMove(ev) {
      const dx = (ev.clientX - startClientX) / scale;
      const dy = (ev.clientY - startClientY) / scale;
      const step = ev.altKey ? 1 : 5;
      el.style.left = (startLeft + Math.round(dx / step) * step) + 'px';
      el.style.top  = (startTop  + Math.round(dy / step) * step) + 'px';
      refreshPanel();
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  /* ---------- 面板实时显示 ---------- */
  function refreshPanel() {
    const list = document.getElementById('tuner-list');
    if (!list) return;
    const data = readCurrent();
    const rows = Object.entries(data).map(([id, v]) => {
      const pairs = Object.entries(v).map(([k, n]) => `${k}=${n}`).join(' ');
      return `<div class="row"><b>${id}</b> — ${pairs}</div>`;
    });
    list.innerHTML = rows.join('');
  }

  function readCurrent() {
    const data = {};
    if (currentMode === 'skeleton') {
      document.querySelectorAll('.bone-hotspot').forEach(el => {
        const left = parseFloat(el.style.left) || 0;
        const top  = parseFloat(el.style.top)  || 0;
        data[el.dataset.id] = {
          tagX: Math.round(left + LAYER_OFFSET_X),
          tagY: Math.round(top + LAYER_OFFSET_Y),
        };
      });
    } else {
      document.querySelectorAll('.organ-hotspot').forEach(el => {
        data[el.dataset.id] = {
          left: Math.round(parseFloat(el.style.left) || 0),
          top:  Math.round(parseFloat(el.style.top)  || 0),
        };
      });
    }
    return data;
  }

  /* ---------- 导出 ---------- */
  function exportJSON() {
    /* 切到对应模式读两次，拿到双层完整状态 */
    const saved = currentMode;

    switchMode('skeleton');
    const skeleton = readCurrent();
    switchMode('xray');
    const xray = readCurrent();
    switchMode(saved);

    const out = { skeleton, xray };
    const json = JSON.stringify(out, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      alert('✓ 已复制到剪贴板\n\n' + json);
    }).catch(() => {
      prompt('手动复制（Cmd+C）：', json);
    });
  }
})();
