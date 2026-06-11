const STORAGE_SETTINGS = "taperSettings";
const STORAGE_USAGE = "taperUsage";
const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "count",
  countLimit: 200,
  timeLimitMinutes: 90,
  hintEveryCount: 10,
  hintEveryMinutes: 10,
  activityGraceSeconds: 90
};

const DEFAULT_USAGE = {
  countEvents: [],
  timeBuckets: [],
  lastCountHintStep: 0,
  lastTimeHintStep: 0
};

const fields = {
  enabled: document.getElementById("enabled"),
  countLimit: document.getElementById("countLimit"),
  timeLimitMinutes: document.getElementById("timeLimitMinutes"),
  hintEveryCount: document.getElementById("hintEveryCount"),
  hintEveryMinutes: document.getElementById("hintEveryMinutes"),
  statusLine: document.getElementById("statusLine"),
  reset: document.getElementById("reset"),
  modes: Array.from(document.querySelectorAll("[data-mode]"))
};

let settings = { ...DEFAULT_SETTINGS };
let saveTimer = 0;

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
    minutes: Math.floor(clean.timeBuckets.reduce((total, bucket) => total + bucket.ms, 0) / 60000)
  };
}

async function getStored() {
  const stored = await chrome.storage.local.get([STORAGE_SETTINGS, STORAGE_USAGE]);
  return {
    settings: { ...DEFAULT_SETTINGS, ...(stored[STORAGE_SETTINGS] || {}) },
    usage: pruneUsage(stored[STORAGE_USAGE])
  };
}

function readSettingsFromUI() {
  return {
    ...settings,
    enabled: fields.enabled.checked,
    countLimit: clampNumber(fields.countLimit.value, 1, 9999, DEFAULT_SETTINGS.countLimit),
    timeLimitMinutes: clampNumber(fields.timeLimitMinutes.value, 1, 1440, DEFAULT_SETTINGS.timeLimitMinutes),
    hintEveryCount: clampNumber(fields.hintEveryCount.value, 0, 9999, DEFAULT_SETTINGS.hintEveryCount),
    hintEveryMinutes: clampNumber(fields.hintEveryMinutes.value, 0, 1440, DEFAULT_SETTINGS.hintEveryMinutes)
  };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function renderSettings(nextSettings) {
  settings = { ...DEFAULT_SETTINGS, ...nextSettings };
  fields.enabled.checked = settings.enabled;
  fields.countLimit.value = settings.countLimit;
  fields.timeLimitMinutes.value = settings.timeLimitMinutes;
  fields.hintEveryCount.value = settings.hintEveryCount;
  fields.hintEveryMinutes.value = settings.hintEveryMinutes;
  fields.modes.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === settings.mode);
  });
}

function renderUsage(usage) {
  const summary = summarize(usage);
  fields.statusLine.textContent = `${summary.count} Shorts • ${summary.minutes}m`;
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    settings = readSettingsFromUI();
    await chrome.storage.local.set({ [STORAGE_SETTINGS]: settings });
  }, 120);
}

fields.enabled.addEventListener("change", queueSave);
fields.countLimit.addEventListener("input", queueSave);
fields.timeLimitMinutes.addEventListener("input", queueSave);
fields.hintEveryCount.addEventListener("input", queueSave);
fields.hintEveryMinutes.addEventListener("input", queueSave);

fields.modes.forEach((button) => {
  button.addEventListener("click", () => {
    settings = { ...readSettingsFromUI(), mode: button.dataset.mode };
    renderSettings(settings);
    chrome.storage.local.set({ [STORAGE_SETTINGS]: settings });
  });
});

fields.reset.addEventListener("click", async () => {
  await chrome.storage.local.set({ [STORAGE_USAGE]: { ...DEFAULT_USAGE } });
  renderUsage(DEFAULT_USAGE);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE_SETTINGS]) renderSettings(changes[STORAGE_SETTINGS].newValue);
  if (changes[STORAGE_USAGE]) renderUsage(changes[STORAGE_USAGE].newValue);
});

getStored().then(({ settings: storedSettings, usage }) => {
  renderSettings(storedSettings);
  renderUsage(usage);
  chrome.storage.local.set({
    [STORAGE_SETTINGS]: storedSettings,
    [STORAGE_USAGE]: usage
  });
});
