/* ==========================================================================
   audio.js · 8 条音效 · 静音常驻按钮 · 模块切换 BG 交叉淡变
   交底：docs/specs/2026-04-22-audio-handoff.md
   ========================================================================== */

(() => {
  const STORAGE_KEY = 'bird-demo-audio-enabled';
  const CROSSFADE_MS = 1000;

  const audios = {};
  let manifest = null;
  let enabled = localStorage.getItem(STORAGE_KEY) !== '0';
  let currentBG = null;
  let unlocked = false;  // autoplay 解锁标志

  /* ---------- 构建静音按钮（画布右上角常驻） ---------- */
  function buildMuteBtn() {
    const btn = document.createElement('button');
    btn.className = 'audio-toggle';
    btn.setAttribute('aria-label', '音效开关');
    btn.innerHTML = `<span class="audio-toggle__icon" aria-hidden="true"></span>`;
    btn.addEventListener('click', toggleMute);
    document.getElementById('stage').appendChild(btn);
    updateBtnUI(btn);
    return btn;
  }
  function updateBtnUI(btn) {
    btn = btn || document.querySelector('.audio-toggle');
    if (!btn) return;
    btn.classList.toggle('is-muted', !enabled);
    btn.setAttribute('title', enabled ? '点击静音' : '点击开启音效');
  }

  /* ---------- 预取 ---------- */
  async function load() {
    const res = await fetch('assets/audio/audio-manifest.json');
    manifest = await res.json();
    manifest.items.forEach(item => {
      const a = new Audio(`assets/audio/${item.file}`);
      a.volume = item.volume_target || 0.2;
      a.preload = 'auto';
      if (item.loop) a.loop = true;
      audios[item.id] = a;
    });
  }

  /* ---------- 播放 UI 音（短促，可重叠） ---------- */
  function play(id) {
    if (!enabled) return;
    const a = audios[id];
    if (!a) return;
    /* 克隆播放允许重叠；BG 不走这条路 */
    try {
      const clip = a.cloneNode(true);
      clip.volume = a.volume;
      clip.play().catch(() => {});
    } catch (_) { /* noop */ }
  }

  /* ---------- BG 音（常驻循环 + 交叉淡变） ---------- */
  function fadeVolume(audio, from, to, ms, done) {
    const steps = 20;
    const step = (to - from) / steps;
    const interval = ms / steps;
    let i = 0;
    audio.volume = from;
    const timer = setInterval(() => {
      i++;
      audio.volume = Math.max(0, Math.min(1, from + step * i));
      if (i >= steps) {
        clearInterval(timer);
        audio.volume = to;
        done && done();
      }
    }, interval);
  }

  function switchBG(mod) {
    if (!manifest) return;
    const id = mod === 'module-b' ? 'S-BG-02-wetland-forest' : 'S-BG-01-museum-quiet';
    const target = audios[id];
    if (!target || currentBG === id) return;

    const prev = currentBG && audios[currentBG];
    const targetVol = (manifest.items.find(x => x.id === id) || {}).volume_target || 0.08;

    const startTarget = () => {
      if (!enabled) { currentBG = id; return; }
      target.currentTime = 0;
      target.volume = 0;
      const p = target.play();
      if (p && p.catch) p.catch(() => {});
      fadeVolume(target, 0, targetVol, CROSSFADE_MS);
    };

    if (prev) {
      fadeVolume(prev, prev.volume, 0, CROSSFADE_MS, () => prev.pause());
    }
    startTarget();
    currentBG = id;
  }

  function stopAllBG() {
    ['S-BG-01-museum-quiet', 'S-BG-02-wetland-forest'].forEach(id => {
      const a = audios[id];
      if (a) { a.pause(); a.currentTime = 0; }
    });
    currentBG = null;
  }

  /* 淡出当前 BG 但不启动新的（模块 B 把声道让给视频时用） */
  function fadeOutBG() {
    if (!currentBG) return;
    const prev = audios[currentBG];
    currentBG = null;
    if (prev) {
      fadeVolume(prev, prev.volume, 0, CROSSFADE_MS, () => prev.pause());
    }
  }

  /* ---------- 静音切换 ---------- */
  function toggleMute() {
    enabled = !enabled;
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    updateBtnUI();
    if (!enabled) {
      /* 立即静音所有 BG */
      ['S-BG-01-museum-quiet', 'S-BG-02-wetland-forest'].forEach(id => {
        const a = audios[id];
        if (a) a.volume = 0;
      });
    } else if (currentBG) {
      const cfg = manifest.items.find(x => x.id === currentBG);
      const a = audios[currentBG];
      if (a) {
        a.volume = 0;
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
        fadeVolume(a, 0, (cfg && cfg.volume_target) || 0.08, 500);
      }
    }
  }

  /* ---------- Autoplay 解锁：首次手势 ---------- */
  /* 仅在用户仍停留在模块 A 时解锁 BG-A；若首次手势是切 Tab 到 B，
     Tabs.activate 已自己处理（fadeOutBG 让位视频声音），这里不再重复启动。 */
  function tryUnlock() {
    if (unlocked) return;
    unlocked = true;
    if (!enabled || currentBG) return;
    const active = document.querySelector('.module.is-active');
    if (active && active.id === 'module-a') {
      switchBG('module-a');
    }
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    try { await load(); } catch (e) {
      console.warn('[audio] manifest load failed', e); return;
    }
    buildMuteBtn();

    /* 首次尝试启动 A 模块 BG（多半会被拒） */
    if (enabled) {
      const a = audios['S-BG-01-museum-quiet'];
      if (a) {
        a.volume = 0;
        const p = a.play();
        if (p && p.then) {
          p.then(() => {
            currentBG = 'S-BG-01-museum-quiet';
            fadeVolume(a, 0, 0.08, 800);
            unlocked = true;
          }).catch(() => { /* 等首次手势 */ });
        }
      }
    }
    /* 首次手势兜底 */
    ['click', 'pointerdown', 'keydown'].forEach(ev =>
      document.addEventListener(ev, tryUnlock, { once: true, passive: true }));
  }

  /* ---------- 暴露 API ---------- */
  window.AudioFX = { play, switchBG, fadeOutBG, stopAllBG, toggleMute, isEnabled: () => enabled };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
