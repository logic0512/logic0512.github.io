/**
 * Memory Sparks · 声音管理器（8 颗星共用）
 * ------------------------------------------------------------------
 * 职责：
 *   1. 背景氛围音：交叉淡化「无缝循环」（任何 AI 生成的片段首尾接不上也不会有咔哒声）
 *   2. 进 / 出星球：背景音淡入（~2.5s）/ 淡出（~1.0s）—— 复用父层已有的 visibility 消息
 *   3. 静音：localStorage 跨星共享，父层右上角按钮通过 postMessage 控制
 *   4. 反馈音：添加 / 删除 / 更新 等关键操作的轻量「合成音」（零文件、即时、清脆）
 *   5. 浏览器自动播放策略：首次用户交互时 resume AudioContext
 *
 * 用法（每颗星 index.html，放在 ms-config.js 之后）：
 *   <script src="../_shared/ms-sound.js"></script>
 *   <script>MS_SOUND.init('sea');</script>   // planetKey；声音配置从 ms-config 的 sound 字段读
 *
 * 设计原则：任何一步失败都「静默降级」——没有声音绝不能拖垮页面。
 */
(function () {
  'use strict';

  var MUTE_KEY = 'memory-sparks:sound-muted';

  // ── 内部状态 ──────────────────────────────────────────
  var ctx = null;            // AudioContext（懒创建）
  var masterGain = null;     // 总开关（静音用）
  var bgGain = null;         // 背景音淡入淡出用
  var bgBuffer = null;       // 解码后的氛围音 buffer
  var oneShotBuffers = {};   // 命名一次性音效 buffer（wash / hang / drip ...）
  var planetKey = null;
  var soundCfg = null;       // 当前星的 sound 配置
  var schedulerTimer = null; // 交叉淡化循环的 lookahead 定时器
  var loopState = null;      // { nextStart, period, xfade }
  var pageVisible = true;    // 当前是否「在这颗星里且可见」
  var soundActive = true;    // 是否「已真正进入星球」（飞入过程中为 false，避免没进去就响）
  var unlocked = false;      // AudioContext 是否已被用户交互解锁
  var inited = false;

  // 背景音乐层（可选）：与氛围层并存的第二条连续背景，用于「融合」星
  // （氛围保留低音量 + 叠一首背景乐）。配置：sound.music = { src, volume, fadeIn, xfade }
  var musicBuffer = null, musicGain = null, musicTimer = null, musicState = null, musicCfg = null;

  function muted() {
    try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; }
  }

  // ── AudioContext 懒创建 ───────────────────────────────
  function ensureCtx() {
    if (ctx) return ctx;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted() ? 0 : 1;
      masterGain.connect(ctx.destination);
      bgGain = ctx.createGain();
      bgGain.gain.value = 0; // 起步静音，靠 fade-in 抬起
      bgGain.connect(masterGain);
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  // ── 自动播放解锁：首次交互 resume ─────────────────────
  function unlock() {
    if (unlocked) return;
    var c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') {
      c.resume().then(function () {
        unlocked = true;
        // 解锁后若当前应该响，补一次淡入
        if (pageVisible) fadeBg(targetVolume(), 1.2);
      }).catch(function () {});
    } else {
      unlocked = true;
    }
  }

  function bindUnlockOnce() {
    var evs = ['pointerdown', 'touchstart', 'keydown'];
    function handler() {
      unlock();
      evs.forEach(function (ev) { window.removeEventListener(ev, handler); });
    }
    evs.forEach(function (ev) { window.addEventListener(ev, handler, { passive: true }); });
  }

  function targetVolume() {
    // 背景音只跟「是否真正在星球内」(soundActive) 走，不被「列表页/不可见」(pageVisible) 停掉——
    // 列表页时声音应继续。pageVisible 只影响画面渲染，不影响音乐。
    if (!soundCfg || muted() || !soundActive) return 0;
    return typeof soundCfg.volume === 'number' ? soundCfg.volume : 0.5;
  }

  // ── 背景音淡入淡出 ────────────────────────────────────
  function fadeBg(to, seconds) {
    if (!bgGain || !ctx) return;
    var now = ctx.currentTime;
    var g = bgGain.gain;
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(0.0001, g.value), now);
      // 用指数渐变更接近人耳感受；到 0 用 linear 收尾
      if (to <= 0.0001) {
        g.linearRampToValueAtTime(0.0001, now + seconds);
      } else {
        g.exponentialRampToValueAtTime(to, now + seconds);
      }
    } catch (e) {}
  }

  // ── 交叉淡化「无缝循环」调度器 ────────────────────────
  // 每个循环周期提前 xfade 秒启动下一份 buffer，两份在交叠区做等功率交叉淡化，
  // 所以即使片段首尾电平 / 相位不一致，也听不到接缝。
  function scheduleCycle(startAt) {
    if (!ctx || !bgBuffer) return;
    var src = ctx.createBufferSource();
    src.buffer = bgBuffer;
    var g = ctx.createGain();
    src.connect(g);
    g.connect(bgGain);

    var xfade = loopState.xfade;
    var period = loopState.period; // = buffer.duration - xfade
    g.gain.setValueAtTime(0.0001, startAt);
    g.gain.linearRampToValueAtTime(1, startAt + xfade);          // 淡入
    g.gain.setValueAtTime(1, startAt + period);                   // 保持
    g.gain.linearRampToValueAtTime(0.0001, startAt + period + xfade); // 淡出

    try { src.start(startAt); } catch (e) {}
    try { src.stop(startAt + period + xfade + 0.05); } catch (e) {}
    src.onended = function () { try { src.disconnect(); g.disconnect(); } catch (e) {} };
  }

  function startLoop() {
    if (!ctx || !bgBuffer || loopState) return;
    var dur = bgBuffer.duration;
    var xfade = Math.min(soundCfg && soundCfg.xfade ? soundCfg.xfade : 2.5, dur * 0.45);
    var period = Math.max(0.5, dur - xfade);
    loopState = { xfade: xfade, period: period, nextStart: ctx.currentTime + 0.08 };

    // lookahead：每 250ms 检查，确保未来 ~3s 内的循环都已排好。
    // 用自循环 setTimeout（而不是 setInterval）—— iframe 的可见性暂停只拦 setInterval/RAF，
    // 不拦 setTimeout，所以列表页（不可见）时音频循环照常调度、声音继续。
    function tick() {
      if (!loopState) return;
      var horizon = ctx.currentTime + 3.0;
      while (loopState.nextStart < horizon) {
        scheduleCycle(loopState.nextStart);
        loopState.nextStart += loopState.period;
      }
      schedulerTimer = setTimeout(tick, 250);
    }
    tick();
  }

  function stopLoop() {
    if (schedulerTimer) { clearTimeout(schedulerTimer); schedulerTimer = null; }
    loopState = null;
  }

  // ── 背景音乐层：与氛围层并存的连续背景（交叉淡化无缝循环）──
  function targetMusicVolume() {
    if (!musicCfg || muted() || !soundActive) return 0;
    return typeof musicCfg.volume === 'number' ? musicCfg.volume : 0.5;
  }
  function ensureMusicGain() {
    if (!musicGain && ctx) { musicGain = ctx.createGain(); musicGain.gain.value = 0; musicGain.connect(masterGain); }
  }
  function fadeMusic(to, seconds) {
    if (!musicGain || !ctx) return;
    var now = ctx.currentTime, g = musicGain.gain;
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(0.0001, g.value), now);
      if (to <= 0.0001) g.linearRampToValueAtTime(0.0001, now + seconds);
      else g.exponentialRampToValueAtTime(to, now + seconds);
    } catch (e) {}
  }
  function scheduleMusicCycle(startAt) {
    if (!ctx || !musicBuffer) return;
    var src = ctx.createBufferSource();
    src.buffer = musicBuffer;
    var g = ctx.createGain();
    src.connect(g); g.connect(musicGain);
    var xfade = musicState.xfade, period = musicState.period;
    g.gain.setValueAtTime(0.0001, startAt);
    g.gain.linearRampToValueAtTime(1, startAt + xfade);
    g.gain.setValueAtTime(1, startAt + period);
    g.gain.linearRampToValueAtTime(0.0001, startAt + period + xfade);
    try { src.start(startAt); } catch (e) {}
    try { src.stop(startAt + period + xfade + 0.05); } catch (e) {}
    src.onended = function () { try { src.disconnect(); g.disconnect(); } catch (e) {} };
  }
  function startMusicLoop() {
    if (!ctx || !musicBuffer || musicState) return;
    var dur = musicBuffer.duration;
    var xfade = Math.min(musicCfg && musicCfg.xfade ? musicCfg.xfade : 3.0, dur * 0.45);
    var period = Math.max(0.5, dur - xfade);
    musicState = { xfade: xfade, period: period, nextStart: ctx.currentTime + 0.08 };
    function tick() {
      if (!musicState) return;
      var horizon = ctx.currentTime + 3.0;
      while (musicState.nextStart < horizon) {
        scheduleMusicCycle(musicState.nextStart);
        musicState.nextStart += musicState.period;
      }
      musicTimer = setTimeout(tick, 250);
    }
    tick();
  }
  function loadMusicBuffer(url) {
    var c = ensureCtx();
    if (!c || !url) return;
    fetch(url)
      .then(function (r) { if (!r.ok) throw new Error('music fetch ' + r.status); return r.arrayBuffer(); })
      .then(function (buf) { return new Promise(function (resolve, reject) { c.decodeAudioData(buf, resolve, reject); }); })
      .then(function (decoded) {
        musicBuffer = decoded;
        ensureMusicGain();
        startMusicLoop();
        if (pageVisible && !muted()) {
          unlock();
          fadeMusic(targetMusicVolume(), musicCfg && musicCfg.fadeIn ? musicCfg.fadeIn : 2.5);
        }
      })
      .catch(function () { /* 静默降级：无背景乐 */ });
  }

  // ── 加载并解码氛围音 ──────────────────────────────────
  function loadBuffer(url) {
    var c = ensureCtx();
    if (!c || !url) return;
    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('sound fetch ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        return new Promise(function (resolve, reject) {
          c.decodeAudioData(buf, resolve, reject);
        });
      })
      .then(function (decoded) {
        bgBuffer = decoded;
        startLoop();
        if (pageVisible && !muted()) {
          unlock();
          fadeBg(targetVolume(), soundCfg && soundCfg.fadeIn ? soundCfg.fadeIn : 2.5);
        }
      })
      .catch(function () { /* 静默降级：无背景音 */ });
  }

  // ── 交互层一次性音效（如海浪冲沙）──────────────────
  // 用真实音效样本播一次，叠在背景层之上，受静音控制。
  function loadSample(url, assign) {
    var c = ensureCtx();
    if (!c || !url) return;
    fetch(url)
      .then(function (r) { if (!r.ok) throw new Error(); return r.arrayBuffer(); })
      .then(function (buf) { return new Promise(function (res, rej) { c.decodeAudioData(buf, res, rej); }); })
      .then(function (decoded) { assign(decoded); })
      .catch(function () {});
  }

  // 解析某个命名一次性音效的配置（wash 兼容旧写法，其余从 oneShots 读）
  function oneShotCfg(name) {
    if (!soundCfg) return null;
    if (name === 'wash' && soundCfg.wash) return soundCfg.wash;
    if (soundCfg.oneShots && soundCfg.oneShots[name]) return soundCfg.oneShots[name];
    return null;
  }

  // 播一次命名音效（支持 裁剪起点 / 音量 / 速度 / 淡入淡出），叠在背景层之上
  // volMul：可选音量系数（如按水珠可见度缩放每记水滴）
  function playOneShot(name, volMul) {
    var c = ensureCtx();
    var buf = oneShotBuffers[name];
    var w = oneShotCfg(name);
    if (!c || !buf || !w || muted() || !soundActive) return;
    if (c.state === 'suspended') { unlock(); return; }
    var vol = (typeof w.volume === 'number' ? w.volume : 0.9) * (volMul == null ? 1 : Math.max(0, volMul));
    var rate = typeof w.rate === 'number' ? w.rate : 1;
    var trim = typeof w.trim === 'number' ? w.trim : 0;   // 裁剪起点（秒）
    var src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    var g = c.createGain();
    src.connect(g); g.connect(masterGain);
    var t0 = c.currentTime;
    var start = Math.max(0, trim);
    var playDur = Math.max(0.05, (buf.duration - start) / rate);
    var fi = Math.min(w.fadeIn || 0, playDur * 0.5);
    var fo = Math.min(w.fadeOut || 0, playDur * 0.5);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + Math.max(0.005, fi));
    g.gain.setValueAtTime(vol, t0 + playDur - fo);
    g.gain.linearRampToValueAtTime(0.0001, t0 + playDur);
    try { src.start(t0, start); } catch (e) { try { src.start(); } catch (e2) {} }
    try { src.stop(t0 + playDur + 0.05); } catch (e) {}
    src.onended = function () { try { src.disconnect(); g.disconnect(); } catch (e) {} };
  }

  // ── 录音期间压低背景（如海星录音时音乐让位），录完恢复 ──
  // duckBg(level)：把背景压到 level（很低）；restoreBg()：恢复到正常音量
  var duckedRef = false;
  function duckBg(level, attack) {
    if (!bgGain || !ctx) return;
    duckedRef = true;
    var now = ctx.currentTime, g = bgGain.gain;
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(0.0001, g.value), now);
      g.exponentialRampToValueAtTime(Math.max(0.0001, level == null ? 0.04 : level), now + (attack == null ? 0.18 : attack));
    } catch (e) {}
    // 背景乐层同步压低
    if (musicGain) {
      var gm = musicGain.gain;
      try {
        gm.cancelScheduledValues(now);
        gm.setValueAtTime(Math.max(0.0001, gm.value), now);
        gm.exponentialRampToValueAtTime(Math.max(0.0001, level == null ? 0.04 : level), now + (attack == null ? 0.18 : attack));
      } catch (e) {}
    }
  }
  function restoreBg(release) {
    if (!bgGain || !ctx) return;
    duckedRef = false;
    var now = ctx.currentTime, g = bgGain.gain;
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(0.0001, g.value), now);
      g.exponentialRampToValueAtTime(Math.max(0.0001, targetVolume()), now + (release == null ? 0.8 : release));
    } catch (e) {}
    // 背景乐层同步恢复
    if (musicGain) {
      var gm = musicGain.gain;
      try {
        gm.cancelScheduledValues(now);
        gm.setValueAtTime(Math.max(0.0001, gm.value), now);
        gm.exponentialRampToValueAtTime(Math.max(0.0001, targetMusicVolume()), now + (release == null ? 0.8 : release));
      } catch (e) {}
    }
  }

  // ── 反馈音（轻量合成，零文件）────────────────────────
  // kind: 'add' | 'delete' | 'update'
  function feedback(kind) {
    // 通用合成「提示音」默认关闭：每颗星都有自己的专属交互音，不再叠一记电子录入音。
    // 只有某颗星显式配置了 sound.feedback 才会响。
    if (!soundCfg || !soundCfg.feedback) return;
    var c = ensureCtx();
    if (!c || muted()) return;
    if (c.state === 'suspended') return; // 未解锁就不出声，避免堆积
    var fb = soundCfg.feedback;
    // 某些星某些操作由专属音效代表（如海星的「添加」= 冲沙音），这里跳过合成反馈
    if (fb.mute && fb.mute.indexOf(kind) !== -1) return;
    var wave = fb.wave || 'sine';
    var base = fb.baseFreq || 440;
    var vol = (typeof fb.volume === 'number' ? fb.volume : 0.12);

    // 不同操作 → 不同音高走向
    var notes;
    if (kind === 'delete')      notes = [base, base * 0.66];        // 下行：带走 / 消失
    else if (kind === 'update') notes = [base * 0.9];               // 单点：轻确认
    else                        notes = [base, base * 1.33];        // 上行：生成 / 记下

    var now = c.currentTime;
    var step = 0.085;
    for (var i = 0; i < notes.length; i++) {
      var osc = c.createOscillator();
      var g = c.createGain();
      var lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = (fb.cutoff || 2200);
      osc.type = wave;
      osc.frequency.value = notes[i];
      osc.connect(lp); lp.connect(g); g.connect(masterGain);
      var t0 = now + i * step;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      osc.start(t0);
      osc.stop(t0 + 0.32);
      (function (o, gg) { o.onended = function () { try { o.disconnect(); gg.disconnect(); } catch (e) {} }; })(osc, g);
    }
  }

  // ── 静音切换 ──────────────────────────────────────────
  function applyMute(isMuted) {
    if (!masterGain || !ctx) return;
    var now = ctx.currentTime;
    try {
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), now);
      masterGain.gain.linearRampToValueAtTime(isMuted ? 0.0001 : 1, now + 0.25);
    } catch (e) {}
  }

  function setMuted(isMuted) {
    try { localStorage.setItem(MUTE_KEY, isMuted ? '1' : '0'); } catch (e) {}
    ensureCtx();
    applyMute(isMuted);
    if (!isMuted) unlock();
  }

  // ── 可见性（进 / 出星球、切 tab）─────────────────────
  function setVisible(v) {
    pageVisible = !!v;
    ensureCtx();
    if (pageVisible) unlock();
    // 不可见（列表页 / 切 tab）不再把背景硬淡到 0 —— 由 targetVolume()（soundActive）决定：
    // 列表页时 soundActive 仍为真 → 继续播放；真正退出/切走时 soundActive false → 自然淡出。
    fadeBg(targetVolume(), pageVisible ? (soundCfg && soundCfg.fadeIn ? soundCfg.fadeIn : 2.5) : 0.6);
    fadeMusic(targetMusicVolume(), pageVisible ? (musicCfg && musicCfg.fadeIn ? musicCfg.fadeIn : 2.5) : 0.6);
  }

  // 已真正进入星球（飞入完成）才放行声音；飞入 / 退出过程中静默
  function setActive(v) {
    soundActive = !!v;
    ensureCtx();
    if (soundActive) unlock();
    fadeBg(targetVolume(), soundActive ? (soundCfg && soundCfg.fadeIn ? soundCfg.fadeIn : 2.5) : (soundCfg && soundCfg.fadeOut ? soundCfg.fadeOut : 1.0));
    fadeMusic(targetMusicVolume(), soundActive ? (musicCfg && musicCfg.fadeIn ? musicCfg.fadeIn : 2.5) : (musicCfg && musicCfg.fadeOut ? musicCfg.fadeOut : 1.0));
  }

  // ── 父层消息桥接 ──────────────────────────────────────
  function bindMessages() {
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || typeof d !== 'object') return;
      switch (d.type) {
        case 'memory-sparks:visibility':
          setVisible(d.visible);
          break;
        case 'memory-sparks:sound-active':
          setActive(d.active);
          break;
        case 'memory-sparks:sound-muted':
          setMuted(!!d.muted);
          break;
      }
    });
  }

  // ── 初始化 ────────────────────────────────────────────
  function init(key) {
    if (inited) return;
    inited = true;
    planetKey = key;
    var cfg = (window.MS_PLANETS && window.MS_PLANETS[key]) || {};
    soundCfg = cfg.sound || null;

    bindMessages();
    bindUnlockOnce();

    if (soundCfg && soundCfg.src) {
      loadBuffer(soundCfg.src);
    }
    // 背景音乐层（融合星）：与氛围层并存的第二条连续背景
    if (soundCfg && soundCfg.music && soundCfg.music.src) {
      musicCfg = soundCfg.music;
      loadMusicBuffer(musicCfg.src);
    }
    // 加载命名一次性音效：wash（兼容旧写法）+ oneShots（hang / drip ...）
    if (soundCfg && soundCfg.wash && soundCfg.wash.src) {
      loadSample(soundCfg.wash.src, function (b) { oneShotBuffers.wash = b; });
    }
    if (soundCfg && soundCfg.oneShots) {
      Object.keys(soundCfg.oneShots).forEach(function (n) {
        var o = soundCfg.oneShots[n];
        if (o && o.src) loadSample(o.src, function (b) { oneShotBuffers[n] = b; });
      });
    }
  }

  window.MS_SOUND = {
    init: init,
    feedback: feedback,
    play: playOneShot,              // 通用：MS_SOUND.play('hang' / 'drip' / 'wash')
    wash: function () { playOneShot('wash'); },  // 兼容海星
    duckBg: duckBg,                 // 录音时把背景压低：duckBg(level, attack)
    restoreBg: restoreBg,           // 录音完恢复背景：restoreBg(release)
    setMuted: setMuted,
    setVisible: setVisible,
    setActive: setActive,
    isMuted: muted,
  };
})();
