/**
 * 离线 Shim —— 固定一期节目的静态播放器
 *
 * 原前端（app.js）紧耦合 Node 后端，所有数据走 /api/*。
 * 本 shim 在 app.js 之前加载，拦截 window.fetch，把所有 /api/* 请求
 * 用本地 show.json + 本地音频文件应答，从而零后端、零 token、可分享。
 *
 * 不修改 app.js 一行 —— 它的播放状态机、UI、交互全部原样保留。
 */
(function () {
  'use strict';

  let SHOW = null;           // 已加载的本地节目
  const trackById = {};      // song.id -> track（供 /api/music/url/:id 查本地路径）

  // 同步加载 show.json（在 fetch 被改写前用原生 XHR，确保 manifest 先就绪）
  const xhr = new XMLHttpRequest();
  xhr.open('GET', 'show.json', false);
  xhr.send(null);
  const manifest = JSON.parse(xhr.responseText);

  // 把 manifest 整理成前端期望的 show 结构
  const tracks = manifest.tracks.map(function (t) {
    const tk = {
      song: {
        id:     t.song.id,
        name:   t.song.name,
        artist: t.song.artist,
        album:  t.song.album,
        // 用本地封面，彻底离线；缺失则回落远程
        picUrl: t.song.cover || t.song.picUrl,
      },
      djIntroText:     t.djIntroText,
      djAudioUrl:      t.djAudioUrl,        // 'dj/tts_xxx.mp3' 相对路径
      midRollText:     t.midRollText,
      midRollAudioUrl: t.midRollAudioUrl,
      midRollAt:       t.midRollAt,
      segueText:       t.segueText,
      segueAudioUrl:   t.segueAudioUrl,
      songBackground:  t.songBackground,
    };
    trackById[String(t.song.id)] = t;
    return tk;
  });

  SHOW = {
    show_theme:   manifest.show_theme,
    arc_type:     manifest.arc_type,
    mood:         manifest.mood,
    chat_message: manifest.chat_message,
    tracks:       tracks,
  };

  const W = manifest.weather || { temp: 26, description: '多云', city: '' };

  // 固定一期里 DJ 不再实时对话，给一句友好的固定回复
  const CANNED_REPLY =
    '这是一期固定录好的节目，发给你慢慢听就好。完整版里我才会实时陪你聊天、按心情换歌～';

  function json(data) {
    return Promise.resolve(
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }

  const _origFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';

    // 非 /api/ 请求（本地音频、封面等）走原生 fetch
    if (url.indexOf('/api/') === -1) {
      return _origFetch(input, init);
    }

    // ── 登录闸门：永远已登录，跳过登录弹窗 ──
    if (url.indexOf('/api/netease/status') !== -1) return json({ loggedIn: true });

    // ── 会话/状态类：无操作成功 ──
    if (url.indexOf('/api/session/') !== -1)        return json({ ok: true });
    if (url.indexOf('/api/show/advance') !== -1)    return json({ ok: true });
    if (url.indexOf('/api/music/behavior') !== -1)  return json({ ok: true });
    if (url.indexOf('/api/music/like') !== -1)      return json({ ok: true, liked: true });
    if (url.indexOf('/api/music/feedback') !== -1)  return json({ ok: true });

    // ── 节目状态 ──
    if (url.indexOf('/api/show/status') !== -1) {
      return json({ building: false, reordering: false, failed: false,
        hasNext: false, hasCurrent: true, version: 1, stage: 'ready' });
    }

    // ── 取当前节目 / 节目结束（循环回放同一期） ──
    if (url.indexOf('/api/show/current') !== -1 || url.indexOf('/api/show/end') !== -1) {
      return json({ status: 'ready', show: SHOW });
    }

    // ── 取音乐播放 URL → 返回本地 mp3 路径 ──
    const m = url.match(/\/api\/music\/url\/(\d+)/);
    if (m) {
      const t = trackById[m[1]];
      return json({ url: t && t.songUrl ? t.songUrl : null });
    }

    // ── 歌词：固定一期暂不带歌词 ──
    if (url.indexOf('/api/music/lyrics/') !== -1) return json({ lines: [] });

    // ── 天气 ──
    if (url.indexOf('/api/weather') !== -1) return json(W);

    // ── 用户状态 ──
    if (url.indexOf('/api/state') !== -1) {
      return json({ moodContext: '', playHistory: [], sessionHistory: [], currentSong: null });
    }

    // ── 聊天：固定回复，不调 AI ──
    if (url.indexOf('/api/chat') !== -1) {
      return json({ reply: CANNED_REPLY, songs: [], action: null });
    }

    // ── 其余点播/重排/插播等：固定一期不支持，安静成功 ──
    return json({ ok: true });
  };
})();
