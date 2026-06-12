(() => {
  const STORAGE_SETTINGS = "taperSettings";
  const STORAGE_USAGE = "taperUsage";
  const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;
  const TIME_TICK_MS = 1000;
  const DUPLICATE_COUNT_GUARD_MS = 15 * 60 * 1000;

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

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    usage: { ...DEFAULT_USAGE },
    lastShortId: "",
    lastInputAt: Date.now(),
    loopShortId: "",
    loopVideo: null,
    lastVideoTime: 0,
    loopCount: 0,
    presencePromptShortId: "",
    routeTimer: 0,
    tickTimer: 0,
    shortBlockUntil: 0,
    shortBlockTimer: 0,
    backgroundPauseUsed: false,
    pipResizeObserver: null
  };

  function storageGet(keys) {
    return chrome.storage.local.get(keys);
  }

  function storageSet(value) {
    return chrome.storage.local.set(value);
  }

  function pruneUsage(usage) {
    const cutoff = Date.now() - ROLLING_WINDOW_MS;
    const clean = {
      ...DEFAULT_USAGE,
      ...(usage || {})
    };
    clean.countEvents = Array.isArray(clean.countEvents)
      ? clean.countEvents.filter((event) => event && event.t >= cutoff)
      : [];
    clean.timeBuckets = Array.isArray(clean.timeBuckets)
      ? clean.timeBuckets.filter((bucket) => bucket && bucket.t >= cutoff && bucket.ms > 0)
      : [];
    return clean;
  }

  function saveUsage() {
    state.usage = pruneUsage(state.usage);
    return storageSet({ [STORAGE_USAGE]: state.usage });
  }

  function summarize() {
    state.usage = pruneUsage(state.usage);
    return {
      count: state.usage.countEvents.length,
      timeMs: state.usage.timeBuckets.reduce((total, bucket) => total + bucket.ms, 0)
    };
  }

  function getShortId() {
    const match = location.pathname.match(/^\/shorts\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function isShortsPage() {
    return Boolean(getShortId());
  }

  function activeVideo() {
    const videos = Array.from(document.querySelectorAll("video"));
    return videos.find((video) => !video.paused && !video.ended && video.readyState > 2) || null;
  }

  function isRecentlyActive() {
    return Date.now() - state.lastInputAt <= state.settings.activityGraceSeconds * 1000;
  }

  function shouldTrackTime() {
    return (
      isActive() &&
      isShortsPage() &&
      !isShortsFrozen() &&
      document.visibilityState === "visible" &&
      isRecentlyActive() &&
      Boolean(activeVideo())
    );
  }

  function isLimitReached() {
    if (!isActive()) return false;
    const { count, timeMs } = summarize();
    const countReached = count >= state.settings.countLimit;
    const timeReached = timeMs >= state.settings.timeLimitMinutes * 60 * 1000;

    if (state.settings.mode === "count") return countReached;
    if (state.settings.mode === "time") return timeReached;
    if (state.settings.mode === "both") return countReached && timeReached;
    return countReached || timeReached;
  }

  function isPaused() {
    return Date.now() < Number(state.settings.pausedUntil || 0);
  }

  function isActive() {
    return state.settings.enabled && !isPaused();
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

  function ensureStyle() {
    if (document.getElementById("taper-style")) return;
    const style = document.createElement("style");
    style.id = "taper-style";
    style.textContent = `
      body.taper-limit-reached a[title="Shorts"],
      body.taper-limit-reached ytd-guide-entry-renderer:has(a[title="Shorts"]),
      body.taper-limit-reached ytd-mini-guide-entry-renderer:has(a[title="Shorts"]),
      body.taper-limit-reached ytd-rich-section-renderer:has(a[href^="/shorts/"]),
      body.taper-limit-reached ytd-rich-shelf-renderer:has(a[href^="/shorts/"]),
      body.taper-limit-reached ytd-reel-shelf-renderer,
      body.taper-limit-reached ytd-reel-item-renderer,
      body.taper-limit-reached grid-shelf-view-model:has(a[href^="/shorts/"]),
      body.taper-limit-reached ytd-video-renderer:has(a[href^="/shorts/"]),
      body.taper-limit-reached ytd-grid-video-renderer:has(a[href^="/shorts/"]),
      body.taper-limit-reached ytd-compact-video-renderer:has(a[href^="/shorts/"]),
      body.taper-limit-reached ytd-rich-item-renderer:has(a[href^="/shorts/"]),
      body.taper-limit-reached yt-lockup-view-model:has(a[href^="/shorts/"]) {
        display: none !important;
      }

      #taper-meter {
        position: fixed;
        top: 50%;
        left: max(48px, calc(25vw - 248px));
        transform: translateY(-50%);
        z-index: 2147483645;
        display: none;
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        gap: 5px;
        min-height: 34px;
        max-width: min(30vw, 300px);
        padding: 14px 16px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        color: #fff;
        background: rgba(16, 18, 22, 0.56);
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
        backdrop-filter: blur(18px);
        font: 700 19px/1.15 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        pointer-events: none;
      }

      #taper-meter span {
        display: block;
        white-space: nowrap;
      }

      #taper-meter span + span {
        color: rgba(255, 255, 255, 0.68);
        font-size: 16px;
        font-weight: 600;
      }

      body.taper-on-shorts #taper-meter {
        display: flex;
      }

      #taper-overlay,
      #taper-break-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: none;
        place-items: center;
        padding: 20px;
        background: rgba(7, 9, 12, 0.48);
        backdrop-filter: blur(20px);
      }

      body.taper-on-shorts.taper-limit-reached #taper-overlay {
        display: grid;
      }

      body.taper-on-shorts.taper-break-blocked #taper-break-overlay {
        display: grid;
      }

      #taper-presence-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: none;
        place-items: center;
        padding: 20px;
        background: rgba(7, 9, 12, 0.48);
        backdrop-filter: blur(20px);
      }

      body.taper-on-shorts.taper-presence-check #taper-presence-overlay {
        display: grid;
      }

      #taper-card,
      #taper-break-card,
      #taper-presence-card {
        width: min(88vw, 360px);
        padding: 22px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 8px;
        color: #fff;
        background: rgba(20, 23, 29, 0.72);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.42);
        text-align: center;
        font: 600 16px/1.25 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #taper-break-card strong {
        display: block;
        margin-top: 12px;
        color: #89d8c1;
        font-size: 28px;
        line-height: 1;
      }

      #taper-card button,
      #taper-presence-card button {
        margin-top: 16px;
        min-width: 104px;
        min-height: 38px;
        border: 0;
        border-radius: 6px;
        color: #061512;
        background: #89d8c1;
        font: 700 13px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
      }

      @media (max-width: 900px) {
        #taper-meter {
          top: 78px;
          left: 16px;
          transform: none;
          max-width: calc(100vw - 32px);
          font-size: 15px;
        }

        #taper-meter span + span {
          font-size: 13px;
        }

      }
    `;
    document.documentElement.appendChild(style);
  }

  function ensureUi() {
    if (!document.body) return;
    ensureStyle();

    if (!document.getElementById("taper-meter")) {
      const meter = document.createElement("div");
      meter.id = "taper-meter";
      meter.setAttribute("aria-live", "polite");
      document.body.appendChild(meter);
    }

    if (!document.getElementById("taper-overlay")) {
      const overlay = document.createElement("div");
      overlay.id = "taper-overlay";
      overlay.innerHTML = '<div id="taper-card"><div>Shorts limit reached</div><button type="button">Home</button></div>';
      overlay.querySelector("button").addEventListener("click", () => {
        location.href = "/";
      });
      document.body.appendChild(overlay);
    }

    if (!document.getElementById("taper-break-overlay")) {
      const overlay = document.createElement("div");
      overlay.id = "taper-break-overlay";
      overlay.innerHTML = '<div id="taper-break-card"><div id="taper-break-message">Shorts break</div><strong id="taper-break-countdown">5</strong></div>';
      document.body.appendChild(overlay);
    }

    if (!document.getElementById("taper-presence-overlay")) {
      const overlay = document.createElement("div");
      overlay.id = "taper-presence-overlay";

      const card = document.createElement("div");
      card.id = "taper-presence-card";
      const message = document.createElement("div");
      message.textContent = "Still here?";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Resume";
      button.addEventListener("click", resumeFromPresenceCheck);

      card.append(message, button);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    }
  }

  function updateMeter() {
    ensureUi();
    const meter = document.getElementById("taper-meter");
    if (!meter) return;
    const { count, timeMs } = summarize();
    meter.replaceChildren(
      textLine(`Shorts ${count} / ${state.settings.countLimit}`),
      textLine(`${formatDuration(timeMs)} / ${formatDuration(state.settings.timeLimitMinutes * 60 * 1000)}`)
    );
  }

  function textLine(text) {
    const line = document.createElement("span");
    line.textContent = text;
    return line;
  }

  function isTimedShortsBlockActive() {
    return isShortsPage() && Date.now() < state.shortBlockUntil;
  }

  function isShortsFrozen() {
    return isTimedShortsBlockActive() || document.body?.classList.contains("taper-presence-check");
  }

  function updateShortsBlockerUi(message) {
    ensureUi();
    const messageNode = document.getElementById("taper-break-message");
    const countdownNode = document.getElementById("taper-break-countdown");
    const remainingSeconds = Math.max(0, Math.ceil((state.shortBlockUntil - Date.now()) / 1000));
    if (messageNode) messageNode.textContent = message;
    if (countdownNode) countdownNode.textContent = String(remainingSeconds);
  }

  function clearShortsBlocker(shouldResume = true) {
    clearTimeout(state.shortBlockTimer);
    state.shortBlockTimer = 0;
    state.shortBlockUntil = 0;
    document.body?.classList.remove("taper-break-blocked");
    if (shouldResume && isShortsPage() && document.visibilityState === "visible" && !isLimitReached()) {
      const video = document.querySelector("video");
      if (video instanceof HTMLVideoElement) video.play().catch(() => {});
    }
  }

  function showShortsBlocker(message) {
    if (!isActive() || !isShortsPage()) return;
    const durationMs = Math.max(1, state.settings.hintDurationSeconds) * 1000;
    state.shortBlockUntil = Date.now() + durationMs;
    document.body?.classList.add("taper-break-blocked");
    pauseShortsVideo();

    const tick = () => {
      if (!isTimedShortsBlockActive()) {
        clearShortsBlocker();
        applyEnforcement();
        return;
      }

      pauseShortsVideo();
      updateShortsBlockerUi(message);
      state.shortBlockTimer = setTimeout(tick, 250);
    };

    clearTimeout(state.shortBlockTimer);
    tick();
  }

  function maybeShowHints() {
    const { count, timeMs } = summarize();
    const countStep = state.settings.hintEveryCount > 0
      ? Math.floor(count / state.settings.hintEveryCount)
      : 0;
    const timeStep = state.settings.hintEveryMinutes > 0
      ? Math.floor(timeMs / (state.settings.hintEveryMinutes * 60 * 1000))
      : 0;

    if (countStep > state.usage.lastCountHintStep && countStep > 0) {
      state.usage.lastCountHintStep = countStep;
      showShortsBlocker(`${countStep * state.settings.hintEveryCount} Shorts watched`);
      saveUsage();
      return;
    }

    if (timeStep > state.usage.lastTimeHintStep && timeStep > 0) {
      state.usage.lastTimeHintStep = timeStep;
      showShortsBlocker(`${timeStep * state.settings.hintEveryMinutes} minutes on Shorts`);
      saveUsage();
    }
  }

  function pauseShortsVideo() {
    const video = activeVideo() || document.querySelector("video");
    if (video) video.pause();
  }

  function findLargestPictureInPictureVideo() {
    const videos = Array.from(document.querySelectorAll("video"))
      .filter((video) => video instanceof HTMLVideoElement)
      .filter((video) => video.readyState !== 0)
      .filter((video) => video.disablePictureInPicture === false)
      .sort((first, second) => {
        const firstRect = first.getClientRects()[0] || { width: 0, height: 0 };
        const secondRect = second.getClientRects()[0] || { width: 0, height: 0 };
        return secondRect.width * secondRect.height - firstRect.width * firstRect.height;
      });

    return videos[0] || null;
  }

  async function requestPictureInPicture(video) {
    if (!state.settings.pipEnabled || isShortsPage() || !(video instanceof HTMLVideoElement)) return;
    await video.requestPictureInPicture();
    video.dataset.taperPip = "true";
    video.addEventListener(
      "leavepictureinpicture",
      () => {
        delete video.dataset.taperPip;
        state.pipResizeObserver?.disconnect();
        state.pipResizeObserver = null;
      },
      { once: true }
    );

    state.pipResizeObserver?.disconnect();
    state.pipResizeObserver = new ResizeObserver(maybeUpdatePictureInPictureVideo);
    state.pipResizeObserver.observe(video);
  }

  function maybeUpdatePictureInPictureVideo(entries) {
    const observedVideo = entries[0]?.target;
    if (!document.pictureInPictureElement || !observedVideo) {
      state.pipResizeObserver?.disconnect();
      state.pipResizeObserver = null;
      return;
    }

    const video = findLargestPictureInPictureVideo();
    if (video && video !== observedVideo) {
      requestPictureInPicture(video).catch(() => {});
    }
  }

  async function togglePictureInPicture() {
    if (!state.settings.pipEnabled) return;

    if (isShortsPage()) {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
      return;
    }

    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
      return;
    }

    const video = findLargestPictureInPictureVideo();
    if (video) await requestPictureInPicture(video);
  }

  function enforcePictureInPicturePolicy() {
    if ((!state.settings.pipEnabled || isShortsPage()) && document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    }
  }

  function applyPictureInPictureAvailability() {
    const disable = isShortsPage();
    document.querySelectorAll("video").forEach((video) => {
      if (!(video instanceof HTMLVideoElement)) return;

      if (disable) {
        if (!("taperOriginalDisablePip" in video.dataset)) {
          video.dataset.taperOriginalDisablePip = String(video.disablePictureInPicture);
        }
        video.disablePictureInPicture = true;
        return;
      }

      if ("taperOriginalDisablePip" in video.dataset) {
        video.disablePictureInPicture = video.dataset.taperOriginalDisablePip === "true";
        delete video.dataset.taperOriginalDisablePip;
      }
    });
  }

  function setupPictureInPicture() {
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.setActionHandler("enterpictureinpicture", () => {
          if (!state.settings.pipEnabled || isShortsPage()) return;
          const video = findLargestPictureInPictureVideo();
          if (video) requestPictureInPicture(video).catch(() => {});
        });
      } catch (_) {}
    }

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== "taper-toggle-picture-in-picture") return;
      togglePictureInPicture().catch(() => {});
    });
  }

  function resetLoopTracker(shortId = getShortId()) {
    state.loopShortId = shortId;
    state.loopVideo = null;
    state.lastVideoTime = 0;
    state.loopCount = 0;
    state.presencePromptShortId = "";
    document.body?.classList.remove("taper-presence-check");
  }

  function trackVideoLoop() {
    if (isTimedShortsBlockActive()) {
      pauseShortsVideo();
      return;
    }

    if (!isShortsPage()) {
      resetLoopTracker("");
      return;
    }

    const shortId = getShortId();
    const video = document.querySelector("video");
    if (!(video instanceof HTMLVideoElement) || !Number.isFinite(video.duration) || video.duration < 2) {
      return;
    }

    if (state.loopShortId !== shortId || state.loopVideo !== video) {
      resetLoopTracker(shortId);
      state.loopVideo = video;
      state.lastVideoTime = video.currentTime;
      return;
    }

    const previousTime = state.lastVideoTime;
    const currentTime = video.currentTime;
    state.lastVideoTime = currentTime;

    const wrappedToStart = previousTime > Math.max(1, video.duration - 1.5) && currentTime < 1.5;
    const jumpedBackward = previousTime - currentTime > Math.max(2, video.duration * 0.5) && currentTime < Math.min(3, video.duration * 0.25);
    if (!wrappedToStart && !jumpedBackward) return;

    state.loopCount += 1;
    if (state.loopCount >= state.settings.loopPromptLimit && state.presencePromptShortId !== shortId) {
      state.presencePromptShortId = shortId;
      showPresenceCheck();
    }
  }

  function showPresenceCheck() {
    ensureUi();
    clearShortsBlocker(false);
    pauseShortsVideo();
    document.body?.classList.add("taper-presence-check");
  }

  function resumeFromPresenceCheck() {
    document.body?.classList.remove("taper-presence-check");
    state.presencePromptShortId = getShortId();
    const video = document.querySelector("video");
    if (video instanceof HTMLVideoElement) video.play().catch(() => {});
  }

  function applyEnforcement() {
    if (!document.body) return;
    const onShorts = isShortsPage();
    const reached = isLimitReached();
    if (!onShorts) clearShortsBlocker(false);
    applyPictureInPictureAvailability();
    enforcePictureInPicturePolicy();
    document.body.classList.toggle("taper-on-shorts", onShorts && isActive());
    document.body.classList.toggle("taper-limit-reached", reached);
    if ((reached || isShortsFrozen()) && onShorts) pauseShortsVideo();
    updateMeter();
  }

  async function countCurrentShort() {
    if (!isActive()) return;
    if (isShortsFrozen()) return;
    const shortId = getShortId();
    if (!shortId || shortId === state.lastShortId) return;

    state.lastShortId = shortId;
    state.usage = pruneUsage(state.usage);

    const latest = state.usage.countEvents[state.usage.countEvents.length - 1];
    if (latest && latest.id === shortId && Date.now() - latest.t < DUPLICATE_COUNT_GUARD_MS) return;

    state.usage.countEvents.push({ id: shortId, t: Date.now() });
    await saveUsage();
    maybeShowHints();
  }

  function tickTime() {
    trackVideoLoop();
    if (shouldTrackTime()) {
      state.usage.timeBuckets.push({ t: Date.now(), ms: TIME_TICK_MS });
      saveUsage();
      maybeShowHints();
    }
    applyEnforcement();
  }

  function scheduleRouteCheck() {
    clearTimeout(state.routeTimer);
    state.routeTimer = setTimeout(async () => {
      await countCurrentShort();
      applyEnforcement();
    }, 180);
  }

  function patchHistory() {
    if (window.__taperHistoryPatched) return;
    window.__taperHistoryPatched = true;
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    history.pushState = function pushState(...args) {
      const result = originalPush.apply(this, args);
      window.dispatchEvent(new Event("taper-location-change"));
      return result;
    };
    history.replaceState = function replaceState(...args) {
      const result = originalReplace.apply(this, args);
      window.dispatchEvent(new Event("taper-location-change"));
      return result;
    };
  }

  function markInput() {
    state.lastInputAt = Date.now();
  }

  function maybePauseShortsOnFirstBackground() {
    if (document.visibilityState !== "hidden" || !isShortsPage() || state.backgroundPauseUsed) return;
    state.backgroundPauseUsed = true;
    pauseShortsVideo();
  }

  function blockTimedShortsInput(event) {
    if (!isTimedShortsBlockActive()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pauseShortsVideo();
  }

  function addListeners() {
    ["wheel", "keydown", "pointerdown", "touchstart", "scroll"].forEach((eventName) => {
      window.addEventListener(eventName, markInput, { passive: true, capture: true });
    });

    ["wheel", "keydown", "touchmove", "pointerdown"].forEach((eventName) => {
      window.addEventListener(eventName, blockTimedShortsInput, { passive: false, capture: true });
    });

    ["yt-navigate-finish", "yt-page-type-changed", "popstate", "taper-location-change"].forEach((eventName) => {
      window.addEventListener(eventName, scheduleRouteCheck);
      document.addEventListener(eventName, scheduleRouteCheck);
    });

    document.addEventListener("visibilitychange", () => {
      maybePauseShortsOnFirstBackground();
      applyEnforcement();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[STORAGE_SETTINGS]) {
        state.settings = { ...DEFAULT_SETTINGS, ...(changes[STORAGE_SETTINGS].newValue || {}), enabled: true };
      }
      if (changes[STORAGE_USAGE]) {
        state.usage = pruneUsage(changes[STORAGE_USAGE].newValue);
      }
      applyEnforcement();
    });
  }

  async function init() {
    ensureUi();
    patchHistory();
    setupPictureInPicture();
    addListeners();

    const stored = await storageGet([STORAGE_SETTINGS, STORAGE_USAGE]);
    state.settings = { ...DEFAULT_SETTINGS, ...(stored[STORAGE_SETTINGS] || {}), enabled: true };
    state.usage = pruneUsage(stored[STORAGE_USAGE]);

    await storageSet({
      [STORAGE_SETTINGS]: state.settings,
      [STORAGE_USAGE]: state.usage
    });

    scheduleRouteCheck();
    clearInterval(state.tickTimer);
    state.tickTimer = setInterval(tickTime, TIME_TICK_MS);
  }

  init();
})();
