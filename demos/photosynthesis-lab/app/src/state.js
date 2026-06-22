// Pure state logic for the photosynthesis lab exhibit.
// Staged two-experiment model (方案 B):
//   - one full session = 实验一 + 实验二, recorded by tapping the oxygen card
//   - phases: setup1 -> (record exp1) -> setup2 -> (record exp2) -> result -> reset
//   - light is one variable: low / mid / high
//   - CO2 is a ONE-WAY variable per setup: absent -> present (no "clear water")
//   - recording an experiment freezes {light, co2Added, oxygen, curvePoints} into
//     a slot, draws its curve, then resets the tank to the baseline (low + no CO2)
//   - oxygen + every curve y-value come straight from the locked OXYGEN_RATE table
//   - aquarium video is still selected by response level (drives which clip)
//
// Loaded two ways (UMD-lite, see bottom of file):
//   - browser: classic <script> -> symbols hang off window.PSL (file:// works)
//   - node test: require('./state.js') -> CommonJS module.exports

const LIGHT_LEVELS = ["low", "mid", "high"];
const RESPONSE_LEVELS = ["low", "mid", "high"];

// X-axis tiers on the oxygen curve, in order. "none" is the shared origin
// (no light = oxygen 0); the three real light levels follow.
const CURVE_TIERS = ["none", "low", "mid", "high"];
const CURVE_TIER_LABELS = {
  none: "无光",
  low: "低",
  mid: "中",
  high: "高"
};

const LIGHT_LABELS = {
  low: "低光",
  mid: "中光",
  high: "高光"
};

const CO2_LABELS = {
  false: "无 CO₂",
  true: "有 CO₂"
};

const RESPONSE_LABELS = {
  low: "弱反馈",
  mid: "中等反馈",
  high: "强反馈"
};

// PRD §5.2 — LOCKED science table. Oxygen is read ONLY from here:
//   oxygen = OXYGEN_RATE[lightIdx][co2Added ? 1 : 0]
// (lightIdx: low=0 / mid=1 / high=2). Do not change any number.
const OXYGEN_RATE = [
  [2, 3], // low:  no-co2, co2
  [5, 8], // mid:  no-co2, co2
  [9, 18] // high: no-co2, co2
];

// Three aquarium loops represent response strength (still drives the video).
const AQUARIUM_VIDEOS = {
  low: { id: "AQ-R1", file: "aq-v1-low-loop.mp4", poster: "aq-p1-low-poster.jpg" },
  mid: { id: "AQ-R2", file: "aq-v2-mid-loop.mp4", poster: "aq-p2-mid-poster.jpg" },
  high: { id: "AQ-R3", file: "aq-v3-high-loop.mp4", poster: "aq-p3-high-poster.jpg" }
};

// Single soda-pour video (plays once, not looped).
const POUR_VIDEO = {
  id: "SD-V1",
  file: "sd-v1-pour-co2.mp4",
  poster: "sd-p1-pour-poster.jpg"
};

// Programmatic CO2 dissolve intensity when CO2 is added under the current light.
const CO2_INTENSITY = {
  low: "weak",
  mid: "medium",
  high: "strong"
};

// 6 free states reuse 3 response loops (still drives the aquarium video).
const RESPONSE_LEVELS_BY_STATE = {
  "low:false": "low",
  "low:true": "mid",
  "mid:false": "mid",
  "mid:true": "high",
  "high:false": "high",
  "high:true": "high"
};

// Procedural bubble richness follows perceived result.
const BUBBLE_LEVELS = {
  "low:false": "scarce",
  "low:true": "medium",
  "mid:false": "medium",
  "mid:true": "rich",
  "high:false": "rich",
  "high:true": "abundant"
};

// Two experiment slots per session.
const PHASES = ["setup1", "setup2", "result"];

// Baseline the tank resets to between experiments: low light, no CO2.
const BASELINE = Object.freeze({ light: "low", co2Added: false });

const INITIAL_STATE = Object.freeze({
  light: "low",
  co2Added: false,
  phase: "setup1",
  lastAction: "init",
  isAddingCo2: false,
  hintTarget: "lamp",
  resetWarning: false,
  experiments: [] // up to 2 frozen experiment records
});

function lightIndex(light) {
  const i = LIGHT_LEVELS.indexOf(light);
  if (i === -1) throw new Error(`Unknown light level: ${light}`);
  return i;
}

function assertLight(light) {
  if (!LIGHT_LEVELS.includes(light)) throw new Error(`Unknown light level: ${light}`);
}

function stateKey(state) {
  return `${state.light}:${Boolean(state.co2Added)}`;
}

// Oxygen value for any {light, co2Added} — always from the locked table.
function getOxygen(light, co2Added) {
  return OXYGEN_RATE[lightIndex(light)][co2Added ? 1 : 0];
}

function getOxygenRate(state) {
  return getOxygen(state.light, state.co2Added);
}

function getResponseLevel(state) {
  return RESPONSE_LEVELS_BY_STATE[stateKey(state)] ?? "low";
}

function getAquariumVideo(source) {
  const level = typeof source === "string" ? source : getResponseLevel(source);
  const video = AQUARIUM_VIDEOS[level];
  if (!video) throw new Error(`Unknown response level: ${level}`);
  return video;
}

function getCo2Intensity(light) {
  assertLight(light);
  return CO2_INTENSITY[light];
}

function getBubbleLevel(state) {
  return BUBBLE_LEVELS[stateKey(state)] ?? "scarce";
}

// Table ceiling (18). Computed from OXYGEN_RATE so vigor never hardcodes a max.
const MAX_OXYGEN = Math.max(...OXYGEN_RATE.map((row) => Math.max(...row)));

// "Vigor" = how lively the tank should LOOK, on a continuous 0..1 scale, driven
// ONLY by the locked oxygen value (oxygen / table-ceiling). This is what the
// procedural overlay (bubbles, glow, dissolve burst) scales by, so all 6
// conditions read as distinct and move the SAME direction as the curve — even
// though only 3 underlying videos exist. The video itself stays response-driven.
//   low/no  oxygen 2  -> 0.111      high/no  oxygen 9  -> 0.500
//   low/co2 oxygen 3  -> 0.167      high/co2 oxygen 18 -> 1.000
//   mid/no  oxygen 5  -> 0.278
//   mid/co2 oxygen 8  -> 0.444
// Key property: high+CO2 (1.000) is double high+no-CO2 (0.500), so the overlay
// (e.g. bubble rate) visibly ~doubles between them, matching the curve.
function getVigor(light, co2Added) {
  return getOxygen(light, co2Added) / MAX_OXYGEN;
}

function getVigorFromState(state) {
  return getVigor(state.light, state.co2Added);
}

// CO2 dissolve burst strength scales with the RESULT oxygen (after the powder is
// in), so high+CO2 gets the strongest dissolve. Continuous 0..1, same source.
function getCo2DissolveScale(light) {
  return getVigor(light, true);
}

function getLightLabel(light) {
  return LIGHT_LABELS[light] ?? light;
}

function getCo2Label(co2Added) {
  return CO2_LABELS[String(Boolean(co2Added))];
}

function getResponseLabel(stateOrLevel) {
  const level = typeof stateOrLevel === "string" ? stateOrLevel : getResponseLevel(stateOrLevel);
  return RESPONSE_LABELS[level] ?? level;
}

function getConditionLabel(state) {
  return `${getLightLabel(state.light)} / ${getCo2Label(state.co2Added)}`;
}

// --- oxygen curve geometry --------------------------------------------------

// Points for one experiment line, from the shared origin (no light = oxygen 0)
// up the CO2 track to the experiment's light level. Every y comes from the
// locked OXYGEN_RATE table; x is the tier index in CURVE_TIERS.
//   no-CO2 track passes through low=2, mid=5, high=9
//   CO2 track passes through low=3, mid=8, high=18
// Example: getCurvePoints("high", false) ->
//   [{tier:"none",x:0,oxygen:0},{tier:"low",x:1,oxygen:2},
//    {tier:"mid",x:2,oxygen:5},{tier:"high",x:3,oxygen:9}]
function getCurvePoints(light, co2Added) {
  const stop = lightIndex(light); // 0..2 -> how far up the track we go (throws on bad input)
  const points = [{ tier: "none", x: 0, oxygen: 0 }];
  for (let i = 0; i <= stop; i += 1) {
    const tier = LIGHT_LEVELS[i];
    points.push({ tier, x: i + 1, oxygen: getOxygen(tier, co2Added) });
  }
  return points;
}

// --- transitions ------------------------------------------------------------

function setLight(state, light) {
  assertLight(light);
  return {
    ...state,
    light,
    lastAction: `set-light-${light}`,
    hintTarget: null,
    resetWarning: false
  };
}

// Begin the pour animation (CO2 is one-way within a setup; re-adding is a no-op).
function startCo2(state) {
  if (state.isAddingCo2) {
    return { ...state, lastAction: "co2-busy", hintTarget: null };
  }
  if (state.co2Added) {
    return { ...state, lastAction: "co2-already-on", hintTarget: null };
  }

  return {
    ...state,
    isAddingCo2: true,
    lastAction: `add-co2-${state.light}`,
    hintTarget: null,
    resetWarning: false
  };
}

// Settle CO2 as present. Idempotent terminal setter (one-way within a setup).
function addCo2(state) {
  if (state.co2Added && !state.isAddingCo2) {
    return { ...state, lastAction: "co2-already-on", hintTarget: null };
  }
  return {
    ...state,
    co2Added: true,
    isAddingCo2: false,
    lastAction: `co2-added-${state.light}`,
    hintTarget: null,
    resetWarning: false
  };
}

// Alias kept for the runtime pour-finish step; same one-way semantics.
function finishCo2(state) {
  return addCo2(state);
}

function resetExperiment() {
  return { ...INITIAL_STATE, lastAction: "reset", experiments: [] };
}

// --- phase machine ----------------------------------------------------------

function getPhase(state) {
  return state.phase || "setup1";
}

// Which slot the next tap on the card will fill (0 or 1), or -1 when both done.
function nextSlot(state) {
  const filled = (state.experiments || []).length;
  return filled >= 2 ? -1 : filled;
}

// Freeze the current condition into the next slot, then either reset the tank to
// baseline for the next setup, or — once both are recorded — enter `result`.
// Immutable: returns a new state with a new experiments array.
function recordExperiment(state) {
  const slot = nextSlot(state);
  if (slot === -1) return state; // both already recorded; ignore

  const record = {
    index: slot,
    light: state.light,
    co2Added: Boolean(state.co2Added),
    oxygen: getOxygen(state.light, state.co2Added),
    responseLevel: getResponseLevel(state),
    curvePoints: getCurvePoints(state.light, state.co2Added)
  };
  const experiments = [...(state.experiments || []), record];

  // After exp1: back to baseline, phase setup2. After exp2: stay at the
  // recorded condition (no point resetting) and enter the result phase.
  if (experiments.length === 1) {
    return {
      ...state,
      ...BASELINE,
      experiments,
      phase: "setup2",
      isAddingCo2: false,
      lastAction: "record-exp-1",
      hintTarget: null,
      resetWarning: false
    };
  }

  return {
    ...state,
    experiments,
    phase: "result",
    isAddingCo2: false,
    lastAction: "record-exp-2",
    hintTarget: null,
    resetWarning: false
  };
}

// Tap-the-card action. Drives the whole session forward:
//   setup1/setup2 -> record an experiment (see recordExperiment)
//   result        -> reset for a fresh session
// Returns { state, action } so the runtime knows what just happened.
function advancePhase(state) {
  const phase = getPhase(state);
  if (phase === "result") {
    return { state: resetExperiment(), action: "reset" };
  }
  const slot = nextSlot(state);
  const next = recordExperiment(state);
  return { state: next, action: slot === 0 ? "recorded-1" : "recorded-2" };
}

// --- captions (objective only — describe the tank, not the variables) -------

// Setup-phase caption: describe what the tank is doing right now by response
// strength. No mention of "limiting factor" / what was added.
function getStateCaption(responseLevel) {
  if (responseLevel === "high") {
    return "水草大量冒泡，氧气很充足，小鱼欢快地来回穿梭。";
  }
  if (responseLevel === "mid") {
    return "水草冒泡明显变多，水里氧气在上升，小鱼活跃了起来。";
  }
  return "水草偶尔冒一两个气泡，小鱼懒懒地游。";
}

// Result-phase caption: objective comparison of the two recorded experiments.
// Only states observed facts (more/less oxygen, fish activity); no causation.
function getResultCaption(exp1, exp2) {
  if (!exp1 || !exp2) {
    return "两组实验都记录好了，曲线已经画在右上方。";
  }
  const a = exp1.oxygen;
  const b = exp2.oxygen;
  if (a === b) {
    return "两组氧气一样多，小鱼的活跃程度也差不多。";
  }
  // "close" = within 2 units on the locked 0..18 scale.
  if (Math.abs(a - b) <= 2) {
    return "两组氧气差不多，小鱼活跃度也接近。";
  }
  if (b > a) {
    return "实验二的氧气比实验一多，小鱼明显更活跃。";
  }
  return "实验一的氧气比实验二多，小鱼明显更活跃。";
}

// --- labels for bottom experiment bars & the card hint ----------------------

// Bottom bar label for an experiment slot. NO oxygen number (it lives on the
// curve). Placeholder text when the slot isn't recorded / in progress yet.
//   index 0 -> 实验一, index 1 -> 实验二
function getExperimentLabel(exp, index, status) {
  const name = index === 0 ? "实验一" : "实验二";
  // One separator max per line: experiment name + full-width space, then the
  // condition with a single "·" between light and CO₂ (was 2 "·" per line).
  if (exp) {
    return `${name}　${getLightLabel(exp.light)}·${getCo2Label(exp.co2Added)}`;
  }
  // Placeholder states drop the leading "·": just name + full-width space + tag.
  if (status === "active") return `${name}　进行中…`;
  return `${name}　待记录`;
}

// Clickable hint line under the card title, varies by phase.
function getCardHint(state) {
  const phase = getPhase(state);
  if (phase === "result") return "再点一下 · 重做";
  const slot = nextSlot(state);
  return slot === 0 ? "实验一 · 点这里记录" : "实验二 · 点这里记录";
}

// One-line guidance shown while setting up (NOT a science explanation).
function getSetupPrompt(state) {
  const phase = getPhase(state);
  if (phase === "setup1") return "调出实验一的条件，再点右上卡片记录。";
  if (phase === "setup2") return "换一组条件做实验二，再点右上卡片记录。";
  return "";
}

// --- UMD-lite dual export ---------------------------------------------------
const PSL = {
  // constants
  LIGHT_LEVELS,
  RESPONSE_LEVELS,
  CURVE_TIERS,
  CURVE_TIER_LABELS,
  LIGHT_LABELS,
  CO2_LABELS,
  RESPONSE_LABELS,
  OXYGEN_RATE,
  AQUARIUM_VIDEOS,
  POUR_VIDEO,
  CO2_INTENSITY,
  RESPONSE_LEVELS_BY_STATE,
  BUBBLE_LEVELS,
  MAX_OXYGEN,
  PHASES,
  BASELINE,
  INITIAL_STATE,
  // selectors
  lightIndex,
  stateKey,
  getOxygen,
  getOxygenRate,
  getResponseLevel,
  getAquariumVideo,
  getCo2Intensity,
  getBubbleLevel,
  getVigor,
  getVigorFromState,
  getCo2DissolveScale,
  getLightLabel,
  getCo2Label,
  getResponseLabel,
  getConditionLabel,
  getCurvePoints,
  getPhase,
  nextSlot,
  getStateCaption,
  getResultCaption,
  getExperimentLabel,
  getCardHint,
  getSetupPrompt,
  // transitions
  setLight,
  startCo2,
  addCo2,
  finishCo2,
  recordExperiment,
  advancePhase,
  resetExperiment
};

if (typeof window !== "undefined") window.PSL = PSL;
if (typeof module !== "undefined" && module.exports) module.exports = PSL;
