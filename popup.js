const STORAGE_SETTINGS = "taperSettings";
const STORAGE_USAGE = "taperUsage";
const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;
const EDIT_WINDOW_MS = 30 * 1000;
const PAUSE_MS = 5 * 60 * 1000;
const EDIT_LOCK_RATIO = 0.8;

const DEFAULT_SETTINGS = {
  enabled: true,
  pipEnabled: true,
  mode: "count",
  countLimit: 200,
  timeLimitMinutes: 90,
  hintEveryCount: 10,
  hintEveryMinutes: 10,
  hintDurationSeconds: 5,
  loopPromptLimit: 10,
  activityGraceSeconds: 90,
  pausedUntil: 0
};

const DEFAULT_USAGE = {
  countEvents: [],
  timeBuckets: [],
  lastCountHintStep: 0,
  lastTimeHintStep: 0
};

const fields = {
  pipEnabled: document.getElementById("pipEnabled"),
  mode: document.getElementById("mode"),
  countLimit: document.getElementById("countLimit"),
  timeLimitMinutes: document.getElementById("timeLimitMinutes"),
  hintEveryCount: document.getElementById("hintEveryCount"),
  hintEveryMinutes: document.getElementById("hintEveryMinutes"),
  hintDurationSeconds: document.getElementById("hintDurationSeconds"),
  loopPromptLimit: document.getElementById("loopPromptLimit"),
  statusLine: document.getElementById("statusLine"),
  edit: document.getElementById("edit"),
  pause: document.getElementById("pause")
};

const shortsFields = [
  fields.mode,
  fields.countLimit,
  fields.timeLimitMinutes,
  fields.hintEveryCount,
  fields.hintEveryMinutes,
  fields.hintDurationSeconds,
  fields.loopPromptLimit
];

const editableFields = [
  fields.pipEnabled,
  ...shortsFields
];

let settings = { ...DEFAULT_SETTINGS };
let saveTimer = 0;
let editTimer = 0;
let pauseTimer = 0;
let editing = false;
let usageSummary = { count: 0, timeMs: 0 };

function pruneUsage(usage) {
  const cutoff = Date.now() - ROLLING_WINDOW_MS;
  const next = {
    ...DEFAULT_USAGE,
    ...(usage || {})
  };
  next.countEvents = Array.isArray(next.countEvents)
    ? next.countEvents.filter((event) => event && event.t >= cutoff)
    : [];
  next.timeBuckets = Array.isArray(next.timeBuckets)
    ? next.timeBuckets.filter((bucket) => bucket && bucket.t >= cutoff && bucket.ms > 0)
    : [];
  return next;
}

function summarize(usage) {
  const clean = pruneUsage(usage);
  return {
    count: clean.countEvents.length,
    timeMs: clean.timeBuckets.reduce((total, bucket) => total + bucket.ms, 0)
  };
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function getStored() {
  const stored = await chrome.storage.local.get([STORAGE_SETTINGS, STORAGE_USAGE]);
  return {
    settings: { ...DEFAULT_SETTINGS, ...(stored[STORAGE_SETTINGS] || {}) },
    usage: pruneUsage(stored[STORAGE_USAGE])
  };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function readSettingsFromUI() {
  return {
    ...settings,
    enabled: true,
    pipEnabled: fields.pipEnabled.checked,
    mode: fields.mode.value,
    countLimit: clampNumber(fields.countLimit.value, 1, 9999, DEFAULT_SETTINGS.countLimit),
    timeLimitMinutes: clampNumber(fields.timeLimitMinutes.value, 1, 1440, DEFAULT_SETTINGS.timeLimitMinutes),
    hintEveryCount: clampNumber(fields.hintEveryCount.value, 0, 9999, DEFAULT_SETTINGS.hintEveryCount),
    hintEveryMinutes: clampNumber(fields.hintEveryMinutes.value, 0, 1440, DEFAULT_SETTINGS.hintEveryMinutes),
    hintDurationSeconds: clampNumber(fields.hintDurationSeconds.value, 1, 60, DEFAULT_SETTINGS.hintDurationSeconds),
    loopPromptLimit: clampNumber(fields.loopPromptLimit.value, 1, 100, DEFAULT_SETTINGS.loopPromptLimit)
  };
}

function setEditing(nextEditing) {
  editing = nextEditing;
  fields.pipEnabled.disabled = !editing;
  shortsFields.forEach((field) => {
    field.disabled = !editing;
  });
  if (isEditLocked()) {
    shortsFields.forEach((field) => {
      field.disabled = true;
    });
  }
  fields.edit.textContent = editing ? "Done" : "Edit";
  fields.edit.classList.toggle("editing", editing);
  clearTimeout(editTimer);
  if (editing) editTimer = setTimeout(() => setEditing(false), EDIT_WINDOW_MS);
}

function isEditLocked() {
  const countRatio = usageSummary.count / Math.max(1, settings.countLimit);
  const timeRatio = usageSummary.timeMs / Math.max(1, settings.timeLimitMinutes * 60 * 1000);
  return countRatio >= EDIT_LOCK_RATIO || timeRatio >= EDIT_LOCK_RATIO;
}

function renderSettings(nextSettings) {
  settings = { ...DEFAULT_SETTINGS, ...nextSettings, enabled: true };
  fields.pipEnabled.checked = settings.pipEnabled;
  fields.mode.value = settings.mode;
  fields.countLimit.value = settings.countLimit;
  fields.timeLimitMinutes.value = settings.timeLimitMinutes;
  fields.hintEveryCount.value = settings.hintEveryCount;
  fields.hintEveryMinutes.value = settings.hintEveryMinutes;
  fields.hintDurationSeconds.value = settings.hintDurationSeconds;
  fields.loopPromptLimit.value = settings.loopPromptLimit;
  setEditing(editing);
  renderPause();
}

function renderUsage(usage) {
  usageSummary = summarize(usage);
  fields.statusLine.textContent = `${usageSummary.count} Shorts • ${formatDuration(usageSummary.timeMs)}`;
  setEditing(editing);
}

function renderPause() {
  clearTimeout(pauseTimer);
  const remaining = Math.max(0, settings.pausedUntil - Date.now());
  fields.pause.classList.toggle("paused", remaining > 0);
  fields.pause.textContent = remaining > 0 ? `Paused ${Math.ceil(remaining / 60000)}m` : "Pause 5m";
  if (remaining > 0) {
    pauseTimer = setTimeout(renderPause, Math.min(remaining, 15 * 1000));
  }
}

function queueSave() {
  if (!editing) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    settings = readSettingsFromUI();
    await chrome.storage.local.set({ [STORAGE_SETTINGS]: settings });
  }, 120);
}

editableFields.forEach((field) => {
  field.addEventListener("input", queueSave);
  field.addEventListener("change", queueSave);
});

fields.edit.addEventListener("click", async () => {
  if (editing) {
    settings = readSettingsFromUI();
    await chrome.storage.local.set({ [STORAGE_SETTINGS]: settings });
    setEditing(false);
    return;
  }
  setEditing(true);
});

fields.pause.addEventListener("click", async () => {
  settings = {
    ...settings,
    enabled: true,
    pausedUntil: Date.now() + PAUSE_MS
  };
  await chrome.storage.local.set({ [STORAGE_SETTINGS]: settings });
  renderPause();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE_SETTINGS]) renderSettings(changes[STORAGE_SETTINGS].newValue);
  if (changes[STORAGE_USAGE]) renderUsage(changes[STORAGE_USAGE].newValue);
});

getStored().then(({ settings: storedSettings, usage }) => {
  renderSettings(storedSettings);
  renderUsage(usage);
  setEditing(false);
  chrome.storage.local.set({
    [STORAGE_SETTINGS]: settings,
    [STORAGE_USAGE]: usage
  });
});
