/* ==========================================================================
   module-a.js · 特征实验室 · 骨件拖拽装配
   参考：mockups V2 .bone-placed inline style · handoff §4
   坐标清单见：docs/specs/coordinates-1920x1080.md
   ========================================================================== */

(() => {
  const moduleA = document.getElementById('module-a');
  const stage = document.getElementById('stage');
  if (!moduleA || !stage) return;
  const skeletonLayer = moduleA.querySelector('.layer--skeleton');
  if (!skeletonLayer) return;

  /* 5 个骨件正位（画布坐标系，Figma node 6:13）+ 拼完后的热点贴标位置 */
  const TARGETS = {
    'A1-skull':        { cx: 569,  cy: 234, w: 186, h: 135, label: '头 骨', tagX: 594,  tagY: 205 },
    'A1-furcula':      { cx: 764,  cy: 535, w: 238, h: 305, label: '锁 骨', tagX: 705,  tagY: 465 },
    'A1-wing-bone':    { cx: 1032, cy: 508, w: 244, h: 224, label: '翼 骨', tagX: 1005, tagY: 490 },
    'A1-feather-wing': { cx: 1162, cy: 608, w: 525, h: 138, label: '羽 翼', tagX: 1240, tagY: 630 },
    'A1-foot':         { cx: 842,  cy: 652, w: 361, h: 350, label: '足 部', tagX: 900,  tagY: 720 },
  };
  const SNAP_RADIUS = 60;  // 画布像素

  /* 视口坐标 → 画布坐标（考虑 #stage 的 transform scale） */
  function toCanvas(clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    const scale = rect.width / 1920;
    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale,
    };
  }

  function onPointerDown(e) {
    if (moduleA.dataset.activeLayer !== 'skeleton') return;
    const slot = e.target.closest('.gear-slot');
    if (!slot || slot.classList.contains('is-done')) return;
    const id = slot.dataset.id;
    const target = TARGETS[id];
    if (!target) return;

    e.preventDefault();

    /* 创建跟手 ghost：克隆 slot 内的 SVG img（透明底），目标尺寸直接给出 */
    const srcImg = slot.querySelector('img');
    const ghost = document.createElement('img');
    ghost.src = srcImg.getAttribute('src');
    ghost.className = 'bone-ghost';
    ghost.style.width = target.w + 'px';
    ghost.style.height = target.h + 'px';
    /* 挂在骨架层容器里，随层切换一起淡出 */
    skeletonLayer.appendChild(ghost);

    /* ghost 在 .layer--skeleton 坐标系中定位（容器 top:130 left:320） */
    const LAYER_OFFSET_X = 320, LAYER_OFFSET_Y = 130;
    const place = (clientX, clientY) => {
      const { x, y } = toCanvas(clientX, clientY);
      ghost.style.left = (x - LAYER_OFFSET_X - target.w / 2) + 'px';
      ghost.style.top  = (y - LAYER_OFFSET_Y - target.h / 2) + 'px';
      const dist = Math.hypot(x - target.cx, y - target.cy);
      ghost.classList.toggle('is-near', dist < SNAP_RADIUS);
      return dist;
    };
    place(e.clientX, e.clientY);

    let rafId = 0, lastX = e.clientX, lastY = e.clientY;
    const onMove = ev => {
      lastX = ev.clientX; lastY = ev.clientY;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        place(lastX, lastY);
      });
    };

    const onUp = ev => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      const dist = place(ev.clientX, ev.clientY);
      if (dist < SNAP_RADIUS) {
        /* 贴位 */
        ghost.classList.remove('is-near');
        ghost.classList.add('is-placed');
        ghost.style.left = (target.cx - LAYER_OFFSET_X - target.w / 2) + 'px';
        ghost.style.top  = (target.cy - LAYER_OFFSET_Y - target.h / 2) + 'px';
        slot.classList.add('is-done');
        spawnOneHotspot(id);
        if (window.AudioFX) window.AudioFX.play('S-UI-05-snap');
        checkComplete();
      } else {
        /* 弹回：淡出移除 */
        ghost.classList.add('is-returning');
        setTimeout(() => ghost.remove(), 200);
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  function checkComplete() {
    const done = moduleA.querySelectorAll('.gear-slot.is-done').length;
    if (done === Object.keys(TARGETS).length) {
      moduleA.classList.add('is-bones-complete');
      /* 发一个事件通知 main.js 解锁 xray / plumage pill */
      moduleA.dispatchEvent(new CustomEvent('bones-complete'));
    }
  }

  function spawnOneHotspot(id) {
    if (skeletonLayer.querySelector(`.bone-hotspot[data-id="${id}"]`)) return;
    const t = TARGETS[id];
    const LAYER_OFFSET_X = 320, LAYER_OFFSET_Y = 130;
    const hs = document.createElement('button');
    hs.className = 'bone-hotspot';
    hs.dataset.id = id;
    hs.style.left = (t.tagX - LAYER_OFFSET_X) + 'px';
    hs.style.top  = (t.tagY - LAYER_OFFSET_Y) + 'px';
    hs.innerHTML = `<span class="bone-hotspot__dot" aria-hidden="true"></span><span>${t.label}</span>`;
    skeletonLayer.appendChild(hs);
    /* 下一帧加 is-revealed 触发入场 transition */
    requestAnimationFrame(() => hs.classList.add('is-revealed'));
  }

  /* 事件委托绑到装备栏 */
  moduleA.querySelector('.gear-bar')
    .addEventListener('pointerdown', onPointerDown);

  /* 调参工具挂钩（?tuner 模式下暴露坐标给 _tuner.js） */
  if (location.search.includes('tuner')) {
    window.__TUNER_TARGETS = TARGETS;
    window.__TUNER_SPAWN = spawnOneHotspot;
  }
})();
