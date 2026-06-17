const scenePanels = [...document.querySelectorAll("[data-scene-panel]")];
const actionButtons = [...document.querySelectorAll("[data-action]")];
const weaponCards = [...document.querySelectorAll(".weapon-card")];
const characterStill = document.getElementById("characterStill");
const weaponVideo = document.getElementById("weaponVideo");
const armScan = document.getElementById("armScan");
const equipButton = document.getElementById("equipButton");
const weaponName = document.getElementById("weaponName");
const weaponPreview = document.getElementById("weaponPreview");
const matchVideo = document.getElementById("matchVideo");
const matchStateStill = document.getElementById("matchStateStill");
const gameplayStill = document.getElementById("gameplayStill");
const soundToggle = document.getElementById("soundToggle");
const menuScene = document.querySelector('[data-scene-panel="menu"]');
const startMatchButton = document.querySelector('[data-action="start-match"]');

const sceneVideos = [...document.querySelectorAll(".scene video")];

const weaponData = {
  default: {
    name: "KINETIC CANNON",
    still: "./assets/concept/customization-hero.png",
    part: "./assets/ui/weapon-parts/default-cannon.png",
    video: "",
    matchVideo: "./assets/seedance-shots/10-match-default/match-default.mp4",
    endStill: "./assets/ui/match-end-stills/default.png",
    stats: [72, 64, 58, 69],
  },
  rail: {
    name: "RAIL LANCE",
    still: "./assets/concept/weapon-rail-lance.png",
    part: "./assets/ui/weapon-parts/rail-lance.png",
    video: "./assets/seedance-shots/02-weapon-switch-rail/weapon-switch-rail.mp4",
    matchVideo: "./assets/seedance-shots/11-match-rail/match-rail.mp4",
    endStill: "./assets/ui/match-end-stills/rail.png",
    stats: [88, 91, 32, 54],
  },
  plasma: {
    name: "PLASMA CASTER",
    still: "./assets/concept/weapon-plasma-caster.png",
    part: "./assets/ui/weapon-parts/plasma-caster.png",
    video: "./assets/seedance-shots/03-weapon-switch-plasma/weapon-switch-plasma.mp4",
    matchVideo: "./assets/seedance-shots/12-match-plasma/match-plasma.mp4",
    endStill: "./assets/ui/match-end-stills/plasma.png",
    stats: [94, 52, 41, 47],
  },
  arc: {
    name: "ARC CLAW",
    still: "./assets/concept/weapon-arc-claw.png",
    part: "./assets/ui/weapon-parts/arc-claw.png",
    video: "./assets/seedance-shots/04-weapon-switch-arc-claw/weapon-switch-arc-claw.mp4",
    matchVideo: "./assets/seedance-shots/13-match-arc/match-arc.mp4",
    endStill: "./assets/ui/match-end-stills/arc.png",
    stats: [81, 28, 76, 83],
  },
};

const statIds = ["statDamage", "statRange", "statRate", "statStability"];
let audio;
let selectedWeapon = "default";
let equippedWeapon = "default";
let matchStarting = false;

Object.values(weaponData).forEach((weapon) => {
  if (!weapon.endStill) return;
  const image = new Image();
  image.src = weapon.endStill;
});

function initAudio() {
  if (audio) return audio;
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.16;
  master.connect(ctx.destination);

  const ambience = ctx.createGain();
  ambience.gain.value = 0.2;
  ambience.connect(master);

  [42, 57, 86].forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = index === 0 ? "sine" : "triangle";
    osc.frequency.value = freq;
    gain.gain.value = index === 0 ? 0.38 : 0.08;
    osc.connect(gain);
    gain.connect(ambience);
    osc.start();
  });

  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.08;
  lfoGain.gain.value = 0.05;
  lfo.connect(lfoGain);
  lfoGain.connect(ambience.gain);
  lfo.start();

  audio = { ctx, master };
  return audio;
}

function setAudioEnabled(enabled) {
  const engine = initAudio();
  engine.ctx.resume();
  engine.master.gain.cancelScheduledValues(engine.ctx.currentTime);
  engine.master.gain.linearRampToValueAtTime(enabled ? 0.16 : 0, engine.ctx.currentTime + 0.18);
  soundToggle.classList.toggle("is-on", enabled);
  soundToggle.textContent = enabled ? "AUDIO ON" : "AUDIO OFF";
}

function playTone(type = "click") {
  if (!audio || audio.master.gain.value === 0) return;
  const { ctx, master } = audio;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  const settings = {
    click: [520, 0.045, 0.08, "square"],
    equip: [110, 0.22, 0.26, "sawtooth"],
    match: [64, 0.36, 0.44, "triangle"],
  }[type];

  osc.type = settings[3];
  osc.frequency.setValueAtTime(settings[0], now);
  osc.frequency.exponentialRampToValueAtTime(settings[0] * 0.62, now + settings[2]);
  gain.gain.setValueAtTime(settings[1], now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + settings[2]);
  osc.connect(gain);
  gain.connect(master);
  osc.start(now);
  osc.stop(now + settings[2] + 0.02);
}

function setScene(name, options = {}) {
  document.querySelector(".app")?.setAttribute("data-scene", name);
  const keepMatchMedia = options.keepMatchMedia && name !== "match";

  if (name !== "match" && !keepMatchMedia) {
    matchStarting = false;
    matchStateStill.classList.remove("is-visible", "is-dissolving");
    matchVideo.classList.remove("is-visible");
    matchVideo.pause();
  }

  scenePanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.scenePanel === name);
  });

  sceneVideos.forEach((video) => {
    const active = video.closest(".scene")?.dataset.scenePanel === name;
    if (active && (video.autoplay || video.loop)) {
      video.play().catch(() => {});
    } else if (!active && video !== weaponVideo && !(keepMatchMedia && video === matchVideo)) {
      video.pause();
    }
  });
}

function playMatch() {
  if (matchStarting) return;
  matchStarting = true;
  playTone("match");
  const weapon = weaponData[equippedWeapon] || weaponData[selectedWeapon] || weaponData.default;
  gameplayStill.src = weapon.endStill || weapon.still;
  if (weapon.matchVideo && matchVideo.dataset.currentSrc !== weapon.matchVideo) {
    matchVideo.src = weapon.matchVideo;
    matchVideo.dataset.currentSrc = weapon.matchVideo;
    matchVideo.load();
  }
  matchStateStill.src = weapon.still;
  matchStateStill.classList.remove("is-dissolving");
  matchStateStill.classList.add("is-visible");
  matchVideo.classList.remove("is-visible");
  matchVideo.pause();
  matchVideo.currentTime = 0;
  setScene("match");
  window.setTimeout(() => {
    matchStateStill.classList.add("is-dissolving");
    matchVideo.classList.add("is-visible");
    matchVideo.play().catch(() => {});
  }, 720);
}

window.startMatchDemo = playMatch;
window.goCustomizeDemo = () => setScene("customize");

function updateStats(stats) {
  statIds.forEach((id, index) => {
    const label = document.getElementById(id);
    const bar = label.parentElement.nextElementSibling.firstElementChild;
    label.textContent = stats[index];
    bar.style.setProperty("--value", `${stats[index]}%`);
  });
}

function triggerArmScan() {
  armScan.classList.remove("is-active");
  void armScan.offsetWidth;
  armScan.classList.add("is-active");
}

function selectWeapon(key) {
  const weapon = weaponData[key];
  if (!weapon) return;
  selectedWeapon = key;
  equippedWeapon = key;

  weaponCards.forEach((card) => {
    card.classList.toggle("is-active", card.dataset.weapon === key);
    card.classList.toggle("is-equipped", card.dataset.weapon === equippedWeapon);
  });

  weaponName.textContent = weapon.name;
  weaponPreview.src = weapon.part;
  updateStats(weapon.stats);
  equipButton.textContent = "EQUIPPED";
  playTone(key === "default" ? "click" : "equip");

  if (!weapon.video) {
    characterStill.src = weapon.still;
    weaponVideo.classList.remove("is-playing");
    return;
  }

  triggerArmScan();
  weaponVideo.src = weapon.video;
  weaponVideo.currentTime = 0;
  weaponVideo.classList.add("is-playing");
  weaponVideo.play().catch(() => {
    characterStill.src = weapon.still;
    weaponVideo.classList.remove("is-playing");
  });

  weaponVideo.onended = () => {
    characterStill.src = weapon.still;
    weaponVideo.classList.remove("is-playing");
  };
}

function runAction(action) {
  playTone("click");
  if (action === "go-menu") setScene("menu");
  if (action === "go-customize") setScene("customize");
  if (action === "start-match") playMatch();
  if (action === "go-product") setScene("product");
}

let lastActionAt = 0;

function handleActionEvent(event) {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  event.preventDefault();
  const now = performance.now();
  if (now - lastActionAt < 120) return;
  lastActionAt = now;
  runAction(actionButton.dataset.action);
}

document.addEventListener("pointerdown", handleActionEvent);
document.addEventListener("click", handleActionEvent);

startMatchButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.stopPropagation();
  playMatch();
});

startMatchButton.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  playMatch();
});

startMatchButton.addEventListener("focus", () => {
  playMatch();
});

menuScene.addEventListener("click", (event) => {
  if (event.target.closest("#soundToggle")) return;
  if (event.target.closest("button") && !event.target.dataset.action) return;
  setScene("customize");
});

weaponCards.forEach((card) => {
  card.addEventListener("click", () => selectWeapon(card.dataset.weapon));
});

equipButton.addEventListener("click", () => {
  equippedWeapon = selectedWeapon;
  equipButton.textContent = "EQUIPPED";
  weaponCards.forEach((card) => {
    card.classList.toggle("is-equipped", card.dataset.weapon === equippedWeapon);
  });
  triggerArmScan();
  playTone("equip");
});

soundToggle.addEventListener("click", () => {
  const next = !soundToggle.classList.contains("is-on");
  setAudioEnabled(next);
  playTone("click");
});

matchVideo.addEventListener("ended", () => {
  const weapon = weaponData[equippedWeapon] || weaponData[selectedWeapon] || weaponData.default;
  gameplayStill.src = weapon.endStill || weapon.still;
  matchStarting = false;
  setScene("gameplay", { keepMatchMedia: true });
  window.setTimeout(() => {
    matchStateStill.classList.remove("is-visible", "is-dissolving");
    matchVideo.classList.remove("is-visible");
    matchVideo.pause();
  }, 620);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setScene("menu");
  if (event.key.toLowerCase() === "c") setScene("customize");
  if (event.key.toLowerCase() === "b") setScene("customize");
  if (event.key.toLowerCase() === "m") playMatch();
  if (event.key.toLowerCase() === "g") setScene("gameplay");
});

weaponCards.forEach((card) => {
  card.classList.toggle("is-equipped", card.dataset.weapon === equippedWeapon);
});
