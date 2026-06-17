/**
 * Memory Sparks · 全局反馈机制
 * 用法：
 *   <script src="../_shared/ms-feedback.js"></script>
 *   msToast('已记下');
 *   const ok = await msConfirm('要删除这条记录吗？', { yes: '删除', no: '取消', danger: true });
 *   if (ok) ...
 */
(function(){
  // ─── Toast ───────────────────────────────
  let toastEl = null;
  let toastTimer = null;

  window.msToast = function(text, options = {}) {
    const duration = options.duration ?? 2000;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'ms-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    clearTimeout(toastTimer);
    // 强制 reflow → 让动画稳定
    void toastEl.offsetWidth;
    requestAnimationFrame(() => toastEl.classList.add('show'));
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, duration);
  };

  // ─── Confirm ─────────────────────────────
  let confirmEl = null;

  function ensureConfirmEl() {
    if (confirmEl) return confirmEl;
    confirmEl = document.createElement('div');
    confirmEl.className = 'ms-confirm-backdrop';
    confirmEl.innerHTML = `
      <div class="ms-confirm">
        <div class="msg"></div>
        <div class="actions">
          <button type="button" class="no"></button>
          <button type="button" class="yes"></button>
        </div>
      </div>
    `;
    document.body.appendChild(confirmEl);
    return confirmEl;
  }

  // ─── 拦截原生 alert → msToast（无副作用） ───
  // 不拦截 confirm（sync vs async 不兼容）
  const _nativeAlert = window.alert.bind(window);
  window.alert = function(msg) {
    if (typeof msg !== 'string') return _nativeAlert(msg);
    msToast(msg);
  };

  // ─── P2: 暂停 GSAP 全局 timeline ───
  // 父页面切 tab 时，给 iframe 内已建立的所有 GSAP timeline 暂停（避免后台空转 CPU）
  let _gsapAllPausedOn = false;
  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'memory-sparks:visibility') return;
    if (typeof window.gsap === 'undefined') return;
    if (e.data.visible) {
      if (_gsapAllPausedOn) {
        // 恢复全局所有 tweens
        try { window.gsap.globalTimeline.play(); } catch {}
        _gsapAllPausedOn = false;
      }
    } else {
      try { window.gsap.globalTimeline.pause(); } catch {}
      _gsapAllPausedOn = true;
    }
  });

  // ─── 自动反馈：localStorage 变化 → msToast ───
  // 延迟 2.5s 启用，避开页面初始化期间各星的 demo data 写入
  let _storageHookOn = false;
  setTimeout(() => { _storageHookOn = true; }, 2500);

  const _setItem    = localStorage.setItem.bind(localStorage);
  const _removeItem = localStorage.removeItem.bind(localStorage);
  // 只针对 8 颗星和 memory-sparks 命名空间的 key
  const KEY_PATTERN = /^(memory-sparks|beizi|cloud|flower|hiking|sea|starry|tree|healing)/i;

  // 防抖：同一 key 短时间多次 setItem 只通知一次（避免雪崩）
  const _notifyDebounce = new Map();
  localStorage.setItem = function(key, value) {
    const before = localStorage.getItem(key);
    _setItem(key, value);
    if (!KEY_PATTERN.test(key) || before === value) return;
    // 防抖通知父 App
    const prevTimer = _notifyDebounce.get(key);
    if (prevTimer) clearTimeout(prevTimer);
    _notifyDebounce.set(key, setTimeout(() => {
      _notifyDebounce.delete(key);
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'memory-sparks:storage-changed', key }, '*');
        }
      } catch {}
    }, 80));
    if (!_storageHookOn) return;
    try {
      const a = before ? JSON.parse(before) : [];
      const b = JSON.parse(value);
      if (Array.isArray(a) && Array.isArray(b)) {
        if (b.length > a.length)      { window.msToast('已记下'); window.MS_SOUND && window.MS_SOUND.feedback('add'); }
        else if (b.length < a.length) { window.msToast('已删除'); window.MS_SOUND && window.MS_SOUND.feedback('delete'); }
        else                          { window.msToast('已更新'); window.MS_SOUND && window.MS_SOUND.feedback('update'); }
      }
    } catch {
      // 非数组类型变化，不 toast
    }
  };

  localStorage.removeItem = function(key) {
    _removeItem(key);
    if (_storageHookOn && KEY_PATTERN.test(key)) { window.msToast('已清空'); window.MS_SOUND && window.MS_SOUND.feedback('delete'); }
  };

  window.msConfirm = function(question, options = {}) {
    return new Promise((resolve) => {
      const el = ensureConfirmEl();
      const inner = el.querySelector('.ms-confirm');
      el.querySelector('.msg').textContent = question;
      el.querySelector('.no').textContent = options.no || '取消';
      el.querySelector('.yes').textContent = options.yes || '确认';
      inner.classList.toggle('danger', !!options.danger);
      el.classList.add('show');

      const cleanup = (result) => {
        el.classList.remove('show');
        el.querySelector('.no').onclick = null;
        el.querySelector('.yes').onclick = null;
        resolve(result);
      };
      el.querySelector('.no').onclick = () => cleanup(false);
      el.querySelector('.yes').onclick = () => cleanup(true);
    });
  };
})();
