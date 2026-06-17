/* ==========================================================================
   main.js · 模块切换主控 + 画布缩放 + 模块 B 入场视频时序
   参考：docs/specs/2026-04-22-design-handoff.md §1 / §6.1
   ========================================================================== */

const CONFIG = {
  CANVAS_W: 1920,
  CANVAS_H: 1080,
  MIN_VIEWPORT_W: 900,
  MIN_VIEWPORT_H: 560,
  BIRD_STAGGER_MS: 60,     // §6.1 每鸟入场延迟 60ms
  BIRD_DURATION_MS: 300,   // §6.1 单鸟 fade-in 300ms
};

/* ---------- 画布等比缩放到视口 ------------------------------------------ */
const Stage = (() => {
  const el = document.getElementById('stage');

  function fit() {
    const { innerWidth: vw, innerHeight: vh } = window;
    const s = Math.min(vw / CONFIG.CANVAS_W, vh / CONFIG.CANVAS_H);
    const tx = (vw - CONFIG.CANVAS_W * s) / 2;
    const ty = (vh - CONFIG.CANVAS_H * s) / 2;
    el.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  }

  return {
    init() {
      fit();
      window.addEventListener('resize', fit, { passive: true });
    },
  };
})();

/* ---------- 12 鸟 stagger fade-in（§6.1） ------------------------------ */
const Birds = (() => {
  const list = () => document.querySelectorAll('#module-b .bird');

  function reveal() {
    list().forEach((b, i) => {
      b.style.transitionDelay = `${i * CONFIG.BIRD_STAGGER_MS}ms`;
      b.classList.add('is-revealed');
    });
  }
  function reset() {
    list().forEach(b => {
      b.style.transitionDelay = '0ms';
      b.classList.remove('is-revealed');
    });
  }
  return { reveal, reset };
})();

/* ---------- 模块 B 入场视频（循环 / 静音；点击淡出后鸟入场） ------------ */
const Intro = (() => {
  const video = document.getElementById('module-b-intro');
  const moduleB = document.getElementById('module-b');
  let bound = false;

  function dismiss() {
    if (!video || !moduleB) return;
    if (moduleB.classList.contains('is-intro-dismissed')) return;
    moduleB.classList.add('is-intro-dismissed');
    Birds.reveal();
    video.addEventListener('transitionend', () => {
      video.pause();
    }, { once: true });
    /* 视频结束，由湿地环境音接管 */
    if (window.AudioFX) window.AudioFX.switchBG('module-b');
  }

  function play() {
    if (!video || !moduleB) { Birds.reveal(); return; }
    video.loop = true;
    video.muted = false;                 /* 保留视频原声 */
    const p = video.play();
    if (p && p.catch) {
      p.catch(() => {
        /* 浏览器拒绝带声 autoplay：静音兜底，保证画面 */
        video.muted = true;
        video.play().catch(() => {});
      });
    }
    if (!bound) {
      /* 直接点视频：最快响应 */
      video.addEventListener('pointerdown', dismiss);
      /* 兜底：模块 B 内任何点击都触发 dismiss；capture 阶段拦截冒泡到 modal.js 的 click */
      const stage = document.getElementById('stage');
      stage && stage.addEventListener('click', e => {
        if (!moduleB.classList.contains('is-active')) return;
        if (moduleB.classList.contains('is-intro-dismissed')) return;
        if (!moduleB.contains(e.target)) return;   /* 不拦 Tab 栏 */
        dismiss();
        e.stopImmediatePropagation();              /* 阻止 modal.js 弹 popup */
      }, true);
      bound = true;
    }
  }

  function reset() {
    if (!video || !moduleB) return;
    moduleB.classList.remove('is-intro-dismissed');
    video.pause();
    try { video.currentTime = 0; } catch (_) {}
    Birds.reset();
  }

  return { play, reset };
})();

/* ---------- 模块 A 层切换（skeleton / xray / plumage）------------------ */
const Layers = (() => {
  const moduleA = document.getElementById('module-a');
  const nav = moduleA && moduleA.querySelector('.layer-switch');

  function activate(layer) {
    moduleA.dataset.activeLayer = layer;
    nav.querySelectorAll('.layer-switch__btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.layer === layer);
    });
  }

  function unlock() {
    const hidden = nav.querySelectorAll('.layer-switch__btn.is-hidden');
    hidden.forEach((btn, i) => {
      btn.classList.remove('is-hidden');
      btn.removeAttribute('aria-hidden');
      btn.classList.add('is-revealing');
      btn.style.animationDelay = `${i * 120}ms`;
      btn.addEventListener('animationend',
        () => btn.classList.remove('is-revealing'), { once: true });
    });
  }

  return {
    init() {
      if (!nav) return;
      nav.addEventListener('click', e => {
        const btn = e.target.closest('.layer-switch__btn');
        if (!btn) return;
        const layer = btn.dataset.layer;
        if (!layer || btn.classList.contains('is-active')) return;
        activate(layer);
        if (window.AudioFX) window.AudioFX.play('S-UI-06-layer-switch');
      });
      /* module-a.js 拼完 5 件后派发事件，让后两个 pill 入场 */
      moduleA && moduleA.addEventListener('bones-complete', unlock);
    },
  };
})();

/* ---------- Tab 切换主控 ------------------------------------------------ */
const Tabs = (() => {
  const nav = document.querySelector('.tab-nav');
  const modules = document.querySelectorAll('.module');

  function activate(id) {
    nav.querySelectorAll('.tab-nav__btn').forEach(btn => {
      const on = btn.dataset.tab === id;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    modules.forEach(m => m.classList.toggle('is-active', m.id === id));

    if (window.AudioFX) {
      window.AudioFX.play('S-UI-02-switch');
      if (id === 'module-b') {
        window.AudioFX.fadeOutBG();      /* 让位给视频原声；dismiss 时再切 BG-B */
      } else {
        window.AudioFX.switchBG(id);     /* 回到 A：恢复 A 的 BG 音 */
      }
    }

    if (id === 'module-b') Intro.play();
    else Intro.reset();
  }

  return {
    init() {
      nav.addEventListener('click', e => {
        const btn = e.target.closest('.tab-nav__btn');
        if (!btn) return;
        const id = btn.dataset.tab;
        if (!id || btn.classList.contains('is-active')) return;
        activate(id);
      });
    },
  };
})();

/* ---------- 启动 -------------------------------------------------------- */
function boot() {
  if (window.innerWidth < CONFIG.MIN_VIEWPORT_W ||
      window.innerHeight < CONFIG.MIN_VIEWPORT_H) {
    return; // 降级页由 CSS media query 托管
  }
  Stage.init();
  Tabs.init();
  Layers.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
