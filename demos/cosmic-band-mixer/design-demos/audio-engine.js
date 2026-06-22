/* ═══════════════════════════════════════════════════════════════
   Cosmic Band Mixer · audio-engine.js  (Single Source of Truth · 音频)
   --------------------------------------------------------------
   24 件乐器音色配方 + 5 件 SampleLibrary 采样，逐件原样移植自
   design-demos/instrument-audition.html（已用户验收，音色不可改）。
   导出（挂 window.CBMAudio）:
     loadEngine()                          → Promise，采样就绪后 resolve
     playInstrument(id, time)              → 单件代表短句（旋钮试听用）
     playBandSolo(objectData, band,
                  instrumentId, durationSec=30) → 单波段琶音 solo N 秒（带渐变+自停）
     playArpTrack(objectData, band, instrumentId,
                  startTime, durationSec)  → 可复用单轨琶音（合奏复用，无渐变/不启 Transport）
     playEnsemble(objectData, selections,
                  durationSec=40)          → 六波段「天体肖像」合奏 N 秒（按能量排名编制角色 + 整段渐变 + 自停）
     ensemblePlan(objectData, durationSec=40) → 该天体的肖像编制计划（角色/电平/入场，测试用）
     stopAll()                             → 立即停止并清空 Transport/音符
   依赖（页面需先用 <script> 引入）: Tone.js、Tonejs-Instruments(SampleLibrary)
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  /* ---------- 引擎状态 ---------- */
  let reverb = null;
  let samplers = {};             // {piano,cello,violin,flute,harp} -> Tone.Sampler
  const synthNodes = {};         // id -> { node, play(time) }
  const fallbackIds = new Set(); // 采样失败降级为合成的 id
  let audioBuilt = false;        // 节点是否已构建
  let samplesReady = false;      // 采样是否就绪
  let loadPromise = null;        // 单次加载承诺（幂等）
  const soloHandle = { ids: [], releaseAt: 0 }; // 当前 solo 的调度句柄（用于 stopAll）

  /* ════════════════════════════════════════════════════════════
     一、24 件乐器音色配方（与 instrument-audition.html 逐件一致）
     ════════════════════════════════════════════════════════════ */

  function buildReverb() {
    reverb = new Tone.Reverb({ decay: 3, wet: 0.22 }).toDestination();
  }

  /* 每件合成乐器封装为 { node, play(time) } —— time 为 Tone 时间基准 */
  function buildSynths() {
    /* ===== RADIO 射电 ｜ C1–C2 ｜ 低频持续 + 缓慢脉冲 ===== */
    {
      const s = new Tone.MembraneSynth({ pitchDecay: 0.12, octaves: 5,
        oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 1.8 } }).connect(reverb);
      synthNodes["timpani"] = { node: s, play: (t) => { s.triggerAttackRelease("C1", "4n", t); s.triggerAttackRelease("G1", "4n", t + 0.85); s.triggerAttackRelease("C1", "4n", t + 1.7); } };
    }
    {
      const s = new Tone.PluckSynth({ attackNoise: 2, dampening: 900, resonance: 0.93 }).toDestination();
      synthNodes["bass-pluck"] = { node: s, play: (t) => { ["C2", "G1", "C2", "E2"].forEach((n, i) => s.triggerAttack(n, t + i * 0.55)); } };
    }
    {
      const s = new Tone.MonoSynth({ oscillator: { type: "square" },
        // sustain 由 0 提到 0.4：音符能撑住编制要求的时长（不再 0.14s 后归零→主奏出现 0.5s 真空"断掉"感）；
        // 方波 + 快起仍保留脉冲质感。filterEnvelope 保持 sustain:0 维持"啵"的滤波弹跳。
        envelope: { attack: 0.002, decay: 0.14, sustain: 0.4, release: 0.18 },
        filterEnvelope: { attack: 0.001, decay: 0.1, sustain: 0, baseFrequency: 120, octaves: 2 } }).toDestination();
      synthNodes["pulsar-pulse"] = { node: s, play: (t) => { for (let i = 0; i < 7; i++) s.triggerAttackRelease("C2", "16n", t + i * 0.42); } };
    }
    {
      const af = new Tone.AutoFilter({ frequency: 0.15, depth: 0.7 }).connect(reverb).start();
      const s = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 1.2, decay: 0, sustain: 1, release: 3 } }).connect(af);
      const s2 = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 1.2, decay: 0, sustain: 1, release: 3 } }).connect(af);
      synthNodes["deep-drone"] = { node: s, play: (t) => { s.triggerAttackRelease("C1", 3, t); s2.triggerAttackRelease("G1", 3, t); } };
    }

    /* ===== IR 红外 ｜ C2–C4 ｜ 温暖绵长持续音、legato、无打击音头 ===== */
    {
      const lp = new Tone.Filter(1400, "lowpass").connect(reverb);
      const vib = new Tone.Vibrato({ frequency: 5, depth: 0.08 }).connect(lp);
      const s = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.18, decay: 0.2, sustain: 0.85, release: 0.9 } }).connect(vib);
      synthNodes["warm-clarinet"] = { node: s, play: (t) => { ["C3", "E3", "D3"].forEach((n, i) => s.triggerAttackRelease(n, 0.8, t + i * 0.7)); } };
    }
    {
      const lp = new Tone.Filter(900, "lowpass").connect(reverb);
      const s = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sawtooth" }, envelope: { attack: 0.8, decay: 0.4, sustain: 0.8, release: 1.5 } }).connect(lp);
      synthNodes["warm-pad"] = { node: s, play: (t) => { s.triggerAttackRelease(["C3", "E3", "G3"], 2, t); } };
    }
    {
      const s = new Tone.AMSynth({ harmonicity: 1.5, oscillator: { type: "sine" }, envelope: { attack: 1.0, decay: 0.3, sustain: 0.9, release: 2 } }).connect(reverb);
      const s2 = new Tone.AMSynth({ harmonicity: 1.5, oscillator: { type: "sine" }, envelope: { attack: 1.0, decay: 0.3, sustain: 0.9, release: 2 } }).connect(reverb);
      synthNodes["low-warm-pad"] = { node: s, play: (t) => { s.triggerAttackRelease("C2", 2.2, t); s2.triggerAttackRelease("G2", 2.2, t); } };
    }

    /* ===== OPTICAL 可见光 ｜ C3–C5 ｜ 清晰原声旋律、明确音头 ===== */
    {
      const ch = new Tone.Chorus(3, 1.5, 0.3).toDestination().start();
      const s = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.4 } }).connect(ch);
      synthNodes["bright-lead"] = { node: s, play: (t) => { ["C4", "D4", "E4", "G4"].forEach((n, i) => s.triggerAttackRelease(n, "8n", t + i * 0.3)); } };
    }

    /* ===== UV 紫外 ｜ C5–C6 ｜ 冷亮流动、连续 legato ===== */
    {
      const s = new Tone.PluckSynth({ attackNoise: 1, dampening: 4500, resonance: 0.95 }).connect(reverb);
      synthNodes["glass-pluck"] = { node: s, play: (t) => { ["G5", "A5", "B5", "D6", "B5", "D6"].forEach((n, i) => s.triggerAttack(n, t + i * 0.16)); } };
    }
    {
      const s = new Tone.FMSynth({ harmonicity: 2, modulationIndex: 7, oscillator: { type: "sine" }, envelope: { attack: 0.005, decay: 0.4, sustain: 0.1, release: 0.6 } }).toDestination();
      synthNodes["fm-keys"] = { node: s, play: (t) => { ["C5", "E5", "G5", "E5"].forEach((n, i) => s.triggerAttackRelease(n, "8n", t + i * 0.3)); } };
    }
    {
      const ch = new Tone.Chorus(4, 2.5, 0.5).connect(reverb).start();
      const s = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle" }, envelope: { attack: 0.6, decay: 0.3, sustain: 0.7, release: 2 } }).connect(ch);
      synthNodes["shimmer-pad"] = { node: s, play: (t) => { s.triggerAttackRelease(["G5", "B5", "D6"], 2, t); } };
    }

    /* ===== XRAY X射线 ｜ C4–C6 ｜ 有音高木质/键盘打击 + 急促16分连击 ===== */
    {
      const s = new Tone.FMSynth({ harmonicity: 1, modulationIndex: 2.5, oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.22 },
        modulationEnvelope: { attack: 0.001, decay: 0.13, sustain: 0, release: 0.1 } }).toDestination();
      synthNodes["marimba"] = { node: s, play: (t) => { const seq = ["C5", "E5", "G5", "C6", "G5", "E5", "G5", "C5"]; seq.forEach((n, i) => s.triggerAttackRelease(n, "16n", t + i * 0.13)); } };
    }
    {
      const s = new Tone.FMSynth({ harmonicity: 1, modulationIndex: 1.8, oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 },
        modulationEnvelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.05 } }).toDestination();
      synthNodes["xylophone"] = { node: s, play: (t) => { const seq = ["C6", "C6", "G5", "C6", "E6", "C6", "G5", "C6"]; seq.forEach((n, i) => s.triggerAttackRelease(n, "16n", t + i * 0.12)); } };
    }
    {
      const s = new Tone.Synth({ oscillator: { type: "sawtooth" }, envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.04 } }).toDestination();
      synthNodes["laser-pulse"] = { node: s, play: (t) => {
        for (let i = 0; i < 7; i++) {
          const tt = t + i * 0.16;
          s.triggerAttackRelease("C6", 0.1, tt);
          s.frequency.setValueAtTime(1800, tt);
          s.frequency.exponentialRampToValueAtTime(260, tt + 0.09);
        }
      } };
    }
    {
      const s = new Tone.MembraneSynth({ pitchDecay: 0.012, octaves: 2, oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.1 } }).toDestination();
      synthNodes["pulse-perc"] = { node: s, play: (t) => { const seq = ["C4", "C4", "G4", "C4", "C4", "G4", "C4", "C4"]; seq.forEach((n, i) => s.triggerAttackRelease(n, "16n", t + i * 0.13)); } };
    }

    /* ===== GAMMA 伽马 ｜ 无调/极高瞬态 ｜ 稀疏不规则爆裂、大量留白 ===== */
    {
      const hp = new Tone.Filter(7000, "highpass").connect(reverb);
      const s = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.01 } }).connect(hp);
      synthNodes["geiger"] = { node: s, play: (t) => { [0, 0.07, 0.55, 1.0, 1.12, 1.7].forEach((d) => s.triggerAttackRelease("16n", t + d)); } };
    }
    {
      const s = new Tone.FMSynth({ harmonicity: 3.01, modulationIndex: 14, oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 1.4, sustain: 0, release: 1.8 },
        modulationEnvelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.4 } }).connect(reverb);
      synthNodes["crystal-bell"] = { node: s, play: (t) => { s.triggerAttackRelease("C7", "2n", t); s.triggerAttackRelease("G7", "2n", t + 1.6); } };
    }
    {
      const s = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.04 } }).toDestination();
      synthNodes["granular-blip"] = { node: s, play: (t) => { const notes = ["C7", "A7", "E7", "B6"]; const gaps = [0, 0.4, 1.05, 1.5]; notes.forEach((n, i) => s.triggerAttackRelease(n, "32n", t + gaps[i])); } };
    }
    {
      const hp = new Tone.Filter(6000, "highpass").connect(reverb);
      const s = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.03 } }).connect(hp);
      synthNodes["noise-spark"] = { node: s, play: (t) => { [0, 0.45, 0.6, 1.3, 1.95].forEach((d) => s.triggerAttackRelease("16n", t + d)); } };
    }
  }

  /* 采样乐器降级合成等价物（幂等；与试听页一致） */
  let samplerFallbacksBuilt = false;
  function buildSamplerFallbacks() {
    if (samplerFallbacksBuilt) return;
    samplerFallbacksBuilt = true;
    if (!samplers.cello) {
      const s = new Tone.FMSynth({ harmonicity: 1.5, modulationIndex: 4, oscillator: { type: "sawtooth" }, envelope: { attack: 0.15, decay: 0.3, sustain: 0.8, release: 1.0 } }).connect(reverb);
      synthNodes["cello"] = { node: s, play: (t) => { ["C3", "E3", "G3"].forEach((n, i) => s.triggerAttackRelease(n, "4n", t + i * 0.5)); } };
      fallbackIds.add("cello");
    }
    if (!samplers.piano) {
      const s = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle" }, envelope: { attack: 0.005, decay: 0.4, sustain: 0.2, release: 0.8 } }).toDestination();
      synthNodes["piano"] = { node: s, play: (t) => { ["C4", "E4", "G4", "C5"].forEach((n, i) => s.triggerAttackRelease(n, "8n", t + i * 0.28)); } };
      fallbackIds.add("piano");
    }
    if (!samplers.violin) {
      const s = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sawtooth" }, envelope: { attack: 0.25, decay: 0.3, sustain: 0.8, release: 1.2 } }).connect(reverb);
      synthNodes["strings"] = { node: s, play: (t) => { s.triggerAttackRelease(["C4", "E4", "G4"], 1.8, t); } };
      fallbackIds.add("strings");
    } else {
      synthNodes["strings"] = { node: samplers.violin, play: (t) => { samplers.violin.triggerAttackRelease(["C4", "E4", "G4"], 1.8, t); } };
    }
    if (!samplers.flute) {
      const s = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.6 } }).connect(reverb);
      synthNodes["flute"] = { node: s, play: (t) => { ["C5", "E5", "G5"].forEach((n, i) => s.triggerAttackRelease(n, "4n", t + i * 0.45)); } };
      fallbackIds.add("flute");
    }
    if (!samplers.harp) {
      const s = new Tone.PluckSynth({ attackNoise: 1, dampening: 2600, resonance: 0.96 }).connect(reverb);
      synthNodes["harp"] = { node: s, play: (t) => { ["C4", "E4", "G4", "C5", "E5"].forEach((n, i) => s.triggerAttack(n, t + i * 0.16)); } };
      fallbackIds.add("harp");
    }
  }

  /* 统一单件代表短句（与试听页 playInstrument 逐件一致） */
  function playInstrument(id, baseTime) {
    const t = baseTime !== undefined ? baseTime : Tone.now() + 0.02;
    if (id === "cello" && samplers.cello) { ["C3", "E3", "G3"].forEach((n, i) => samplers.cello.triggerAttackRelease(n, "4n", t + i * 0.5)); return; }
    if (id === "piano" && samplers.piano) { ["C4", "E4", "G4", "C5"].forEach((n, i) => samplers.piano.triggerAttackRelease(n, "8n", t + i * 0.28)); return; }
    if (id === "flute" && samplers.flute) { ["C5", "E5", "G5"].forEach((n, i) => samplers.flute.triggerAttackRelease(n, "4n", t + i * 0.45)); return; }
    if (id === "harp" && samplers.harp) { ["C4", "E4", "G4", "C5", "E5"].forEach((n, i) => samplers.harp.triggerAttackRelease(n, "8n", t + i * 0.16)); return; }
    const node = synthNodes[id];
    if (node) node.play(t);
  }

  /* ════════════════════════════════════════════════════════════
     二、数据驱动 30 秒演奏规格 (playBandSolo)
     ════════════════════════════════════════════════════════════ */

  const BANDS = ["radio", "ir", "optical", "uv", "xray", "gamma"];

  /* 每波段的「性格基线」：音区 + 节奏个性 —— 从已验收 v2 音色提炼，
     琶音只在该基线上由 E 调节疏密/音域/力度，不改变波段本性。
     register: 该波段音符池所在的 MIDI 音高范围 [lo,hi]（音符池在此区间取音阶音）
     baseGap : 该波段基础琶音间隔（秒，E=0.5 的典型疏密）→ radio 慢、xray 快、gamma 稀疏
     gapJitter:历史保留字段（基线不规则感参数，gamma 另用固定循环间隔型，见 playArpTrack）
     dur     : 单音持续（"sustained" 走长音 legato 铺底；数字走该秒数）
     baseVel : 基础力度（实际力度 = baseVel × E 缩放 × 人性化抖动）
     trigger : 触发风格 —— "note"(有音高音符) | "burst"(gamma 爆点) */
  const BAND_CHAR = {
    // radio：低且慢 —— 低音区，稀疏脉冲感
    radio:   { register: [24, 41], baseGap: 0.95, gapJitter: 0.30, dur: 0.6,  sustained: false, baseVel: 0.62, trigger: "note" },
    // ir：绵长长音 —— 中低音区，重叠 legato 铺底
    ir:      { register: [36, 60], baseGap: 1.6,  gapJitter: 0.20, dur: "sustained", baseVel: 0.55, trigger: "note" },
    // optical：中音旋律 —— 主旋律音区，清晰音头
    optical: { register: [48, 72], baseGap: 0.55, gapJitter: 0.22, dur: 0.35, sustained: false, baseVel: 0.62, trigger: "note" },
    // uv：高音流动 —— 高音区，连续流动
    uv:      { register: [67, 84], baseGap: 0.34, gapJitter: 0.18, dur: 0.28, sustained: false, baseVel: 0.55, trigger: "note" },
    // xray：急促密集 —— 中高音区，16 分连击感
    xray:    { register: [60, 84], baseGap: 0.22, gapJitter: 0.25, dur: 0.14, sustained: false, baseVel: 0.6,  trigger: "note" },
    // gamma：高/无调且稀疏 —— 不走音高轮廓，走爆点密度
    gamma:   { register: [84, 96], baseGap: 1.7,  gapJitter: 0.55, dur: 0.1,  sustained: false, baseVel: 0.7,  trigger: "burst" }
  };

  /* 音阶量化：每个天体选一个固定调 + 音阶（用 id 做稳定种子），
     所有音高吸附到音阶 → 和谐不难听。返回该调允许的 pitch-class 集合 + 主音偏移。
     scales 以半音相对主音的 pitch-class 表示。 */
  const SCALES = {
    // 大调五声（最稳、最“好听”） C D E G A
    pentaMajor:  [0, 2, 4, 7, 9],
    // 小调五声（略带忧郁）       A C D E G  → 以相对主音表示 0 3 5 7 10
    pentaMinor:  [0, 3, 5, 7, 10],
    // 自然小调（更有情绪层次）    0 2 3 5 7 8 10
    naturalMinor:[0, 2, 3, 5, 7, 8, 10],
    // 多利亚（明亮的小调，星系/星云用）0 2 3 5 7 9 10
    dorian:      [0, 2, 3, 5, 7, 9, 10]
  };
  // 每天体固定的「调」配置（主音 root 用 MIDI pitch-class 0..11，C=0）。
  // 未列出的天体回退到 fallback（用 id 字符做稳定 hash 选）。
  const OBJECT_KEY = {
    sun:       { root: 0,  scale: "pentaMajor" },   // C 大调五声 —— 温暖明亮
    jupiter:   { root: 2,  scale: "dorian" },       // D 多利亚 —— 宽厚、双峰
    orion:     { root: 9,  scale: "naturalMinor" }, // A 自然小调 —— 孕育、宽阔
    andromeda: { root: 5,  scale: "pentaMajor" },   // F 大调五声 —— 均衡成熟
    m87:       { root: 4,  scale: "pentaMinor" }    // E 小调五声 —— 极端、张力
  };
  const KEY_FALLBACKS = [
    { root: 0, scale: "pentaMajor" }, { root: 7, scale: "dorian" },
    { root: 9, scale: "naturalMinor" }, { root: 5, scale: "pentaMinor" }
  ];

  function objectKey(objectData) {
    const id = objectData && objectData.id;
    if (id && OBJECT_KEY[id]) return OBJECT_KEY[id];
    // 稳定 hash 回退
    const s = String(id || (objectData && objectData.name) || "x");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return KEY_FALLBACKS[h % KEY_FALLBACKS.length];
  }

  /* 把任意 MIDI 音高吸附到「调」的音阶上，并夹到波段音区内 */
  function quantizeToScale(midi, key, register) {
    const lo = register[0], hi = register[1];
    let m = Math.max(lo, Math.min(hi, Math.round(midi)));
    const scale = SCALES[key.scale] || SCALES.pentaMajor;
    // 在 m 附近搜索最接近的「合法音」（pitch-class ∈ scale，偏移 root 后）
    let best = m, bestDist = Infinity;
    for (let cand = lo; cand <= hi; cand++) {
      const pc = (((cand - key.root) % 12) + 12) % 12;
      if (scale.indexOf(pc) === -1) continue;
      const d = Math.abs(cand - m);
      if (d < bestDist) { bestDist = d; best = cand; }
    }
    return best;
  }

  /* 音符池：在波段音区 register=[lo,hi] 内、取该天体调式音阶的全部合法音，
     升序排列后，由能量 E 决定取多少个、音域多宽（PRD line 165）。
       · E 高 → 音域宽、音数多（取满 hiCount，居中向两端扩展）
       · E 低 → 音域窄、音数少（取 loCount，集中在音区低端）
     输出永远是「升序、落在音阶上」的 MIDI 数组，长度 ∈ [loCount, hiCount]。
     这是琶音的「轨道音符池」——顺序循环就在这个池里走。 */
  function buildNotePool(key, register, E) {
    const scale = SCALES[key.scale] || SCALES.pentaMajor;
    const lo = register[0], hi = register[1];
    // 1) 列出音区内全部合法音（音阶量化的母集），升序
    const legal = [];
    for (let m = lo; m <= hi; m++) {
      const pc = (((m - key.root) % 12) + 12) % 12;
      if (scale.indexOf(pc) !== -1) legal.push(m);
    }
    if (legal.length === 0) return [Math.round((lo + hi) / 2)]; // 兜底：至少 1 个音
    // 2) E 决定目标音数：低能量 5、高能量 8（夹在 legal 长度内）
    const loCount = 5, hiCount = 8;
    let want = Math.round(loCount + (hiCount - loCount) * clamp01(E));
    want = Math.max(1, Math.min(want, legal.length));
    if (want >= legal.length) return legal.slice(); // 池就是整个音区
    // 3) E 决定音域宽窄：高 E 居中向两端扩展（宽），低 E 集中在低端（窄）
    //    用一个起始偏移把窗口在 legal 内滑动：E 高→窗口居中，E 低→窗口贴底。
    const room = legal.length - want;        // 可滑动余量
    const startIdx = Math.round(room * (0.5 * clamp01(E))); // E=0→0(贴底)，E=1→room/2(居中)
    return legal.slice(startIdx, startIdx + want);
  }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function midiToNote(m) {
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const oct = Math.floor(m / 12) - 1;
    return names[((m % 12) + 12) % 12] + oct;
  }
  // 确定性伪随机（用天体+波段做种子 → 同一组合每次演奏一致，便于对照）
  function makeRng(seedStr) {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) {
      h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
  }

  /* 触发单件乐器在 time、以 vel 力度、midi 音高演奏一个「点」。
     兼容采样(triggerAttackRelease note,dur)、合成节点、NoiseSynth(无音高)。 */
  function triggerNote(id, time, midi, durSec, vel) {
    const node = synthNodes[id];
    // 采样优先
    if (id === "cello" && samplers.cello) { samplers.cello.triggerAttackRelease(midiToNote(midi), durSec, time, vel); return; }
    if (id === "piano" && samplers.piano) { samplers.piano.triggerAttackRelease(midiToNote(midi), durSec, time, vel); return; }
    if (id === "flute" && samplers.flute) { samplers.flute.triggerAttackRelease(midiToNote(midi), durSec, time, vel); return; }
    if (id === "harp" && samplers.harp) { samplers.harp.triggerAttackRelease(midiToNote(midi), durSec, time, vel); return; }
    if (id === "strings" && samplers.violin) { samplers.violin.triggerAttackRelease(midiToNote(midi), durSec, time, vel); return; }
    if (!node) return;
    const n = node.node;
    // NoiseSynth（geiger / noise-spark）无音高
    if (n instanceof Tone.NoiseSynth) { n.triggerAttackRelease(durSec, time, vel); return; }
    if (n instanceof Tone.PluckSynth) { n.triggerAttack(midiToNote(midi), time, vel); return; } // Pluck 无 dur，但可吃 velocity
    // 其余有音高合成（含 PolySynth）
    try { n.triggerAttackRelease(midiToNote(midi), durSec, time, vel); }
    catch (e) { try { n.triggerAttackRelease(midiToNote(midi), durSec, time); } catch (e2) { /* ignore */ } }
  }

  /* gamma 爆点：稀疏孤立瞬态。NoiseSynth 无音高（纯爆裂）；
     有音高的 gamma 乐器（crystal-bell / granular-blip / 等）用传入的 midi —
     该 midi 来自 gamma 音符池的「顺序循环」，不再随机取，保证循环可复现。 */
  function triggerBurst(id, time, vel, midi) {
    const node = synthNodes[id];
    if (!node) return;
    const n = node.node;
    if (n instanceof Tone.NoiseSynth) { n.triggerAttackRelease("32n", time, vel); return; }
    const m = (typeof midi === "number") ? midi : BAND_CHAR.gamma.register[0];
    if (n instanceof Tone.PluckSynth) { n.triggerAttack(midiToNote(m), time, vel); return; }
    try { n.triggerAttackRelease(midiToNote(m), "16n", time, vel); }
    catch (e) { try { n.triggerAttackRelease(midiToNote(m), "16n", time); } catch (e2) { /* ignore */ } }
  }

  /* 构造琶音遍历 pattern（顺序循环走音符池索引，PRD line 166 的核心）。
       · 有音高波段（n≥2）：上下往复 0,1,…,n-1,n-2,…,1，再循环（来回扫，不撞顶/底重复）
       · n==1：恒定 [0]
     返回一个长度为「一个完整循环周期」的 index 数组；演奏时对它取模无限循环。 */
  function arpPattern(n) {
    if (n <= 1) return [0];
    const up = [];
    for (let i = 0; i < n; i++) up.push(i);          // 0..n-1
    const down = [];
    for (let i = n - 2; i >= 1; i--) down.push(i);   // n-2..1
    return up.concat(down);                          // 上下往复，一个周期长 2n-2
  }

  function poolAt(pool, idx) {
    if (!pool || !pool.length) return BAND_CHAR.optical.register[0];
    return pool[((idx % pool.length) + pool.length) % pool.length];
  }

  /**
   * 单波段琶音轨道（可复用 · PRD line 182 试听=正式播放同一套发声规则）。
   * 在该波段音符池里【按固定 pattern 顺序循环走】，循环填满 durationSec。
   * 不含渐入渐出、不启动 Transport —— 这些由调用方（playBandSolo / 将来 6 轨合奏）统一套。
   *
   * @param {object} objectData 单个天体对象（需含 .bands、.id）
   * @param {string} band       6 波段之一
   * @param {string} instrumentId 该波段的乐器 id
   * @param {number} startTime  Tone 绝对起始时间（秒，如 Tone.now()+0.15）
   * @param {number} durationSec 该轨演奏时长
   * @returns {{scheduled:number, ids:number[], pattern:number[], pool:number[],
   *            trace:Array, kind:string}} pool=音符池(MIDI升序)，pattern=遍历索引序列，
   *            trace=前若干音的 {time,midi,vel} 用于验证「顺序循环」。
   */
  function playArpTrack(objectData, band, instrumentId, startTime, durationSec, gainScale) {
    if (!objectData || !objectData.bands) throw new Error("playArpTrack: objectData 缺少 bands");
    if (BANDS.indexOf(band) === -1) throw new Error("playArpTrack: 非法波段 " + band);

    const gs = (typeof gainScale === "number" && gainScale > 0) ? gainScale : 1;
    // Density model:
    // - E controls activity intensity through sqrt-compressed gapScale.
    // - BAND_CHAR gives each electromagnetic band its base rhythmic personality.
    // - role is used in ensemble arrangement timing, not as the only density source.

    const E = clamp01(typeof objectData.bands[band] === "number" ? objectData.bands[band] : 0);
    const Ec = Math.sqrt(E);                 // 与 objects.json audioNote 的 √x 一致：弱波段也可听
    const char = BAND_CHAR[band];
    const key = objectKey(objectData);
    // 人性化抖动种子（仅用于 velocity 微抖 + gamma 内部不均匀间隔，不用于选音高）
    const rng = makeRng((objectData.id || objectData.name || "x") + ":" + band + ":" + instrumentId);

    // —— 音符池（数据驱动音域/音数 ← E） + 遍历 pattern（顺序循环） ——
    const pool = buildNotePool(key, char.register, E);
    const pattern = arpPattern(pool.length);

    // —— 疏密/速度 ← E：在波段节奏性格基线(baseGap)上调节 ——
    //    Ec 越大 gap 越小（密/快）；Ec 越小 gap 越大（疏/慢）。
    const gapScale = 1.9 - 1.3 * Ec;          // ∈ [~0.6, ~1.9]
    const baseGap = char.baseGap * gapScale;
    // —— 力度 ← E（+ 轻微人性化抖动） ——
    function velFor(idx) {
      const human = 0.94 + 0.12 * rng();      // ±~6% 人性化抖动
      return clamp01(char.baseVel * (0.5 + 0.6 * Ec) * human * gs);
    }

    const ids = [];
    const trace = [];                          // 前若干音，用于验证顺序循环
    let scheduled = 0;
    const endT = startTime + durationSec - 0.05;
    let t = startTime;
    let step = 0;                              // 遍历步进计数 → pattern[step % len]
    let guard = 0;

    function scheduleNote(tt, midi, durSec, vel, poolIdx) {
      const idLocal = Tone.Transport.scheduleOnce(
        (time) => triggerNote(instrumentId, time, midi, durSec, vel), "+" + (tt - Tone.now()));
      ids.push(idLocal);
      if (trace.length < 24) trace.push({ time: +(tt - startTime).toFixed(3), idx: poolIdx, midi: midi, vel: +vel.toFixed(3) });
      scheduled++;
    }
    function scheduleBurst(tt, midi, vel, poolIdx) {
      const idLocal = Tone.Transport.scheduleOnce(
        (time) => triggerBurst(instrumentId, time, vel, midi), "+" + (tt - Tone.now()));
      ids.push(idLocal);
      if (trace.length < 24) trace.push({ time: +(tt - startTime).toFixed(3), idx: poolIdx, midi: midi, vel: +vel.toFixed(3) });
      scheduled++;
    }

    if (band === "ir") {
      /* 红外：热层长音。少跑音阶，多做缓慢重叠的持续音，像温度场在呼吸。 */
      const motif = [0, 2, 1, 3, 1, 4];
      while (t < endT && guard < 3000) {
        guard++;
        const poolIdx = motif[step % motif.length] % pool.length;
        const midi = poolAt(pool, poolIdx);
        const vel = velFor(step) * 0.92;
        const durSec = Math.min(4.2, Math.max(2.4, baseGap * (2.0 + 0.7 * Ec)));
        scheduleNote(t, midi, durSec, vel, poolIdx);
        t += Math.max(1.05, baseGap * (0.92 + 0.18 * rng()));
        step++;
      }
    } else if (band === "radio") {
      /* 射电：低频脉冲。保留慢、低、重复的信号感，不做连续旋律。 */
      const pulsePat = [0, 0, 1, 0, 2, 1, 0, 3];
      while (t < endT && guard < 3000) {
        guard++;
        const poolIdx = pulsePat[step % pulsePat.length] % pool.length;
        const midi = poolAt(pool, poolIdx);
        const vel = velFor(step) * (step % 4 === 0 ? 1.08 : 0.86);
        scheduleNote(t, midi, Math.max(0.35, char.dur), vel, poolIdx);
        t += Math.max(0.42, baseGap * (step % 3 === 0 ? 1.45 : 0.82));
        step++;
      }
    } else if (band === "optical") {
      /* 可见光：可辨认主旋律 motif。它仍由音符池决定，但不再机械上下爬。 */
      const motif = [0, 2, 4, 5, 4, 2, 1, 3, 2, 0, 4, 3];
      const rhythm = [1.0, 0.72, 1.18, 0.82, 1.45, 0.72, 1.0, 1.65, 0.86, 0.72, 1.12, 1.9];
      while (t < endT && guard < 5000) {
        guard++;
        const poolIdx = motif[step % motif.length] % pool.length;
        const midi = poolAt(pool, poolIdx);
        const vel = velFor(step) * (step % motif.length === 0 ? 1.12 : 0.95);
        scheduleNote(t, midi, char.dur, vel, poolIdx);
        t += Math.max(0.16, baseGap * rhythm[step % rhythm.length]);
        step++;
      }
    } else if (band === "uv") {
      /* 紫外：冷亮碎片。短小上行簇 + 留白，避免持续高频铺满。 */
      const clusterGap = Math.max(0.92, baseGap * (3.8 - 0.9 * Ec));
      while (t < endT && guard < 2500) {
        guard++;
        const notesInCluster = 2 + Math.round(E * 1.6);
        for (let j = 0; j < notesInCluster; j++) {
          const tt = t + j * (0.085 + 0.025 * (1 - Ec));
          if (tt >= endT) break;
          const poolIdx = (step + j * 2) % pool.length;
          const midi = poolAt(pool, poolIdx);
          const vel = velFor(step + j) * (j === 0 ? 1.0 : 0.82);
          scheduleNote(tt, midi, Math.max(0.09, char.dur * 0.72), vel, poolIdx);
        }
        t += clusterGap * (0.86 + 0.28 * rng());
        step += notesInCluster;
      }
    } else if (band === "xray") {
      /* X 射线：簇状爆发。短时间急促，随后留白，避免全程连打抢走主声部。 */
      const clusterGap = Math.max(1.25, baseGap * (6.0 - 2.0 * Ec));
      while (t < endT && guard < 2500) {
        guard++;
        const notesInCluster = 2 + Math.round(E * 3);
        for (let j = 0; j < notesInCluster; j++) {
          const tt = t + j * (0.055 + 0.018 * (1 - Ec));
          if (tt >= endT) break;
          const poolIdx = (step + j * 3) % pool.length;
          const midi = poolAt(pool, poolIdx);
          const vel = velFor(step + j) * (j === 0 ? 1.08 : 0.88);
          scheduleNote(tt, midi, Math.max(0.055, char.dur * 0.72), vel, poolIdx);
        }
        t += clusterGap * (0.9 + 0.22 * rng());
        step += notesInCluster;
      }
    } else if (char.trigger === "burst") {
      /* 伽马：稀疏高能爆点。大量留白，偶发闪烁，不形成稳定旋律。 */
      const gapPat = [1.0, 0.55, 2.1, 0.9, 1.65, 2.6];
      while (t < endT && guard < 3000) {
        guard++;
        const poolIdx = pattern[step % pattern.length];
        const midi = pool[poolIdx];
        const vel = clamp01((char.baseVel * (0.5 + 0.6 * Ec) * 0.92 + 0.08 * char.baseVel) * gs);
        scheduleBurst(t, midi, vel, poolIdx);
        const g = baseGap * gapPat[step % gapPat.length];
        t += Math.max(0.35, g);
        step++;
      }
    } else {
      /* 兜底：保留旧式顺序循环，只用于未来新增波段/未知分支。 */
      while (t < endT && guard < 8000) {
        guard++;
        const poolIdx = pattern[step % pattern.length];
        const midi = pool[poolIdx];
        const vel = velFor(step);
        const durSec = (char.dur === "sustained") ? (1.6 + 1.0 * Ec) : char.dur;
        scheduleNote(t, midi, durSec, vel, poolIdx);
        t += Math.max(0.08, baseGap);
        step++;
      }
    }

    return { scheduled: scheduled, ids: ids, pattern: pattern, pool: pool.slice(), trace: trace, kind: char.trigger };
  }

  /**
   * 按天体数据演奏一条波段 solo（单件乐器，非合奏）= 单条琶音轨道 + 渐入渐出 + 30s 自停。
   * 发声规则与正式播放一致（复用 playArpTrack），满足 PRD line 182。
   * @param {object} objectData objects.json 里的单个天体对象（需含 .bands、.id）
   * @param {string} band       6 波段之一
   * @param {string} instrumentId 该波段的乐器 id
   * @param {number} durationSec 演奏时长（默认 30，PRD line 179）
   * @returns {{scheduled:number, durationSec:number, startTime:number,
   *            pool:number[], pattern:number[], trace:Array}}
   */
  function playBandSolo(objectData, band, instrumentId, durationSec) {
    if (!objectData || !objectData.bands) throw new Error("playBandSolo: objectData 缺少 bands");
    if (BANDS.indexOf(band) === -1) throw new Error("playBandSolo: 非法波段 " + band);
    const D = (typeof durationSec === "number" && durationSec > 0) ? durationSec : 30;

    stopAll(); // 互斥：一次只演奏一条 solo

    const FADE = 2.0;                          // 渐入秒数（PRD line 182）
    const FADE_OUT = Math.min(3.0, D * 0.12);  // 渐出秒数
    const t0 = Tone.now() + 0.15;              // 起始（留一点点调度余量）

    // —— 渐入渐出：用 Destination volume 包络（dB），不污染单件音色 ——
    const dest = Tone.getDestination();
    dest.volume.cancelScheduledValues(t0);
    dest.volume.setValueAtTime(-40, t0);
    dest.volume.linearRampToValueAtTime(-8, t0 + FADE);              // fade in 到工作电平
    dest.volume.setValueAtTime(-8, t0 + D - FADE_OUT);
    dest.volume.linearRampToValueAtTime(-40, t0 + D);               // fade out

    // —— 单条琶音轨道（顺序循环音符池，填满 D） ——
    const track = playArpTrack(objectData, band, instrumentId, t0 + 0.05, D);

    soloHandle.ids = track.ids;
    soloHandle.releaseAt = t0 + D;
    Tone.Transport.start();
    return {
      scheduled: track.scheduled, durationSec: D, startTime: t0,
      pool: track.pool, pattern: track.pattern, trace: track.trace
    };
  }

  /* 每波段「默认乐器」回退表（与 data/objects.json meta.bandInstruments 里 default:true
     的那件保持一致）。合奏时若某波段 selections 缺省/非法，用此回退保证 6 轨齐全，
     无需在引擎里读取 objects.json（engine 保持自洽、可独立测试）。 */
  const BAND_DEFAULT = {
    radio:   "deep-drone",
    ir:      "cello",
    optical: "bright-lead",
    uv:      "glass-pluck",
    xray:    "marimba",
    gamma:   "crystal-bell"
  };

  /* 该 id 是否为引擎已知的可发声乐器（合成节点 / 采样 / 采样降级映射均算） */
  function isKnownInstrument(id) {
    if (!id) return false;
    if (synthNodes[id]) return true;
    if (id === "cello" || id === "piano" || id === "flute" || id === "harp" || id === "strings") return true;
    return false;
  }

  /* ════════════════════════════════════════════════════════════
     二·补 ｜「天体肖像」合奏编制（portrait）——逐字移植自已验收 demo
       ensemble-compare.html 的 portraitPlan / portraitRoleEvents。
     把六波段当一支乐队，角色按【能量排名 + 音区】分配：
       能量第1名 = 主奏 hook（开场单独署名）；最低强波段 = 贝斯（强拍引擎）；
       较弱高频波段 = 镲 hi-hat（轻纹理推动律动）；其余强波段 = 和声；弱波段 = 点缀。
     角色决定声部「演什么」，但音色/音区/音阶仍用该波段自己的（数据可读性不丢）。
     ════════════════════════════════════════════════════════════ */
  const ENS_BPM = 100;              // 合奏统一拍子（与 demo 一致）
  const ENS_BEAT = 60 / ENS_BPM;    // 0.6s/拍（ENS_BPM 为唯一真源）
  const ENS_BAR = ENS_BEAT * 4;     // 一小节 = 4 拍
  const ENS_EIGHTH = ENS_BEAT / 2;  // 1/8 音符

  /* 「天体肖像」编制计划（移植 demo portraitPlan）。
     返回 {[band]:{rank,role,level,enter,fadeIn,exit,leadLow,skip,E}}。
     @param {object} objectData 单个天体对象（需含 .bands）
     @param {number} D 合奏总时长（决定 accent 入场上限，默认 40） */
  function ensemblePlan(objectData, D) {
    const total = (typeof D === "number" && D > 0) ? D : 40;
    const Eof = (b) => clamp01((objectData && objectData.bands && objectData.bands[b]) || 0);
    const ranked = BANDS.map((b) => ({ b, E: Eof(b) })).sort((a, c) => c.E - a.E);
    const lead = ranked[0].b;
    let strong = ranked.filter((r) => r.E >= 0.18).map((r) => r.b);
    if (strong.length < 3) strong = ranked.slice(0, 3).map((r) => r.b);   // 至少前三名进核心
    const rankOf = {}; ranked.forEach((r, i) => { rankOf[r.b] = i; });
    const bass = strong.slice().sort((a, b) => BAND_CHAR[a].register[0] - BAND_CHAR[b].register[0])[0]; // 音区最低 = 贝斯
    // 镲只给【高音区(高边界≥78) 且 非能量前三(rank≥3) 且 非主奏/贝斯】的较弱高频波段，取能量最高者；否则无镲。
    const hatCands = BANDS.filter((b) =>
      BAND_CHAR[b].register[1] >= 78 && rankOf[b] >= 3 && b !== lead && b !== bass && Eof(b) >= 0.05
    ).sort((a, b) => Eof(b) - Eof(a));
    const hat = hatCands.length ? hatCands[0] : null;
    // harmony：能量最高的 ≤2 个剩余强波段（旋律对位）
    const used = new Set([lead, bass, hat].filter(Boolean));
    const harmony = strong.filter((b) => !used.has(b)).sort((a, b) => Eof(b) - Eof(a)).slice(0, 2);
    harmony.forEach((b) => used.add(b));
    // 电平统一走【能量单调映射】→ 越强越响，低能波段绝不比高能波段更突出
    const levelForE = (E) => clamp01(0.2 + 0.5 * E);
    const ENTER = { lead: 0, bass: ENS_BAR, hat: ENS_BAR, harmony: ENS_BAR * 2 };
    const FADE = { lead: 0.8, bass: 0.35, hat: 0.35, harmony: 1.4 };
    const plan = {};
    ranked.forEach((r, i) => {
      const role = r.b === lead ? "lead" : r.b === bass ? "bass" : r.b === hat ? "hat"
        : harmony.indexOf(r.b) !== -1 ? "harmony" : "accent";
      const level = role === "lead" ? Math.max(0.8, levelForE(r.E)) : levelForE(r.E);
      const enter = (role in ENTER) ? ENTER[role] : Math.min(ENS_BAR * (2 + (i - 2)), total - 7);
      const fade = (FADE[role] != null) ? FADE[role] : 1.4;
      plan[r.b] = {
        rank: i, role: role, level: level, enter: enter, fadeIn: fade, exit: total, E: r.E,
        leadLow: (r.b === lead && lead === bass),         // 主奏恰好也是最低波段 → 低音驱动型 hook
        skip: (role === "accent" && r.E < 0.05)
      };
    });
    return plan;
  }

  /* 按角色生成【全程踩格子】的声部事件（移植 demo portraitRoleEvents）。
     @param {string} band 波段
     @param {object} p    该波段在 ensemblePlan 里的计划项
     @param {number[]} pool 该波段音符池（MIDI 升序，来自 buildNotePool）
     @param {function} rng  种子随机（此处未直接用，留接口与 demo 一致）
     @param {number} D    合奏总时长
     @returns {Array<{t,midi,dur,vel}>} t 相对 0 */
  function ensembleRoleEvents(band, p, pool, rng, D) {
    const total = (typeof D === "number" && D > 0) ? D : 40;
    const reg = BAND_CHAR[band].register;
    const pick = (i) => pool[((i % pool.length) + pool.length) % pool.length];
    const start = p.enter, end = total - 0.05, out = [];
    const onBeat = (t) => Math.abs((t / ENS_BEAT) - Math.round(t / ENS_BEAT)) < 1e-6;
    const push = (t, midi, dur, vel) => {
      if (t >= start - 1e-9 && t < end) out.push({ t: +t.toFixed(4), midi: midi, dur: dur, vel: clamp01(vel) });
    };

    if (p.role === "bass") {                 // 每拍一下，小节头重音+低八度 = 强拍引擎
      let k = 0;
      for (let t = start; t < end; t += ENS_BEAT) {
        const bib = k % 4;
        let m = pick([0, 0, 2, 0][bib]);
        if (bib === 0 && m - 12 >= reg[0]) m -= 12;
        push(t, m, 0.5, bib === 0 ? 0.8 : 0.62); k++;
      }
      return out;
    }
    if (p.role === "hat") {                  // 较弱高频的轻纹理；最多 1/8（≥.45），更弱走 1/4。无 1/16 → 永不抢耳
      const step = p.E >= 0.45 ? ENS_EIGHTH : ENS_BEAT;
      let k = 0;
      for (let t = start; t < end; t += step) {
        push(t, pick(pool.length - 1 - (k % 2)), 0.07, onBeat(t) ? 0.4 : 0.22); k++;
      }
      return out;
    }
    if (p.role === "lead") {                 // 署名 + 招牌 hook：16 个 1/8 槽固定节奏面具，循环；强拍重音
      const mask = p.leadLow ? [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]   // 低音驱动型 = 每拍走低音
        : [1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0];                       // 旋律 hook 型
      const motif = p.leadLow ? [0, 0, 2, 0, 1, 0, 2, 3] : [0, 2, 4, 2, 5, 3, 4, 1];
      let slot = 0, mi = 0;
      for (let t = start; t < end; t += ENS_EIGHTH) {
        const s = slot % 16;
        if (mask[s]) {
          push(t, pick(motif[mi % motif.length]), p.leadLow ? 0.34 : 0.3, (s === 0 || s === 8) ? 0.92 : (s % 2 === 0 ? 0.8 : 0.66));
          mi++;
        }
        slot++;
      }
      return out;
    }
    if (p.role === "harmony") {              // 每 2 拍一个中长音，垫和声
      let k = 0;
      for (let t = start; t < end; t += ENS_BEAT * 2) { push(t, pick([1, 3, 2, 4][k % 4]), 1.4, 0.5); k++; }
      return out;
    }
    // accent：每 1~2 小节零星点缀
    let k = 0;
    for (let t = start; t < end; t += ENS_BAR * (k % 2 ? 2 : 1)) { push(t, pick(2 + k), 0.3, 0.4); k++; }
    return out;
  }

  /**
   * 六波段【同时合奏】N 秒——「天体肖像」编制（portrait）。
   * 不再 6× playArpTrack 错峰，而是按 ensemblePlan 的角色（主奏/贝斯/镲/和声/点缀）
   * 用 ensembleRoleEvents 生成踩格子的声部，整支乐队锁在 100 BPM 共同拍子上。
   * 整段输出套一层渐入(2s)+末段渐出音量包络；入场淡入折进每音力度（不加 per-band gain
   * 节点，与 CBM-028 一致）；durationSec 后自动停止清理。
   *
   * @param {object} objectData objects.json 里的单个天体对象（需含 .bands、.id）
   * @param {object} selections 形如 {radio:乐器id, ir:乐器id, ...}；某波段缺省/非法
   *                            时用 BAND_DEFAULT 回退，保证 6 轨齐全。
   * @param {number} durationSec 演奏时长（默认 40）
   * @returns {{durationSec, startTime, releaseAt, arc, totalScheduled, tracks, arrangement}}
   *          tracks[band] = {instrumentId, scheduled, role, rank, level, enter, leadLow, poolLen}
   */
  function playEnsemble(objectData, selections, durationSec) {
    if (!objectData || !objectData.bands) throw new Error("playEnsemble: objectData 缺少 bands");
    const sel = selections || {};
    const D = (typeof durationSec === "number" && durationSec > 0) ? durationSec : 40;

    stopAll(); // 互斥：合奏前清掉任何在播的 solo/合奏

    const FADE = 2.0;                          // 渐入秒数
    const FADE_OUT = Math.min(3.0, D * 0.12);  // 渐出秒数
    const t0 = Tone.now() + 0.15;              // 起始（留调度余量）

    // —— 整段音量包络：用 Destination volume（dB），照 playBandSolo 的套路 ——
    const dest = Tone.getDestination();
    dest.volume.cancelScheduledValues(t0);
    dest.volume.setValueAtTime(-40, t0);
    dest.volume.linearRampToValueAtTime(-8, t0 + FADE);          // fade in 到工作电平
    dest.volume.setValueAtTime(-8, t0 + D - FADE_OUT);
    dest.volume.linearRampToValueAtTime(-40, t0 + D);            // fade out

    // —— 按该天体能量排名算编制计划（角色/电平/入场/淡入由排名决定） ——
    const plan = ensemblePlan(objectData, D);
    const key = objectKey(objectData);

    const tracks = {};
    const allIds = [];
    let totalScheduled = 0;

    BANDS.forEach((band) => {
      // 每波段乐器：传入选择 > 该波段 default 回退；非法 id 也回退到 default
      let instId = sel[band];
      if (!isKnownInstrument(instId)) instId = BAND_DEFAULT[band];

      const p = plan[band];
      const E = p.E;
      // 能量≈0 的弱波段（accent 且 E<0.05）：肖像里不加噪，直接跳过
      if (p.skip) {
        tracks[band] = {
          instrumentId: instId, scheduled: 0, role: p.role, rank: p.rank,
          level: +p.level.toFixed(3), enter: +p.enter.toFixed(3), leadLow: p.leadLow, poolLen: 0
        };
        return;
      }

      // 数据驱动音符池（引擎真实音阶/音区，非 demo 五声）——升序
      const pool = buildNotePool(key, BAND_CHAR[band].register, E);
      // 人性化种子（与 playArpTrack 一致风格，仅用于力度微抖）
      const rng = makeRng((objectData.id || objectData.name || "x") + ":" + band + ":" + instId + ":ens");

      try {
        const events = ensembleRoleEvents(band, p, pool, rng, D);
        let scheduled = 0;
        events.forEach((ev) => {
          if (ev.t >= D) return;
          // 入场淡入折进力度：fadeFactor ∈ [0,1]（CBM-028：不加 per-band gain 节点）
          const fadeFactor = p.fadeIn > 0 ? clamp01((ev.t - p.enter) / p.fadeIn) : 1;
          const humanize = 0.94 + 0.12 * rng();
          const finalVel = clamp01(ev.vel * p.level * fadeFactor * humanize);
          const id = Tone.Transport.scheduleOnce(
            (time) => triggerNote(instId, time, ev.midi, ev.dur, finalVel),
            "+" + ((t0 + ev.t) - Tone.now()));
          allIds.push(id);
          scheduled++;
        });
        totalScheduled += scheduled;
        tracks[band] = {
          instrumentId: instId,
          scheduled: scheduled,
          role: p.role,
          rank: p.rank,
          level: +p.level.toFixed(3),
          enter: +p.enter.toFixed(3),
          leadLow: p.leadLow,
          poolLen: pool.length
        };
      } catch (e) {
        // 单轨失败不拖垮整段合奏：跳过该轨，记录空汇总，继续其余波段
        console.error("[audio-engine] playEnsemble track failed:", band, e);
        tracks[band] = {
          instrumentId: instId, scheduled: 0, role: p.role, rank: p.rank,
          level: +p.level.toFixed(3), enter: +p.enter.toFixed(3), leadLow: p.leadLow, poolLen: 0
        };
      }
    });

    // 复用 soloHandle 句柄 → stopAll() 同样能立即停掉合奏
    soloHandle.ids = allIds;
    soloHandle.releaseAt = t0 + D;
    Tone.Transport.start();

    return {
      durationSec: D, startTime: t0, releaseAt: t0 + D, arc: true,
      totalScheduled: totalScheduled, tracks: tracks, arrangement: "portrait"
    };
  }

  /* 立即停止并清空 Transport / 音符 / 渐变包络 */
  function stopAll() {
    try {
      Tone.Transport.stop();
      Tone.Transport.cancel(0);
    } catch (e) { /* Transport 未启动 */ }
    soloHandle.ids = [];
    soloHandle.releaseAt = 0;
    // 释放所有正在发声的音
    Object.values(synthNodes).forEach((nd) => {
      const n = nd && nd.node;
      if (!n) return;
      try { if (typeof n.releaseAll === "function") n.releaseAll(); else if (typeof n.triggerRelease === "function") n.triggerRelease(); } catch (e) { /* ignore */ }
    });
    Object.values(samplers).forEach((s) => { try { if (s && typeof s.releaseAll === "function") s.releaseAll(); } catch (e) { /* ignore */ } });
    // 恢复主音量包络
    try {
      const dest = Tone.getDestination();
      dest.volume.cancelScheduledValues(Tone.now());
      dest.volume.setValueAtTime(-8, Tone.now() + 0.01);
    } catch (e) { /* ignore */ }
  }

  /* ════════════════════════════════════════════════════════════
     三、加载（loadEngine）
     ════════════════════════════════════════════════════════════ */
  async function loadEngine() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      if (Tone.context.state !== "running") {
        // 注：浏览器策略下，loadEngine 通常在用户手势后调用；这里不强制 start，
        // 由页面在用户点击时确保 Tone.start()。
      }
      if (!audioBuilt) {
        buildReverb();
        buildSynths();
        Tone.getDestination().volume.value = -8;
        audioBuilt = true;
      }
      // 加载 5 件采样 —— 防卡死：与超时赛跑，CDN 永不响应时也能在 ~6s 内降级
      const SAMPLE_LOAD_TIMEOUT_MS = 6000; // ponytail: anti-hang 上限，超时即走降级合成路径
      try {
        const loadAndAwait = (async () => {
          samplers = SampleLibrary.load({
            instruments: ["piano", "cello", "violin", "flute", "harp"],
            baseUrl: "design-demos/samples/"
          });
          Object.values(samplers).forEach((s) => s.connect(reverb));
          await Tone.loaded();
        })();
        let timeoutId;
        const timeout = new Promise((_, reject) =>
          timeoutId = setTimeout(() => reject(new Error("SAMPLE_LOAD_TIMEOUT")), SAMPLE_LOAD_TIMEOUT_MS));
        await Promise.race([loadAndAwait, timeout]);
        clearTimeout(timeoutId); // 成功即清掉超时定时器，避免悬挂引用
        samplesReady = true;
        buildSamplerFallbacks(); // 全成功：仅为 strings 建映射
      } catch (e) {
        // 超时与快速失败走同一条降级路径：合成 5 件采样等价物，samplers 清空
        if (e && e.message === "SAMPLE_LOAD_TIMEOUT") {
          console.warn("[audio-engine] sample load timed out (" + SAMPLE_LOAD_TIMEOUT_MS + "ms), degrading to synth fallbacks");
        } else {
          console.warn("[audio-engine] sample load failed, degrading to synth fallbacks:", e && e.message);
        }
        samplesReady = true;
        samplers = {};
        buildSamplerFallbacks();
      }
      buildSamplerFallbacks(); // 幂等兜底
      return {
        samplesReady: samplesReady,
        sampleCount: Object.keys(samplers).length,
        fallbacks: Array.from(fallbackIds)
      };
    })();
    return loadPromise;
  }

  /* ---------- 暴露 ---------- */
  const API = {
    loadEngine,
    playInstrument,
    playBandSolo,
    playArpTrack,
    playEnsemble,
    ensemblePlan,
    stopAll,
    // 只读访问器（调试 / demo 用）
    get isSamplesReady() { return samplesReady; },
    get sampleCount() { return Object.keys(samplers).length; },
    get fallbackIds() { return Array.from(fallbackIds); },
    BANDS,
    BAND_CHAR,
    OBJECT_KEY
  };
  global.CBMAudio = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
