const STORAGE_PREFIX = "blackblues_music_";
const VOLUME_STORAGE_KEY = `${STORAGE_PREFIX}volume`;
const TRACK_INDEX_STORAGE_KEY = `${STORAGE_PREFIX}track_index`;
const POSITION_STORAGE_KEY = `${STORAGE_PREFIX}position`;
const DEFAULT_DOCUMENT_TITLE = document.title;

const PLAY_MODES = [
  { id: "sequence", label: "顺序播放", icon: "ti ti-arrow-right" },
  { id: "shuffle", label: "随机播放", icon: "ti ti-arrows-shuffle" },
  { id: "repeat-one", label: "单曲循环", icon: "ti ti-repeat-once" }
];

const playerState = {
  tracks: [],
  activeIndex: -1,
  durations: [],
  playMode: PLAY_MODES[0].id,
  loadToken: 0,
  artworkUrls: new Map(),
  mediaAvailability: new Map(),
  lyrics: [],
  activeLyricIndex: -1,
  activeTags: new Set(),
  searchQuery: "",
  pendingSeekTime: null,
  lastPositionSaveAt: 0,
  mobileSheetOpen: false,
  sheetPointerStartY: null
};

const elements = {};

function resolveMediaPath(path) {
  if (!path) return "";
  const normalizedPath = path.startsWith("music/") ? `../${path}` : path;
  return new URL(normalizedPath, window.location.href).href;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function readStoredVolume() {
  try {
    const storedValue = localStorage.getItem(VOLUME_STORAGE_KEY);
    if (storedValue === null) return 0.8;

    const storedVolume = Number(storedValue);
    return Number.isFinite(storedVolume) ? clamp(storedVolume, 0, 1) : 0.8;
  } catch {
    return 0.8;
  }
}

function writeStoredVolume(volume) {
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
  } catch {
    // Playback still works when storage is unavailable.
  }
}

function readStoredTrackIndex(trackCount) {
  try {
    const index = Number(localStorage.getItem(TRACK_INDEX_STORAGE_KEY));
    return Number.isInteger(index) && index >= 0 && index < trackCount ? index : 0;
  } catch {
    return 0;
  }
}

function writeStoredTrackIndex(index) {
  try {
    localStorage.setItem(TRACK_INDEX_STORAGE_KEY, String(index));
  } catch {
    // Playback still works when storage is unavailable.
  }
}

function readStoredPosition() {
  try {
    const position = Number(localStorage.getItem(POSITION_STORAGE_KEY));
    return Number.isFinite(position) && position > 0 ? position : 0;
  } catch {
    return 0;
  }
}

function writeStoredPosition(position) {
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, String(Math.max(0, Math.floor(position))));
  } catch {
    // Playback still works when storage is unavailable.
  }
}

function getTrackInitial(track) {
  const source = (track.title || track.album || track.artist || "?").trim();
  return source ? source[0] : "?";
}

function isBlank(value) {
  return !String(value || "").trim();
}

function setCoverPlaceholder(element, track) {
  if (!element) return;

  element.classList.remove("has-image", "is-missing");
  element.classList.add("is-placeholder");
  element.style.removeProperty("--cover-image");
  element.dataset.initial = getTrackInitial(track);
}

function setCoverBackground(element, coverUrl, track) {
  if (!element) return Promise.resolve(false);

  element.classList.remove("has-image", "is-missing", "is-placeholder");
  element.style.removeProperty("--cover-image");
  element.dataset.initial = getTrackInitial(track);

  if (!coverUrl) {
    setCoverPlaceholder(element, track);
    return Promise.resolve(false);
  }

  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => {
      element.style.setProperty("--cover-image", `url("${image.src}")`);
      element.classList.add("has-image");
      resolve(true);
    };
    image.onerror = () => {
      element.classList.add("is-missing");
      setCoverPlaceholder(element, track);
      resolve(false);
    };
    image.src = coverUrl;
  });
}

function mediaExists(url) {
  if (!url) return Promise.resolve(false);
  if (!playerState.mediaAvailability) playerState.mediaAvailability = new Map();
  if (playerState.mediaAvailability.has(url)) return playerState.mediaAvailability.get(url);

  const availability = fetch(url, { method: "HEAD" })
    .then(response => response.ok)
    .catch(() => false);
  playerState.mediaAvailability.set(url, availability);
  return availability;
}

function readId3Tags(track) {
  if (!track.src || !window.jsmediatags) return Promise.resolve(null);

  return new Promise(resolve => {
    window.jsmediatags.read(resolveMediaPath(track.src), {
      onSuccess: result => resolve(result.tags || null),
      onError: () => resolve(null)
    });
  });
}

function getFallbackText(track) {
  return [track.title, track.album, track.artist].find(value => !isBlank(value)) || "blackblues";
}

function parseLrcTime(minutes, seconds, fraction = "") {
  const normalizedFraction = fraction ? Number(`0.${fraction}`) : 0;
  return Number(minutes) * 60 + Number(seconds) + normalizedFraction;
}

function parseLrc(lrcText) {
  const lines = [];
  const timestampPattern = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  lrcText.split(/\r?\n/).forEach(rawLine => {
    const matches = [...rawLine.matchAll(timestampPattern)];
    if (matches.length === 0) return;

    const text = rawLine.replace(timestampPattern, "").trim();
    if (!text) return;

    matches.forEach(match => {
      lines.push({
        time: parseLrcTime(match[1], match[2], match[3]),
        text
      });
    });
  });

  return lines.sort((first, second) => first.time - second.time);
}

function getLyricsTargets() {
  return [
    { panel: elements.lyricsPanel, list: elements.lyricsList },
    { panel: elements.sheetLyricsPanel, list: elements.sheetLyricsList }
  ].filter(({ panel, list }) => panel && list);
}

function hideLyrics() {
  playerState.lyrics = [];
  playerState.activeLyricIndex = -1;

  getLyricsTargets().forEach(({ panel, list }) => {
    list.replaceChildren();
    panel.hidden = true;
  });
}

function renderLyrics(lines) {
  playerState.lyrics = lines;
  playerState.activeLyricIndex = -1;

  if (lines.length === 0) {
    hideLyrics();
    return;
  }

  getLyricsTargets().forEach(({ panel, list }) => {
    list.replaceChildren(...lines.map((line, index) => {
      const item = document.createElement("p");
      item.className = "lyric-line";
      item.dataset.lyricIndex = String(index);
      item.textContent = line.text;
      return item;
    }));
    panel.hidden = false;
    panel.scrollTop = 0;
  });
  syncLyrics();
}

async function loadLyrics(track, loadToken) {
  if (!track.lyrics) {
    hideLyrics();
    return;
  }

  try {
    const response = await fetch(resolveMediaPath(track.lyrics));
    if (loadToken !== playerState.loadToken) return;

    if (!response.ok) {
      hideLyrics();
      return;
    }

    const lrcText = await response.text();
    if (loadToken !== playerState.loadToken) return;

    renderLyrics(parseLrc(lrcText));
  } catch {
    if (loadToken === playerState.loadToken) hideLyrics();
  }
}

function findCurrentLyricIndex(currentTime) {
  let low = 0;
  let high = playerState.lyrics.length - 1;
  let currentIndex = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (playerState.lyrics[middle].time <= currentTime) {
      currentIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return currentIndex;
}

function syncLyrics() {
  if (playerState.lyrics.length === 0) return;

  const lyricIndex = findCurrentLyricIndex(elements.audio.currentTime);
  if (lyricIndex === playerState.activeLyricIndex) return;

  playerState.activeLyricIndex = lyricIndex;
  getLyricsTargets().forEach(({ panel, list }) => {
    if (panel.hidden) return;

    list.querySelectorAll(".lyric-line").forEach(line => {
      line.classList.toggle("is-active", Number(line.dataset.lyricIndex) === lyricIndex);
    });

    const activeLine = list.querySelector(".lyric-line.is-active");
    if (activeLine) {
      activeLine.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest"
      });
    }
  });
}

function getTrackSearchText(track) {
  return [track.title, track.artist, track.album]
    .filter(value => !isBlank(value))
    .join(" ")
    .toLowerCase();
}

function getAllTags(tracks) {
  return [...new Set(tracks.flatMap(track => track.tags || []))]
    .filter(tag => !isBlank(tag))
    .sort((first, second) => first.localeCompare(second));
}

function trackMatchesActiveTags(track) {
  if (playerState.activeTags.size === 0) return true;

  const trackTags = new Set(track.tags || []);
  return [...playerState.activeTags].every(tag => trackTags.has(tag));
}

function trackMatchesSearch(track) {
  if (!playerState.searchQuery) return true;
  return getTrackSearchText(track).includes(playerState.searchQuery);
}

function getFilteredTrackEntries() {
  return playerState.tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => trackMatchesActiveTags(track) && trackMatchesSearch(track));
}

function updateTrackCount(visibleCount = playerState.tracks.length) {
  if (visibleCount === playerState.tracks.length) {
    elements.trackCount.textContent = `${playerState.tracks.length} tracks`;
    return;
  }

  elements.trackCount.textContent = `${visibleCount} / ${playerState.tracks.length} tracks`;
}

function syncTagButtons() {
  document.querySelectorAll("[data-filter-tag]").forEach(button => {
    const isActive = playerState.activeTags.has(button.dataset.filterTag);
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function applyFilters() {
  const filteredEntries = getFilteredTrackEntries();
  renderTracks(filteredEntries);
  syncActiveTrack();
  updateTrackCount(filteredEntries.length);
  syncTagButtons();
}

function toggleTagFilter(tag) {
  if (playerState.activeTags.has(tag)) {
    playerState.activeTags.delete(tag);
  } else {
    playerState.activeTags.add(tag);
  }

  applyFilters();
}

function createPictureUrl(picture, index) {
  if (!picture || !picture.data || !picture.format) return "";

  const previousUrl = playerState.artworkUrls.get(index);
  if (previousUrl) {
    URL.revokeObjectURL(previousUrl);
    playerState.artworkUrls.delete(index);
  }

  const bytes = new Uint8Array(picture.data);
  const blob = new Blob([bytes], { type: picture.format });
  const objectUrl = URL.createObjectURL(blob);
  playerState.artworkUrls.set(index, objectUrl);
  return objectUrl;
}

function applyId3Metadata(track, tags, index) {
  if (!tags) return;

  let changed = false;
  if (isBlank(track.title) && tags.title) {
    track.title = tags.title;
    changed = true;
  }
  if (isBlank(track.artist) && tags.artist) {
    track.artist = tags.artist;
    changed = true;
  }
  if (isBlank(track.album) && tags.album) {
    track.album = tags.album;
    changed = true;
  }

  if (!changed) return;

  const row = elements.trackList.querySelector(`[data-index="${index}"]`);
  if (row) {
    row.querySelector(".track-title").textContent = track.title || "Untitled";
    row.querySelector(".track-artist").textContent = track.artist || "Unknown Artist";
    row.setAttribute("aria-label", `加载 ${track.title || "Untitled"}`);
  }

  if (index === playerState.activeIndex) {
    elements.nowTitle.textContent = track.title || "Untitled";
    elements.nowArtist.textContent = track.artist || "Unknown Artist";
    setElementText(elements.sheetTitle, track.title || "Untitled");
    setElementText(elements.sheetArtist, track.artist || "Unknown Artist");
    updateDocumentTitle();
  }
}

function mixColor(color, target, amount) {
  return color.map((channel, index) => Math.round(channel + (target[index] - channel) * amount));
}

function readableAccentColor(color) {
  const luminance = color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114;
  if (luminance < 90) return mixColor(color, [255, 255, 255], 0.42);
  if (luminance > 215) return mixColor(color, [0, 0, 0], 0.18);
  return color;
}

function hashColor(text) {
  let hash = 0;
  for (const char of text || "blackblues") {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }

  const hue = hash;
  const saturation = 48;
  const lightness = 58;
  const chroma = (1 - Math.abs((2 * lightness) / 100 - 1)) * saturation / 100;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = lightness / 100 - chroma / 2;
  const [r, g, b] =
    hue < 60 ? [chroma, x, 0] :
    hue < 120 ? [x, chroma, 0] :
    hue < 180 ? [0, chroma, x] :
    hue < 240 ? [0, x, chroma] :
    hue < 300 ? [x, 0, chroma] :
    [chroma, 0, x];

  return [r, g, b].map(channel => Math.round((channel + m) * 255));
}

function applyDynamicColor(color) {
  const [r, g, b] = readableAccentColor(color);
  const root = document.documentElement;
  root.style.setProperty("--dynamic-r", String(r));
  root.style.setProperty("--dynamic-g", String(g));
  root.style.setProperty("--dynamic-b", String(b));
}

function extractDominantColor(coverUrl, fallbackText, loadToken) {
  if (!coverUrl || !window.ColorThief) {
    applyDynamicColor(hashColor(fallbackText));
    return;
  }

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => {
    if (loadToken !== playerState.loadToken) return;

    try {
      const thief = new window.ColorThief();
      applyDynamicColor(thief.getColor(image));
    } catch {
      applyDynamicColor(hashColor(fallbackText));
    }
  };
  image.onerror = () => {
    if (loadToken === playerState.loadToken) applyDynamicColor(hashColor(fallbackText));
  };
  image.src = coverUrl;
}

async function resolveTrackArtwork(track, index) {
  if (track.cover) {
    const localCoverUrl = resolveMediaPath(track.cover);
    if (await mediaExists(localCoverUrl)) return localCoverUrl;
  }

  if (!await mediaExists(resolveMediaPath(track.src))) return "";

  const tags = await readId3Tags(track);
  applyId3Metadata(track, tags, index);

  if (tags && tags.picture) {
    return createPictureUrl(tags.picture, index);
  }

  return "";
}

function setActiveRowCover(index, coverUrl, track) {
  const rowCover = elements.trackList.querySelector(`[data-index="${index}"] .track-cover`);
  return rowCover ? setCoverBackground(rowCover, coverUrl, track) : Promise.resolve(false);
}

function createCoverThumb(track) {
  const cover = document.createElement("div");
  cover.className = "track-cover";
  cover.setAttribute("aria-hidden", "true");
  cover.dataset.initial = getTrackInitial(track);
  setCoverPlaceholder(cover, track);

  if (track.cover) {
    const coverUrl = resolveMediaPath(track.cover);
    mediaExists(coverUrl).then(exists => {
      if (exists) setCoverBackground(cover, coverUrl, track);
    });
  }
  return cover;
}

function createTagBadge(tag) {
  const badge = document.createElement("button");
  badge.className = "track-tag";
  badge.type = "button";
  badge.dataset.filterTag = tag;
  badge.setAttribute("aria-pressed", playerState.activeTags.has(tag) ? "true" : "false");
  badge.textContent = tag;
  badge.addEventListener("click", event => {
    event.stopPropagation();
    toggleTagFilter(tag);
  });
  return badge;
}

function createSidebarTagButton(tag) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sidebar-tag-button";
  button.dataset.filterTag = tag;
  button.setAttribute("aria-pressed", playerState.activeTags.has(tag) ? "true" : "false");
  button.textContent = tag;
  button.addEventListener("click", () => toggleTagFilter(tag));
  return button;
}

function renderTracks(trackEntries) {
  elements.trackList.replaceChildren();

  if (trackEntries.length === 0) {
    const empty = document.createElement("li");
    empty.className = "track-empty";
    empty.textContent = "暂无匹配曲目";
    elements.trackList.append(empty);
    return;
  }

  trackEntries.forEach(({ track, index }) => {
    const row = document.createElement("li");
    row.className = "track-item";
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `加载 ${track.title || "Untitled"}`);
    row.dataset.index = String(index);

    const trackIndex = document.createElement("span");
    trackIndex.className = "track-index";
    trackIndex.textContent = String(index + 1).padStart(2, "0");

    const meta = document.createElement("span");
    meta.className = "track-meta";

    const title = document.createElement("span");
    title.className = "track-title";
    title.textContent = track.title || "Untitled";

    const artist = document.createElement("span");
    artist.className = "track-artist";
    artist.textContent = track.artist || "Unknown Artist";

    const duration = document.createElement("span");
    duration.className = "track-time";
    duration.dataset.durationIndex = String(index);
    duration.textContent = playerState.durations[index] || "--:--";

    const tags = document.createElement("span");
    tags.className = "track-tags";
    (track.tags || []).forEach(tag => tags.append(createTagBadge(tag)));

    meta.append(title, artist);
    row.append(trackIndex, createCoverThumb(track), meta, duration, tags);

    row.addEventListener("click", () => {
      const shouldPlay = !elements.audio.paused && !elements.audio.ended;
      loadTrack(index, { play: shouldPlay });
    });
    row.addEventListener("keydown", event => {
      if (event.target instanceof HTMLButtonElement) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const shouldPlay = !elements.audio.paused && !elements.audio.ended;
      loadTrack(index, { play: shouldPlay });
    });

    elements.trackList.append(row);
  });
}

function renderTags(tracks) {
  const tags = getAllTags(tracks);

  elements.sidebarTagList.replaceChildren(...tags.map(createSidebarTagButton));
  elements.tagList.replaceChildren(...tags.map(tag => {
    return createTagBadge(tag);
  }));
  syncTagButtons();
}

function syncActiveTrack() {
  elements.trackList.querySelectorAll(".track-item").forEach(row => {
    const isCurrent = Number(row.dataset.index) === playerState.activeIndex;
    row.classList.toggle("is-current", isCurrent);
    row.setAttribute("aria-current", isCurrent ? "true" : "false");
  });
}

function setElementText(element, text) {
  if (element) element.textContent = text;
}

function setProgressPercent(percent) {
  const width = `${clamp(percent, 0, 100)}%`;
  if (elements.progressFill) elements.progressFill.style.width = width;
  if (elements.sheetProgressFill) elements.sheetProgressFill.style.width = width;
  if (elements.progressBar) elements.progressBar.setAttribute("aria-valuenow", String(Math.round(clamp(percent, 0, 100))));
  if (elements.sheetProgressBar) elements.sheetProgressBar.setAttribute("aria-valuenow", String(Math.round(clamp(percent, 0, 100))));
}

function updateDocumentTitle() {
  const track = playerState.tracks[playerState.activeIndex];
  const isPlaying = elements.audio && !elements.audio.paused && !elements.audio.ended;
  document.title = isPlaying && track ? `♪ ${track.title || "Untitled"} — music.` : DEFAULT_DOCUMENT_TITLE;
}

function updatePlayButton() {
  const isPlaying = !elements.audio.paused && !elements.audio.ended;
  const iconClass = isPlaying ? "ti ti-player-pause" : "ti ti-player-play";
  const label = isPlaying ? "暂停" : "播放";

  elements.playIcon.className = iconClass;
  elements.playButton.setAttribute("aria-label", label);
  if (elements.sheetPlayIcon) elements.sheetPlayIcon.className = iconClass;
  if (elements.sheetPlayButton) elements.sheetPlayButton.setAttribute("aria-label", label);
  elements.coverDisc.classList.toggle("is-playing", isPlaying);
  if (elements.sheetCover) elements.sheetCover.classList.toggle("is-playing", isPlaying);
  updateDocumentTitle();
}

function updateProgress() {
  const duration = elements.audio.duration;
  const currentTime = elements.audio.currentTime;
  const percent = Number.isFinite(duration) && duration > 0 ? (currentTime / duration) * 100 : 0;

  const currentText = formatDuration(currentTime);
  const durationText = playerState.durations[playerState.activeIndex] || formatDuration(duration);
  setElementText(elements.currentTime, currentText);
  setElementText(elements.sheetCurrentTime, currentText);
  setElementText(elements.durationTime, durationText);
  setElementText(elements.sheetDurationTime, durationText);
  setProgressPercent(percent);
}

function syncDuration(duration) {
  if (playerState.activeIndex < 0) return;

  const formattedDuration = formatDuration(duration);
  playerState.durations[playerState.activeIndex] = formattedDuration;
  setElementText(elements.durationTime, formattedDuration);
  setElementText(elements.sheetDurationTime, formattedDuration);

  const durationNode = elements.trackList.querySelector(`[data-duration-index="${playerState.activeIndex}"]`);
  if (durationNode) durationNode.textContent = formattedDuration;
}

function applyPendingSeek() {
  if (playerState.pendingSeekTime === null || !Number.isFinite(elements.audio.duration)) return;

  elements.audio.currentTime = clamp(playerState.pendingSeekTime, 0, Math.max(0, elements.audio.duration - 1));
  playerState.pendingSeekTime = null;
  updateProgress();
}

function saveCurrentPosition({ force = false } = {}) {
  if (playerState.activeIndex < 0 || !Number.isFinite(elements.audio.currentTime)) return;

  const now = Date.now();
  if (!force && now - playerState.lastPositionSaveAt < 2000) return;

  playerState.lastPositionSaveAt = now;
  writeStoredTrackIndex(playerState.activeIndex);
  writeStoredPosition(elements.audio.ended ? 0 : elements.audio.currentTime);
}

function playActiveTrack() {
  if (playerState.activeIndex < 0 && playerState.tracks.length > 0) {
    loadTrack(0, { play: true });
    return;
  }

  if (!elements.audio.currentSrc && playerState.activeIndex >= 0) {
    prepareAudioSource(playerState.tracks[playerState.activeIndex], playerState.loadToken, { play: true });
    return;
  }

  const playPromise = elements.audio.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {
      updatePlayButton();
    });
  }
}

function pauseTrack() {
  elements.audio.pause();
}

function togglePlay() {
  if (elements.audio.paused || elements.audio.ended) {
    playActiveTrack();
    return;
  }

  pauseTrack();
}

function getRandomTrackIndex() {
  const trackCount = playerState.tracks.length;
  if (trackCount <= 1) return playerState.activeIndex;

  let nextIndex = playerState.activeIndex;
  while (nextIndex === playerState.activeIndex) {
    nextIndex = Math.floor(Math.random() * trackCount);
  }
  return nextIndex;
}

function getNextIndex({ wrap = false, forEnded = false } = {}) {
  const trackCount = playerState.tracks.length;
  if (trackCount === 0) return null;
  if (playerState.activeIndex < 0) return 0;
  if (forEnded && playerState.playMode === "repeat-one") return playerState.activeIndex;
  if (playerState.playMode === "shuffle") return getRandomTrackIndex();

  const nextIndex = playerState.activeIndex + 1;
  if (nextIndex < trackCount) return nextIndex;
  return wrap ? 0 : null;
}

function getPreviousIndex({ wrap = true } = {}) {
  const trackCount = playerState.tracks.length;
  if (trackCount === 0) return null;
  if (playerState.activeIndex < 0) return 0;
  if (playerState.playMode === "shuffle") return getRandomTrackIndex();

  const previousIndex = playerState.activeIndex - 1;
  if (previousIndex >= 0) return previousIndex;
  return wrap ? trackCount - 1 : null;
}

function playNextTrack({ auto = false } = {}) {
  const nextIndex = getNextIndex({ wrap: !auto, forEnded: auto });
  if (nextIndex === null) {
    updatePlayButton();
    return;
  }

  const shouldPlay = auto || (!elements.audio.paused && !elements.audio.ended);
  loadTrack(nextIndex, { play: shouldPlay });
}

function playPreviousTrack() {
  const previousIndex = getPreviousIndex();
  if (previousIndex === null) return;

  const shouldPlay = !elements.audio.paused && !elements.audio.ended;
  loadTrack(previousIndex, { play: shouldPlay });
}

function seekBy(seconds) {
  if (!Number.isFinite(elements.audio.duration)) return;
  elements.audio.currentTime = clamp(elements.audio.currentTime + seconds, 0, elements.audio.duration);
  updateProgress();
  writeStoredPosition(elements.audio.currentTime);
}

function seekToProgress(event) {
  if (!Number.isFinite(elements.audio.duration) || elements.audio.duration <= 0) return;

  const progressBar = event.currentTarget;
  const rect = progressBar.getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  elements.audio.currentTime = ratio * elements.audio.duration;
  updateProgress();
  writeStoredPosition(elements.audio.currentTime);
}

function cyclePlayMode() {
  const currentModeIndex = PLAY_MODES.findIndex(mode => mode.id === playerState.playMode);
  const nextMode = PLAY_MODES[(currentModeIndex + 1) % PLAY_MODES.length];
  playerState.playMode = nextMode.id;
  elements.modeIcon.className = nextMode.icon;
  elements.modeButton.setAttribute("aria-label", nextMode.label);
  elements.modeButton.title = nextMode.label;
  if (elements.sheetModeIcon) elements.sheetModeIcon.className = nextMode.icon;
  if (elements.sheetModeButton) {
    elements.sheetModeButton.setAttribute("aria-label", nextMode.label);
    elements.sheetModeButton.title = nextMode.label;
  }
}

function setVolume(volume) {
  const normalizedVolume = clamp(Number(volume), 0, 1);
  elements.audio.volume = normalizedVolume;
  elements.volumeSlider.value = String(normalizedVolume);
  writeStoredVolume(normalizedVolume);
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 767px)").matches;
}

function openMobileSheet() {
  if (!elements.mobileSheet || !isMobileViewport()) return;

  playerState.mobileSheetOpen = true;
  elements.mobileSheet.classList.add("is-open");
  elements.mobileSheet.setAttribute("aria-hidden", "false");
  document.body.classList.add("sheet-open");
}

function closeMobileSheet() {
  if (!elements.mobileSheet) return;

  playerState.mobileSheetOpen = false;
  elements.mobileSheet.classList.remove("is-open");
  elements.mobileSheet.setAttribute("aria-hidden", "true");
  document.body.classList.remove("sheet-open");
}

function bindMobileSheetInteractions() {
  elements.playerBar.addEventListener("click", event => {
    if (!isMobileViewport()) return;
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    if (target && target.closest("button, input, .progress")) return;
    openMobileSheet();
  });

  elements.sheetCloseButton.addEventListener("click", closeMobileSheet);
  elements.mobileSheet.addEventListener("pointerdown", event => {
    playerState.sheetPointerStartY = event.clientY;
  });
  elements.mobileSheet.addEventListener("pointerup", event => {
    if (playerState.sheetPointerStartY === null) return;

    const deltaY = event.clientY - playerState.sheetPointerStartY;
    playerState.sheetPointerStartY = null;
    if (deltaY > 80) closeMobileSheet();
  });
  elements.mobileSheet.addEventListener("pointercancel", () => {
    playerState.sheetPointerStartY = null;
  });

  window.addEventListener("resize", () => {
    if (!isMobileViewport()) closeMobileSheet();
  });
}

async function prepareAudioSource(track, loadToken, options = {}) {
  const audioUrl = resolveMediaPath(track.src);
  const exists = await mediaExists(audioUrl);
  if (loadToken !== playerState.loadToken || playerState.tracks[playerState.activeIndex] !== track) return;

  if (!exists) {
    elements.audio.removeAttribute("src");
    elements.audio.load();
    updatePlayButton();
    return;
  }

  elements.audio.src = audioUrl;
  elements.audio.load();

  if (options.play) {
    const playPromise = elements.audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => updatePlayButton());
    }
  }
}

function loadTrack(index, options = {}) {
  const track = playerState.tracks[index];
  if (!track || !elements.audio) return;

  const loadToken = ++playerState.loadToken;
  playerState.activeIndex = index;

  const seekTime = Number.isFinite(options.seekTime) ? Math.max(0, options.seekTime) : 0;
  playerState.pendingSeekTime = seekTime > 0 ? seekTime : null;
  writeStoredTrackIndex(index);
  writeStoredPosition(seekTime);

  elements.audio.removeAttribute("src");
  elements.audio.load();

  setElementText(elements.nowTitle, track.title || "Untitled");
  setElementText(elements.sheetTitle, track.title || "Untitled");
  setElementText(elements.nowArtist, track.artist || "Unknown Artist");
  setElementText(elements.sheetArtist, track.artist || "Unknown Artist");
  setElementText(elements.durationTime, playerState.durations[index] || "--:--");
  setElementText(elements.sheetDurationTime, playerState.durations[index] || "--:--");
  setElementText(elements.currentTime, "00:00");
  setElementText(elements.sheetCurrentTime, "00:00");
  setProgressPercent(0);

  hideLyrics();
  loadLyrics(track, loadToken);
  setCoverPlaceholder(elements.coverDisc, track);
  setCoverPlaceholder(elements.sheetCover, track);
  setCoverPlaceholder(elements.nowCover, track);
  setActiveRowCover(index, "", track);
  applyDynamicColor(hashColor(getFallbackText(track)));
  prepareAudioSource(track, loadToken, options);
  resolveTrackArtwork(track, index).then(coverUrl => {
    if (loadToken !== playerState.loadToken || index !== playerState.activeIndex) return;

    Promise.all([
      setCoverBackground(elements.coverDisc, coverUrl, track),
      setCoverBackground(elements.sheetCover, coverUrl, track),
      setCoverBackground(elements.nowCover, coverUrl, track),
      setActiveRowCover(index, coverUrl, track)
    ]).then(([hasHeroCover]) => {
      if (loadToken !== playerState.loadToken || index !== playerState.activeIndex) return;
      extractDominantColor(hasHeroCover ? coverUrl : "", getFallbackText(track), loadToken);
    });
  });
  syncActiveTrack();
  updatePlayButton();
}

function loadTrackDurations(tracks) {
  tracks.forEach((track, index) => {
    if (!track.src) return;

    const audioUrl = resolveMediaPath(track.src);
    mediaExists(audioUrl).then(exists => {
      if (!exists) {
        playerState.durations[index] = "--:--";
        return;
      }

      const probe = new Audio();
      probe.preload = "metadata";
      probe.addEventListener("loadedmetadata", () => {
        const duration = formatDuration(probe.duration);
        playerState.durations[index] = duration;

        const durationNode = elements.trackList.querySelector(`[data-duration-index="${index}"]`);
        if (durationNode) durationNode.textContent = duration;
        if (index === playerState.activeIndex) {
          setElementText(elements.durationTime, duration);
          setElementText(elements.sheetDurationTime, duration);
        }
      }, { once: true });
      probe.addEventListener("error", () => {
        playerState.durations[index] = "--:--";
      }, { once: true });
      probe.src = audioUrl;
    });
  });
}

async function initializePlayer() {
  try {
    const response = await fetch("./tracks.json");
    if (!response.ok) throw new Error(`Unable to load tracks: ${response.status}`);

    playerState.tracks = await response.json();
    playerState.durations = playerState.tracks.map(() => "--:--");

    renderTracks(getFilteredTrackEntries());
    renderTags(playerState.tracks);
    updateTrackCount();
    loadTrackDurations(playerState.tracks);

    if (playerState.tracks.length > 0) {
      loadTrack(readStoredTrackIndex(playerState.tracks.length), { seekTime: readStoredPosition() });
    }
  } catch {
    elements.trackList.innerHTML = '<li class="track-empty">曲目列表加载失败</li>';
  }
}

function isEditableShortcutTarget(element) {
  return element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element.isContentEditable;
}

function bindKeyboardShortcuts() {
  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isEditableShortcutTarget(document.activeElement)) return;

    if (event.code === "Space") {
      if (document.activeElement instanceof HTMLButtonElement) return;
      event.preventDefault();
      togglePlay();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      seekBy(-5);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      seekBy(5);
      return;
    }

    if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      playNextTrack();
      return;
    }

    if (event.key.toLowerCase() === "p") {
      event.preventDefault();
      playPreviousTrack();
    }
  });
}

function bindPlayerControls() {
  elements.playButton.addEventListener("click", togglePlay);
  elements.nextButton.addEventListener("click", () => playNextTrack());
  elements.prevButton.addEventListener("click", playPreviousTrack);
  elements.modeButton.addEventListener("click", cyclePlayMode);
  elements.progressBar.addEventListener("click", seekToProgress);
  elements.sheetPlayButton.addEventListener("click", togglePlay);
  elements.sheetNextButton.addEventListener("click", () => playNextTrack());
  elements.sheetPrevButton.addEventListener("click", playPreviousTrack);
  elements.sheetModeButton.addEventListener("click", cyclePlayMode);
  elements.sheetProgressBar.addEventListener("click", seekToProgress);
  elements.searchInput.addEventListener("input", event => {
    playerState.searchQuery = event.target.value.trim().toLowerCase();
    applyFilters();
  });
  elements.volumeSlider.addEventListener("input", event => setVolume(event.target.value));

  elements.audio.addEventListener("loadedmetadata", () => {
    syncDuration(elements.audio.duration);
    applyPendingSeek();
    updateProgress();
  });
  elements.audio.addEventListener("durationchange", () => {
    syncDuration(elements.audio.duration);
    applyPendingSeek();
    updateProgress();
  });
  elements.audio.addEventListener("timeupdate", () => {
    updateProgress();
    syncLyrics();
    saveCurrentPosition();
  });
  elements.audio.addEventListener("play", updatePlayButton);
  elements.audio.addEventListener("pause", () => {
    saveCurrentPosition({ force: true });
    updatePlayButton();
  });
  elements.audio.addEventListener("error", updatePlayButton);
  elements.audio.addEventListener("ended", () => {
    saveCurrentPosition({ force: true });
    playNextTrack({ auto: true });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveCurrentPosition({ force: true });
  });
  window.addEventListener("beforeunload", () => saveCurrentPosition({ force: true }));

  bindKeyboardShortcuts();
  bindMobileSheetInteractions();
}

function collectElements() {
  elements.audio = document.querySelector("#audioPlayer");
  elements.coverDisc = document.querySelector("#cover-disc");
  elements.currentTime = document.querySelector("#currentTime");
  elements.durationTime = document.querySelector("#durationTime");
  elements.modeButton = document.querySelector("#modeButton");
  elements.modeIcon = document.querySelector("#modeIcon");
  elements.lyricsList = document.querySelector("#lyricsList");
  elements.lyricsPanel = document.querySelector("#lyricsPanel");
  elements.nextButton = document.querySelector("#nextButton");
  elements.nowArtist = document.querySelector("#nowArtist");
  elements.nowCover = document.querySelector("#nowCover");
  elements.nowTitle = document.querySelector("#nowTitle");
  elements.playButton = document.querySelector("#playButton");
  elements.playIcon = document.querySelector("#playIcon");
  elements.playerBar = document.querySelector(".player-bar");
  elements.prevButton = document.querySelector("#prevButton");
  elements.progressBar = document.querySelector("#progressBar");
  elements.progressFill = document.querySelector("#progressFill");
  elements.searchInput = document.querySelector("#trackSearch");
  elements.sidebarTagList = document.querySelector("#sidebarTagList");
  elements.sheetArtist = document.querySelector("#sheetArtist");
  elements.sheetCloseButton = document.querySelector("#sheetCloseButton");
  elements.sheetCover = document.querySelector("#sheetCover");
  elements.sheetCurrentTime = document.querySelector("#sheetCurrentTime");
  elements.sheetDurationTime = document.querySelector("#sheetDurationTime");
  elements.sheetLyricsList = document.querySelector("#sheetLyricsList");
  elements.sheetLyricsPanel = document.querySelector("#sheetLyricsPanel");
  elements.sheetModeButton = document.querySelector("#sheetModeButton");
  elements.sheetModeIcon = document.querySelector("#sheetModeIcon");
  elements.sheetNextButton = document.querySelector("#sheetNextButton");
  elements.sheetPlayButton = document.querySelector("#sheetPlayButton");
  elements.sheetPlayIcon = document.querySelector("#sheetPlayIcon");
  elements.sheetPrevButton = document.querySelector("#sheetPrevButton");
  elements.sheetProgressBar = document.querySelector("#sheetProgressBar");
  elements.sheetProgressFill = document.querySelector("#sheetProgressFill");
  elements.sheetTitle = document.querySelector("#sheetTitle");
  elements.mobileSheet = document.querySelector("#mobilePlayerSheet");
  elements.tagList = document.querySelector("#tagList");
  elements.trackCount = document.querySelector("#trackCount");
  elements.trackList = document.querySelector("#trackList");
  elements.volumeSlider = document.querySelector("#volumeSlider");
}

document.addEventListener("DOMContentLoaded", () => {
  collectElements();
  setVolume(readStoredVolume());
  bindPlayerControls();
  initializePlayer();
});

window.loadTrack = loadTrack;
