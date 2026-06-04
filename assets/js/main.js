const categoryList = document.querySelector('#categoryList');
const emptyState = document.querySelector('#emptyState');
const searchInput = document.querySelector('#searchInput');
const searchCount = document.querySelector('#searchCount');
const clockTime = document.querySelector('#clockTime');
const clockWeekday = document.querySelector('#clockWeekday');
const weatherInfo = document.querySelector('#weatherInfo');
let categories = [];
let clockTimeZone = 'Asia/Shanghai';

// 页面结构不完整时直接停止，避免后续事件绑定产生隐性错误。
if (!categoryList || !emptyState || !searchInput || !searchCount || !clockTime || !clockWeekday || !weatherInfo) {
  throw new Error('页面缺少必要元素');
}

const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const defaultWeatherPosition = {
  latitude: 39.0851,
  longitude: 117.1994,
  timeZone: 'Asia/Shanghai'
};
const weatherCacheKey = 'blackblues.weather.current.tianjin';
const weatherCacheMaxAge = 2 * 60 * 60 * 1000;
const weatherRequestTimeout = 4000;
const mojiWeatherEndpoint = window.MOJI_WEATHER_ENDPOINT || '';

const weatherLabels = {
  0: '晴',
  1: '晴间多云',
  2: '多云',
  3: '阴',
  45: '雾',
  48: '雾',
  51: '小雨',
  53: '小雨',
  55: '小雨',
  56: '冻雨',
  57: '冻雨',
  61: '雨',
  63: '雨',
  65: '大雨',
  66: '冻雨',
  67: '冻雨',
  71: '雪',
  73: '雪',
  75: '大雪',
  77: '雪',
  80: '阵雨',
  81: '阵雨',
  82: '强阵雨',
  85: '阵雪',
  86: '阵雪',
  95: '雷雨',
  96: '雷雨',
  99: '雷雨'
};

const wttrWeatherLabels = {
  113: '晴',
  116: '晴间多云',
  119: '多云',
  122: '阴',
  143: '雾',
  176: '阵雨',
  179: '雨夹雪',
  182: '冻雨',
  185: '冻雨',
  200: '雷雨',
  227: '吹雪',
  230: '暴雪',
  248: '雾',
  260: '雾',
  263: '小雨',
  266: '小雨',
  281: '冻雨',
  284: '冻雨',
  293: '小雨',
  296: '小雨',
  299: '雨',
  302: '雨',
  305: '大雨',
  308: '大雨',
  311: '冻雨',
  314: '冻雨',
  317: '冻雨',
  320: '雪',
  323: '阵雪',
  326: '阵雪',
  329: '大雪',
  332: '大雪',
  335: '大雪',
  338: '大雪',
  350: '冰雹',
  353: '阵雨',
  356: '阵雨',
  359: '强阵雨',
  362: '雨夹雪',
  365: '雨夹雪',
  368: '阵雪',
  371: '大雪',
  374: '冰雹',
  377: '冰雹',
  386: '雷雨',
  389: '雷雨',
  392: '雷雪',
  395: '雷雪'
};

const icons = {
  robot: '<svg viewBox="0 0 24 24" focusable="false"><rect x="5" y="7" width="14" height="11" rx="3"></rect><path d="M12 7V4"></path><circle cx="9" cy="12" r="1"></circle><circle cx="15" cy="12" r="1"></circle><path d="M9 16h6"></path><path d="M4 12H2"></path><path d="M22 12h-2"></path></svg>',
  code: '<svg viewBox="0 0 24 24" focusable="false"><path d="m8 9-4 3 4 3"></path><path d="m16 9 4 3-4 3"></path><path d="m14 5-4 14"></path></svg>',
  'graduation-cap': '<svg viewBox="0 0 24 24" focusable="false"><path d="m3 9 9-4 9 4-9 4-9-4Z"></path><path d="M7 11v5c3 2 7 2 10 0v-5"></path><path d="M21 9v6"></path></svg>',
  school: '<svg viewBox="0 0 24 24" focusable="false"><path d="M4 21V9l8-5 8 5v12"></path><path d="M9 21v-6h6v6"></path><path d="M9 10h.01"></path><path d="M15 10h.01"></path></svg>',
  server: '<svg viewBox="0 0 24 24" focusable="false"><rect x="4" y="4" width="16" height="6" rx="2"></rect><rect x="4" y="14" width="16" height="6" rx="2"></rect><path d="M8 7h.01"></path><path d="M8 17h.01"></path></svg>',
  notebook: '<svg viewBox="0 0 24 24" focusable="false"><path d="M7 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"></path><path d="M8 3v18"></path><path d="M12 8h4"></path><path d="M12 12h4"></path></svg>',
  music: '<svg viewBox="0 0 24 24" focusable="false"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>',
  pencil: '<svg viewBox="0 0 24 24" focusable="false"><path d="M17 3a2.85 2.85 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path><path d="m15 5 4 4"></path></svg>',
  headphones: '<svg viewBox="0 0 24 24" focusable="false"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"></path><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3Z"></path></svg>',
  clock: '<svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>',
  wrench: '<svg viewBox="0 0 24 24" focusable="false"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-3 3-2.4-2.4Z"></path></svg>',
  'book-open': '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 7v14"></path><path d="M3 5a7 7 0 0 1 7 0c1.2.7 2 2 2 2v14s-.8-1.3-2-2a7 7 0 0 0-7 0Z"></path><path d="M21 5a7 7 0 0 0-7 0c-1.2.7-2 2-2 2v14s.8-1.3 2-2a7 7 0 0 1 7 0Z"></path></svg>',
  rss: '<svg viewBox="0 0 24 24" focusable="false"><path d="M5 5a14 14 0 0 1 14 14"></path><path d="M5 11a8 8 0 0 1 8 8"></path><circle cx="6" cy="18" r="1"></circle></svg>'
};

const normalize = value => String(value || '').trim().toLowerCase();

const readJsonStorage = key => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

const writeJsonStorage = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 天气缓存只是用于加快首屏显示，写入失败不影响实时请求。
  }
};

const updateClock = () => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: clockTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'long'
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  const hours = parts.hour || '00';
  const minutes = parts.minute || '00';

  clockTime.textContent = `${hours}:${minutes}`;
  clockWeekday.textContent = parts.weekday || weekdays[now.getDay()];
};

const formatWeather = weather => {
  const temperature = Math.round(Number(weather.temperature));
  const label = weather.label || weatherLabels[Number(weather.weatherCode)] || '天气';

  return Number.isFinite(temperature) ? `${temperature}° ${label}` : '天气 --';
};

const renderWeather = weather => {
  const text = formatWeather(weather);
  weatherInfo.textContent = text;
  return text !== '天气 --';
};

const hydrateCachedWeather = () => {
  const cached = readJsonStorage(weatherCacheKey);
  if (!cached || Date.now() - Number(cached.updatedAt) > weatherCacheMaxAge) return false;

  if (cached.timeZone) {
    clockTimeZone = cached.timeZone;
    updateClock();
  }

  return renderWeather(cached);
};

const getGrantedPosition = () =>
  new Promise(resolve => {
    if (!navigator.geolocation || !navigator.permissions) {
      resolve(defaultWeatherPosition);
      return;
    }

    navigator.permissions.query({ name: 'geolocation' })
      .then(permission => {
        if (permission.state !== 'granted') {
          resolve(defaultWeatherPosition);
          return;
        }

        navigator.geolocation.getCurrentPosition(
          position => resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || defaultWeatherPosition.timeZone
          }),
          () => resolve(defaultWeatherPosition),
          { maximumAge: 30 * 60 * 1000, timeout: 3000 }
        );
      })
      .catch(() => resolve(defaultWeatherPosition));
  });

const isSamePosition = (position, reference) =>
  Math.abs(position.latitude - reference.latitude) < 0.0001 &&
  Math.abs(position.longitude - reference.longitude) < 0.0001;

const fetchJson = async url => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), weatherRequestTimeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchOpenMeteoWeather = async position => {
  const params = new URLSearchParams({
    latitude: position.latitude.toFixed(4),
    longitude: position.longitude.toFixed(4),
    current: 'temperature_2m,weather_code',
    timezone: 'auto',
    forecast_days: '1'
  });

  const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
  const current = data.current || {};

  return {
    temperature: current.temperature_2m,
    weatherCode: current.weather_code,
    timeZone: data.timezone || position.timeZone || defaultWeatherPosition.timeZone,
    updatedAt: Date.now()
  };
};

const fetchMojiWeather = async position => {
  if (!mojiWeatherEndpoint) throw new Error('Moji weather endpoint is not configured');

  const url = new URL(mojiWeatherEndpoint, window.location.origin);
  url.searchParams.set('latitude', position.latitude.toFixed(4));
  url.searchParams.set('longitude', position.longitude.toFixed(4));

  const data = await fetchJson(url.toString());
  const current = data.current || data.data?.current || data.data || data;

  return {
    temperature: current.temperature ?? current.temp ?? current.temp_C ?? current.tempC,
    weatherCode: current.weatherCode ?? current.weather_code ?? current.code,
    label: current.label ?? current.weather ?? current.condition ?? current.weatherText ?? current.weather_desc,
    timeZone: current.timeZone || current.timezone || position.timeZone || defaultWeatherPosition.timeZone,
    updatedAt: Date.now()
  };
};

const fetchWttrWeather = async position => {
  const query = `${position.latitude.toFixed(4)},${position.longitude.toFixed(4)}`;
  const data = await fetchJson(`https://wttr.in/${query}?format=j1`);
  const current = data.current_condition?.[0] || {};
  const weatherCode = Number(current.weatherCode);

  return {
    temperature: current.temp_C,
    weatherCode,
    label: wttrWeatherLabels[weatherCode],
    timeZone: position.timeZone || defaultWeatherPosition.timeZone,
    updatedAt: Date.now()
  };
};

const fetchWeather = position =>
  fetchOpenMeteoWeather(position)
    .catch(() => fetchMojiWeather(position))
    .catch(() => fetchWttrWeather(position));

const renderFetchedWeather = async position => {
  const weather = await fetchWeather(position);
  if (!renderWeather(weather)) throw new Error('Invalid weather data');

  clockTimeZone = weather.timeZone;
  updateClock();
  writeJsonStorage(weatherCacheKey, weather);
};

const updateWeather = () => {
  const hasCachedWeather = hydrateCachedWeather();

  renderFetchedWeather(defaultWeatherPosition)
    .catch(() => {
      if (!hasCachedWeather) weatherInfo.textContent = '天气 --';
    });

  getGrantedPosition()
    .then(position => {
      if (isSamePosition(position, defaultWeatherPosition)) return;
      renderFetchedWeather(position).catch(() => {});
    })
    .catch(() => {});
};

const getAllLinks = () => categories.flatMap(category =>
  Array.isArray(category.links) ? category.links : []
);

const faviconUrl = url => {
  try {
    const parsedUrl = new URL(url, window.location.origin);
    if (parsedUrl.origin === window.location.origin) return '/favicon.svg';

    const { hostname } = parsedUrl;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;
  } catch {
    return '/favicon.svg';
  }
};

const isExternalUrl = url => {
  try {
    return new URL(url, window.location.origin).origin !== window.location.origin;
  } catch {
    return true;
  }
};

const renderIcon = icon => icons[icon] || icons.code;

const createLinkIcon = link => {
  if (link.icon) {
    const icon = document.createElement('span');
    icon.className = 'link-favicon link-favicon-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = renderIcon(link.icon);
    return icon;
  }

  const icon = document.createElement('img');
  icon.className = 'link-favicon';
  icon.src = link.iconUrl || faviconUrl(link.url);
  icon.alt = '';
  icon.width = 32;
  icon.height = 32;
  icon.loading = 'lazy';
  return icon;
};

const createLinkCard = link => {
  const card = document.createElement('a');
  card.className = 'link-card';
  card.href = link.url;

  if (isExternalUrl(link.url)) {
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
  }

  const icon = createLinkIcon(link);

  const content = document.createElement('span');
  content.className = 'link-content';

  const name = document.createElement('span');
  name.className = 'link-name';
  name.textContent = link.name;

  const description = document.createElement('span');
  description.className = 'link-description';
  description.textContent = link.description || '';

  content.append(name, description);
  card.append(icon, content);
  return card;
};

const createCategorySection = (category, links) => {
  const section = document.createElement('section');
  section.className = 'category-section';

  const heading = document.createElement('h2');
  heading.className = 'category-title';

  const categoryName = document.createElement('span');
  categoryName.textContent = category.name;

  const grid = document.createElement('div');
  grid.className = 'link-grid';
  links.forEach(link => grid.append(createLinkCard(link)));

  heading.append(categoryName);
  section.append(heading, grid);
  return section;
};

const linkMatches = (link, query) =>
  `${normalize(link.name)} ${normalize(link.description)}`.includes(query);

const updateSearchCount = (visibleLinks, totalLinks) => {
  searchCount.textContent = `${visibleLinks} / ${totalLinks}`;
};

const render = () => {
  const query = normalize(searchInput.value);
  const totalLinks = getAllLinks().length;
  let visibleLinks = 0;

  categoryList.replaceChildren();

  categories.forEach(category => {
    const links = Array.isArray(category.links) ? category.links : [];
    const filteredLinks = query ? links.filter(link => linkMatches(link, query)) : links;

    if (filteredLinks.length === 0) return;

    visibleLinks += filteredLinks.length;
    categoryList.append(createCategorySection(category, filteredLinks));
  });

  updateSearchCount(visibleLinks, totalLinks);
  emptyState.hidden = visibleLinks > 0;
};

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    searchInput.value = '';
    searchInput.blur();
    render();
  }
});

searchInput.addEventListener('input', render);
updateClock();
updateWeather();
setInterval(updateClock, 1000);
setInterval(updateWeather, 30 * 60 * 1000);

fetch('config/links.json')
  .then(response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then(data => {
    categories = Array.isArray(data.categories) ? data.categories : [];
    render();
  })
  .catch(() => {
    categoryList.replaceChildren();
    emptyState.textContent = '链接加载失败';
    emptyState.hidden = false;
    updateSearchCount(0, 0);
  });
