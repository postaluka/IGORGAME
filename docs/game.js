// Гра «ІГОР»: влучи по літерах, що літають у біт музики, у правильному порядку і на час.
"use strict";

const WORD = ["І", "Г", "О", "Р"];
// Зайві літери, з яких щораунду випадково беруться обманки
const DECOY_POOL = ["А", "Б", "В", "Д", "Е", "Ж", "З", "И", "К", "Л", "М", "Н", "П", "С", "Т", "У", "Ф", "Х", "Ш", "Я", "Ї", "Є"];

// speed — частка ширини поля за секунду
const LEVELS = [
  { id: "easy",   name: "Легко",     speed: 0.07, decoys: 4 },
  { id: "normal", name: "Нормально", speed: 0.14, decoys: 6 },
  { id: "hard",   name: "Важко",     speed: 0.23, decoys: 8 },
  { id: "hell",   name: "Пекло 🔥",  speed: 0.34, decoys: 10 },
];

const FALLBACK_BPM = 124;     // темп треку, якщо браузер не дає слухати звук
const RECORDS_KEY = "igor-records-v1";
const NAME_KEY = "igor-player-name";
const PREFS_KEY = "igor-level";
const MAX_RECORDS = 10;

const $ = (id) => document.getElementById(id);
const screens = ["menu", "play", "records", "bye"];

let level = LEVELS[1];
let keys = [];          // {el, letter, x, y, vx, vy, boost, used}
let typed = [];
let over = false;
let startTime = 0;
let finalTime = 0;
let lastFrame = 0;
let recordsLevel = level.id;
let lastSaved = null;   // щоб підсвітити свій щойно збережений рядок

// ---------- Збереження в браузері (може бути недоступне) ----------
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* приватний режим тощо */ }
}

// ---------- Екрани ----------
function show(name) {
  for (const s of screens) $(s).hidden = s !== name;
  if (name !== "play") $("result").hidden = true;
}

// ---------- Вибір рівня ----------
function buildLevelChips() {
  const saved = load(PREFS_KEY, "normal");
  level = LEVELS.find((l) => l.id === saved) || LEVELS[1];
  const box = $("levels");
  for (const l of LEVELS) {
    const b = document.createElement("button");
    b.className = "chip";
    b.type = "button";
    b.id = "level-" + l.id;
    b.setAttribute("role", "radio");
    b.textContent = l.name;
    b.addEventListener("click", () => { level = l; save(PREFS_KEY, l.id); syncChips(); });
    box.appendChild(b);
  }
  syncChips();
}
function syncChips() {
  for (const l of LEVELS) $("level-" + l.id).setAttribute("aria-checked", String(l === level));
}

// ---------- Музика і пошук біту ----------
const music = $("music");
music.volume = 0.8;
let audioCtx = null, analyser = null, samples = null;
let avgLevel = 0, lastBeatAt = 0, silentFor = 0, useMetronome = false, lastMetroBeat = -1;

function startMusic() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaElementSource(music);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      samples = new Float32Array(analyser.fftSize);
      src.connect(analyser);
      analyser.connect(audioCtx.destination);
    } catch {
      useMetronome = true;
    }
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  music.play().catch(() => {});
}

function stopMusic() { music.pause(); }

/** Повертає true на ударі барабана: гучність різко вища за середню. */
function detectBeat(dt) {
  if (music.paused) return false;

  if (useMetronome) {
    // Запасний варіант: рівний такт за темпом треку
    const beat = Math.floor(music.currentTime * FALLBACK_BPM / 60);
    if (beat !== lastMetroBeat) { lastMetroBeat = beat; return true; }
    return false;
  }

  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const lvl = Math.sqrt(sum / samples.length);

  // Якщо браузер віддає тишу (наприклад, файл відкрито з диска) — переходимо на такт
  silentFor = lvl === 0 && music.currentTime > 0.5 ? silentFor + dt : 0;
  if (silentFor > 1.5) { useMetronome = true; return false; }

  const now = performance.now();
  const isBeat = lvl > avgLevel * 1.35 && lvl > 0.02 && now - lastBeatAt > 250;
  avgLevel = avgLevel * 0.93 + lvl * 0.07;
  if (isBeat) lastBeatAt = now;
  return isBeat;
}

// ---------- Раунд ----------
function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

function fieldSize() {
  const f = $("field");
  return { w: f.clientWidth, h: f.clientHeight };
}

function keySize() { return keys.length ? keys[0].el.offsetWidth : 72; }

function randomVelocity(w) {
  const a = Math.random() * Math.PI * 2;
  const s = level.speed * w;
  return { vx: Math.cos(a) * s, vy: Math.sin(a) * s };
}

function startGame() {
  $("hud-level").textContent = level.name;
  show("play");
  startMusic();
  newRound();
}

function newRound() {
  typed = [];
  over = false;
  $("result").hidden = true;
  $("status").textContent = "";
  $("status").className = "status";
  updateTyped();

  const field = $("field");
  field.textContent = "";
  const letters = shuffle(WORD.concat(shuffle(DECOY_POOL).slice(0, level.decoys)));
  keys = letters.map((letter) => {
    const el = document.createElement("button");
    el.className = "key";
    el.type = "button";
    el.textContent = letter;
    el.setAttribute("aria-label", "Літера " + letter);
    const k = { el, letter, x: 0, y: 0, vx: 0, vy: 0, boost: 1, used: false };
    // pointerdown спрацьовує одразу, тож по рухомій літері реально влучити
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); press(k); });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); press(k); } });
    field.appendChild(el);
    return k;
  });

  // Розставити без накладань
  const { w, h } = fieldSize();
  const size = keySize();
  const spots = [];
  let tries = 0;
  for (const k of keys) {
    let x, y, ok;
    do {
      tries++;
      const gap = tries > 4000 ? 2 : size * 0.3;
      x = Math.random() * Math.max(1, w - size);
      y = Math.random() * Math.max(1, h - size);
      ok = spots.every((p) => Math.abs(p.x - x) > size + gap || Math.abs(p.y - y) > size + gap);
    } while (!ok && tries < 8000);
    spots.push({ x, y });
    Object.assign(k, { x, y }, randomVelocity(w));
    place(k);
  }

  startTime = performance.now();
  finalTime = 0;
}

function place(k) { k.el.style.transform = `translate(${k.x}px, ${k.y}px)`; }

function press(k) {
  if (over || k.used) return;
  k.used = true;
  k.el.classList.add("used");
  k.el.classList.remove("flash");
  typed.push(k.letter);
  updateTyped();
  if (typed.length === WORD.length) finish();
}

function updateTyped() {
  $("typed").textContent = WORD.map((_, i) => typed[i] || "_").join(" ");
}

function finish() {
  over = true;
  finalTime = (performance.now() - startTime) / 1000;
  $("timer").textContent = finalTime.toFixed(2);
  const won = typed.join("") === WORD.join("");

  const title = $("result-title");
  const status = $("status");
  if (won) {
    title.textContent = "Ти виграв!";
    title.className = "result-title win";
    status.textContent = `🎉 ІГОР за ${finalTime.toFixed(2)} с`;
    status.className = "status win";
    const place = placeFor(finalTime);
    $("result-text").textContent = place
      ? `Час ${finalTime.toFixed(2)} с, рівень «${level.name}». Це ${place}-е місце в таблиці!`
      : `Час ${finalTime.toFixed(2)} с, рівень «${level.name}». До таблиці рекордів не вистачило швидкості.`;
    $("save-form").hidden = !place;
    $("player-name").value = load(NAME_KEY, "");
  } else {
    title.textContent = "Ти програв!";
    title.className = "result-title lose";
    status.textContent = `💥 Вийшло «${typed.join("")}»`;
    status.className = "status lose";
    $("result-text").textContent = `Вийшло «${typed.join("")}» замість «ІГОР». Спробуй ще раз!`;
    $("save-form").hidden = true;
  }
  $("result").hidden = false;
  const focusTarget = won && !$("save-form").hidden ? $("player-name") : $("res-again");
  setTimeout(() => focusTarget.focus(), 50);
}

// ---------- Таблиця рекордів ----------
function allRecords() { return load(RECORDS_KEY, {}); }
function levelRecords(id) { return (allRecords()[id] || []).slice().sort((a, b) => a.time - b.time); }

/** Яке місце займе цей час (1…10), або 0 якщо не потрапляє. */
function placeFor(time) {
  const list = levelRecords(level.id);
  const idx = list.findIndex((r) => time < r.time);
  const place = (idx === -1 ? list.length : idx) + 1;
  return place <= MAX_RECORDS ? place : 0;
}

function saveRecord(name) {
  const all = allRecords();
  const entry = { name, time: Math.round(finalTime * 100) / 100, date: new Date().toISOString(), id: Date.now() };
  all[level.id] = (all[level.id] || []).concat(entry).sort((a, b) => a.time - b.time).slice(0, MAX_RECORDS);
  save(RECORDS_KEY, all);
  save(NAME_KEY, name);
  lastSaved = entry.id;
}

function buildRecordTabs() {
  const box = $("record-tabs");
  for (const l of LEVELS) {
    const b = document.createElement("button");
    b.className = "chip";
    b.type = "button";
    b.id = "rec-tab-" + l.id;
    b.setAttribute("role", "tab");
    b.textContent = l.name;
    b.addEventListener("click", () => { recordsLevel = l.id; renderRecords(); });
    box.appendChild(b);
  }
}

function renderRecords() {
  for (const l of LEVELS) $("rec-tab-" + l.id).setAttribute("aria-selected", String(l.id === recordsLevel));
  const body = $("record-rows");
  body.textContent = "";
  const list = levelRecords(recordsLevel);
  if (!list.length) {
    const tr = body.insertRow();
    const td = tr.insertCell();
    td.colSpan = 4;
    td.className = "empty";
    td.textContent = "Поки порожньо. Збери ІГОР на цьому рівні, і твій час з'явиться тут.";
    return;
  }
  list.forEach((r, i) => {
    const tr = body.insertRow();
    if (r.id === lastSaved) tr.className = "mine";
    tr.insertCell().textContent = String(i + 1);
    tr.insertCell().textContent = r.name;
    const t = tr.insertCell(); t.className = "num"; t.textContent = r.time.toFixed(2) + " с";
    tr.insertCell().textContent = new Date(r.date).toLocaleDateString("uk-UA");
  });
}

let returnTo = "menu";

// ---------- Головний цикл: рух, біт, таймер ----------
function frame(now) {
  const dt = Math.min((now - (lastFrame || now)) / 1000, 0.05);
  lastFrame = now;

  const beat = detectBeat(dt);

  if (!$("play").hidden) {
    if (!over) $("timer").textContent = ((now - startTime) / 1000).toFixed(1);

    const { w, h } = fieldSize();
    const size = keySize();
    for (const k of keys) {
      if (beat) {
        // На удар: літера смикається в новий бік і на мить пришвидшується
        Object.assign(k, randomVelocity(w));
        k.boost = 2.6;
        if (!k.used) {
          k.el.classList.add("flash");
          setTimeout(() => k.el.classList.remove("flash"), 120);
        }
      }
      k.boost = Math.max(1, k.boost - 4 * dt);
      k.x += k.vx * k.boost * dt;
      k.y += k.vy * k.boost * dt;
      // Відскок від стінок
      if (k.x < 0) { k.x = 0; k.vx = Math.abs(k.vx); }
      if (k.x > w - size) { k.x = w - size; k.vx = -Math.abs(k.vx); }
      if (k.y < 0) { k.y = 0; k.vy = Math.abs(k.vy); }
      if (k.y > h - size) { k.y = h - size; k.vy = -Math.abs(k.vy); }
      place(k);
    }
  }
  requestAnimationFrame(frame);
}

// ---------- Кнопки ----------
function wire() {
  $("btn-start").addEventListener("click", startGame);
  $("btn-records").addEventListener("click", () => { returnTo = "menu"; recordsLevel = level.id; renderRecords(); show("records"); });
  $("btn-exit").addEventListener("click", () => { stopMusic(); show("bye"); });
  $("btn-back").addEventListener("click", () => { show("menu"); startMusic(); });

  $("btn-again").addEventListener("click", newRound);
  $("btn-menu").addEventListener("click", () => show("menu"));
  $("res-again").addEventListener("click", newRound);
  $("res-menu").addEventListener("click", () => show("menu"));
  $("res-records").addEventListener("click", () => { returnTo = "menu"; recordsLevel = level.id; renderRecords(); show("records"); });
  $("rec-back").addEventListener("click", () => show(returnTo));

  $("save-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("player-name").value.trim().slice(0, 16);
    if (!name) return;
    saveRecord(name);
    $("save-form").hidden = true;
    returnTo = "menu";
    recordsLevel = level.id;
    renderRecords();
    show("records");
  });

  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === "Escape" && !$("play").hidden) show("menu");
    if (e.key === "Enter" && !$("play").hidden && over && document.activeElement === document.body) newRound();
  });
}

buildLevelChips();
buildRecordTabs();
wire();
show("menu");
requestAnimationFrame(frame);
