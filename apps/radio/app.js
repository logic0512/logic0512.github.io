'use strict';

const $ = id => document.getElementById(id);

// ── State ──────────────────────────────────────────
const S = {
  songId:    null,
  songUrl:   null,  // pre-fetched URL for the upcoming song
  playing:   false,
  miniMode:  false,
  djPhase:   'idle',
  theme:     'night',
};

// ── DOM ────────────────────────────────────────────
const dom = {
  html:           document.documentElement,
  // card
  cardTilt:       $('card-tilt'),
  cardFace:       $('card-face'),
  cardHolo:       document.querySelector('.card-holo'),
  cardHolo2:      document.querySelector('.card-holo2'),
  coverImg:       $('cover-img'),
  coverPlaceholder: $('cover-placeholder'),
  cardBackName:   $('card-back-name'),
  cardBackArtist: $('card-back-artist'),
  cardBackStory:  $('card-back-story'),
  songInfoDivider: $('song-info-divider'),
  // player left
  songName:       $('song-name'),
  songArtist:     $('song-artist'),
  btnLike:        $('btn-like'),
  btnPlayPause:   $('btn-play-pause'),
  iconPlay:       $('icon-play'),
  iconPause:      $('icon-pause'),
  btnNext:        $('btn-next'),
  progressFill:   $('progress-fill'),
  timeCurrent:    $('time-current'),
  timeTotal:      $('time-total'),
  // right
  themeToggle:    $('theme-toggle'),
  modeToggle:     $('mode-toggle'),
  clockTime:      $('clock-time'),
  clockWeekday:   $('clock-weekday'),
  clockDate:      $('clock-date'),
  clockBadge:     $('clock-badge'),
  weatherChip:    $('weather-chip'),
  tabChat:        $('tab-chat'),
  tabHistory:     $('tab-history'),
  tabLyrics:      $('tab-lyrics'),
  chatMessages:   $('chat-messages'),
  chatArea:       $('chat-area'),
  historyArea:    $('history-area'),
  historyList:    $('history-list'),
  lyricsArea:     $('lyrics-area'),
  lyricsText:     $('lyrics-text'),
  lyricsLoading:  $('lyrics-loading'),
  lyricsEmpty:    $('lyrics-empty'),
  userInput:      $('user-input'),
  sendBtn:        $('send-btn'),
  // audio
  djAudio:        $('dj-audio'),
  audioPlayer:    $('audio-player'),
  // quick actions
  btnQaCaim:      $('btn-qa-calm'),
  btnQaLike:      $('btn-qa-like'),
  btnQaNext:      $('btn-qa-next'),
  quickActions:   $('quick-actions'),
  // popup panel
  btnInfo:       $('btn-info'),
  songInfoPopup: $('song-info-popup'),
  btnClosePopup: $('btn-close-popup'),
  // mini
  miniPlayer:     $('mini-player'),
  miniCover:      $('mini-cover'),
  miniSongName:   $('mini-song-name'),
  miniSongArtist: $('mini-song-artist'),
  miniPlayPause:  $('mini-play-pause'),
  miniNext:       $('mini-next'),
  miniExpand:     $('mini-expand'),
  miniFill:       $('mini-progress-fill'),
  // login
  loginModal:     $('login-modal'),
  loginPhone:     $('login-phone'),
  loginCaptcha:   $('login-captcha'),
  loginSend:      $('login-send'),
  loginConfirm:   $('login-confirm'),
  loginMsg:       $('login-msg'),
  stepCaptcha:    $('step-captcha'),
  tapOverlay:     $('tap-overlay'),
};

const DAYS = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
const MON  = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
function pad(n) { return String(n).padStart(2,'0'); }
function fmt(s) { if (!isFinite(s)) return '0:00'; return `${Math.floor(s/60)}:${pad(Math.floor(s%60))}`; }

let _lyricsForId = null;

// ──────────────────────────────────────────────────
// 1. HOLOGRAPHIC CARD TILT
// ──────────────────────────────────────────────────

(function initCard() {
  const el = dom.cardTilt;
  let rx = -4, ry = 6, vx = 0, vy = 0;
  let pointerDown = false, lastX = 0, lastY = 0;
  let lastTouch = 0, totalMove = 0;

  function applyTilt() {
    el.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    const hx = 50 + ry * 1.2;
    const hy = 50 - rx * 1.2;
    el.style.setProperty('--hx', `${hx.toFixed(1)}%`);
    el.style.setProperty('--hy', `${hy.toFixed(1)}%`);
  }

  el.addEventListener('pointerdown', e => {
    pointerDown = true; totalMove = 0;
    el.classList.add('fast');
    el.setPointerCapture(e.pointerId);
    lastX = e.clientX; lastY = e.clientY;
    vx = 0; vy = 0;
    e.preventDefault();
  });

  window.addEventListener('pointermove', e => {
    if (!pointerDown) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    totalMove += Math.abs(dx) + Math.abs(dy);
    ry += dx * 0.5;
    rx -= dy * 0.5;
    rx = Math.max(-25, Math.min(25, rx));
    ry = Math.max(-25, Math.min(25, ry));
    vx = -dy * 0.5; vy = dx * 0.5;
    lastX = e.clientX; lastY = e.clientY;
    lastTouch = performance.now();
    applyTilt();
  });

  window.addEventListener('pointerup', () => {
    if (pointerDown && totalMove < 6) {
      openSongInfoPopup();
    }
    pointerDown = false; el.classList.remove('fast');
  });

  let _tiltRafId = null;
  function loop() {
    if (!pointerDown) {
      if (performance.now() - lastTouch > 1000) {
        rx += (0 - rx) * 0.03;
        ry += (6 - ry) * 0.03;
        vx *= 0.9; vy *= 0.9;
      } else {
        rx += vx; ry += vy;
        rx = Math.max(-25, Math.min(25, rx));
        ry = Math.max(-25, Math.min(25, ry));
        vx *= 0.92; vy *= 0.92;
      }
      applyTilt();
      // Stop RAF when animation has fully settled (within 0.1deg of rest position)
      if (Math.abs(rx) < 0.1 && Math.abs(ry - 6) < 0.1 && Math.abs(vx) < 0.01 && Math.abs(vy) < 0.01) {
        _tiltRafId = null;
        return;
      }
    }
    _tiltRafId = requestAnimationFrame(loop);
  }
  // Restart loop on any pointer interaction
  function wakeLoop() { if (!_tiltRafId) { lastTouch = performance.now(); _tiltRafId = requestAnimationFrame(loop); } }
  el.addEventListener('pointerdown', wakeLoop);
  window.addEventListener('pointermove', () => { if (pointerDown) wakeLoop(); });
  applyTilt();
  _tiltRafId = requestAnimationFrame(loop);
})();

// ──────────────────────────────────────────────────
// 2. CLOCK
// ──────────────────────────────────────────────────

function updateClock() {
  const n = new Date(), h = n.getHours(), m = n.getMinutes(), d = n.getDay();
  dom.clockTime.textContent    = `${pad(h)}:${pad(m)}`;
  dom.clockWeekday.textContent = DAYS[d];
  dom.clockDate.textContent    = `${MON[n.getMonth()]}${n.getDate()}日`;
  dom.clockBadge.textContent   = (d === 0 || d === 6) ? '周末' : '工作日';
  applyAccent(h);
}
function startClock() { updateClock(); setInterval(updateClock, 1000); }

// ──────────────────────────────────────────────────
// 3. THEME
// ──────────────────────────────────────────────────

function applyAccent(h) {
  const t = dom.html.getAttribute('data-theme');
  let a;
  if (t === 'day')  a = (h >= 7 && h < 10) ? '#d4943a' : '#c4892a';
  else              a = (h >= 22 || h < 4)  ? '#9a7d3a' : '#c8a060';
  dom.html.style.setProperty('--accent', a);
}

function setTheme(t) {
  dom.html.setAttribute('data-theme', t);
  S.theme = t;
  localStorage.setItem('lc-t', t);
  applyAccent(new Date().getHours());
}

function initTheme() {
  const stored = localStorage.getItem('lc-t');
  // auto: before 7am or after 22 → night
  const h = new Date().getHours();
  const auto = (h >= 7 && h < 22) ? 'day' : 'night';
  setTheme(stored || auto);
}

dom.themeToggle.addEventListener('click', () => {
  setTheme(S.theme === 'night' ? 'day' : 'night');
});

// ──────────────────────────────────────────────────
// 4. WEATHER
// ──────────────────────────────────────────────────

async function fetchWeather() {
  try {
    const d = await fetch('/api/weather').then(r => r.json());
    if (d?.temp !== undefined) {
      dom.weatherChip.textContent = `${d.temp}°C · ${d.description || ''}`;
    }
  } catch { dom.weatherChip.textContent = ''; }
}

// ──────────────────────────────────────────────────
// 5. MUSIC (Show-level playback)
// ──────────────────────────────────────────────────

function setSongUI(song) {
  if (!song) return;
  dom.songName.textContent       = song.name   || '未知歌曲';
  dom.songArtist.textContent     = song.artist || '';
  dom.miniSongName.textContent   = song.name   || '';
  dom.miniSongArtist.textContent = song.artist || '';
  dom.btnLike.classList.toggle('liked', _likedIds.has(song.id));

  if (song.picUrl) {
    const img = new Image();
    img.onload = () => {
      dom.coverImg.src = song.picUrl;
      dom.coverImg.classList.add('loaded');
      dom.miniCover.src = song.picUrl;
    };
    img.src = song.picUrl;
  }
  S.songId = song.id;
  _lyricsForId = null;   // reset so lyrics reload for new song
  _lyricsLines = [];
  _lyricsActiveIdx = -1;
  _stopLyricsRaf();
}

async function getUrl(id) {
  const d = await fetch(`/api/music/url/${id}`).then(r => r.json());
  return d.url || null;
}

function reportBehavior(action) {
  if (!S.songId) return;
  const dur = dom.audioPlayer.duration;
  const cur = dom.audioPlayer.currentTime;
  const listenRatio = (dur > 0) ? Math.min(1, cur / dur) : null;
  fetch('/api/music/behavior', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId: S.songId, action, listenRatio }),
  }).catch(() => {});
}

// ── Show state ───────────────────────────────────
let _show = null;           // current show being played
let _trackIndex = 0;        // which track we're at
let _djTimer = null;
let _djMode = 'intro';      // 'intro' | 'segue' | 'mid-roll'
let _midRollCleanup = null; // removes timeupdate listener when track changes
let _suggestionActive = false; // true while playing a user-requested song
let _consecutiveSkips = 0;  // 缺口四：连续跳歌计数器
let _pendingFreshUrl = null; // fresh URL fetched during DJ intro, used when DJ ends
let _knownShowVersion = null; // last server version seen; used to pick up Phase 3 live intro patches

// Smoothly fade dom.audioPlayer volume to `target` (0–1) over ~800ms.
function _fadeMusicVolume(target) {
  const current = dom.audioPlayer.volume;
  if (current === target) return;
  const steps = 10;
  const delta = (target - current) / steps;
  let i = 0;
  const iv = setInterval(() => {
    i++;
    const next = current + delta * i;
    dom.audioPlayer.volume = i >= steps ? target : Math.max(0, Math.min(1, next));
    if (i >= steps) clearInterval(iv);
  }, 80);
}

// Play mid-roll TTS over music (music continues at 30% volume, fades back after).
async function playMidRoll(track) {
  if (S.djPhase !== 'music' || !S.playing) return;
  _djMode = 'mid-roll';
  _fadeMusicVolume(0.3);
  dom.djAudio.src = track.midRollAudioUrl;
  dom.djAudio.load();
  await dom.djAudio.play().catch(() => {
    _djMode = 'intro';
    _fadeMusicVolume(1.0);
  });
}

// Watchdog: detects silent stalls (stalled/expired CDN URL) that don't trigger 'error'
let _watchdogTimer = null;
let _watchdogLastTime = 0;

function startWatchdog() {
  stopWatchdog();
  _watchdogLastTime = dom.audioPlayer.currentTime;
  _watchdogTimer = setInterval(async () => {
    if (S.djPhase !== 'music' || !S.playing) { stopWatchdog(); return; }
    const ct = dom.audioPlayer.currentTime;
    const stuck = ct === _watchdogLastTime && !dom.audioPlayer.paused && !dom.audioPlayer.ended;
    _watchdogLastTime = ct;
    if (!stuck) return;

    console.warn('[Watchdog] Audio stalled, refreshing URL...');
    stopWatchdog();
    const track = _show?.tracks?.[_trackIndex];
    if (!track?.song) return;
    const seekTo = ct;

    const freshUrl = await getUrl(track.song.id).catch(() => null);
    if (!freshUrl) {
      // Can't get a playable URL — skip to next track rather than stay silent
      advanceTrack().catch(() => {});
      return;
    }

    dom.audioPlayer.src = freshUrl;
    // Wait for canplay with a hard timeout; if it never fires, skip rather than stay silent
    const canplayOk = await new Promise(resolve => {
      const t = setTimeout(() => {
        dom.audioPlayer.removeEventListener('canplay', ok);
        resolve(false);
      }, 8000);
      function ok() { clearTimeout(t); resolve(true); }
      dom.audioPlayer.addEventListener('canplay', ok, { once: true });
      dom.audioPlayer.load();
    });

    if (!canplayOk) {
      advanceTrack().catch(() => {});
      return;
    }

    dom.audioPlayer.currentTime = Math.max(0, seekTo - 1);
    dom.audioPlayer.play()
      .then(() => startWatchdog())
      .catch(() => advanceTrack().catch(() => {}));
  }, 5000);
}

function stopWatchdog() {
  if (_watchdogTimer) { clearInterval(_watchdogTimer); _watchdogTimer = null; }
}

async function playMusic(song, urlHint) {
  try {
    const url = urlHint || await getUrl(song.id);
    if (!url) {
      S.djPhase = 'idle';
      setPlayIcon(false);
      advanceTrack().catch(() => {});
      return false;
    }
    dom.audioPlayer.src = url;
    // Do NOT call initAudioAnalyser() here — creating an AudioContext outside a
    // user-gesture handler puts it in suspended state, silencing the music.
    // initAudioAnalyser() is called only from direct user-gesture handlers.
    if (_analyser?.context?.state === 'suspended') {
      await _analyser.context.resume().catch(() => {});
    }
    await dom.audioPlayer.play();
    S.playing = true; S.djPhase = 'music';
    setPlayIcon(true);
    resumeWaveRaf();
    startWatchdog();
    return true;
  } catch (e) {
    console.error('[playMusic]', e.message);
    S.djPhase = 'idle';
    setPlayIcon(false);
    if (e?.name !== 'NotAllowedError') advanceTrack().catch(() => {});
    return false;
  }
}

// Apply a pre-built track (from current show or a suggestion).
async function applyTrack(track) {
  if (!track) return;
  setSongUI(track.song);
  closeSongInfoPopup();
  dom.cardBackName.textContent   = track.song.name   || '';
  dom.cardBackArtist.textContent = track.song.artist || '';
  const hasStory = !!track.songBackground;
  dom.songInfoDivider.hidden    = !hasStory;
  dom.cardBackStory.hidden      = !hasStory;
  dom.cardBackStory.textContent = hasStory ? track.songBackground : '';

  // Notify server: track started → updates history + currentSong, triggers prebuild
  if (!_suggestionActive && _show) {
    fetch('/api/show/advance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackIndex: _trackIndex, totalTracks: _show.tracks.length }),
    }).catch(() => {});
  }

  // Pre-fetch the URL string during DJ intro — audioPlayer.src is NOT touched here.
  // A single clean assignment happens in djAudio.ended (or the _djTimer fallback),
  // preventing competing load() calls and stale error-state on the element.
  _pendingFreshUrl = null;
  getUrl(track.song.id).then(url => {
    if (!url) return;
    _pendingFreshUrl = url;
  }).catch(() => {});

  if (track.djAudioUrl) {
    _djMode = 'intro';
    S.djPhase = 'dj-speaking';
    dom.djAudio.src = track.djAudioUrl;
    dom.djAudio.load();
    clearTimeout(_djTimer);
    _djTimer = setTimeout(() => {
      if (S.djPhase === 'dj-speaking') playMusic(track.song, _pendingFreshUrl);
    }, 50000);
    try {
      await dom.djAudio.play();
      // If play() resolved but audio is immediately paused (silent autoplay block), fall through
      if (dom.djAudio.paused) throw new Error('silent-block');
      // iOS: pre-activate audioPlayer while still inside the audio-event chain.
      // On desktop this can leave the music element paused at 0:01 and look
      // like a silent stall, so only do the workaround where it is needed.
      if (_isIOS) dom.audioPlayer.play().then(() => dom.audioPlayer.pause()).catch(() => {});
    } catch {
      clearTimeout(_djTimer);
      S.djPhase = 'idle';
      if (_analyser?.context?.state === 'suspended') _analyser.context.resume().catch(() => {});
      playMusic(track.song, _pendingFreshUrl).catch(() => {});
    }
  } else {
    const url = _pendingFreshUrl || await getUrl(track.song.id).catch(() => null);
    await playMusic(track.song, url);
  }

  // Schedule mid-show message (appears ~45s into the song, as if DJ is speaking between tracks)
  if (_show?.mid_messages?.length) {
    const midMsg = _show.mid_messages.find(m => m.track === _trackIndex);
    if (midMsg) {
      setTimeout(() => {
        if (S.djPhase === 'music' && S.playing) appendDJ(midMsg.text);
      }, 45000);
    }
  }

  // Schedule mid-roll TTS overlay: fires once at midRollAt seconds into the song.
  _midRollCleanup?.();
  _midRollCleanup = null;
  if (track.midRollAudioUrl && track.midRollAt) {
    // Restore volume in case previous track's mid-roll left it low (e.g. user skipped during fade)
    dom.audioPlayer.volume = 1.0;
    let fired = false;
    const onTimeUpdate = () => {
      if (fired) return;
      if (dom.audioPlayer.currentTime >= track.midRollAt) {
        fired = true;
        dom.audioPlayer.removeEventListener('timeupdate', onTimeUpdate);
        _midRollCleanup = null;
        playMidRoll(track).catch(() => {});
      }
    };
    dom.audioPlayer.addEventListener('timeupdate', onTimeUpdate);
    _midRollCleanup = () => {
      dom.audioPlayer.removeEventListener('timeupdate', onTimeUpdate);
      fired = true;
      // If mid-roll was in progress when track changed, restore volume immediately
      if (_djMode === 'mid-roll') {
        _djMode = 'intro';
        dom.audioPlayer.volume = 1.0;
      }
    };
  } else {
    // No mid-roll for this track; ensure volume is clean from any previous fade
    dom.audioPlayer.volume = 1.0;
  }
}

// Advance to the next track. At end of show, loads the next show.
async function advanceTrack() {
  stopWatchdog();
  if (_suggestionActive) {
    _suggestionActive = false;
    // Return to where we were in the show after a suggestion
  } else {
    _trackIndex++;
  }

  if (!_show || _trackIndex >= _show.tracks.length) {
    dom.songName.textContent = '节目换档中…'; dom.songArtist.textContent = '';
    try {
      const res = await fetch('/api/show/end', { method: 'POST' }).then(r => r.json());
      if (res.show) {
        _show = res.show; _trackIndex = 0;
        _knownShowVersion = null;
        if (_show.chat_message) setTimeout(() => appendDJ(_show.chat_message), 600);
        await applyTrack(_show.tracks[0]);
      } else {
        await pollAndStart();
      }
    } catch { await pollAndStart(); }
    return;
  }

  // Version check before playing next track — picks up Phase 3 live intro patches.
  // The live intro for this track was generated server-side during the previous track's playback.
  try {
    const s = await fetch('/api/show/status').then(r => r.json());
    if (_knownShowVersion !== null && s.version !== _knownShowVersion && _show) {
      const res = await fetch('/api/show/current').then(r => r.json());
      if (res.show) _show.tracks = res.show.tracks;
    }
    _knownShowVersion = s.version;
  } catch {}

  await applyTrack(_show.tracks[_trackIndex]);
}

// When the song ends: play segue (if any), then advance.
async function onSongEnd() {
  stopWatchdog();
  _consecutiveSkips = 0; // 听完一首就重置跳歌计数
  reportBehavior('completed');

  const track = _suggestionActive ? null : _show?.tracks?.[_trackIndex];
  if (track?.segueAudioUrl) {
    _djMode = 'segue';
    S.djPhase = 'dj-speaking';
    dom.djAudio.src = track.segueAudioUrl;
    dom.djAudio.load();
    clearTimeout(_djTimer);
    _djTimer = setTimeout(() => {
      if (S.djPhase === 'dj-speaking') advanceTrack();
    }, 20000);
    try { await dom.djAudio.play(); }
    catch { clearTimeout(_djTimer); await advanceTrack(); }
  } else {
    await advanceTrack();
  }
}

// DJ audio 404 or network error — skip the intro and start the song immediately.
dom.djAudio.addEventListener('error', () => {
  if (S.djPhase !== 'dj-speaking') return;
  clearTimeout(_djTimer);
  S.djPhase = 'idle';
  const track = _show?.tracks?.[_trackIndex];
  if (track?.song) playMusic(track.song, _pendingFreshUrl).catch(() => {});
});

dom.djAudio.addEventListener('ended', async () => {
  clearTimeout(_djTimer);
  if (_djMode === 'mid-roll') {
    _djMode = 'intro';
    _fadeMusicVolume(1.0);
    return;
  }
  S.djPhase = 'idle';
  if (_djMode === 'segue') {
    await advanceTrack();
  } else {
    if (_analyser?.context?.state === 'suspended') {
      await _analyser.context.resume().catch(() => {});
    }
    const track = _show?.tracks?.[_trackIndex];
    if (!track?.song) { await advanceTrack(); return; }
    // _pendingFreshUrl was fetched during DJ intro (URL string only — no preload).
    // If it hasn't arrived yet, fetch now. Either way: one clean src assignment in playMusic.
    const urlToPlay = _pendingFreshUrl || await getUrl(track.song.id).catch(() => null);
    await playMusic(track.song, urlToPlay);
  }
});

dom.audioPlayer.addEventListener('ended', () => { onSongEnd(); });

// If audio hits a network error while playing (e.g. Netease URL expired), fetch fresh and retry
dom.audioPlayer.addEventListener('error', async () => {
  if (S.djPhase !== 'music') return;
  const track = _show?.tracks?.[_trackIndex];
  if (!track?.song) return;
  // playMusic fetches a fresh URL, sets src, plays, and calls startWatchdog on success
  await playMusic(track.song, null);
});

// After a reorder is triggered, poll until version increments then refresh local track list.
// Phase-1 (song swap) completes in ~20-30s and triggers the user-visible feedback.
// Phase-2 (TTS fill) runs in background; we keep watching for 90s more to patch djAudioUrl.
async function pollForReorder() {
  let baseVersion;
  try {
    const s = await fetch('/api/show/status').then(r => r.json());
    baseVersion = s.version;
  } catch { return; }

  // Phase-1: wait for song swap (up to 60s)
  let shownWaiting = false;
  let phase1Done = false;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    if (i === 3 && !shownWaiting) {
      shownWaiting = true;
      appendDJ('接下来几首在换，先继续听着。');
    }
    try {
      const s = await fetch('/api/show/status').then(r => r.json());
      if (s.version !== baseVersion) {
        const res = await fetch('/api/show/current').then(r => r.json());
        if (res.show) {
          _show.tracks = res.show.tracks;
          const n = s.lastReorderCount || 0;
          appendDJ(n <= 1 ? '只找到一首，先听着。' : `换好了，接下来 ${n} 首。`);
          baseVersion = s.version;
          phase1Done = true;
        }
        break;
      }
      if (!s.reordering && i > 0) {
        appendDJ('这几首没找到合适的，继续原来的顺序。');
        return;
      }
    } catch {}
  }

  if (!phase1Done) return;

  // Phase-2: silently patch TTS as it fills in (up to 90s, 10s interval)
  for (let i = 0; i < 9; i++) {
    await new Promise(r => setTimeout(r, 10000));
    try {
      const s = await fetch('/api/show/status').then(r => r.json());
      if (s.version !== baseVersion) {
        const res = await fetch('/api/show/current').then(r => r.json());
        if (res.show) _show.tracks = res.show.tracks;
        baseVersion = s.version;
      }
    } catch {}
  }
}

// Background track-sync: runs while the server is still building the current show
// (progressive build — server publishes after track 2, then appends remaining tracks).
// Polls /api/show/status every 5s; when version changes, fetches updated track list.
// Stops automatically when building finishes.
let _trackSyncTimer = null;
function _startTrackSyncPoll() {
  if (_trackSyncTimer) return;
  _trackSyncTimer = setInterval(async () => {
    try {
      const s = await fetch('/api/show/status').then(r => r.json());
      if (!s.building) {
        // Build finished — final sync to pick up any last tracks
        if (_knownShowVersion !== null && s.version !== _knownShowVersion && _show) {
          const res = await fetch('/api/show/current').then(r => r.json());
          if (res.show) _show.tracks = res.show.tracks;
        }
        _knownShowVersion = s.version;
        clearInterval(_trackSyncTimer);
        _trackSyncTimer = null;
        return;
      }
      if (_knownShowVersion !== null && s.version !== _knownShowVersion && _show) {
        const res = await fetch('/api/show/current').then(r => r.json());
        if (res.show) _show.tracks = res.show.tracks;
      }
      _knownShowVersion = s.version;
    } catch {}
  }, 5000);
}

// Poll /api/show/current until a show is ready, then start.
async function pollAndStart(maxWait = 600000) {
  const start = Date.now();
  let _failedMsgShown = false;
  dom.songName.textContent   = '节目制作中…';
  dom.songArtist.textContent = 'Claudio 正在选曲';
  while (Date.now() - start < maxWait) {
    try {
      const r   = await fetch('/api/show/current');
      const res = await r.json();
      if (res.show) {
        _show = res.show; _trackIndex = 0;
        if (_show.chat_message) setTimeout(() => appendDJ(_show.chat_message), 400);
        await applyTrack(_show.tracks[0]);
        if (!S.playing && dom.djAudio.paused) {
          // Autoplay blocked — both music and DJ audio are silent
          dom.tapOverlay.hidden = false;
        }
        // Server may still be building remaining tracks — keep local list in sync
        _startTrackSyncPoll();
        return;
      }
      // Server signals build failed and is already retrying
      if (res.status === 'failed') {
        dom.songName.textContent   = '选曲遇到问题';
        dom.songArtist.textContent = '60秒后自动重试…';
        if (!_failedMsgShown) {
          appendDJ('选曲碰到点小问题，稍等我一分钟再试试。');
          _failedMsgShown = true;
        }
        // Keep polling — server will retry in 60s
      }
    } catch {}
    await new Promise(r => setTimeout(r, 5000));
  }
  dom.songName.textContent   = '启动失败';
  dom.songArtist.textContent = '请刷新页面重试';
}

// ──────────────────────────────────────────────────
// 6. CONTROLS
// ──────────────────────────────────────────────────

function setPlayIcon(playing) {
  dom.iconPlay.style.display  = playing ? 'none' : 'block';
  dom.iconPause.style.display = playing ? 'block' : 'none';
  if (playing && dom.tapOverlay && !dom.tapOverlay.hidden) dom.tapOverlay.hidden = true;
  dom.miniPlayPause.textContent = playing ? '⏸' : '▶';
  $('waveform-bg')?.classList.toggle('playing', playing);
  S.playing = playing;
  // Sync lyrics RAF with play state
  if (playing && _lyricsLines.length && !_lyricsRafId) {
    _lyricsRafId = requestAnimationFrame(_lyricsRafTick);
  } else if (!playing) {
    _stopLyricsRaf();
  }
}

function togglePlay() {
  // Only block interaction if DJ audio is genuinely playing right now
  if (S.djPhase === 'dj-speaking' && !dom.djAudio.paused) return;
  // If stuck in dj-speaking but audio isn't playing, clear the stale state
  if (S.djPhase === 'dj-speaking') {
    clearTimeout(_djTimer);
    S.djPhase = 'idle';
  }
  if (S.playing) {
    dom.audioPlayer.pause();
    setPlayIcon(false);
  } else {
    // This is a user gesture — initialize AudioContext for waveform if not yet done
    initAudioAnalyser();
    const track = _show?.tracks?.[_trackIndex];
    if (track?.song) {
      playMusic(track.song, _pendingFreshUrl).catch(() => {});
    } else {
      dom.audioPlayer.play()
        .then(() => { S.playing = true; setPlayIcon(true); resumeWaveRaf(); startWatchdog(); })
        .catch(() => {});
    }
  }
}

async function skip() {
  if (S.songId) {
    fetch('/api/music/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId: S.songId, action: 'skip' }),
    }).catch(() => {});
  }
  reportBehavior('skipped');
  stopWatchdog();
  dom.audioPlayer.pause(); dom.djAudio.pause();
  clearTimeout(_djTimer);
  _djMode = 'intro'; S.djPhase = 'idle';
  setPlayIcon(false);
  dom.songName.textContent = '换歌中…'; dom.songArtist.textContent = '';

  _consecutiveSkips++;
  if (_consecutiveSkips === 2) {
    // 2连跳：插入一首探针歌曲测试新方向，不打断节目结构
    _insertProbeTrack();
  } else if (_consecutiveSkips >= 3) {
    // 3连跳（含探针也被跳）：全量重建 + Claudio 主动评论
    _consecutiveSkips = 0;
    _onConsecutiveSkips();
  }

  await advanceTrack();
}

function _insertProbeTrack() {
  fetch('/api/show/probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromIndex: _trackIndex }),
  }).then(r => r.json()).then(d => {
    if (d.ok) {
      // Patch local track list so the probe appears immediately
      if (_show && d.song) {
        const probeTrack = {
          song:           d.song,
          djIntroText:    d.djAudioUrl ? undefined : null,
          djAudioUrl:     d.djAudioUrl || null,
          segueAudioUrl:  null,
          songBackground: null,
        };
        _show.tracks.splice(_trackIndex + 1, 0, probeTrack);
      }
      if (d.djComment) appendDJ(d.djComment);
    }
  }).catch(() => {});
}

function _onConsecutiveSkips() {
  fetch('/api/show/adapt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromIndex: _trackIndex, mood: 'skip_heavy' }),
  }).catch(() => {});
  fetch('/api/chat/proactive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trigger: 'consecutive_skips', skipCount: 3 }),
  }).then(r => r.json()).then(d => {
    if (d.reply) appendDJ(d.reply);
  }).catch(() => {});
}

dom.btnPlayPause.addEventListener('click', togglePlay);
dom.miniPlayPause.addEventListener('click', togglePlay);
dom.btnNext.addEventListener('click', skip);
dom.miniNext.addEventListener('click', skip);

dom.tapOverlay.addEventListener('click', () => {
  dom.tapOverlay.hidden = true;
  // 自动播放被拦截时，首次点击是真实用户手势 —— 重新走完整 applyTrack
  // 流程（DJ 开场语音 → 音乐），修复「开场 DJ 丢失」。
  const track = _show?.tracks?.[_trackIndex];
  if (!S.playing && track && S.djPhase !== 'dj-speaking') {
    applyTrack(track).catch(() => { if (!S.playing) togglePlay(); });
  } else if (!S.playing) {
    togglePlay();
  }
});

// ── Like ────────────────────────────────────────────
const _likedIds = new Set();

async function toggleLike() {
  if (!S.songId) return;
  const nowLiked = !_likedIds.has(S.songId);
  if (nowLiked) _likedIds.add(S.songId); else _likedIds.delete(S.songId);
  dom.btnLike.classList.toggle('liked', nowLiked);
  fetch('/api/music/like', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId: S.songId, like: nowLiked }),
  }).catch(() => {});
  if (nowLiked) {
    // Log to behavior so taste model learns from likes
    reportBehavior('liked');
    fetch('/api/music/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId: S.songId, action: 'like' }),
    }).catch(() => {});
  }
}

dom.btnLike.addEventListener('click', toggleLike);

// ── History panel ───────────────────────────────────
function renderHistory(items) {
  dom.historyList.innerHTML = '';
  const reversed = [...items].reverse();
  reversed.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.innerHTML = `
      <img class="history-cover" src="${s.picUrl || ''}" alt="" loading="lazy" />
      <div class="history-info">
        <div class="history-name">${s.name || ''}</div>
        <div class="history-artist">${s.artist || ''}</div>
      </div>
      <span class="history-idx">${i + 1}</span>`;
    dom.historyList.appendChild(el);
  });
}

async function openHistory() {
  _hideAllPanels();
  dom.historyArea.removeAttribute('hidden');
  dom.historyArea.style.display = 'flex';
  dom.historyArea.style.flexDirection = 'column';
  $('input-area').style.display = 'none';
  if (dom.quickActions) dom.quickActions.style.display = 'none';
  dom.tabHistory.classList.add('active');
  try {
    const state = await fetch('/api/state').then(r => r.json());
    const items = state.sessionHistory || [];
    if (items.length === 0) {
      dom.historyList.innerHTML = '<div style="color:var(--muted);font-size:0.82rem;text-align:center;padding:24px 0">本次启动暂无播放记录</div>';
    } else {
      renderHistory(items);
    }
  } catch {}
}

function _hideAllPanels() {
  dom.historyArea.style.display = 'none';
  dom.lyricsArea.removeAttribute('hidden');
  dom.lyricsArea.style.display = 'none';
  dom.chatArea.style.display = 'none';
  dom.tabChat.classList.remove('active');
  dom.tabHistory.classList.remove('active');
  dom.tabLyrics.classList.remove('active');
}

function openChat() {
  _hideAllPanels();
  dom.chatArea.style.display = '';
  $('input-area').style.display = '';
  if (dom.quickActions) dom.quickActions.style.display = '';
  dom.tabChat.classList.add('active');
}

let _lyricsLines = [];    // [{time, text, el}]
let _lyricsActiveIdx = -1;
let _lyricsRafId = null;

function _stopLyricsRaf() {
  if (_lyricsRafId) { cancelAnimationFrame(_lyricsRafId); _lyricsRafId = null; }
}

function _lyricsRafTick() {
  const t = dom.audioPlayer.currentTime || 0;
  if (!_lyricsLines.length) { _lyricsRafId = null; return; }

  // Find the last line whose time <= currentTime
  let idx = -1;
  for (let i = 0; i < _lyricsLines.length; i++) {
    if (_lyricsLines[i].time <= t) idx = i;
    else break;
  }

  if (idx !== _lyricsActiveIdx) {
    if (_lyricsActiveIdx >= 0 && _lyricsLines[_lyricsActiveIdx]?.el) {
      _lyricsLines[_lyricsActiveIdx].el.classList.remove('lyrics-active');
    }
    _lyricsActiveIdx = idx;
    if (idx >= 0 && _lyricsLines[idx]?.el) {
      const el = _lyricsLines[idx].el;
      el.classList.add('lyrics-active');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  _lyricsRafId = requestAnimationFrame(_lyricsRafTick);
}

async function openLyrics() {
  _hideAllPanels();
  dom.lyricsArea.style.display = 'flex';
  dom.lyricsArea.style.flexDirection = 'column';
  $('input-area').style.display = 'none';
  if (dom.quickActions) dom.quickActions.style.display = 'none';
  dom.tabLyrics.classList.add('active');

  const songId = S.songId;
  const alreadyLoaded = _lyricsForId === songId && _lyricsLines.length > 0;
  if (alreadyLoaded) {
    // Already rendered — just restart scroll sync
    _stopLyricsRaf();
    _lyricsActiveIdx = -1;
    if (S.playing) _lyricsRafId = requestAnimationFrame(_lyricsRafTick);
    return;
  }

  if (_lyricsForId === songId) return; // loading in progress
  _lyricsForId = songId;
  _lyricsLines = [];
  _lyricsActiveIdx = -1;
  _stopLyricsRaf();

  dom.lyricsText.innerHTML = '';
  dom.lyricsEmpty.setAttribute('hidden', '');
  dom.lyricsLoading.style.display = '';

  if (!songId) { dom.lyricsLoading.style.display = 'none'; dom.lyricsEmpty.removeAttribute('hidden'); return; }

  try {
    const { lines } = await fetch(`/api/music/lyrics/${songId}`).then(r => r.json());
    dom.lyricsLoading.style.display = 'none';
    if (lines?.length) {
      // Build DOM lines
      lines.forEach(line => {
        const el = document.createElement('p');
        el.className = 'lyrics-line';
        el.textContent = line.text;
        if (line.translation) {
          const tr = document.createElement('span');
          tr.className = 'lyrics-trans';
          tr.textContent = line.translation;
          el.appendChild(tr);
        }
        dom.lyricsText.appendChild(el);
        _lyricsLines.push({ ...line, el });
      });
      if (S.playing) _lyricsRafId = requestAnimationFrame(_lyricsRafTick);
    } else {
      dom.lyricsEmpty.removeAttribute('hidden');
    }
  } catch {
    dom.lyricsLoading.style.display = 'none';
    dom.lyricsEmpty.removeAttribute('hidden');
  }
}

dom.tabChat.addEventListener('click', openChat);
dom.tabHistory.addEventListener('click', openHistory);
dom.tabLyrics.addEventListener('click', openLyrics);

// Progress
setInterval(() => {
  const c = dom.audioPlayer.currentTime || 0;
  const d = dom.audioPlayer.duration    || 0;
  const p = d > 0 ? (c/d)*100 : 0;
  dom.progressFill.style.width = `${p}%`;
  dom.miniFill.style.width     = `${p}%`;
  dom.timeCurrent.textContent  = fmt(c);
  dom.timeTotal.textContent    = fmt(d);
}, 1000);

$('progress-bar').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  const d = dom.audioPlayer.duration;
  if (isFinite(d) && d > 0) dom.audioPlayer.currentTime = ((e.clientX - r.left) / r.width) * d;
});

// Mode toggle
dom.modeToggle.addEventListener('click', () => {
  if (!S.miniMode) {
    S.miniMode = true;
    $('app').style.display = 'none';
    dom.miniPlayer.hidden  = false;
    dom.modeToggle.textContent = '⊞';
  } else {
    S.miniMode = false;
    $('app').style.display = '';
    dom.miniPlayer.hidden  = true;
    dom.modeToggle.textContent = '⊡';
  }
});
dom.miniExpand.addEventListener('click', () => {
  S.miniMode = false;
  $('app').style.display = '';
  dom.miniPlayer.hidden = true;
  dom.modeToggle.textContent = '⊡';
});

// ──────────────────────────────────────────────────
// 7. CHAT
// ──────────────────────────────────────────────────

function bubble(role) {
  const row = document.createElement('div');
  row.className = `msg ${role}`;
  if (role === 'dj') {
    const av = document.createElement('div');
    av.className = 'msg-av'; av.textContent = 'C';
    row.appendChild(av);
  }
  const b = document.createElement('div');
  b.className = 'msg-bubble';
  row.appendChild(b);
  dom.chatMessages.appendChild(row);
  dom.chatArea.scrollTop = dom.chatArea.scrollHeight;
  return b;
}

function appendUser(text) { const b = bubble('user'); b.textContent = text; }

function appendDJ(text) {
  const b = bubble('dj');
  b.classList.add('tw');
  let i = 0;
  const tick = () => {
    if (i < text.length) { b.textContent += text[i++]; dom.chatArea.scrollTop = dom.chatArea.scrollHeight; setTimeout(tick, 28); }
    else b.classList.remove('tw');
  };
  tick();
}

function appendSuggestCards(songs) {
  if (!songs || !songs.length) return;
  const row = document.createElement('div');
  row.className = 'msg dj';
  const spacer = document.createElement('div');
  spacer.style.cssText = 'width:28px;flex-shrink:0';
  row.appendChild(spacer);
  const cards = document.createElement('div');
  cards.className = 'suggest-cards';
  songs.forEach(s => {
    const card = document.createElement('div');
    card.className = 'suggest-card';
    card.innerHTML = `<div class="sc-name">${s.name}</div><div class="sc-artist">${s.artist}</div>${s.reason ? `<div class="sc-reason">${s.reason}</div>` : ''}`;
    card.addEventListener('click', () => playSuggestion(s.artist, s.name));
    cards.appendChild(card);
  });
  row.appendChild(cards);
  dom.chatMessages.appendChild(row);
  dom.chatArea.scrollTop = dom.chatArea.scrollHeight;
}

async function playSuggestion(artist, name) {
  dom.audioPlayer.pause(); dom.djAudio.pause();
  clearTimeout(_djTimer);
  _djMode = 'intro'; S.djPhase = 'idle';
  setPlayIcon(false);
  dom.songName.textContent = `正在找：${name}…`; dom.songArtist.textContent = artist;
  try {
    const d = await fetch('/api/music/play-suggestion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist, name }),
    }).then(r => r.json());
    if (d.song) {
      _suggestionActive = true;
      // Wrap server response as a track-shaped object
      await applyTrack({
        song:           d.song,
        djAudioUrl:     d.djAudioUrl || null,
        segueAudioUrl:  null,
        songBackground: d.songBackground || null,
      });
    } else {
      dom.songName.textContent = '找不到这首歌'; dom.songArtist.textContent = '';
    }
  } catch { dom.songName.textContent = '播放出错'; }
}

async function executeShowAction(action) {
  if (!action?.type) return;

  if (action.type === 'insert_next') {
    const { artist, name } = action;
    if (!artist || !name) return;
    if (!_show) return;
    try {
      const d = await fetch('/api/show/insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist, name, afterIndex: _trackIndex }),
      }).then(r => r.json());
      if (!d.song) { appendDJ('在网易云找不到这首，换一首试试？'); return; }
      // Also patch the local copy so the current session reflects the insertion immediately
      const track = {
        song:           d.song,
        djIntroText:    d.djAudioUrl ? undefined : null,
        djAudioUrl:     d.djAudioUrl || null,
        segueAudioUrl:  null,
        songBackground: d.songBackground || null,
      };
      _show.tracks.splice(_trackIndex + 1, 0, track);
      appendDJ(`${d.song.artist}《${d.song.name}》，下一首就是。`);
    } catch { appendDJ('找歌出了点问题，稍后再试。'); }

  } else if (action.type === 'adapt_show') {
    const mood = action.mood || 'user_request';
    // Immediately replace next 3 tracks in current queue (agent-style reorder).
    // Chat reply already shows the DJ response; pollForReorder shows completion.
    fetch('/api/show/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromIndex: _trackIndex, mood }),
    }).catch(() => {});
    pollForReorder();

  } else if (action.type === 'custom_show') {
    const { theme, when } = action;
    if (!theme) return;
    fetch('/api/show/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
    }).catch(() => {});
    if (when === 'now') {
      // Stop current playback and wait for the custom show to be ready
      dom.audioPlayer.pause(); dom.djAudio.pause();
      clearTimeout(_djTimer); _djMode = 'intro'; S.djPhase = 'idle';
      setPlayIcon(false);
      if (_trackSyncTimer) { clearInterval(_trackSyncTimer); _trackSyncTimer = null; }
      _show = null; _trackIndex = 0; _knownShowVersion = null;
      pollAndStart();
    }

  } else if (action.type === 'skip') {
    skip();
  }
}

async function sendChat() {
  const t = dom.userInput.value.trim();
  if (!t) return;
  dom.userInput.value = '';
  dom.sendBtn.disabled = true;
  appendUser(t);
  try {
    const d = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: t }),
    }).then(r => r.json());
    if (d.reply) appendDJ(d.reply);
    if (d.songs && d.songs.length > 0) appendSuggestCards(d.songs);
    if (d.action) executeShowAction(d.action);
  } catch { appendDJ('抱歉，刚才走神了……再说一遍？'); }
  finally { dom.sendBtn.disabled = false; dom.userInput.focus(); }
}

dom.sendBtn.addEventListener('click', sendChat);
dom.userInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

// ──────────────────────────────────────────────────
// 8. LOGIN
// ──────────────────────────────────────────────────

async function checkLogin() {
  try { return (await fetch('/api/netease/status').then(r=>r.json())).loggedIn; }
  catch { return false; }
}

dom.loginSend.addEventListener('click', async () => {
  const phone = dom.loginPhone.value.trim();
  if (!/^\d{11}$/.test(phone)) { dom.loginMsg.textContent = '请输入 11 位手机号'; return; }
  dom.loginSend.disabled = true; dom.loginMsg.textContent = '发送中…';
  const d = await fetch('/api/netease/captcha/send', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ phone }),
  }).then(r=>r.json()).catch(()=>({ok:false}));
  if (d.ok) { dom.loginMsg.textContent = '验证码已发送'; dom.stepCaptcha.hidden = false; dom.loginCaptcha.focus(); }
  else { dom.loginMsg.textContent = '发送失败'; dom.loginSend.disabled = false; }
});

dom.loginConfirm.addEventListener('click', async () => {
  const phone = dom.loginPhone.value.trim(), cap = dom.loginCaptcha.value.trim();
  if (!cap) { dom.loginMsg.textContent = '请输入验证码'; return; }
  dom.loginMsg.textContent = '登录中…';
  const d = await fetch('/api/netease/login', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ phone, captcha: cap }),
  }).then(r=>r.json()).catch(()=>({ok:false}));
  if (d.ok) { dom.loginMsg.textContent = '登录成功'; setTimeout(() => { dom.loginModal.hidden = true; startRadio(); }, 500); }
  else dom.loginMsg.textContent = d.message || '登录失败';
});

// ──────────────────────────────────────────────────
// 9. INIT
// ──────────────────────────────────────────────────

// ──────────────────────────────────────────────────
// SONG INFO POPUP
// ──────────────────────────────────────────────────

function openSongInfoPopup() {
  if (dom.songInfoPopup.style.display === 'flex') return;
  // hide all chat-section content panels
  _hideAllPanels();
  if (dom.quickActions) dom.quickActions.style.display = 'none';
  $('input-area').style.display = 'none';
  // show popup panel + trigger fade-in
  dom.songInfoPopup.style.display = 'flex';
  dom.songInfoPopup.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => dom.songInfoPopup.classList.add('open'));
}

function closeSongInfoPopup() {
  if (!dom.songInfoPopup.classList.contains('open')) return;
  dom.songInfoPopup.classList.remove('open');
  dom.songInfoPopup.setAttribute('aria-hidden', 'true');
  dom.songInfoPopup.addEventListener('transitionend', () => {
    dom.songInfoPopup.style.display = 'none';
    openChat(); // restore chat view
  }, { once: true });
}

dom.btnInfo?.addEventListener('click', openSongInfoPopup);
dom.btnClosePopup?.addEventListener('click', closeSongInfoPopup);

// ──────────────────────────────────────────────────
// AUDIO ANALYSER (Web Audio → real-time waveform)
// ──────────────────────────────────────────────────

let _analyser = null;
let _analyserData = null;
let _waveRafId = null;

// iOS routes <audio> through AudioContext → suspends automatically → silence
// Skip Web Audio entirely on iOS; waveform falls back to CSS animation
const _isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function initAudioAnalyser() {
  if (_analyser) {
    if (_analyser.context.state === 'suspended') {
      _analyser.context.resume().catch(() => {});
    }
    return;
  }
  if (_isIOS) return; // skip Web Audio on iOS — prevents AudioContext suspension killing music
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaElementSource(dom.audioPlayer);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    src.connect(analyser);
    analyser.connect(ctx.destination);
    _analyser = analyser;
    _analyserData = new Uint8Array(analyser.frequencyBinCount);
    startWaveRaf();
  } catch {
    // CORS or browser restriction — CSS breathe animation remains active
  }
}

function startWaveRaf() {
  if (_waveRafId || !_analyser) return;
  const waveEl = $('waveform-bg');
  if (!waveEl) return;
  waveEl.setAttribute('data-driven', '');
  const bars = Array.from(waveEl.querySelectorAll('.wave-bar'));
  const step = Math.max(1, Math.floor(_analyserData.length / bars.length));
  const INTERVAL = 1000 / 30; // cap at 30fps
  let lastFrameTime = 0;

  function tick(ts) {
    // Stop when audio is not playing
    if (dom.audioPlayer.paused && dom.djAudio.paused) {
      _waveRafId = null;
      return;
    }
    // Throttle to 30fps
    if (ts - lastFrameTime >= INTERVAL) {
      lastFrameTime = ts;
      _analyser.getByteFrequencyData(_analyserData);
      bars.forEach((bar, i) => {
        const v = (_analyserData[i * step] || 0) / 255;
        bar.style.transform = `scaleY(${(0.15 + v * 0.85).toFixed(2)})`;
      });
    }
    _waveRafId = requestAnimationFrame(tick);
  }
  _waveRafId = requestAnimationFrame(tick);
}

function resumeWaveRaf() {
  if (!_waveRafId && _analyser) startWaveRaf();
}

// ──────────────────────────────────────────────────
// WAVEFORM DECORATION
// ──────────────────────────────────────────────────
function initWaveform() {
  const el = $('waveform-bg');
  if (!el) return;
  for (let i = 0; i < 28; i++) {
    const bar = document.createElement('span');
    bar.className = 'wave-bar';
    const h  = Math.round(15 + Math.random() * 80);
    const mn = (0.2 + Math.random() * 0.55).toFixed(2);
    const dr = (0.6 + Math.random() * 1.1).toFixed(2);
    const dl = '-' + (Math.random() * 1.5).toFixed(2) + 's';
    bar.style.cssText = `--bar-h:${h}px;--bar-min:${mn};--bar-dur:${dr}s;--bar-delay:${dl}`;
    el.appendChild(bar);
  }
}

// ──────────────────────────────────────────────────
// QUICK ACTIONS
// ──────────────────────────────────────────────────
function initQuickActions() {
  dom.btnQaCaim?.addEventListener('click', () => {
    dom.userInput.value = '我想听更安静一点';
    sendChat();
  });
  dom.btnQaLike?.addEventListener('click', toggleLike);
  dom.btnQaNext?.addEventListener('click', skip);
}

async function startRadio() {
  setTimeout(() => appendDJ('嗨，我是 Claudio。节目正在准备中，稍等片刻…'), 300);
  // Signal fresh session — server wipes stale show state and builds from current context.
  await fetch('/api/session/start', { method: 'POST' }).catch(() => {});
  pollAndStart();
}

async function init() {
  initWaveform();
  initQuickActions();
  initTheme();
  startClock();
  fetchWeather();
  const ok = await checkLogin();
  if (ok) startRadio();
  else dom.loginModal.hidden = false;
}

document.addEventListener('DOMContentLoaded', init);

// Do not reset the server session on every page unload. Browser refreshes,
// mobile tab suspension, and dev reloads can fire beforeunload while audio is
// still expected to continue in the current session; resetting here makes the
// programme/audio state drift. Cleanup is handled on server startup/exit.
