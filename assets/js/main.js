const categoryList = document.querySelector('#categoryList');
const emptyState = document.querySelector('#emptyState');
const searchInput = document.querySelector('#searchInput');
const searchCount = document.querySelector('#searchCount');
const clockTime = document.querySelector('#clockTime');
const clockWeekday = document.querySelector('#clockWeekday');
const weatherInfo = document.querySelector('#weatherInfo');
let categories = [];

// 页面结构不完整时直接停止，避免后续事件绑定产生隐性错误。
if (!categoryList || !emptyState || !searchInput || !searchCount || !clockTime || !clockWeekday || !weatherInfo) {
  throw new Error('页面缺少必要元素');
}

const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const defaultWeatherPosition = {
  latitude: 31.2304,
  longitude: 121.4737
};

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

const updateClock = () => {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');

  clockTime.textContent = `${hours}:${minutes}`;
  clockWeekday.textContent = weekdays[now.getDay()];
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
            longitude: position.coords.longitude
          }),
          () => resolve(defaultWeatherPosition),
          { maximumAge: 30 * 60 * 1000, timeout: 3000 }
        );
      })
      .catch(() => resolve(defaultWeatherPosition));
  });

const updateWeather = async () => {
  try {
    const { latitude, longitude } = await getGrantedPosition();
    const params = new URLSearchParams({
      latitude: latitude.toFixed(4),
      longitude: longitude.toFixed(4),
      current: 'temperature_2m,weather_code',
      timezone: 'auto',
      forecast_days: '1'
    });

    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const current = data.current || {};
    const temperature = Math.round(current.temperature_2m);
    const label = weatherLabels[current.weather_code] || '天气';

    weatherInfo.textContent = Number.isFinite(temperature) ? `${temperature}° ${label}` : '天气 --';
  } catch {
    weatherInfo.textContent = '天气 --';
  }
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
