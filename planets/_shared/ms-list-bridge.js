/**
 * Memory Sparks · 列表模式桥接（iframe 内通用）
 *
 * 每颗星都引入这个脚本，做两件事：
 * 1. 监听父 App 的 message → 进入/退出列表上下文（隐藏星球主体）
 * 2. 监听 records-reload message → 重新加载本星记录到内存（保持两边同步）
 *
 * 用法（在每颗星 bootMSShared 调 MS.bootstrap 后再调一次）：
 *   MS.bridgeListMode({
 *     storageKey: 'memory-sparks:beizi-records',
 *     onReload: () => { records = loadRecords(); renderTimeline(); },  // 父 App 改完 storage 后调
 *   });
 */
window.MS = window.MS || {};

// ── 通用 RAF/setInterval 暂停 ──
// 收到 visibility=false（父 App 切走 tab 或进列表模式）时，
// 拦截 requestAnimationFrame 和 setInterval 让所有星的动画自动暂停，避免 CPU 空跑。
// 同源 iframe 在 visibility:hidden 状态下 JS 仍跑（不会自动 pause），需要手动控制。
(function setupGlobalActivityPause() {
  if (window.__msActivityHooked) return;
  window.__msActivityHooked = true;

  let __active = true;
  const _raf = window.requestAnimationFrame.bind(window);
  const _setInt = window.setInterval.bind(window);
  let pendingRafs = [];

  window.requestAnimationFrame = function(cb) {
    if (__active) return _raf(cb);
    pendingRafs.push(cb);
    return -1;
  };
  window.setInterval = function(cb, ms) {
    return _setInt(function() { if (__active) cb(); }, ms);
  };

  window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'memory-sparks:visibility') return;
    const wasActive = __active;
    __active = !!e.data.visible;
    if (!wasActive && __active && pendingRafs.length) {
      const q = pendingRafs; pendingRafs = [];
      q.forEach(cb => _raf(cb));
    }
  });
})();

MS.bridgeListMode = function({ storageKey, onReload } = {}) {
  // 拍快照原 parent（composer 移到 body 后还原用）
  const composerParents = new WeakMap();

  // 收集所有需要在列表模式下保持可见的元素（composer/backdrop/overlay/历史 modal 等）
  // 这些元素如果嵌在 .stage 之类的容器内，列表模式会让它们跟着不可见 → 黑屏
  // 全部 move 到 body 直接子层，才能跟白名单 CSS 配合显示
  function collectFloatingElements() {
    // 顶层弹窗类元素 — 这些是会被 moveOut 到 body 顶层的
    // 不包含 .composer-panel：它是 .composer-backdrop 的子，会跟着 backdrop 一起移动
    // 单独 move 会让它离开 backdrop 父级 → body 直接子 → 不在 ms-list-context 白名单 → display:none
    const SEL = [
      '.composer-backdrop',
      '.msc-backdrop',
      '.composer',
      '#composer',
      '.input-mask',
      '.input-panel',
      '.panel',
      '.overlay',
      '.history-modal',
      '#historyModal',
      '#backdrop',
      '#overlay',
    ];
    const set = new Set();
    SEL.forEach(s => {
      document.querySelectorAll(s).forEach(el => set.add(el));
    });
    // 排除已经被其它 floating 元素包含的 — 避免父子双移
    const arr = [...set];
    return arr.filter(el => !arr.some(other => other !== el && other.contains(el)));
  }

  function moveComposerOut(cb) {
    if (!cb || cb.parentElement === document.body) return;
    composerParents.set(cb, {
      parent: cb.parentElement,
      next: cb.nextSibling,
    });
    document.body.appendChild(cb);
  }
  function moveComposerBack(cb) {
    if (!cb) return;
    const ref = composerParents.get(cb);
    if (!ref || !ref.parent || !ref.parent.isConnected) return;
    if (ref.next && ref.next.parentElement === ref.parent) ref.parent.insertBefore(cb, ref.next);
    else ref.parent.appendChild(cb);
    composerParents.delete(cb);
  }

  window.addEventListener('message', (e) => {
    if (!e.data || typeof e.data !== 'object') return;

    // 列表上下文切换：进入则给 body 加 class（CSS 隐藏星球主体）+ 把所有 composer 类元素移到 body 下
    if (e.data.type === 'memory-sparks:list-mode') {
      const enabled = !!e.data.enabled;
      document.body.classList.toggle('ms-list-context', enabled);
      // 强制 html + body 透明（iframe 内某些星 html 元素有不透明 background，挡住父 App 的虚化卡片）
      if (enabled) {
        document.documentElement.style.background = 'transparent';
        document.documentElement.style.backgroundColor = 'transparent';
        document.body.style.background = 'transparent';
        document.body.style.backgroundColor = 'transparent';
      } else {
        document.documentElement.style.background = '';
        document.documentElement.style.backgroundColor = '';
        document.body.style.background = '';
        document.body.style.backgroundColor = '';
      }
      const floatings = collectFloatingElements();
      floatings.forEach(el => {
        if (enabled) moveComposerOut(el);
        else moveComposerBack(el);
      });
    }

    // 父 App 列表 composer 保存/删除后通知：重新加载本星记录到内存
    if (e.data.type === 'memory-sparks:records-reload') {
      try { onReload?.(); } catch (err) {
        console.warn('[ms-list-bridge] onReload failed:', err);
      }
    }

    // 父 App 列表里点 +/编辑 → 让本星打开自己的 composer（真正"统一"）
    if (e.data.type === 'memory-sparks:open-composer') {
      const editIdx = typeof e.data.editIdx === 'number' ? e.data.editIdx : -1;
      if (typeof window.__msOpenComposer === 'function') {
        try { window.__msOpenComposer(editIdx); } catch (err) {
          console.warn('[ms-list-bridge] __msOpenComposer failed:', err);
        }
      } else {
        console.warn('[ms-list-bridge] 本星未实现 window.__msOpenComposer');
      }
    }

    // C5：父 App 切页面/切星球 → 关掉所有弹窗，避免回来还显示上一次的卡片
    if (e.data.type === 'memory-sparks:close-popups') {
      // 0) 关掉 ms-composer（新通用添加界面）
      try { if (window.MS && window.MS.composer) window.MS.composer.close(); } catch (_) {}
      // 1) 各类 composer / popup / modal / overlay 去掉 open/show class
      const POPUP_SEL = '.composer, .composer-backdrop, .composer-panel, .panel, .input-mask, .input-panel, .history-modal, .leaf-card, .ms-card-detail-backdrop, #popup, #leafCard, #activeDetail .detail-card, .reader, .rcard, .del-confirm, .msc-backdrop';
      document.querySelectorAll(POPUP_SEL).forEach(el => {
        el.classList.remove('open', 'show', 'visible', 'on');
      });
      // 2) body 上常见的 open class
      ['beizi-composer-open','starry-composer-open','modal-open','input-open','no-drag','ms-composer-open'].forEach(c => document.body.classList.remove(c));
      // 3) backdrop 也关
      document.querySelectorAll('#backdrop, .backdrop, #overlay, .overlay').forEach(el => el.classList.remove('open', 'on', 'show'));
    }
  });

  // 暴露 records 给父 App 读（其实父 App 走 localStorage 不需要这个，但万一调用方需要）
  if (storageKey) {
    window.__msReadRecords = function() {
      try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); }
      catch { return []; }
    };
  }
};

/** 通用：iframe 内 composer 关闭/保存后调，通知父 App 列表层切回 + 可能 reload */
MS.notifyComposerClosed = function({ dirty = false } = {}) {
  document.body.classList.remove('ms-composer-open');
  // 通知父 App 也清掉 React 层的 dirty 标记
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'memory-sparks:composer-closed',
        dirty: !!dirty,
      }, '*');
    }
  } catch (_) {}
};

/** 通用：iframe 内 composer 打开时调，给 body 加 ms-composer-open class 暂停背景动画 */
MS.notifyComposerOpened = function() {
  document.body.classList.add('ms-composer-open');
};

/* 兜底：监听 .composer / .panel / .input-mask 出现 .open / .show class
   1) 给 body 加 ms-composer-open 暂停背景动画
   2) 直接 inline-style 强制 composer 可见（绕过被 moveOut 破坏的 CSS transition） */
(function setupComposerOpenObserver() {
  if (window.__msComposerObserverOn) return;
  window.__msComposerObserverOn = true;
  const COMPOSER_SEL = '.composer, .composer-backdrop, .msc-backdrop, .composer-panel, .panel.composer, .panel.reader, .input-mask, .input-panel';

  function applyForceVisible(el) {
    const opened = el.classList.contains('open') || el.classList.contains('show');
    if (opened) {
      // 把原始 transform 中的 scale 强制设为 1（保留其他 translate 部分）
      el.style.setProperty('opacity', '1', 'important');
      el.style.setProperty('pointer-events', 'auto', 'important');
      el.style.setProperty('visibility', 'visible', 'important');
      // input-mask 是全屏 backdrop，不需要 transform；其他居中 panel 用 translate(-50%,-50%) scale(1)
      if (el.matches('.input-mask, .composer-backdrop, .msc-backdrop, .overlay')) {
        // 这类是 backdrop / 全屏，不动 transform
      } else {
        el.style.setProperty('transform', 'translate(-50%, -50%) scale(1)', 'important');
      }
    } else {
      el.style.removeProperty('opacity');
      el.style.removeProperty('pointer-events');
      el.style.removeProperty('visibility');
      el.style.removeProperty('transform');
    }
  }
  // 记录上次状态，避免重复 pause/resume gsap
  let lastOpen = false;
  function check() {
    const all = [...document.querySelectorAll(COMPOSER_SEL)];
    let anyOpen = false;
    all.forEach(el => {
      applyForceVisible(el);
      // 新版共享添加界面（ms-composer）用 .msc-open 标记打开，旧版用 .open/.show。
      // 必须三者都认，否则新添加界面打开时 anyOpen=false → 不暂停 GSAP/动画
      // → 主线程被 GSAP ticker 占住 → 打字「字出来慢」（海星卡顿真因）。
      if (el.classList.contains('open') || el.classList.contains('show') || el.classList.contains('msc-open')) anyOpen = true;
    });
    document.body.classList.toggle('ms-composer-open', anyOpen);

    // composer 打开时全面暂停：GSAP + video/audio + 直接 dispatch visibility=false 让顶层 RAF 拦截器停掉所有 RAF
    // → 解决行星/被子/繁星等用 GSAP/Three.js 跑常驻动画的卡顿
    if (anyOpen !== lastOpen) {
      lastOpen = anyOpen;
      try {
        if (window.gsap) {
          if (anyOpen) window.gsap.globalTimeline.pause();
          else window.gsap.globalTimeline.resume();
        }
      } catch(_) {}
      try {
        if (anyOpen) {
          document.querySelectorAll('video, audio').forEach(m => {
            if (!m.paused) { m.dataset._msAutopaused = '1'; m.pause(); }
          });
        } else {
          document.querySelectorAll('video[data-_msAutopaused], audio[data-_msAutopaused]').forEach(m => {
            delete m.dataset._msAutopaused;
            m.play().catch(()=>{});
          });
        }
      } catch(_) {}
      // 注意：不要 dispatch visibility=false——它会让全局 RAF 拦截器停掉所有 RAF，
      // 包括上传照片/解析文件/Canvas 等功能性 RAF，导致用户上传照片就卡死。
      // 卡顿只能靠 GSAP pause + CSS animation pause 来处理（覆盖动画类不影响功能）
    }
  }
  let pending = false;
  const obs = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; check(); });
  });
  function attach() {
    if (!document.body) { setTimeout(attach, 30); return; }
    obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
    check();
  }
  attach();
})();
