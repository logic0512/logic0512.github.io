// Classic script (NOT a module): state.js loads first and exposes window.PSL,
// so file:// double-click works with no CORS / http server. See state.js footer.
// Wrapped in an IIFE so these top-level `const`s don't collide with state.js's
// top-level consts (classic scripts share one global lexical scope).
(function runtime() {
const {
  INITIAL_STATE,
  POUR_VIDEO,
  RESPONSE_LEVELS,
  OXYGEN_RATE,
  CURVE_TIERS,
  CURVE_TIER_LABELS,
  advancePhase,
  finishCo2,
  getAquariumVideo,
  getBubbleLevel,
  getVigorFromState,
  getCo2DissolveScale,
  getCardHint,
  getCo2Intensity,
  getCurvePoints,
  getExperimentLabel,
  getPhase,
  getResponseLevel,
  getResultCaption,
  getSetupPrompt,
  getStateCaption,
  nextSlot,
  resetExperiment,
  setLight,
  startCo2
} = window.PSL;

const VIDEO_BASE = "../assets/videos/";
const POSTER_BASE = "../assets/posters/";

const IDLE_HINT_MS = 3000;
const RESET_WARNING_MS = 42000;
const AUTO_RESET_MS = 50000;
const POUR_FADE_OUT_MS = 600;
// Pour video is ~4.09s. Delay the programmatic dissolve until the white powder
// column has started fading (#4) so the dissolving particles read clearly
// instead of being washed out by the bright pour. Finish the state shortly after
// so captions/bubbles update while particles are still spreading.
const CO2_DISSOLVE_DELAY_MS = 2700;
const CO2_FINISH_MS = 3600;

const stage = document.querySelector("#stage");
const videoA = document.querySelector("#aquariumVideoA");
const videoB = document.querySelector("#aquariumVideoB");
const pourVideo = document.querySelector("#pourVideo");
const bubbleLayer = document.querySelector("#bubbleLayer");
const co2Layer = document.querySelector("#co2Layer");
// NOTE: the legacy #sodaLayer powder layer was removed; CO2 is now #co2Layer.
const caption = document.querySelector("#caption");
const setupPrompt = document.querySelector("#setupPrompt");
const stateLabel = document.querySelector("#stateLabel");
const videoLabel = document.querySelector("#videoLabel");
const assetDebug = document.querySelector("#assetDebug");
const resetFade = document.querySelector("#resetFade");
const sodaButton = document.querySelector("#sodaButton");
const lampControl = document.querySelector(".lamp-control");
const oxygenChart = document.querySelector("#oxygenChart");
const oxygenChartPlot = document.querySelector("#oxygenChartPlot");
const oxygenChartHint = document.querySelector("#oxygenChartHint");
const trialExp1Value = document.querySelector("#trialExp1Value");
const trialExp2Value = document.querySelector("#trialExp2Value");
const trialExp1 = document.querySelector("#trialExp1");
const trialExp2 = document.querySelector("#trialExp2");

let experiment = { ...INITIAL_STATE, experiments: [] };
let activeBuffer = videoA; // currently shown aquarium buffer
let idleBuffer = videoB; // off-screen buffer for the next light level
let currentVideoFile = null;
// D-1: warmed <video> elements (one per aquarium clip), fully fetched at boot.
const videoCache = new Map();

let bubbleTimer = 0;
let idleTimer = 0;
let resetWarningTimer = 0;
let resetTimer = 0;
let co2FinishTimer = 0;
let co2EnterTimer = 0;
let pourFadeTimer = 0;
let sliderDragStartY = 0;
let sliderMoved = false;

if (new URLSearchParams(window.location.search).get("debug") === "1") {
  stage.dataset.debug = "true";
  if (assetDebug) assetDebug.removeAttribute("hidden");
}

// Bubble strength is now driven CONTINUOUSLY by oxygen-derived vigor (0..1),
// not the old 4-bucket getBubbleLevel. Each knob interpolates linearly with
// vigor between a calm low end and a vigorous high end, so the 6 oxygen values
// (2/3/5/8/9/18 -> vigor 0.111/0.167/0.278/0.444/0.500/1.000) produce 6 clearly
// distinct bubble intensities — and high+CO2 (vigor 1.0) visibly out-bubbles
// high+no-CO2 (vigor 0.5): roughly twice the spawn rate AND twice the cap.
const BUBBLE_RATE = {
  // interval between spawn ticks, ms: high vigor = shorter interval = faster
  everyMin: 240, // at vigor 1.0
  everyMax: 1600, // at vigor 0.0
  // bubbles emitted per tick
  countMin: 1, // low vigor
  countMax: 4, // high vigor
  // hard ceiling on concurrent bubbles in the glass
  maxMin: 5, // low vigor
  maxMax: 30 // high vigor
};

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Translate a 0..1 vigor into concrete spawn settings. Interval shrinks as vigor
// rises (everyMax -> everyMin); count + max grow (min -> max).
function bubbleSettingsForVigor(vigor) {
  const t = Math.min(1, Math.max(0, vigor));
  return {
    every: Math.round(lerp(BUBBLE_RATE.everyMax, BUBBLE_RATE.everyMin, t)),
    count: Math.max(1, Math.round(lerp(BUBBLE_RATE.countMin, BUBBLE_RATE.countMax, t))),
    max: Math.round(lerp(BUBBLE_RATE.maxMin, BUBBLE_RATE.maxMax, t))
  };
}

// --- aquarium video (3 response levels, cross-faded) ------------------------

// D-1: point a buffer at a clip's src ONLY when it differs. Because every clip
// is already fully fetched into videoCache at boot, the browser serves the bytes
// from cache and readyState reaches 2 almost immediately — so a rapid low→mid→low
// switch never re-fetches and never aborts an in-flight load (no ERR_ABORTED).
function preloadBuffer(buffer, video) {
  const src = `${VIDEO_BASE}${video.file}`;
  buffer.poster = `${POSTER_BASE}${video.poster}`;
  if (buffer.dataset.src === src) return;
  buffer.dataset.src = src;
  buffer.src = src;
  // No buffer.load() here: a fresh load() would abort the cached fetch and emit
  // ERR_ABORTED. Setting .src already kicks off (cache-served) loading.
}

function showResponseVideo(responseLevel) {
  const video = getAquariumVideo(responseLevel);
  const src = `${VIDEO_BASE}${video.file}`;
  // Skip if this video is already the visible (active) buffer.
  if (
    video.file === currentVideoFile &&
    activeBuffer.classList.contains("is-active") &&
    activeBuffer.dataset.src === src
  ) {
    return;
  }
  currentVideoFile = video.file;
  setDebug(video.id, video.file);

  // Capture the buffer element now; module-level idle/active may swap before
  // an async loadeddata fires (rapid light changes). The pendingFile token is
  // the single source of truth for "which clip this buffer is meant to show":
  // any newer switch overwrites it, so stale onReady callbacks bail out.
  const targetBuffer = idleBuffer;
  targetBuffer.dataset.pendingFile = video.file;
  preloadBuffer(targetBuffer, video);

  const playNext = () => {
    // Stale call: a newer switch reassigned this buffer to another clip.
    if (targetBuffer.dataset.pendingFile !== video.file) return;
    if (targetBuffer.dataset.src !== src) return;
    if (targetBuffer === activeBuffer) return;
    targetBuffer.currentTime = 0;
    targetBuffer.play().catch(() => {});
    // cross-fade: new buffer in, old buffer out
    const previous = activeBuffer;
    targetBuffer.classList.add("is-active");
    previous.classList.remove("is-active");
    activeBuffer = targetBuffer;
    idleBuffer = previous;
    // pause the now-hidden buffer after the fade completes
    window.setTimeout(() => previous.pause(), 320);
  };

  if (targetBuffer.readyState >= 2) {
    playNext();
  } else {
    const onReady = () => {
      targetBuffer.removeEventListener("loadeddata", onReady);
      playNext();
    };
    targetBuffer.addEventListener("loadeddata", onReady);
  }
}

// --- captions / condition UI / debug ---------------------------------------

function setDebug(id, file) {
  if (stateLabel) stateLabel.textContent = id;
  if (videoLabel) videoLabel.textContent = file;
}

function updateCaption(text) {
  if (caption.textContent === text) return;
  caption.classList.add("is-updating");
  window.setTimeout(() => {
    caption.textContent = text;
    caption.classList.remove("is-updating");
  }, 160);
}

// --- card tap: record an experiment / reset --------------------------------

// The right-top oxygen card is the only phase control. Tapping it records the
// current condition (setup1/setup2) or resets the whole session (result).
function tapOxygenCard() {
  if (experiment.isAddingCo2) return; // don't record mid-pour
  const prevPhase = getPhase(experiment);
  const { state, action } = advancePhase(experiment);
  experiment = state; // advancePhase already returns the correct next state
  touchActivity();
  clearFreshHint();

  if (action === "reset") {
    co2Layer.innerHTML = "";
    bubbleLayer.innerHTML = "";
  }

  renderResultsUi();
  renderSetupPrompt();
  // P1b: only the FIRST tap that lands us in result fires the entrance pop on
  // the corner card (prevPhase wasn't result, now it is). A redo tap from result
  // resets and never re-triggers it.
  if (prevPhase !== "result" && getPhase(experiment) === "result") {
    playChartResultPop();
  }
  // Bottom caption is now ONLY the objective tank state / result comparison —
  // the operation guidance moved to the top prompt (renderSetupPrompt).
  syncStage(captionForPhase());
}

// One-shot entrance emphasis for the result-conclusion card. Adds a CSS class
// that runs the pop keyframe, then strips it on animationend so it never replays
// per frame. reduced-motion is honored in CSS (animation:none), so the class is
// harmless there — animationend may not fire, so we also clear it on a timeout.
function playChartResultPop() {
  if (!oxygenChart) return;
  oxygenChart.classList.remove("result-enter");
  // force reflow so re-adding the class restarts the animation cleanly
  void oxygenChart.offsetWidth;
  oxygenChart.classList.add("result-enter");
  const clear = () => {
    oxygenChart.classList.remove("result-enter");
    oxygenChart.removeEventListener("animationend", clear);
  };
  oxygenChart.addEventListener("animationend", clear);
  // safety: if animationend doesn't fire (reduced-motion / interrupted), drop it.
  window.setTimeout(clear, 1000);
}

// Bottom-caption text for the current phase — objective tank description only.
//   result -> objective comparison of the two experiments
//   setup  -> objective description of the tank right now (state caption)
// It NEVER returns the operation guidance; that lives in the top prompt.
function captionForPhase() {
  const phase = getPhase(experiment);
  if (phase === "result") {
    const [exp1, exp2] = experiment.experiments;
    return getResultCaption(exp1, exp2);
  }
  return getStateCaption(getResponseLevel(experiment));
}

// Top-center operation guidance. setup1/setup2 each get their own line; result
// phase invites a redo. Separate from the bottom objective caption so the low-
// light "水草偶尔冒一两个气泡…" state line is never overwritten by guidance.
function renderSetupPrompt() {
  if (!setupPrompt) return;
  const phase = getPhase(experiment);
  const text = phase === "result"
    ? "看完了？点右上卡片重做一次。"
    : getSetupPrompt(experiment);
  setupPrompt.textContent = text;
  setupPrompt.classList.toggle("is-hidden", text.length === 0);
}

// Redraw the card hint, both experiment bars and the dual-curve chart from the
// current recorded experiments + phase.
function renderResultsUi() {
  const experiments = experiment.experiments || [];
  const phase = getPhase(experiment);
  const slot = nextSlot(experiment);

  if (oxygenChartHint) oxygenChartHint.textContent = getCardHint(experiment);
  // Pulse the card only while it still records an experiment (setup1/setup2).
  // In the result phase a tap RESETS, so drop the "record me" affordance.
  if (oxygenChart) oxygenChart.classList.toggle("is-armed", phase !== "result");

  renderExperimentBars(experiments, slot, phase);
  renderOxygenChart(experiments);
}

function renderExperimentBars(experiments, slot, phase) {
  const exp1 = experiments[0] || null;
  const exp2 = experiments[1] || null;

  // exp1 is "active" while we're in setup1 (slot 0); exp2 while setup2 (slot 1).
  const exp1Active = !exp1 && slot === 0;
  const exp2Active = !exp2 && slot === 1;

  if (trialExp1Value) {
    trialExp1Value.textContent = getExperimentLabel(exp1, 0, exp1Active ? "active" : "");
  }
  if (trialExp2Value) {
    trialExp2Value.textContent = getExperimentLabel(exp2, 1, exp2Active ? "active" : "");
  }
  if (trialExp1) {
    trialExp1.classList.toggle("is-empty", !exp1);
    trialExp1.classList.toggle("is-active", exp1Active);
  }
  if (trialExp2) {
    trialExp2.classList.toggle("is-empty", !exp2);
    trialExp2.classList.toggle("is-active", exp2Active);
  }
}

// Oxygen y-axis runs 0..MAX_OXYGEN; MAX_OXYGEN is the table ceiling (18) so the
// scale never depends on the data and stays comparable across experiments.
const MAX_OXYGEN = Math.max(...OXYGEN_RATE.map((row) => Math.max(...row)));
const SVG_NS = "http://www.w3.org/2000/svg";
const CURVE_CLASS = ["exp1", "exp2"]; // slot index -> color suffix

function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

// Inline SVG chart (no chart library). x = light tier (none/low/mid/high),
// y = oxygen. Draws up to two experiment lines, both from the shared origin.
function renderOxygenChart(experiments) {
  if (!oxygenChartPlot) return;
  oxygenChartPlot.innerHTML = "";

  const W = 240;
  const H = 132;
  const padL = 26;
  const padR = 18;
  const padT = 12;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    width: "100%",
    height: "100%",
    "aria-hidden": "true"
  });

  const tiers = CURVE_TIERS; // ["none","low","mid","high"]
  const xAt = (xi) => padL + (plotW * xi) / (tiers.length - 1);
  const yAt = (oxygen) => padT + plotH * (1 - oxygen / MAX_OXYGEN);
  // keep end-point labels inside the viewBox: at oxygen=18 the dot sits on padT,
  // so an "above" label (negative dy) would clip off the top edge.
  const clampLabelY = (y) => Math.max(padT + 8, Math.min(y, H - 4));

  // y gridlines + labels at 0 / mid / max
  for (const val of [0, Math.round(MAX_OXYGEN / 2), MAX_OXYGEN]) {
    const y = yAt(val);
    svg.append(svgEl("line", { x1: padL, y1: y, x2: W - padR, y2: y, class: "oc-grid" }));
    const label = svgEl("text", { x: padL - 5, y: y + 3, class: "oc-axis", "text-anchor": "end" });
    label.textContent = String(val);
    svg.append(label);
  }

  // x-axis tier labels: 无光 / 低 / 中 / 高
  tiers.forEach((tier, xi) => {
    const t = svgEl("text", { x: xAt(xi), y: H - 7, class: "oc-tier", "text-anchor": "middle" });
    t.textContent = CURVE_TIER_LABELS[tier];
    svg.append(t);
  });

  // draw each recorded experiment line. End points carry the oxygen value + a
  // 实验一/实验二 tag so overlapping (no-CO2) lines stay distinguishable.
  experiments.forEach((exp, slot) => {
    if (!exp) return;
    const suffix = CURVE_CLASS[slot] || "exp1";
    const points = exp.curvePoints || getCurvePoints(exp.light, exp.co2Added);

    const pts = points.map((p) => `${xAt(p.x)},${yAt(p.oxygen)}`).join(" ");
    svg.append(svgEl("polyline", { points: pts, class: `oc-line oc-line-${suffix}` }));

    points.forEach((p, i) => {
      const isEnd = i === points.length - 1;
      svg.append(svgEl("circle", {
        cx: xAt(p.x), cy: yAt(p.oxygen), r: isEnd ? 4.4 : 2.6,
        class: isEnd ? `oc-dot-${suffix} oc-end-${suffix}` : `oc-dot-${suffix}`
      }));
    });

    // end-point oxygen value + experiment tag. When two lines share the same
    // endpoint (e.g. both stop at 'low'), exp1 prints value-above / tag-below
    // and exp2 prints value-below / tag-above, so the four labels never collide
    // even though the dots overlap. exp2 also nudges its x slightly right.
    const end = points[points.length - 1];
    const ex = xAt(end.x);
    const ey = yAt(end.oxygen);
    const isExp2 = slot === 1;
    const valDy = isExp2 ? 14 : -9; // exp2 value below the dot, exp1 above
    const tagDy = isExp2 ? -10 : 15; // exp2 tag above, exp1 below
    const tagX = isExp2 ? Math.min(ex + 6, W - padR) : ex;

    const val = svgEl("text", {
      x: ex, y: clampLabelY(ey + valDy), class: `oc-val oc-val-${suffix}`, "text-anchor": "middle"
    });
    val.textContent = String(end.oxygen);
    svg.append(val);

    const tag = svgEl("text", {
      x: tagX, y: clampLabelY(ey + tagDy), class: `oc-tag oc-tag-${suffix}`, "text-anchor": "middle"
    });
    tag.textContent = isExp2 ? "实验二" : "实验一";
    svg.append(tag);
  });

  oxygenChartPlot.append(svg);
}

// --- bubble layer -----------------------------------------------------------

function glassHeightPx() {
  const rect = bubbleLayer.getBoundingClientRect();
  return rect.height || 360;
}

function restartBubbleLoop(vigor) {
  window.clearInterval(bubbleTimer);
  const setting = bubbleSettingsForVigor(vigor);
  bubbleTimer = window.setInterval(() => {
    for (let i = 0; i < setting.count; i += 1) {
      if (bubbleLayer.children.length < setting.max) spawnBubble(vigor);
    }
  }, setting.every);
}

function spawnBubble(vigor) {
  const bubble = document.createElement("i");
  bubble.className = "bubble";
  // bubbles grow a touch larger as vigor climbs (max +8px at vigor 1.0).
  const size = 4 + Math.random() * (4 + 4 * Math.min(1, Math.max(0, vigor)));
  // bubbles originate from the plant region (x ~ 30%..62% of glass)
  const x = 30 + Math.random() * 32;
  const duration = 2600 + Math.random() * 1800;
  // rise ~ 62% of the glass height so bubbles stop near the water surface
  const rise = -(glassHeightPx() * (0.5 + Math.random() * 0.12));
  bubble.style.setProperty("--size", `${size}px`);
  bubble.style.setProperty("--x", `${x}%`);
  bubble.style.setProperty("--duration", `${duration}ms`);
  bubble.style.setProperty("--rise", `${rise}px`);
  bubbleLayer.append(bubble);
  bubble.addEventListener("animationend", () => bubble.remove());
}

// --- DEV-E pour video + DEV-F programmatic CO2 dissolve ---------------------

// Single persistent ended handler. Bound ONCE at boot to pourVideo's "ended"
// event AND used as the 4500ms safety fallback. Idempotent: safe to call from
// both paths in any order — it only clears the safety timer and drops the class.
function onPourEnded() {
  window.clearTimeout(pourFadeTimer);
  pourVideo.classList.remove("is-playing");
}

function stopPour() {
  window.clearTimeout(pourFadeTimer);
  pourVideo.pause();
  pourVideo.classList.remove("is-playing");
}

function playPourVideo() {
  if (pourVideo.classList.contains("is-playing")) return; // reentry guard
  window.clearTimeout(pourFadeTimer);
  const src = `${VIDEO_BASE}${POUR_VIDEO.file}`;
  pourVideo.poster = `${POSTER_BASE}${POUR_VIDEO.poster}`;
  setDebug(POUR_VIDEO.id, POUR_VIDEO.file);

  const start = () => {
    pourVideo.currentTime = 0;
    pourVideo.classList.add("is-playing");
    pourVideo.play().catch(() => {});
  };

  if (pourVideo.dataset.src !== src) {
    pourVideo.dataset.src = src;
    pourVideo.src = src;
    pourVideo.load();
    const onReady = () => {
      pourVideo.removeEventListener("loadeddata", onReady);
      start();
    };
    pourVideo.addEventListener("loadeddata", onReady);
  } else {
    start();
  }

  // safety: hide the pour layer even if "ended" never fires
  pourFadeTimer = window.setTimeout(onPourEnded, 4500);
}

// #4: the dissolve must read as a real "CO2 spreading through the water" event,
// not a faint sprinkle hidden behind the pour. Each tier differs in count, base
// size AND spawn-window tightness so the difference is obvious to the eye:
//   weak   -> few, small, loosely staggered
//   medium -> clearly more, mid-size
//   strong -> dense, larger, tight burst (reads as a surge)
const CO2_TIERS = {
  weak: { count: 24, sizeBase: 3.0, sizeJitter: 3.0, window: 1100, opacity: 0.85 },
  medium: { count: 52, sizeBase: 3.8, sizeJitter: 3.6, window: 850, opacity: 0.92 },
  strong: { count: 96, sizeBase: 4.6, sizeJitter: 4.4, window: 620, opacity: 1.0 }
};

function playCo2Dissolve(intensity, dissolveScale) {
  const tier = CO2_TIERS[intensity] || CO2_TIERS.weak;
  const h = glassHeightPx();
  co2Layer.innerHTML = "";

  // Scale particle count by the RESULT oxygen (vigor, 0..1) so the burst tracks
  // how vigorous the tank ends up: high+CO2 (vigor 1.0) gets the fullest surge,
  // low+CO2 (vigor ~0.17) a modest puff. Floor at 0.5 so even a weak add reads.
  const scale = typeof dissolveScale === "number"
    ? Math.max(0.5, Math.min(1, dissolveScale))
    : 1;
  const count = Math.max(8, Math.round(tier.count * scale));

  for (let i = 0; i < count; i += 1) {
    const drop = document.createElement("i");
    drop.className = "co2-drop";
    // Bigger, higher-contrast particles than before (was 1.5..4.7px).
    const size = tier.sizeBase + Math.random() * tier.sizeJitter;
    // enter across the right-upper water surface
    const startX = 56 + Math.random() * 26; // 56%..82%
    const startY = 14 + Math.random() * 14; // 14%..28% (just below rim)
    // sink and spread left toward the plant region (wider spread on stronger tiers)
    const dx = -(h * (0.18 + Math.random() * 0.26));
    const dy = h * (0.34 + Math.random() * 0.34);
    const duration = 1500 + Math.random() * 1400;
    // tighter spawn window on stronger tiers => denser, more obvious surge
    const delay = Math.random() * tier.window;
    drop.style.setProperty("--size", `${size}px`);
    drop.style.setProperty("--x", `${startX}%`);
    drop.style.setProperty("--y", `${startY}%`);
    drop.style.setProperty("--dx", `${dx}px`);
    drop.style.setProperty("--dy", `${dy}px`);
    drop.style.setProperty("--duration", `${duration}ms`);
    drop.style.setProperty("--peak", String(tier.opacity));
    drop.style.animationDelay = `${delay}ms`;
    co2Layer.append(drop);
    drop.addEventListener("animationend", () => drop.remove());
  }
}

// --- timers / idle hints / auto reset ---------------------------------------

function clearHintTimers() {
  window.clearTimeout(idleTimer);
  window.clearTimeout(resetWarningTimer);
  window.clearTimeout(resetTimer);
}

function clearAllTimers() {
  clearHintTimers();
  window.clearTimeout(co2FinishTimer);
  window.clearTimeout(co2EnterTimer);
}

function armTimers() {
  clearHintTimers();

  idleTimer = window.setTimeout(() => {
    const idle = experiment.lastAction === "init" || experiment.lastAction === "reset";
    if (idle && experiment.hintTarget !== "lamp") {
      experiment = { ...experiment, hintTarget: "lamp" };
      syncStage();
    }
  }, IDLE_HINT_MS);

  resetWarningTimer = window.setTimeout(() => {
    experiment = { ...experiment, resetWarning: true };
    syncStage();
  }, RESET_WARNING_MS);

  resetTimer = window.setTimeout(runReset, AUTO_RESET_MS);
}

// Discoverability: gently breathe the slider + soda can until the visitor first
// interacts, so it reads as "these are touchable" without turning them into
// buttons. Cleared on the first real light/CO2 action.
function clearFreshHint() {
  if (stage.dataset.fresh === "true") stage.dataset.fresh = "false";
}

function touchActivity() {
  armTimers();
}

// --- stage sync -------------------------------------------------------------

const FISH_MOOD = {
  scarce: "weak",
  low: "weak",
  medium: "recovering",
  plateau: "recovering",
  rich: "recovering",
  abundant: "active"
};

// syncStage updates the visual scene + the live setup caption. Pass an explicit
// caption to override (pour transition, result phase). During setup the caption
// objectively describes the tank by response strength.
function syncStage(overrideCaption) {
  const bubbleLevel = getBubbleLevel(experiment);
  const responseLevel = getResponseLevel(experiment);
  // Vigor (0..1, oxygen-derived) drives the procedural overlay so all 6 states
  // are distinct; the 3-clip video still keys off responseLevel.
  const vigor = getVigorFromState(experiment);
  stage.dataset.light = experiment.light;
  stage.dataset.co2 = String(experiment.co2Added);
  stage.dataset.phase = experiment.phase;
  stage.dataset.response = responseLevel;
  stage.dataset.bubbles = bubbleLevel;
  stage.dataset.fish = FISH_MOOD[bubbleLevel] || "weak";
  stage.dataset.hint = experiment.hintTarget || "";
  // Restrained "liveliness" glow opacity, capped at 0.18 so it never washes out
  // the realistic scene. Scales linearly with vigor.
  stage.style.setProperty("--vigor", String(vigor.toFixed(3)));
  stage.style.setProperty("--vigor-glow", String((vigor * 0.18).toFixed(3)));

  const caption = typeof overrideCaption === "string"
    ? overrideCaption
    : captionForPhase();
  updateCaption(caption);
  showResponseVideo(responseLevel);
  restartBubbleLoop(vigor);
}

// Caption while the soda is pouring — still purely objective (describe the tank).
function pourCaption() {
  return "小苏打颗粒落入水中，水面泛起细小气泡。";
}

// --- interactions -----------------------------------------------------------

// During setup, changing light just updates the live scene + caption. Recording
// only happens when the visitor taps the oxygen card.
function selectLight(light) {
  if (getPhase(experiment) === "result") return; // result phase is read-only
  if (experiment.isAddingCo2) return;
  const sameLight = experiment.light === light;
  if (sameLight && !experiment.hintTarget) return;
  clearFreshHint();
  experiment = setLight(experiment, light);
  touchActivity();
  syncStage();
}

function lightFromPointer(clientY) {
  const rect = lampControl.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
  if (ratio < 1 / 3) return "high";
  if (ratio < 2 / 3) return "mid";
  return "low";
}

function startSliderDrag(event) {
  if (experiment.isAddingCo2) return;
  sliderDragStartY = event.clientY;
  sliderMoved = false;
  lampControl.classList.add("is-dragging");
  lampControl.setPointerCapture?.(event.pointerId);
  selectLight(lightFromPointer(event.clientY));
  event.preventDefault();
}

function moveSliderDrag(event) {
  if (!lampControl.classList.contains("is-dragging")) return;
  if (Math.abs(event.clientY - sliderDragStartY) > 4) sliderMoved = true;
  selectLight(lightFromPointer(event.clientY));
  event.preventDefault();
}

function endSliderDrag(event) {
  lampControl.classList.remove("is-dragging");
  lampControl.releasePointerCapture?.(event.pointerId);
  if (sliderMoved) {
    window.setTimeout(() => {
      sliderMoved = false;
    }, 0);
  }
}

// CO2 is one-way: tapping the soda can adds it once. Re-tapping after it is
// already added gives a light hint and does NOT replay the pour.
function addCo2() {
  if (getPhase(experiment) === "result") return; // result phase is read-only
  if (experiment.co2Added || experiment.isAddingCo2) {
    touchActivity();
    return;
  }

  clearFreshHint();
  const intensity = getCo2Intensity(experiment.light);
  // Result oxygen of "this light + CO2 added" drives how big the dissolve surge
  // looks (high+CO2 = strongest), kept consistent with the bubble vigor scale.
  const dissolveScale = getCo2DissolveScale(experiment.light);
  experiment = startCo2(experiment);
  touchActivity();
  syncStage(pourCaption());

  playPourVideo();
  // #4: hold the dissolve until the powder column begins to fade out, so the
  // dissolving particles aren't drowned by the bright pour. Was 0.8s (overlapped
  // the powder); now ~2.7s into the ~4.09s clip.
  window.clearTimeout(co2EnterTimer);
  co2EnterTimer = window.setTimeout(() => {
    if (experiment.isAddingCo2 || experiment.co2Added) playCo2Dissolve(intensity, dissolveScale);
  }, CO2_DISSOLVE_DELAY_MS);

  window.clearTimeout(co2FinishTimer);
  co2FinishTimer = window.setTimeout(() => {
    experiment = finishCo2(experiment);
    touchActivity();
    syncStage();
  }, CO2_FINISH_MS);
}

function runReset() {
  clearAllTimers();
  stopPour();
  resetFade.classList.add("is-active");
  window.setTimeout(() => {
    experiment = resetExperiment(); // already at setup1 baseline, experiments []
    co2Layer.innerHTML = "";
    bubbleLayer.innerHTML = "";
    renderResultsUi();
    renderSetupPrompt();
    stage.dataset.fresh = "true";
    resetFade.classList.remove("is-active");
    armTimers();
    syncStage(captionForPhase());
  }, POUR_FADE_OUT_MS + 50);
}

// --- wiring -----------------------------------------------------------------

document.querySelectorAll("button[data-light]").forEach((button) => {
  button.addEventListener("click", (event) => {
    if (sliderMoved) {
      event.preventDefault();
      return;
    }
    selectLight(button.dataset.light);
  });
});

lampControl.addEventListener("pointerdown", startSliderDrag);
lampControl.addEventListener("pointermove", moveSliderDrag);
lampControl.addEventListener("pointerup", endSliderDrag);
lampControl.addEventListener("pointercancel", endSliderDrag);
sodaButton.addEventListener("click", addCo2);
if (oxygenChart) oxygenChart.addEventListener("click", tapOxygenCard);
stage.addEventListener("pointerdown", touchActivity);
window.addEventListener("keydown", (event) => {
  if (event.key === "1") selectLight("low");
  if (event.key === "2") selectLight("mid");
  if (event.key === "3") selectLight("high");
  if (event.key.toLowerCase() === "c") addCo2();
  if (event.key.toLowerCase() === "e") tapOxygenCard(); // record / advance phase
  if (event.key.toLowerCase() === "r") runReset();
  if (event.key.toLowerCase() === "p") toggleTuner();
});

// --- PSL-028 pour-video tuning panel (dev only, toggle with P) ---------------
// A non-coder can re-crop / move / scale the soda-pour clip so its own tank
// stops double-exposing on the real aquarium video. Drives the --pour-* CSS
// vars live; the readonly textarea emits a paste-ready :root block. Hidden by
// default, opened only via the P key or ?debug=1 — exhibit visitors never see it.

const TUNER_STORAGE_KEY = "psl.pour.tuner.v1";

// Each param: css var, label, range and the unit suffix shown / written out.
const TUNER_PARAMS = [
  { key: "x", var: "--pour-x", label: "X 位移", min: -50, max: 50, step: 0.5, def: -12, unit: "%" },
  { key: "y", var: "--pour-y", label: "Y 位移", min: -50, max: 50, step: 0.5, def: -6, unit: "%" },
  { key: "scale", var: "--pour-scale", label: "缩放", min: 0.3, max: 2, step: 0.01, def: 1, unit: "" },
  { key: "opacity", var: "--pour-opacity", label: "不透明度", min: 0, max: 1, step: 0.05, def: 1, unit: "" },
  { key: "clipT", var: "--pour-clip-t", label: "裁切 上", min: 0, max: 80, step: 0.5, def: 0, unit: "%" },
  { key: "clipR", var: "--pour-clip-r", label: "裁切 右", min: 0, max: 80, step: 0.5, def: 0, unit: "%" },
  { key: "clipB", var: "--pour-clip-b", label: "裁切 下", min: 0, max: 80, step: 0.5, def: 50.5, unit: "%" },
  { key: "clipL", var: "--pour-clip-l", label: "裁切 左", min: 0, max: 80, step: 0.5, def: 0, unit: "%" }
];

const tunerPanel = document.querySelector("#tuner");
const tunerInputs = new Map(); // key -> range input
let tunerOutput = null;
let glassOutline = null;

function tunerDefaults() {
  const out = {};
  for (const p of TUNER_PARAMS) out[p.key] = p.def;
  return out;
}

// best-effort: file:// may throw on localStorage access; never let it crash.
function loadTunerValues() {
  const defaults = tunerDefaults();
  try {
    const raw = window.localStorage.getItem(TUNER_STORAGE_KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw);
    for (const p of TUNER_PARAMS) {
      if (typeof saved[p.key] === "number" && Number.isFinite(saved[p.key])) {
        defaults[p.key] = saved[p.key];
      }
    }
  } catch (_err) {
    /* file:// or private mode — ignore and use defaults. */
  }
  return defaults;
}

function saveTunerValues() {
  const values = {};
  for (const [key, input] of tunerInputs) values[key] = Number(input.value);
  try {
    window.localStorage.setItem(TUNER_STORAGE_KEY, JSON.stringify(values));
  } catch (_err) {
    /* file:// or private mode — persistence is best-effort. */
  }
}

function formatTunerValue(param, value) {
  const num = param.step < 1 ? Number(value).toFixed(2) : String(Number(value));
  return param.unit ? `${num}${param.unit}` : num;
}

function applyTunerParam(param, value) {
  document.documentElement.style.setProperty(param.var, `${value}${param.unit}`);
}

function refreshTunerOutput() {
  if (!tunerOutput) return;
  const parts = TUNER_PARAMS.map((p) => {
    const value = tunerInputs.get(p.key).value;
    return `${p.var}: ${value}${p.unit};`;
  });
  // group: transform/opacity line, then the four clip edges on a second line.
  tunerOutput.value = `${parts.slice(0, 4).join(" ")}\n${parts.slice(4).join(" ")}`;
}

function applyAllTunerValues() {
  for (const p of TUNER_PARAMS) {
    const input = tunerInputs.get(p.key);
    applyTunerParam(p, input.value);
    const valEl = input.parentElement.querySelector(".tuner-val");
    if (valEl) valEl.textContent = formatTunerValue(p, input.value);
  }
  refreshTunerOutput();
}

// --- pin helper: keep the pour clip visible + looping while tuning -----------
function setPourPinned(on) {
  if (on) {
    pourVideo.loop = true;
    pourVideo.classList.add("is-pinned");
    const src = `${VIDEO_BASE}${POUR_VIDEO.file}`;
    if (pourVideo.dataset.src !== src) {
      pourVideo.dataset.src = src;
      pourVideo.src = src;
      pourVideo.load();
    }
    pourVideo.play().catch(() => {});
  } else {
    pourVideo.loop = false;
    pourVideo.classList.remove("is-pinned");
    // only stop if a real pour isn't currently mid-play
    if (!pourVideo.classList.contains("is-playing")) pourVideo.pause();
  }
}

function setGlassOutline(on) {
  if (on && !glassOutline) {
    glassOutline = document.createElement("div");
    glassOutline.className = "glass-outline";
    stage.append(glassOutline);
  } else if (!on && glassOutline) {
    glassOutline.remove();
    glassOutline = null;
  }
}

function setPourBlend(useScreen) {
  pourVideo.style.mixBlendMode = useScreen ? "screen" : "normal";
}

function buildTuner() {
  if (!tunerPanel) return;
  const values = loadTunerValues();

  const title = document.createElement("p");
  title.className = "tuner-title";
  title.textContent = "倒粉视频调参（按 P 关闭）";
  tunerPanel.append(title);

  const hint = document.createElement("p");
  hint.className = "tuner-hint";
  hint.textContent = "拖滑杆实时改画面，底部数值可手动选中复制进 styles.css。";
  tunerPanel.append(hint);

  for (const p of TUNER_PARAMS) {
    const row = document.createElement("div");
    row.className = "tuner-row";

    const label = document.createElement("label");
    label.textContent = p.label;

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(p.min);
    input.max = String(p.max);
    input.step = String(p.step);
    input.value = String(values[p.key]);

    const val = document.createElement("span");
    val.className = "tuner-val";
    val.textContent = formatTunerValue(p, input.value);

    input.addEventListener("input", () => {
      applyTunerParam(p, input.value);
      val.textContent = formatTunerValue(p, input.value);
      refreshTunerOutput();
      saveTunerValues();
    });

    row.append(label, input, val);
    tunerPanel.append(row);
    tunerInputs.set(p.key, input);
  }

  // --- toggles ---
  const toggles = document.createElement("div");
  toggles.className = "tuner-toggles";

  function addToggle(text, onChange) {
    const wrap = document.createElement("label");
    wrap.className = "tuner-toggle";
    const box = document.createElement("input");
    box.type = "checkbox";
    const span = document.createElement("span");
    span.textContent = text;
    box.addEventListener("change", () => onChange(box.checked));
    wrap.append(box, span);
    toggles.append(wrap);
    return box;
  }

  addToggle("显示鱼缸轮廓", setGlassOutline);
  addToggle("钉住倒粉视频（循环常驻）", setPourPinned);
  const blendBox = addToggle("倒粉混合模式 screen（取消则 normal）", (on) => setPourBlend(on));
  blendBox.checked = true; // default screen, matches the live CSS

  tunerPanel.append(toggles);

  // --- output textarea (selectable; no clipboard button under file://) ---
  tunerOutput = document.createElement("textarea");
  tunerOutput.className = "tuner-output";
  tunerOutput.readOnly = true;
  tunerOutput.spellcheck = false;
  tunerOutput.addEventListener("focus", () => tunerOutput.select());
  tunerPanel.append(tunerOutput);

  // --- reset ---
  const actions = document.createElement("div");
  actions.className = "tuner-actions";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "tuner-btn";
  resetBtn.textContent = "重置默认值";
  resetBtn.addEventListener("click", () => {
    const defaults = tunerDefaults();
    for (const p of TUNER_PARAMS) {
      tunerInputs.get(p.key).value = String(defaults[p.key]);
    }
    applyAllTunerValues();
    saveTunerValues();
  });
  actions.append(resetBtn);
  tunerPanel.append(actions);

  applyAllTunerValues();
}

function toggleTuner() {
  if (!tunerPanel) return;
  tunerPanel.classList.toggle("is-open");
}

// --- boot -------------------------------------------------------------------

// D-2: bind the pour "ended" handler exactly once here (not inside playPourVideo,
// which would stack a new listener on every CO2 add). The pour video is ~4.09s;
// without this, only the 4500ms safety timer removed the layer, leaving a ~400ms
// residual frame after the video naturally ended.
pourVideo.addEventListener("ended", onPourEnded);

// D-1: preload all 3 response videos up front. low fills the active buffer; mid
// and high are warmed into a small src cache so switching never re-fetches under
// load (closes the cross-fade race + kills ERR_ABORTED console noise).
function preloadAllAquariumVideos() {
  for (const level of RESPONSE_LEVELS) {
    const video = getAquariumVideo(level);
    const src = `${VIDEO_BASE}${video.file}`;
    const warm = document.createElement("video");
    warm.muted = true;
    warm.preload = "auto";
    warm.playsInline = true;
    warm.src = src;
    warm.load();
    videoCache.set(video.file, warm);
  }
}

// syncStage() -> showResponseVideo("low") loads the low buffer into idleBuffer,
// fades it in and promotes it to active. No special-case boot path needed.
(function boot() {
  preloadAllAquariumVideos();
  buildTuner();
  // Convenience: ?debug=1 already shows the asset overlay; also open the tuner.
  if (stage.dataset.debug === "true") toggleTuner();
  stage.dataset.fresh = "true";
  renderResultsUi();
  renderSetupPrompt();
  // Bottom caption boots with the objective low-light tank state; the operation
  // guidance shows in the top prompt (renderSetupPrompt) instead.
  syncStage(captionForPhase());
  armTimers();
})();
})();
