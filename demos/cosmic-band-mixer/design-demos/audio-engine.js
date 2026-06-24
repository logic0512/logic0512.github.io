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

  /* ---------- 混音基础设施（CBM-038 #3，全部 load 时构建一次的持久节点）----------
     信号流向（绝不 per-note / per-render 改动）：
       乐器 → [按频区分到 lowBus / midBus / highBus] → reverb / 直连 → masterBus
       reverb（混响湿声）── 也汇入 masterBus
       masterBus = EQ3 → Compressor(轻胶合) → Limiter(-1dB 顶) → Destination
     主渐变仍用 Destination.volume（dB 包络），masterBus 在它之前，渐变行为不变。
     —— de-mud：低频区高通/低架修掉 sub 堆积；de-harsh：高频区高架削 + 专属限幅压瞬态。
     —— 立体声：低频居中、高频区轻微 L/R 展开（±0.25，mono 兼容）。 */
  let masterBus = null;          // { eq3, comp, limiter } 的入口节点（eq3）
  const MASTER_CEILING_DB = -1;  // limiter 天花板
  let lowBus = null;             // 低频区染色总线（高通 + 低架 trim），入口
  let midBus = null;             // 中频区（透明直通，保主奏 presence）
  let highBus = null;            // 高频区（高架削 + 专属 limiter），入口
  const mixRegion = {};          // id -> "low" | "mid" | "high"（持久路由表，诊断用）
  const mixApplied = { low: [], mid: [], high: [] }; // 每区施加的处理描述（mixInfo 用）

  /* ════════════════════════════════════════════════════════════
     一、24 件乐器音色配方（与 instrument-audition.html 逐件一致）
     ════════════════════════════════════════════════════════════ */

  /* 构建主输出链 + 三个频区染色总线（持久，仅 load 时调用一次）。
     拓扑（绝不 per-note / per-render 改动）：
       乐器 ── 老路径不变：要么 .connect(reverb)（湿声共享混响），要么直连 ——
              但所有这些出口都改接到「频区总线」而非原始 Destination。
       reverb（共享湿声）── 也按其默认归属接到一个频区总线（mid，中性，不二次染色它的多区湿声）。
       lowBus  = Filter(HP 48) → EQ3(lowShelf -2.5) → masterBus
       midBus  = (透明汇聚) → masterBus
       highBus = EQ3(highShelf -3) → Limiter(-2) → masterBus
       masterBus = EQ3 → Compressor(轻胶合) → Limiter(-1dB) → Destination
     —— 关键：每件乐器仍只有【一条】到达 masterBus 的信号路径（不新增并行 dry 拷贝），
        只是这条路径中途插入了它所属频区的染色，故响度排名（CBM-028）不变、不会翻倍。
     —— 立体声：低频/中频居中，高频区乐器在【乐器出口】各插一个持久 Panner（±0.25 交替）。
     主渐变仍用 Destination.volume（dB 包络），masterBus 在它之前 → 渐变行为完全不变。 */
  function buildReverb() {
    // —— 主输出链：EQ3（极轻整形）→ Compressor（轻胶合）→ Limiter（-1dB 顶）→ Destination ——
    const dest = Tone.getDestination();
    const eq3 = new Tone.EQ3({ low: 0, mid: 0, high: -0.5, lowFrequency: 250, highFrequency: 4000 });
    const comp = new Tone.Compressor({ threshold: -18, ratio: 2.5, attack: 0.02, release: 0.18, knee: 8 });
    const limiter = new Tone.Limiter(MASTER_CEILING_DB);
    eq3.connect(comp); comp.connect(limiter); limiter.connect(dest);
    masterBus = { eq3: eq3, comp: comp, limiter: limiter, input: eq3 };

    // —— 频区总线，全部汇入 masterBus 入口（eq3）——
    // 低频区 de-mud：48Hz 高通切掉 sub-rumble + 低架轻削（180Hz,-2.5dB）减低频糊堆积，
    //  radio + ir 叠在一起不再「糊成一团」。低频居中（无 panner，保单声道力量感）。
    const lowHP = new Tone.Filter({ type: "highpass", frequency: 48, rolloff: -12 });
    const lowShelf = new Tone.EQ3({ low: -2.5, mid: 0, high: 0, lowFrequency: 180, highFrequency: 2500 });
    lowHP.connect(lowShelf); lowShelf.connect(masterBus.input);
    lowBus = { input: lowHP, hp: lowHP, shelf: lowShelf };

    // 中频区（optical lead）：透明直通，不做 scoop —— 主奏保持清晰 presence。
    const midGain = new Tone.Gain(1); // 单位增益汇聚点，不改频响（mid 不染色，保 presence）
    midGain.connect(masterBus.input);
    midBus = { input: midGain, gain: midGain };

    // 高频区 de-harsh：8kHz 高架 -3dB 削齿音/嘶嘶 + 专属 Limiter(-2dB) 压瞬态毛刺。
    //  盖革/火花/白噪/亮拨弦堆叠时不再刺耳。pan 在乐器出口做（轻 L/R 展开）。
    const highShelf = new Tone.EQ3({ low: 0, mid: 0, high: -3, lowFrequency: 400, highFrequency: 8000 });
    const highLimiter = new Tone.Limiter(-2);
    highShelf.connect(highLimiter); highLimiter.connect(masterBus.input);
    highBus = { input: highShelf, shelf: highShelf, limiter: highLimiter };

    // 记录每区施加的处理（mixInfo 诊断用）
    mixApplied.low = ["highpass@48Hz(-12dB/oct)", "lowShelf@180Hz(-2.5dB)", "pan=center"];
    mixApplied.mid = ["transparent(unity-gain,no-scoop)", "pan=center"];
    mixApplied.high = ["highShelf@8kHz(-3dB)", "limiter(-2dB)", "pan=spread(±0.25)"];

    // 共享混响：改为【纯湿声送返】（wet=1），干声不再从 reverb 走，而是走频区总线。
    //  这样每件乐器的【干声】只有一条路径（频区总线），既能被频区染色又不会翻倍；
    //  混响仍在链路里——出口接中性的 midBus（不再 .toDestination），保证零节点直连原始 Destination。
    //  reverbSendGain≈0.22 复刻原 wet=0.22 的湿/干比（原：78%干+22%湿声经混响；新：100%干经总线 + 0.22 电平湿声送返）。
    reverb = new Tone.Reverb({ decay: 3, wet: 1 });
    reverb.connect(midBus.input);
  }

  /* 混响送返电平（复刻原 wet=0.22）。乐器若原本 .connect(reverb)，现改为
     干声→频区总线、并以此电平送一份到共享混响（reverbSend）。绝不 per-note。 */
  const REVERB_SEND_LEVEL = 0.22;
  function reverbSend(node) {
    // 持久送返：node → Gain(0.22) → reverb（湿声）。仅 load 时建。
    const g = new Tone.Gain(REVERB_SEND_LEVEL);
    node.connect(g); g.connect(reverb);
  }

  /* —— 持久路由助手（仅在 buildSynths/buildSamplerFallbacks/loadEngine 内调用，绝不 per-note）——
     把一件乐器的【末级干声出口节点】按频区接到对应总线，并按需送一份到共享混响。
       region: "low" | "mid" | "high"
       wantReverb: 该乐器原本是否 .connect(reverb)（true → 额外加 0.22 湿声送返）
     high 区在干声出口再插一个持久 Panner 做轻展开（±0.25 交替分配，确定性、mono 兼容）。 */
  let highPanToggle = 0;
  function routeToRegion(id, node, region, wantReverb) {
    mixRegion[id] = region;
    let dryOut = node;
    if (region === "high") {
      // high：插一个持久 Panner（±0.25 交替分配，mono 兼容）
      const pan = (highPanToggle % 2 === 0) ? 0.25 : -0.25;
      highPanToggle++;
      const panner = new Tone.Panner(pan);
      node.connect(panner);
      dryOut = panner;
    }
    if (region === "low") dryOut.connect(lowBus.input);
    else if (region === "mid") dryOut.connect(midBus.input);
    else dryOut.connect(highBus.input);
    // 湿声送返：从乐器干声节点（panner 之前的 node）送，保持湿声不被 pan/区染色二次处理
    if (wantReverb) reverbSend(node);
  }

  /* 每件合成乐器封装为 { node, play(time) } —— time 为 Tone 时间基准 */
  function buildSynths() {
    /* ===== RADIO 射电 ｜ C1–C2 ｜ 低频持续 + 缓慢脉冲 ｜ LOW 区（de-mud） ===== */
    {
      const s = new Tone.MembraneSynth({ pitchDecay: 0.12, octaves: 5,
        oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 1.8 } });
      routeToRegion("timpani", s, "low", true);   // 原 .connect(reverb)
      synthNodes["timpani"] = { node: s, play: (t) => { s.triggerAttackRelease("C1", "4n", t); s.triggerAttackRelease("G1", "4n", t + 0.85); s.triggerAttackRelease("C1", "4n", t + 1.7); } };
    }
    {
      const s = new Tone.PluckSynth({ attackNoise: 2, dampening: 900, resonance: 0.93 });
      routeToRegion("bass-pluck", s, "low", false); // 原 .toDestination
      synthNodes["bass-pluck"] = { node: s, play: (t) => { ["C2", "G1", "C2", "E2"].forEach((n, i) => s.triggerAttack(n, t + i * 0.55)); } };
    }
    {
      const s = new Tone.MonoSynth({ oscillator: { type: "square" },
        // sustain 由 0 提到 0.4：音符能撑住编制要求的时长（不再 0.14s 后归零→主奏出现 0.5s 真空"断掉"感）；
        // 方波 + 快起仍保留脉冲质感。filterEnvelope 保持 sustain:0 维持"啵"的滤波弹跳。
        envelope: { attack: 0.002, decay: 0.14, sustain: 0.4, release: 0.18 },
        filterEnvelope: { attack: 0.001, decay: 0.1, sustain: 0, baseFrequency: 120, octaves: 2 } });
      routeToRegion("pulsar-pulse", s, "low", false); // 原 .toDestination
      synthNodes["pulsar-pulse"] = { node: s, play: (t) => { for (let i = 0; i < 7; i++) s.triggerAttackRelease("C2", "16n", t + i * 0.42); } };
    }
    {
      const af = new Tone.AutoFilter({ frequency: 0.15, depth: 0.7 }).start();
      routeToRegion("deep-drone", af, "low", true);  // 原 af.connect(reverb)
      const s = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 1.2, decay: 0, sustain: 1, release: 3 } }).connect(af);
      const s2 = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 1.2, decay: 0, sustain: 1, release: 3 } }).connect(af);
      synthNodes["deep-drone"] = { node: s, play: (t) => { s.triggerAttackRelease("C1", 3, t); s2.triggerAttackRelease("G1", 3, t); } };
    }

    /* ===== IR 红外 ｜ C2–C4 ｜ 温暖绵长持续音、legato、无打击音头 ｜ LOW 区（de-mud） ===== */
    {
      const lp = new Tone.Filter(1400, "lowpass");
      routeToRegion("warm-clarinet", lp, "low", true);  // 原 lp.connect(reverb)
      const vib = new Tone.Vibrato({ frequency: 5, depth: 0.08 }).connect(lp);
      const s = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.18, decay: 0.2, sustain: 0.85, release: 0.9 } }).connect(vib);
      synthNodes["warm-clarinet"] = { node: s, play: (t) => { ["C3", "E3", "D3"].forEach((n, i) => s.triggerAttackRelease(n, 0.8, t + i * 0.7)); } };
    }
    {
      const lp = new Tone.Filter(900, "lowpass");
      routeToRegion("warm-pad", lp, "low", true);        // 原 lp.connect(reverb)
      const s = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sawtooth" }, envelope: { attack: 0.8, decay: 0.4, sustain: 0.8, release: 1.5 } }).connect(lp);
      synthNodes["warm-pad"] = { node: s, play: (t) => { s.triggerAttackRelease(["C3", "E3", "G3"], 2, t); } };
    }
    {
      // 两件 AMSynth 共一个汇聚 Gain → 频区/混响（统一末级节点，方便路由）
      const g = new Tone.Gain(1);
      routeToRegion("low-warm-pad", g, "low", true);     // 原 两件各 .connect(reverb)
      const s = new Tone.AMSynth({ harmonicity: 1.5, oscillator: { type: "sine" }, envelope: { attack: 1.0, decay: 0.3, sustain: 0.9, release: 2 } }).connect(g);
      const s2 = new Tone.AMSynth({ harmonicity: 1.5, oscillator: { type: "sine" }, envelope: { attack: 1.0, decay: 0.3, sustain: 0.9, release: 2 } }).connect(g);
      synthNodes["low-warm-pad"] = { node: s, play: (t) => { s.triggerAttackRelease("C2", 2.2, t); s2.triggerAttackRelease("G2", 2.2, t); } };
    }

    /* ===== OPTICAL 可见光 ｜ C3–C5 ｜ 清晰原声旋律、明确音头 ｜ MID 区（透明，保 presence） ===== */
    {
      const ch = new Tone.Chorus(3, 1.5, 0.3).start();
      routeToRegion("bright-lead", ch, "mid", false);   // 原 .toDestination；主奏不染色、居中
      const s = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.4 } }).connect(ch);
      synthNodes["bright-lead"] = { node: s, play: (t) => { ["C4", "D4", "E4", "G4"].forEach((n, i) => s.triggerAttackRelease(n, "8n", t + i * 0.3)); } };
    }

    /* ===== UV 紫外 ｜ C5–C6 ｜ 冷亮流动、连续 legato ｜ HIGH 区（de-harsh + 轻展开） ===== */
    {
      const s = new Tone.PluckSynth({ attackNoise: 1, dampening: 4500, resonance: 0.95 });
      routeToRegion("glass-pluck", s, "high", true);   // 原 .connect(reverb)
      synthNodes["glass-pluck"] = { node: s, play: (t) => { ["G5", "A5", "B5", "D6", "B5", "D6"].forEach((n, i) => s.triggerAttack(n, t + i * 0.16)); } };
    }
    {
      const s = new Tone.FMSynth({ harmonicity: 2, modulationIndex: 7, oscillator: { type: "sine" }, envelope: { attack: 0.005, decay: 0.4, sustain: 0.1, release: 0.6 } });
      routeToRegion("fm-keys", s, "high", false);      // 原 .toDestination
      synthNodes["fm-keys"] = { node: s, play: (t) => { ["C5", "E5", "G5", "E5"].forEach((n, i) => s.triggerAttackRelease(n, "8n", t + i * 0.3)); } };
    }
    {
      const ch = new Tone.Chorus(4, 2.5, 0.5).start();
      routeToRegion("shimmer-pad", ch, "high", true);  // 原 ch.connect(reverb)
      const s = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle" }, envelope: { attack: 0.6, decay: 0.3, sustain: 0.7, release: 2 } }).connect(ch);
      synthNodes["shimmer-pad"] = { node: s, play: (t) => { s.triggerAttackRelease(["G5", "B5", "D6"], 2, t); } };
    }

    /* ===== XRAY X射线 ｜ C4–C6 ｜ 有音高木质/键盘打击 + 急促16分连击 ｜ HIGH 区 ===== */
    {
      const s = new Tone.FMSynth({ harmonicity: 1, modulationIndex: 2.5, oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.22 },
        modulationEnvelope: { attack: 0.001, decay: 0.13, sustain: 0, release: 0.1 } });
      routeToRegion("marimba", s, "high", false);      // 原 .toDestination
      synthNodes["marimba"] = { node: s, play: (t) => { const seq = ["C5", "E5", "G5", "C6", "G5", "E5", "G5", "C5"]; seq.forEach((n, i) => s.triggerAttackRelease(n, "16n", t + i * 0.13)); } };
    }
    {
      const s = new Tone.FMSynth({ harmonicity: 1, modulationIndex: 1.8, oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 },
        modulationEnvelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.05 } });
      routeToRegion("xylophone", s, "high", false);    // 原 .toDestination
      synthNodes["xylophone"] = { node: s, play: (t) => { const seq = ["C6", "C6", "G5", "C6", "E6", "C6", "G5", "C6"]; seq.forEach((n, i) => s.triggerAttackRelease(n, "16n", t + i * 0.12)); } };
    }
    {
      const s = new Tone.Synth({ oscillator: { type: "sawtooth" }, envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.04 } });
      routeToRegion("laser-pulse", s, "high", false);  // 原 .toDestination
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
      const s = new Tone.MembraneSynth({ pitchDecay: 0.012, octaves: 2, oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.1 } });
      routeToRegion("pulse-perc", s, "high", false);   // 原 .toDestination
      synthNodes["pulse-perc"] = { node: s, play: (t) => { const seq = ["C4", "C4", "G4", "C4", "C4", "G4", "C4", "C4"]; seq.forEach((n, i) => s.triggerAttackRelease(n, "16n", t + i * 0.13)); } };
    }

    /* ===== GAMMA 伽马 ｜ 无调/极高瞬态 ｜ 稀疏不规则爆裂、大量留白 ｜ HIGH 区（de-harsh + 轻展开） ===== */
    {
      const hp = new Tone.Filter(7000, "highpass");
      routeToRegion("geiger", hp, "high", true);       // 原 hp.connect(reverb)
      const s = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.01 } }).connect(hp);
      synthNodes["geiger"] = { node: s, play: (t) => { [0, 0.07, 0.55, 1.0, 1.12, 1.7].forEach((d) => s.triggerAttackRelease("16n", t + d)); } };
    }
    {
      const s = new Tone.FMSynth({ harmonicity: 3.01, modulationIndex: 14, oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 1.4, sustain: 0, release: 1.8 },
        modulationEnvelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.4 } });
      routeToRegion("crystal-bell", s, "high", true);  // 原 .connect(reverb)
      synthNodes["crystal-bell"] = { node: s, play: (t) => { s.triggerAttackRelease("C7", "2n", t); s.triggerAttackRelease("G7", "2n", t + 1.6); } };
    }
    {
      const s = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.04 } });
      routeToRegion("granular-blip", s, "high", false); // 原 .toDestination
      synthNodes["granular-blip"] = { node: s, play: (t) => { const notes = ["C7", "A7", "E7", "B6"]; const gaps = [0, 0.4, 1.05, 1.5]; notes.forEach((n, i) => s.triggerAttackRelease(n, "32n", t + gaps[i])); } };
    }
    {
      const hp = new Tone.Filter(6000, "highpass");
      routeToRegion("noise-spark", hp, "high", true);  // 原 hp.connect(reverb)
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
      const s = new Tone.FMSynth({ harmonicity: 1.5, modulationIndex: 4, oscillator: { type: "sawtooth" }, envelope: { attack: 0.15, decay: 0.3, sustain: 0.8, release: 1.0 } });
      routeToRegion("cello", s, "low", true);          // cello=ir → LOW；原 .connect(reverb)
      synthNodes["cello"] = { node: s, play: (t) => { ["C3", "E3", "G3"].forEach((n, i) => s.triggerAttackRelease(n, "4n", t + i * 0.5)); } };
      fallbackIds.add("cello");
    }
    if (!samplers.piano) {
      const s = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle" }, envelope: { attack: 0.005, decay: 0.4, sustain: 0.2, release: 0.8 } });
      routeToRegion("piano", s, "mid", false);         // piano=optical 旋律 → MID；原 .toDestination
      synthNodes["piano"] = { node: s, play: (t) => { ["C4", "E4", "G4", "C5"].forEach((n, i) => s.triggerAttackRelease(n, "8n", t + i * 0.28)); } };
      fallbackIds.add("piano");
    }
    if (!samplers.violin) {
      const s = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sawtooth" }, envelope: { attack: 0.25, decay: 0.3, sustain: 0.8, release: 1.2 } });
      routeToRegion("strings", s, "mid", true);        // strings=optical → MID；原 .connect(reverb)
      synthNodes["strings"] = { node: s, play: (t) => { s.triggerAttackRelease(["C4", "E4", "G4"], 1.8, t); } };
      fallbackIds.add("strings");
    } else {
      // 采样 violin 已在 loadEngine 里按区路由到 midBus（__sampler_violin）；此处仅建别名映射，不重复连接。
      //  把 strings 别名也登记到同一频区，避免 mixInfo 误判为「未路由直连 Destination」。
      synthNodes["strings"] = { node: samplers.violin, play: (t) => { samplers.violin.triggerAttackRelease(["C4", "E4", "G4"], 1.8, t); } };
      mixRegion["strings"] = mixRegion["__sampler_violin"] || "mid";
    }
    if (!samplers.flute) {
      const s = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.1, decay: 0.2, sustain: 0.7, release: 0.6 } });
      routeToRegion("flute", s, "mid", true);          // flute=optical → MID；原 .connect(reverb)
      synthNodes["flute"] = { node: s, play: (t) => { ["C5", "E5", "G5"].forEach((n, i) => s.triggerAttackRelease(n, "4n", t + i * 0.45)); } };
      fallbackIds.add("flute");
    }
    if (!samplers.harp) {
      const s = new Tone.PluckSynth({ attackNoise: 1, dampening: 2600, resonance: 0.96 });
      routeToRegion("harp", s, "high", true);          // harp=uv → HIGH；原 .connect(reverb)
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
    dorian:      [0, 2, 3, 5, 7, 9, 10],
    // 混合利底亚（大调味 + 降七，明亮但带一点张力）0 2 4 5 7 9 10 —— deriveKey 的「亮 + 张力」档
    mixolydian:  [0, 2, 4, 5, 7, 9, 10]
  };
  // 开关（CBM-038 #4）：是否让【表中已有的 5 个已验收天体】也走能量派生 deriveKey。
  //  默认 false = 已知天体严格用 OBJECT_KEY 手工表（音色零回归，与历史完全一致）。
  //  若日后想统一切到派生，把这里改成 true 即可（一行切换）；objectKey 会据此优先派生。
  const USE_DERIVED_FOR_KNOWN = false;

  // 每天体固定的「调」配置（主音 root 用 MIDI pitch-class 0..11，C=0）。
  //  现在它是【显式覆盖表】：表中天体严格用这里的调（已验收 5 件不回归）；
  //  表外天体走 deriveKey（从能量分布派生），不再用旧的字符 hash 兜底。
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

  /* ── deriveKey（CBM-038 #4）：从 6 波段能量分布【派生】调 + 音阶 ──
     返回与 OBJECT_KEY / objectKey 完全一致的形状 { root, scale }，buildNotePool /
     quantizeToScale / ensemblePlan 原样消费，无需任何改动。
     设计目标：派生出的调【永远落在一小撮协和音阶里】，绝不可能听起来无调
     （这正是手工表过去保证的安全性）。完全确定性，无 Math.random / Date。

     三个特征（全部从 bands 能量算）：
       · 频谱质心 centroid = Σ(i·E_i)/ΣE_i ，band index radio=0…gamma=5，∈[0,5]。
         质心高（能量偏高频）→ 更亮 → 偏大调味 + 主音偏高；质心低 → 更暗 → 偏小调味 + 主音偏低。
       · 能量分散度 spread = 以能量为权重的 band index 标准差，∈[0,~2.5]；归一到 [0,1]。
         分散宽 → 用更丰富的 7 音调式（dorian/mixolydian，多一个色彩音）；分散窄 → 干净五声。
       · 高能比 highRatio = (uv+xray+gamma)/total ，∈[0,1]。高 → 更多张力 → 推向小调/降七调式。

     映射（确定性，阈值按真实 SED 的特征范围标定）：
       亮度直接由质心 centroidN 主导（质心低=暗、质心高=亮）；highRatio 只作【张力微调】，
       不从 centroid 里减（两者强相关，相减会自相抵消导致全部落到中间档 → 失去区分度）。
       · 暗  centroidN < 0.34          → 偏小调：spreadN 宽用 dorian（明亮小调），窄用 pentaMinor
       · 中  0.34 ≤ centroidN < 0.46   → 看张力：highRatio≥0.30 偏张力用 dorian/mixolydian，否则 pentaMajor
       · 亮  centroidN ≥ 0.46          → 偏大调：spreadN 宽用 mixolydian（亮+降七色彩），窄用 pentaMajor
       —— 自然 SED 普遍偏宽（spreadN≈0.58..1.0），故「宽」阈值取 0.72，只有真正横跨全谱
          （orion / m87 / 全平）才算宽 → 用 7 音调式；其余用干净五声。
       主音 root：把质心映到固定五度环 ROOT_RING（C G D A E F），index = round(centroidN×(len-1))。
         质心低→环首（C，低/暖），质心高→环尾（E/F，亮），确定性、与亮度方向一致。 */
  const DERIVE_ROOT_RING = [0, 7, 2, 9, 4, 5]; // C, G, D, A, E, F（协和五度环；末端偏亮）
  // 派生只允许这些【协和音阶】，故任何派生调都不会无调（安全护栏）。
  const DERIVE_SCALES = ["pentaMajor", "pentaMinor", "dorian", "mixolydian"];

  function deriveKey(objectData) {
    const bands = (objectData && objectData.bands) || {};
    const E = BANDS.map((b) => {
      const v = bands[b];
      return (typeof v === "number" && isFinite(v) && v > 0) ? v : 0;
    });
    const total = E.reduce((s, v) => s + v, 0);
    // 无能量兜底：退回最稳的硬兜底（与 KEY_FALLBACKS[0] 一致），仍是协和调。
    if (total <= 0) return { root: KEY_FALLBACKS[0].root, scale: KEY_FALLBACKS[0].scale };

    // 频谱质心（0..5）→ 归一 0..1
    let centroid = 0;
    for (let i = 0; i < E.length; i++) centroid += i * E[i];
    centroid /= total;
    const centroidN = clamp01(centroid / (BANDS.length - 1)); // /5

    // 能量分散度：以能量为权重的 band index 标准差 → 归一
    let varSum = 0;
    for (let i = 0; i < E.length; i++) varSum += E[i] * (i - centroid) * (i - centroid);
    const spread = Math.sqrt(varSum / total);                  // ∈[0, ~2.5]
    const spreadN = clamp01(spread / 1.7);                      // 1.7 ≈ 较宽分布的标准差量级

    // 高能比（uv+xray+gamma）/ total —— 张力信号
    const highRatio = clamp01((E[3] + E[4] + E[5]) / total);

    // —— 选音阶（只在协和集里选）—— 亮度由 centroidN 主导，highRatio 作张力微调
    const wide = spreadN >= 0.72;       // 真实 SED 偏宽，0.72 仅圈出横跨全谱者
    const tense = highRatio >= 0.30;    // 高能可观 → 偏暗/降七
    let scale;
    if (centroidN < 0.34) {
      // 暗（能量压在低频）：宽→多利亚（明亮小调，色彩音多）；窄→小调五声（干净忧郁）
      scale = wide ? "dorian" : "pentaMinor";
    } else if (centroidN < 0.46) {
      // 中段：看张力。有张力→宽 mixolydian / 窄 dorian（带降三/降七）；无张力→大调五声（稳）
      scale = tense ? (wide ? "mixolydian" : "dorian") : "pentaMajor";
    } else {
      // 亮（能量偏高频）：宽→混合利底亚（亮+降七色彩）；窄→大调五声（最稳最亮）
      scale = wide ? "mixolydian" : "pentaMajor";
    }
    // 安全护栏：万一落到集合外，钳回大调五声（绝不无调）
    if (DERIVE_SCALES.indexOf(scale) === -1) scale = "pentaMajor";

    // —— 选主音：质心映到五度环 ——
    const ringIdx = Math.round(centroidN * (DERIVE_ROOT_RING.length - 1));
    const root = DERIVE_ROOT_RING[Math.max(0, Math.min(DERIVE_ROOT_RING.length - 1, ringIdx))];

    return { root: root, scale: scale };
  }

  function objectKey(objectData) {
    const id = objectData && objectData.id;
    // 已知天体：默认走显式覆盖表（手工已验收，零回归）；
    //  仅当 USE_DERIVED_FOR_KNOWN=true 时，已知天体也改用派生。
    if (!USE_DERIVED_FOR_KNOWN && id && OBJECT_KEY[id]) return OBJECT_KEY[id];
    // 表外天体（或全局切到派生时）：从能量分布派生 —— 取代旧的字符 hash 兜底。
    const derived = deriveKey(objectData);
    if (derived && typeof derived.root === "number" && SCALES[derived.scale]) return derived;
    // 终极硬兜底：派生若意外失败，回到最稳的协和调（绝不返回空）。
    return KEY_FALLBACKS[0];
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

  /* ════════════════════════════════════════════════════════════
     二·核 ｜统一手势：波段性格手势(grain) → 唯一发声真源 bandGestureEvents
       （Step 2 / CBM-037）。把原 playArpTrack 的 6 波段分支抽成 *纯函数*
       bandCharacterFree —— 返回事件 [{t,midi,dur,vel,burst}]（不再自调度），
       供 solo（满密度试听）与 ensemble（角色编制）共用同一套内核，治「试听≠生成」。
     ════════════════════════════════════════════════════════════ */

  /* —— 波段「性格手势」grain（纯函数，从原 playArpTrack 分支逐字搬出）——
     返回该波段在 [startRel, endRel) 区间的自由音符流，t 为相对 startRel 的秒数。
     gamma 事件带 burst:true → 调度方走 triggerBurst（保「爆点」触发路径不变）。
     这是各波段身份的唯一来源（射电脉冲/红外长垫/可见光主旋律/紫外碎片/X射线急簇/伽马稀爆）。
     @returns {Array<{t:number,midi:number,dur:number,vel:number,burst?:boolean}>} */
  function bandCharacterFree(band, E, startRel, endRel, pool, rng) {
    const char = BAND_CHAR[band];
    const Ec = Math.sqrt(clamp01(E));
    const gapScale = 1.9 - 1.3 * Ec;          // ∈ [~0.6, ~1.9]
    const baseGap = char.baseGap * gapScale;
    function velFor(idx) {
      const human = 0.94 + 0.12 * rng();      // ±~6% 人性化抖动
      return clamp01(char.baseVel * (0.5 + 0.6 * Ec) * human);
    }
    const out = [];
    const endT = endRel;
    let t = startRel, step = 0, guard = 0;

    if (band === "ir") {
      /* 红外：热层长音。少跑音阶，多做缓慢重叠的持续音，像温度场在呼吸。 */
      const motif = [0, 2, 1, 3, 1, 4];
      while (t < endT && guard < 3000) {
        guard++;
        const poolIdx = motif[step % motif.length] % pool.length;
        const midi = poolAt(pool, poolIdx);
        const vel = velFor(step) * 0.92;
        const durSec = Math.min(4.2, Math.max(2.4, baseGap * (2.0 + 0.7 * Ec)));
        out.push({ t: t, midi: midi, dur: durSec, vel: vel });
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
        out.push({ t: t, midi: midi, dur: Math.max(0.35, char.dur), vel: vel });
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
        out.push({ t: t, midi: midi, dur: char.dur, vel: vel });
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
          out.push({ t: tt, midi: midi, dur: Math.max(0.09, char.dur * 0.72), vel: vel });
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
          out.push({ t: tt, midi: midi, dur: Math.max(0.055, char.dur * 0.72), vel: vel });
        }
        t += clusterGap * (0.9 + 0.22 * rng());
        step += notesInCluster;
      }
    } else if (char.trigger === "burst") {
      /* 伽马：稀疏高能爆点。大量留白，偶发闪烁，不形成稳定旋律。burst:true → triggerBurst */
      const gapPat = [1.0, 0.55, 2.1, 0.9, 1.65, 2.6];
      const pattern = arpPattern(pool.length);
      while (t < endT && guard < 3000) {
        guard++;
        const poolIdx = pattern[step % pattern.length];
        const midi = pool[poolIdx];
        const vel = clamp01(char.baseVel * (0.5 + 0.6 * Ec) * 0.92 + 0.08 * char.baseVel);
        out.push({ t: t, midi: midi, dur: char.dur, vel: vel, burst: true });
        t += Math.max(0.35, baseGap * gapPat[step % gapPat.length]);
        step++;
      }
    } else {
      /* 兜底：旧式顺序循环（未来新增/未知波段） */
      const pattern = arpPattern(pool.length);
      while (t < endT && guard < 8000) {
        guard++;
        const poolIdx = pattern[step % pattern.length];
        const midi = pool[poolIdx];
        const vel = velFor(step);
        const durSec = (char.dur === "sustained") ? (1.6 + 1.0 * Ec) : char.dur;
        out.push({ t: t, midi: midi, dur: durSec, vel: vel });
        t += Math.max(0.08, baseGap);
        step++;
      }
    }
    return out;
  }

  /* —— 主奏招牌 hook：用本波段自己的音符池铺一段固定循环、卡死 1/8 网格的律动 ——
     groove（让人跟着打拍子的劲）只给能量最强的波段（lead）。它是全曲【密度最高 + 最驱动】
     的声部 → 「最强的波段同时最有节奏存在感」，机制上保证 groove 落在主角而非贝斯/镲。
     （移植 demo leadHookEvents；音高来自引擎 buildNotePool，非 demo 固定五声。） */
  function leadHookEvents(band, p, pool, D) {
    const total = (typeof D === "number" && D > 0) ? D : 40;
    const pick = (i) => pool[((i % pool.length) + pool.length) % pool.length];
    const start = p.enter, end = total - 0.05, out = [];
    const mask = p.leadLow ? [1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1]   // 低音驱动：8/16 命中
      : [1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0];                       // 旋律 hook：10/16 命中，最密最驱动
    const motif = p.leadLow ? [0, 0, 2, 0, 1, 0, 2, 3] : [0, 2, 4, 2, 5, 3, 4, 1];
    let slot = 0, mi = 0;
    for (let t = start; t < end; t += ENS_EIGHTH) {
      const s = ((slot % 16) + 16) % 16;
      if (mask[s]) {
        out.push({ t: +t.toFixed(4), midi: pick(motif[mi % motif.length]),
          dur: p.leadLow ? 0.34 : 0.3, vel: clamp01((s === 0 || s === 8) ? 0.92 : (s % 2 === 0 ? 0.8 : 0.66)) });
        mi++;
      }
      slot++;
    }
    return out;
  }

  /* 宽谱「强副声部」阈值与活跃度地板（FIX #1）——【声明提前】到首个调用点（rawUnifiedEvents）之前，
     不依赖 const 在模块尾部的运行期初始化（呼应 HIGH-1：避免「靠声明位置侥幸」的脆弱性）。
     · WIDE_SPECTRUM_E：E≥此值的非主奏波段算「真强」，要保证一定密度（几乎没有寂静区的天体如 M87
       才能整谱都忙起来，而不是「主奏满、其余全瘫」）。弱于此值的波段照旧极稀疏，地板不触及它们。
     · FLOOR_FRAC：强副声部音符数下限 = round(leadNotes * FLOOR_FRAC)。地板只抬【密度】不抬【响度】，
       且永不破坏密度单调（每名 target 仍受上一名 target 钳制），也永不超过该波段真实生成数。 */
  const WIDE_SPECTRUM_E = 0.35;
  const FLOOR_FRAC = 0.28;
  /* 弱-hat 能量缩放天花板系数（CBM-038 #2 Rule 3）：弱 hat（E<WIDE_SPECTRUM_E）密度上限 =
     round(leadNotes × HAT_WEAK_CEIL_FRAC × E/WIDE_SPECTRUM_E)。E 恰好到阈值时上限 = 12% lead，
     越弱越趋近 0 → 弱 hat 是稀疏轻点击而非被强波段密度撑满的忙碌 hi-hat。仍受 running-min 钳制（单调不破）。 */
  const HAT_WEAK_CEIL_FRAC = 0.12;

  /* —— 把事件均匀抽稀到 ≤ cap 个（保留首尾分布，不集中开头）—— */
  function thinTo(evts, cap) {
    if (cap >= evts.length) return evts.slice();
    if (cap <= 0) return [];
    const out = [], stride = evts.length / cap;
    for (let i = 0; i < cap; i++) out.push(evts[Math.min(evts.length - 1, Math.floor(i * stride))]);
    return out;
  }

  /* 把绝对时间 t 吸附到以 origin 为起点、步长 g 的网格（共享 1/8 网格用）。
     HIGH-1：声明提前到首个调用点（rawUnifiedEvents）之前，避免依赖函数提升的脆弱性。 */
  function snapTo(t, g, origin) {
    if (!g) return t;                          // 步长 0/NaN 守卫：异常时原样返回，绝不产出 NaN onset
    const o = (origin == null) ? 0 : origin;   // 只把 null/undefined 当默认，不吞 0/NaN
    return o + Math.round((t - o) / g) * g;
  }

  /* —— 统一手势【原始音符流】（已落 1/8 网格、未套电平/密度预算）——
     每个角色的「内核节奏」都在这里产生；densityTargets 与 bandGestureEvents 共用同一套事件，
     保证「算密度」和「真播放」一致（诊断 == 听感）。
     · lead   = 招牌 hook（最密、最驱动，groove 来源）
     · bass/hat = ensembleRoleEvents 拍锁定固定声部（铺底）
     · harmony = 性格手势抽稀 1/4
     · accent  = 性格手势每 1~2 小节一个点
     · solo    = 性格手势全留（满密度试听） */
  function rawUnifiedEvents(band, role, E, pool, plan, D) {
    // HIGH-2 守卫：本函数绝不能调用 bandGestureEvents —— densityTargets 经它进来，回调即成无限互递归。
    const total = (typeof D === "number" && D > 0) ? D : 40;
    const p = (plan && plan[band]) ? plan[band] : null;
    const isSolo = role === "solo";
    const enter = isSolo ? 0 : (p ? p.enter : 0);
    const end = total - 0.05;
    if (!isSolo && role === "lead" && p) return leadHookEvents(band, p, pool, total);
    if (!isSolo && (role === "bass" || role === "hat") && p) {
      const pp = {}; for (const k in p) pp[k] = p[k]; pp.role = role;
      return ensembleRoleEvents(band, pp, pool, null, total);
    }
    // 性格手势 grain → 吸附 1/8 网格、同格去重（burst 标记随事件保留）
    const rng = makeRng(band + ":grain:" + Math.round(clamp01(E) * 1000));
    const grain = bandCharacterFree(band, E, enter, end, pool, rng);
    const seen = new Set(), aligned = [];
    grain.forEach((e) => {
      const q = snapTo(e.t, ENS_EIGHTH, 0);
      const key = q.toFixed(3);
      if (q < enter - 1e-9 || q >= end) return;
      if (seen.has(key)) return;
      seen.add(key);
      aligned.push({ t: +q.toFixed(4), midi: e.midi, dur: e.dur, vel: e.vel, burst: !!e.burst });
    });
    aligned.sort((a, b) => a.t - b.t);
    if (isSolo) return aligned;                                   // solo：全留
    const Ec = clamp01(E);
    if (role === "harmony") {
      // 【能量依赖】harmony 抽稀：能量越强保留得越密（keep-every-N，N 随 E 单调下降 → 梯度单调）。
      //  E≥0.6 → 每 1 留 1（最强副声部跑满性格手势），E≥0.45 → 每 2，E≥0.35 → 每 2，
      //  E≥0.25 → 每 3，否则每 4（弱副声部保持稀疏）。强波段因此能越过活跃度地板。
      const everyN = Ec >= 0.6 ? 1 : Ec >= 0.35 ? 2 : Ec >= 0.25 ? 3 : 4;
      return aligned.filter((e, i) => i % everyN === 0);
    }
    // accent：分两档。
    //  · 强 accent（E≥WIDE_SPECTRUM_E）：宽谱天体里它仍是「真声部」，用 keep-every-N 抽稀性格手势
    //    （N 随 E 单调），生成量足够越过活跃度地板，再交给 densityTargets 排成下降梯度。
    //  · 弱 accent（E<WIDE_SPECTRUM_E）：保持原「每 1~2 小节一个落点」的极稀疏点缀，不被地板抬起。
    if (Ec >= WIDE_SPECTRUM_E) {
      // 强 accent 跑满性格手势（every-1）：宽谱天体里这些波段入场偏晚、窗口短，需最大化生成量
      //  才能越过活跃度地板；最终密度交给 densityTargets 钳成下降梯度（不会反超更强波段）。
      return aligned.slice();
    }
    const accentEvery = Ec >= 0.25 ? 1 : 2;                 // 弱波段：每小节 / 每 2 小节首个落点
    const barIdx = (t) => Math.floor((t + 1e-6) / ENS_BAR);
    const byBar = new Map();
    aligned.forEach((e) => { const b = barIdx(e.t); if (b % accentEvery === 0 && !byBar.has(b)) byBar.set(b, e); });
    return Array.from(byBar.values()).map((e) => ({ t: e.t, midi: e.midi, dur: e.dur, vel: e.vel, burst: e.burst }));
  }

  /* —— 密度预算表：保证音符数随能量排名【严格非增】（running-min）+ 强副声部活跃度地板 ——
     按 rank 升序（能量降序）走一遍：
       base(b)=min(rawCount(b), 上一名的 target)；
       若 rank>0 且 E≥WIDE_SPECTRUM_E：target=clamp( max(base, floor), 0, 上一名 target )——
         地板把强副声部抬上来，但绝不超过更强波段（保住单调）。
     主奏(rank0)不设上限 → 必是最密（leadDensest）。只依赖 plan（确定性）→ 播放/诊断一致。 */
  function densityTargets(plan, D) {
    const key = (plan && plan.__key) || KEY_FALLBACKS[0];
    const bands = BANDS.filter((b) => plan[b] && !plan[b].skip).sort((a, b) => plan[a].rank - plan[b].rank);
    const raw = {}, target = {};
    bands.forEach((b) => {
      const p = plan[b];
      const pool = buildNotePool(key, BAND_CHAR[b].register, p.E || 0);
      raw[b] = rawUnifiedEvents(b, p.role, p.E || 0, pool, plan, D).length;
    });
    const leadBand = bands.find((b) => plan[b].rank === 0);
    const leadNotes = leadBand != null ? raw[leadBand] : 0;
    const floorVal = Math.round(leadNotes * FLOOR_FRAC);
    let runningMin = Infinity;          // 上一名（更强波段）的【可达 target】，作单调上限
    bands.forEach((b) => {
      const p = plan[b];
      if (p.rank === 0) { target[b] = raw[b]; runningMin = raw[b]; return; }
      // 基线：受上一名钳制。强副声部再被地板抬起——但地板永不超过该波段真实生成数 raw[b]
      //  （thinTo 只减不增，over-promise 会让实际音符数 < 地板，既破坏单调又使 wideSpectrumOK 假阳）。
      let t = Math.min(raw[b], runningMin);
      if ((p.E || 0) >= WIDE_SPECTRUM_E) {
        const achievableFloor = Math.min(floorVal, raw[b]);   // 地板不能超过生成上限
        t = Math.min(Math.max(t, achievableFloor), runningMin);
      }
      // Rule 3 · 弱-hat 能量缩放天花板（register/role 无关的同一症状：弱波段被拍锁定填充角色拉满）：
      //  音乐角色为 hat 且能量真弱（E<WIDE_SPECTRUM_E）的波段，不许吃满 running-min（更强波段的密度），
      //  改用【随能量缩放】的稀疏上限 → 弱 hat 只是轻、稀的点击，不是被强波段密度撑起来的忙碌 hi-hat。
      //  修「仙女座 xray E=0.24 当 hat 打 63 下」。贝斯（groove 引擎，强低音）一律不降密——只针对弱 hat。
      //  公式：cap = round(leadNotes × HAT_WEAK_CEIL_FRAC × (E/WIDE_SPECTRUM_E))，再夹进 [0, running-min] 与生成上限。
      //   能量越接近阈值越接近 HAT_WEAK_CEIL_FRAC×lead，越弱越趋近 0；仍受上一名 running-min 钳制 → 单调不破。
      if (p.role === "hat" && (p.E || 0) < WIDE_SPECTRUM_E) {
        const eScaled = Math.round(leadNotes * HAT_WEAK_CEIL_FRAC * (clamp01(p.E || 0) / WIDE_SPECTRUM_E));
        t = Math.min(t, eScaled);
      }
      target[b] = t; runningMin = t;    // runningMin 跟可达 target → 下一名不会越过本名实际密度
    });
    return target;
  }

  /* densityTargets 记忆化（HIGH-3）：plan 每次渲染都是新对象、D 固定 → 同一渲染内只算一次。
     原先每个波段都重算全表（6×6 次 rawUnifiedEvents），现降为 1 次。 */
  function densityTargetsFor(plan, D) {
    if (!plan.__caps || plan.__capsD !== D) { plan.__caps = densityTargets(plan, D); plan.__capsD = D; }
    return plan.__caps;
  }

  /**
   * 统一手势 · 唯一发声真源（Step 2 / CBM-037）。
   * 波段「性格手势」当音符内核，角色只管密度/入场/音量。solo=满密度试听，lead=招牌 hook，
   * bass/hat=从属铺底（密度被 densityTargets 压到不超过任何更强波段），harmony/accent=稀疏点缀。
   * 节奏密度 + 响度峰值都随能量单调 → 弱波段绝不喧宾夺主。
   * @returns {Array<{t,midi,dur,vel,burst?}>} t 相对 0；vel 已折进 level + 入场淡入。
   */
  function bandGestureEvents(band, role, E, pool, plan, D) {
    const total = (typeof D === "number" && D > 0) ? D : 40;
    const p = (plan && plan[band]) ? plan[band] : null;
    const isSolo = role === "solo";
    const enter = isSolo ? 0 : (p ? p.enter : 0);
    const level = isSolo ? 1 : (p ? p.level : clamp01(0.2 + 0.5 * clamp01(E)));
    const fadeIn = isSolo ? 0 : (p && p.fadeIn != null ? p.fadeIn : 1.4);
    const end = total - 0.05;

    let evts = rawUnifiedEvents(band, role, E, pool, plan, total);
    // 时间窗口收口在【力度成形之前】：保证峰值归一化是对真正会播放的事件集做的，
    //  这样 max 事件一定能落到 level（否则窗外的最响音被裁掉后整轨峰值 < level → 破坏响度单调）。
    evts = evts.filter((e) => e.t >= enter - 1e-9 && e.t < end);
    // 密度预算：非 solo 时把音符数压到「随能量单调」目标（lead 不被压 → 最密）
    if (!isSolo && p) {
      const cap = densityTargetsFor(plan, total)[band];
      if (cap != null) evts = thinTo(evts, cap);
    }
    if (!evts.length) return [];

    // 力度成形：峰值始终落在 level（响度随能量单调），靠加宽弱→强落差体现从属/驱动。
    //  · bass/hat 落差最大（0.5..1.0×level）→ 铺底更轻；峰值仍 == level。
    //  · 其余      落差中等（0.62..1.0×level），峰值 == level。
    const floorRel = (role === "bass" || role === "hat") ? 0.5 : 0.62;
    const peak = evts.reduce((m, e) => Math.max(m, e.vel), 0) || 1;
    return evts.map((e) => {
      const rel = floorRel + (1 - floorRel) * (e.vel / peak);
      const fadeK = (fadeIn > 0 && e.t < enter + fadeIn) ? clamp01((e.t - enter) / fadeIn) : 1;
      return { t: e.t, midi: e.midi, dur: e.dur, vel: clamp01(level * rel * fadeK), burst: e.burst };
    });
  }

  /**
   * 单波段琶音轨道（薄适配器 · CBM-037）。现在只是 bandGestureEvents(band,'solo',…) 的
   * 调度外壳：把统一手势 solo 事件挂到 Tone.Transport（burst 走 triggerBurst），不含渐变/不启 Transport。
   * **返回契约 {scheduled,ids,pattern,pool,trace,kind} 必须保留**（app.html 状态 UI / 测试读取）。
   *
   * @param {object} objectData 单个天体对象（需含 .bands、.id）
   * @param {string} band       6 波段之一
   * @param {string} instrumentId 该波段的乐器 id
   * @param {number} startTime  Tone 绝对起始时间（秒，如 Tone.now()+0.15）
   * @param {number} durationSec 该轨演奏时长
   * @returns {{scheduled:number, ids:number[], pattern:number[], pool:number[],
   *            trace:Array, kind:string}}
   */
  function playArpTrack(objectData, band, instrumentId, startTime, durationSec, gainScale) {
    if (!objectData || !objectData.bands) throw new Error("playArpTrack: objectData 缺少 bands");
    if (BANDS.indexOf(band) === -1) throw new Error("playArpTrack: 非法波段 " + band);

    const gs = (typeof gainScale === "number" && gainScale > 0) ? gainScale : 1;
    const E = clamp01(typeof objectData.bands[band] === "number" ? objectData.bands[band] : 0);
    const char = BAND_CHAR[band];
    const key = objectKey(objectData);
    const pool = buildNotePool(key, char.register, E);
    const pattern = arpPattern(pool.length);   // 契约字段：遍历索引序列（验证用）

    // 统一手势 · solo 版（满密度、enter=0、满电平）——这就是试听播的内容
    const events = bandGestureEvents(band, "solo", E, pool, null, durationSec);

    const ids = [];
    const trace = [];
    let scheduled = 0;
    events.forEach((ev) => {
      const tt = startTime + ev.t;
      const vel = clamp01(ev.vel * gs);
      const idLocal = ev.burst
        ? Tone.Transport.scheduleOnce((time) => triggerBurst(instrumentId, time, vel, ev.midi), "+" + (tt - Tone.now()))
        : Tone.Transport.scheduleOnce((time) => triggerNote(instrumentId, time, ev.midi, ev.dur, vel), "+" + (tt - Tone.now()));
      ids.push(idLocal);
      if (trace.length < 24) trace.push({ time: +ev.t.toFixed(3), idx: -1, midi: ev.midi, vel: +vel.toFixed(3) });
      scheduled++;
    });

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

  /* 数据策展角色（objects.json 的 bandDetail[band].role ∈ {lead,support,accent,trace}）
     是【科学/策展】定性，与音乐角色（lead/bass/hat/harmony/accent/point）不同维度。
     CBM-038 #2：把它当【约束】拧进编制——但能量诚实（密度+响度随能量单调、最强能量=主奏=最突出）
     是不可逾越的硬护栏，数据角色只能在不违反它的前提下做软先验/降权/路由。
     · trace  → 路由到最稀疏的 accent（覆盖任何 hat/harmony 候选），最少音、悄声（弱波段才生效）
     · support→ 软偏向 harmony（旋律支撑）
     · accent → 软偏向 accent 音乐角色
     · lead   → 仅在能量近乎并列时作主奏挑选的 tie-breaker，绝不把低能数据-lead 抬成突出主奏 */
  function dataRoleOf(objectData, band) {
    const d = objectData && objectData.bandDetail && objectData.bandDetail[band];
    return (d && typeof d.role === "string") ? d.role : null;
  }

  /* 「天体肖像」编制计划（移植 demo portraitPlan）。
     返回 {[band]:{rank,role,level,enter,fadeIn,exit,leadLow,skip,E,dataRole}}。
     @param {object} objectData 单个天体对象（需含 .bands，可选 .bandDetail）
     @param {number} D 合奏总时长（决定 accent 入场上限，默认 40） */
  function ensemblePlan(objectData, D) {
    const total = (typeof D === "number" && D > 0) ? D : 40;
    const Eof = (b) => clamp01((objectData && objectData.bands && objectData.bands[b]) || 0);
    const dRole = (b) => dataRoleOf(objectData, b);
    const ranked = BANDS.map((b) => ({ b, E: Eof(b) })).sort((a, c) => c.E - a.E);
    // Rule 5 · 数据-lead 仅作 tie-breaker：能量第1、第2近乎并列（差 ≤ NEAR_EQ_E）时，
    //  若第2名的 dataRole==='lead' 而第1名不是，让数据-lead 上位作主奏。能量明显领先时一律不动
    //  （绝不把低能数据-lead 抬成突出主奏 → 能量诚实硬护栏不破）。
    const NEAR_EQ_E = 0.04;
    let lead = ranked[0].b;
    if (ranked.length >= 2 && (ranked[0].E - ranked[1].E) <= NEAR_EQ_E
        && dRole(ranked[1].b) === "lead" && dRole(ranked[0].b) !== "lead") {
      lead = ranked[1].b;
    }
    let strong = ranked.filter((r) => r.E >= 0.18).map((r) => r.b);
    if (strong.length < 3) strong = ranked.slice(0, 3).map((r) => r.b);   // 至少前三名进核心
    const rankOf = {}; ranked.forEach((r, i) => { rankOf[r.b] = i; });
    const bass = strong.slice().sort((a, b) => BAND_CHAR[a].register[0] - BAND_CHAR[b].register[0])[0]; // 音区最低 = 贝斯
    // 镲只给【高音区(高边界≥78) 且 非能量前三(rank≥3) 且 非主奏/贝斯】的较弱高频波段，取能量最高者；否则无镲。
    const hatCands = BANDS.filter((b) =>
      BAND_CHAR[b].register[1] >= 78 && rankOf[b] >= 3 && b !== lead && b !== bass && Eof(b) >= 0.05
    ).sort((a, b) => Eof(b) - Eof(a));
    const hat = hatCands.length ? hatCands[0] : null;
    // harmony：能量最高的 ≤2 个剩余强波段（旋律对位）。
    //  Rule 4 软先验：能量【相等】时，dataRole==='support' 优先入 harmony（旋律支撑）。
    //  排序主键仍是能量（c-a 降序），数据角色只在能量并列时作次键 → 永不越过能量逻辑。
    const supportPri = (b) => (dRole(b) === "support" ? 0 : 1);
    const used = new Set([lead, bass, hat].filter(Boolean));
    const harmony = strong.filter((b) => !used.has(b))
      .sort((a, b) => (Eof(b) - Eof(a)) || (supportPri(a) - supportPri(b)))
      .slice(0, 2);
    harmony.forEach((b) => used.add(b));
    // 电平统一走【能量单调映射】→ 越强越响，低能波段绝不比高能波段更突出
    const levelForE = (E) => clamp01(0.2 + 0.5 * E);
    const ENTER = { lead: 0, bass: ENS_BAR, hat: ENS_BAR, harmony: ENS_BAR * 2 };
    const FADE = { lead: 0.8, bass: 0.35, hat: 0.35, harmony: 1.4 };
    const plan = {};
    ranked.forEach((r, i) => {
      let role = r.b === lead ? "lead" : r.b === bass ? "bass" : r.b === hat ? "hat"
        : harmony.indexOf(r.b) !== -1 ? "harmony" : "accent";
      const dr = dRole(r.b);
      // Rule 2 · trace 路由（仅作用于真弱波段 E<WIDE_SPECTRUM_E）：
      //  数据角色为 trace 的弱波段，覆盖任何 hat/harmony 音乐角色，强制走最稀疏的 accent
      //  （sparse point）→ 最少音、悄声、绝不打成忙碌的拍锁定 hat。修「太阳 xray 当 hat 打 25 下」。
      //  护栏：trace+强(E≥阈值) 极少且矛盾，此时让能量地板赢（保持可听），不在此降级。
      //  主奏/贝斯（groove 引擎）不被 trace 降级——它们由能量结构选出，是能量诚实的体现。
      if (dr === "trace" && r.E < WIDE_SPECTRUM_E && role !== "lead" && role !== "bass") {
        role = "accent";
      }
      const level = role === "lead" ? Math.max(0.8, levelForE(r.E)) : levelForE(r.E);
      const enter = (role in ENTER) ? ENTER[role] : Math.min(ENS_BAR * (2 + (i - 2)), total - 7);
      const fade = (FADE[role] != null) ? FADE[role] : 1.4;
      plan[r.b] = {
        rank: i, role: role, level: level, enter: enter, fadeIn: fade, exit: total, E: r.E,
        dataRole: dr,                                     // 策展角色（诊断 + 弱-hat 降密判定用）
        leadLow: (r.b === lead && lead === bass),         // 主奏恰好也是最低波段 → 低音驱动型 hook
        skip: (role === "accent" && r.E < 0.05)
      };
    });
    // 把该天体的「调」挂在 plan 上（非枚举 → 不污染 6 波段返回形状），供 densityTargets
    // 用真实音阶重建音符池，确保「算密度」与 playEnsemble 真播放的池一致。
    Object.defineProperty(plan, "__key", { value: objectKey(objectData), enumerable: false });
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
    if (p.role === "hat") {                  // 较弱高频的轻纹理；能量越强走得越密（≥.35→1/8，更弱→1/4）。无 1/16 → 永不抢耳
      const step = p.E >= 0.35 ? ENS_EIGHTH : ENS_BEAT;
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

      try {
        // 唯一发声真源：bandGestureEvents 已折进 level + 入场淡入（CBM-028：不加 per-band gain 节点）
        // → vel 峰值落在 p.level（响度随能量单调），密度被 densityTargets 压到随能量单调。
        const events = bandGestureEvents(band, p.role, E, pool, plan, D);
        let scheduled = 0;
        events.forEach((ev) => {
          if (ev.t >= D) return;
          const finalVel = clamp01(ev.vel);
          const id = ev.burst
            ? Tone.Transport.scheduleOnce(
                (time) => triggerBurst(instId, time, finalVel, ev.midi),
                "+" + ((t0 + ev.t) - Tone.now()))
            : Tone.Transport.scheduleOnce(
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
          // 采样器按【乐器频区】路由（cello=low, piano/violin/flute=mid, harp=high），
          //  并各送一份 0.22 湿声到共享混响（复刻原 .connect(reverb) 的湿声）。绝不直连 Destination。
          const SAMPLER_REGION = { cello: "low", piano: "mid", violin: "mid", flute: "mid", harp: "high" };
          Object.keys(samplers).forEach((name) => {
            const s = samplers[name];
            if (!s) return;
            routeToRegion("__sampler_" + name, s, SAMPLER_REGION[name] || "mid", true);
          });
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
    OBJECT_KEY,
    /* ── 测试钩子（headless 验证用，不依赖 Tone 调度）── CBM-037
       让外部验证器断言：solo/ensemble 同源、落网格、响度&密度随能量单调、lead 最密、署名 bar1。 */
    __ENGINE: {
      bandGestureEvents, bandCharacterFree, rawUnifiedEvents,
      leadHookEvents, ensembleRoleEvents, densityTargets, thinTo,
      buildNotePool, objectKey, deriveKey, ensemblePlan,
      ENS_BEAT, ENS_BAR, ENS_EIGHTH, ENS_BPM,
      /* ── 调派生诊断（CBM-038 #4）：让外部验证器对照「手工 vs 派生 vs 实际所用」──
         manual : OBJECT_KEY[id]（手工覆盖表，无则 null）
         derived: deriveKey(objectData)（能量派生，永远是协和调）
         used   : objectKey(objectData)（引擎真正用的调）
         consonant: derived.scale 是否在协和集 DERIVE_SCALES 内（应恒 true）
         flag   : USE_DERIVED_FOR_KNOWN 当前值（一行切换位） */
      keyDiag(objectData) {
        const id = objectData && objectData.id;
        const derived = deriveKey(objectData);
        return {
          id: id || null,
          manual: (id && OBJECT_KEY[id]) ? OBJECT_KEY[id] : null,
          derived: derived,
          used: objectKey(objectData),
          consonant: DERIVE_SCALES.indexOf(derived.scale) !== -1,
          useDerivedForKnown: USE_DERIVED_FOR_KNOWN
        };
      },
      /* ── 混音图诊断（CBM-038 #3）：让外部浏览器验证器断言主链/路由/分区处理 ──
         masterChain: 主输出链节点类型（顺序，到 Destination 为止）
         ceilingDb  : limiter 天花板（dB）
         directToDestination: 仍直连【原始】Destination 的可发声节点数（应 = 0，全部经 masterBus）
         regions    : { low/mid/high: { instruments:[...id], processing:[...] } } */
      mixInfo() {
        // 已构建的可发声节点 id 全集（合成节点 + 已建的采样器）
        const synthIds = Object.keys(synthNodes);
        const samplerIds = Object.keys(samplers).map((n) => "__sampler_" + n);
        const allSounding = synthIds.concat(samplerIds);
        // 经 routeToRegion 的节点都进了频区总线 → 不直连原始 Destination。
        //  未登记进 mixRegion 的 = 漏路由（直连 Destination 的潜在风险）。
        const direct = allSounding.filter((id) => !mixRegion[id]);
        const byRegion = { low: [], mid: [], high: [] };
        Object.keys(mixRegion).forEach((id) => {
          const r = mixRegion[id];
          if (byRegion[r]) byRegion[r].push(id);
        });
        const masterChain = masterBus
          ? ["EQ3", "Compressor", "Limiter", "Destination"]
          : [];
        return {
          masterChain: masterChain,
          ceilingDb: MASTER_CEILING_DB,
          reverbInPath: !!reverb,
          directToDestination: direct.length,
          directToDestinationIds: direct,
          regions: {
            low:  { instruments: byRegion.low,  processing: mixApplied.low.slice() },
            mid:  { instruments: byRegion.mid,  processing: mixApplied.mid.slice() },
            high: { instruments: byRegion.high, processing: mixApplied.high.slice() }
          }
        };
      },
      /* 纯函数派生整段合奏事件（不碰 Tone）→ 验证 ensemble 不依赖运行时 */
      ensembleEventsFor(objectData, D) {
        const total = (typeof D === "number" && D > 0) ? D : 40;
        const plan = ensemblePlan(objectData, total);
        const key = objectKey(objectData);
        const out = {};
        BANDS.forEach((band) => {
          const p = plan[band];
          if (p.skip) { out[band] = { role: p.role, rank: p.rank, level: p.level, enter: p.enter, events: [] }; return; }
          const pool = buildNotePool(key, BAND_CHAR[band].register, p.E);
          out[band] = {
            role: p.role, rank: p.rank, level: p.level, enter: p.enter, leadLow: p.leadLow,
            events: bandGestureEvents(band, p.role, p.E, pool, plan, total)
          };
        });
        return { plan: plan, tracks: out };
      },
      /* 统一手势诊断：网格 / 响度单调 / 密度单调 / lead 最密 / 署名 bar1 / solo-vs-role */
      diag(objectData, D) {
        const total = (typeof D === "number" && D > 0) ? D : 40;
        const plan = ensemblePlan(objectData, total);
        const key = objectKey(objectData);
        const onGrid8 = (t) => Math.abs((t / ENS_EIGHTH) - Math.round(t / ENS_EIGHTH)) < 1e-3;
        const rows = BANDS.map((band) => {
          const p = plan[band];
          const E = p.E;
          const pool = (p.skip) ? [] : buildNotePool(key, BAND_CHAR[band].register, E);
          const ev = (p.skip) ? [] : bandGestureEvents(band, p.role, E, pool, plan, total);
          const peakVel = ev.length ? Math.max.apply(null, ev.map((e) => e.vel)) : 0;
          const bar1 = ev.filter((e) => e.t < ENS_BAR).length;
          return {
            band: band, E: +E.toFixed(3), rank: p.rank,
            role: p.role,                                 // 音乐角色（lead/bass/hat/harmony/accent/point）
            dataRole: p.dataRole || null,                 // 数据策展角色（bandDetail[band].role）
            level: +p.level.toFixed(3),
            notes: ev.length, peakVel: +peakVel.toFixed(4),
            gridRate: ev.length ? +(ev.filter((e) => onGrid8(e.t)).length / ev.length).toFixed(4) : 1,
            bar1: bar1, skip: !!p.skip,
            // 宽谱强副声部：rank>0 且 E≥WIDE_SPECTRUM_E → 活跃度地板适用于它（应 notes≥floor）。
            wideStrong: (p.rank > 0 && !p.skip && E >= WIDE_SPECTRUM_E)
          };
        }).sort((a, b) => a.rank - b.rank);

        const live = rows.filter((r) => !r.skip && r.notes > 0);
        // 全部事件落共享 1/8 网格（solo 也对齐）
        const allOnGrid = rows.every((r) => r.skip || r.gridRate >= 0.999);
        // 响度单调：响度由【level】控制（level=0.2+0.5E，lead floored 0.8）—— 按能量降序 level 不得回升。
        //  另校验每轨【峰值力度 ≤ 自身 level】（无波段越过自己的电平天花板）。入场淡入是瞬态包络，
        //  不计入稳态响度判定（否则恰好落在淡入窗内的最响音会误伤单调性）。
        const byE = live.slice().sort((a, b) => b.E - a.E);
        let loudnessMonotonic = true, loudOffender = null;
        for (let k = 1; k < byE.length; k++) {
          if (byE[k - 1].level + 1e-6 < byE[k].level) { loudnessMonotonic = false; loudOffender = byE[k].band + ">" + byE[k - 1].band; break; }
        }
        const peakWithinLevel = live.every((r) => r.peakVel <= r.level + 1e-6);
        // 密度单调（容差 1）：按能量降序，音符数非增；lead(rank0) 最密
        const lead = rows.find((r) => r.rank === 0);
        const leadDensest = !!lead && rows.every((r) => r.skip || r.rank === 0 || r.notes <= lead.notes);
        const TOL = 1;
        const byEd = live.slice().sort((a, b) => b.E - a.E);
        let densityMonotonic = true, densOffender = null;
        for (let k = 1; k < byEd.length; k++) {
          if (byEd[k].notes > byEd[k - 1].notes + TOL) { densityMonotonic = false; densOffender = byEd[k].band + ">" + byEd[k - 1].band; break; }
        }
        // 署名 bar1：lead 在第 1 小节有音符，其余非 skip 波段 bar1 为 0
        const others = rows.filter((r) => r.rank > 0 && !r.skip);
        const signatureBar1 = !!lead && lead.bar1 > 0 && others.every((r) => r.bar1 === 0);
        // solo == 单波段 solo 事件来自同一 bandGestureEvents
        const soloVsRole = BANDS.filter((b) => !plan[b].skip && plan[b].E > 0).map((b) => {
          const pool = buildNotePool(key, BAND_CHAR[b].register, plan[b].E);
          const solo = bandGestureEvents(b, "solo", plan[b].E, pool, null, total);
          const role = bandGestureEvents(b, plan[b].role, plan[b].E, pool, plan, total);
          return { band: b, soloNotes: solo.length, roleNotes: role.length,
            soloPeak: +(solo.length ? Math.max.apply(null, solo.map((e) => e.vel)) : 0).toFixed(4) };
        });
        const allSchedule = rows.filter((r) => !r.skip).every((r) => r.notes > 0);
        // 宽谱活跃度地板（FIX #1）：每个 rank>0 且 E≥WIDE_SPECTRUM_E 的强副声部，音符数应 ≥ floor，
        //  floor = round(leadNotes * FLOOR_FRAC)。弱波段（E<阈值）不受地板约束，照旧稀疏（不计入此断言）。
        const leadNotes = lead ? lead.notes : 0;
        const floor = Math.round(leadNotes * FLOOR_FRAC);
        const wideBands = rows.filter((r) => r.wideStrong);
        const wideUnderFloor = wideBands.filter((r) => r.notes < floor).map((r) => r.band + "(" + r.notes + "<" + floor + ")");
        const wideSpectrumOK = wideUnderFloor.length === 0;
        // CBM-038 #2 诊断：trace 稀疏护栏——dataRole==='trace' 的弱波段必须被压到极少音
        //  （≤ round(leadNotes×0.12)）。trace+强(E≥阈值)矛盾，能量地板赢、不计入此断言（保持可听）。
        const traceCap = Math.round(leadNotes * 0.12);
        const traceWeak = rows.filter((r) => r.dataRole === "trace" && !r.skip && r.E < WIDE_SPECTRUM_E);
        const traceOver = traceWeak.filter((r) => r.notes > traceCap).map((r) => r.band + "(" + r.notes + ">" + traceCap + ")");
        const traceSparse = traceOver.length === 0;
        return {
          rows: rows, allOnGrid: allOnGrid, loudnessMonotonic: loudnessMonotonic, loudOffender: loudOffender,
          peakWithinLevel: peakWithinLevel,
          densityMonotonic: densityMonotonic, densOffender: densOffender, leadDensest: leadDensest,
          signatureBar1: signatureBar1, soloVsRole: soloVsRole, allSchedule: allSchedule,
          // FIX #1 诊断：宽谱强副声部活跃度地板
          wideSpectrumOK: wideSpectrumOK, wideUnderFloor: wideUnderFloor,
          // FIX #2 诊断：trace 稀疏护栏
          traceSparse: traceSparse, traceOffender: traceOver.length ? traceOver.join(",") : null, traceCap: traceCap,
          FLOOR_FRAC: FLOOR_FRAC, floor: floor, leadNotes: leadNotes, WIDE_SPECTRUM_E: WIDE_SPECTRUM_E
        };
      }
    }
  };
  global.CBMAudio = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
