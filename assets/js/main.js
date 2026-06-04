const categoryList = document.querySelector('#categoryList');
const emptyState = document.querySelector('#emptyState');
const searchInput = document.querySelector('#searchInput');
const searchCount = document.querySelector('#searchCount');
const clockTime = document.querySelector('#clockTime');
const clockWeekday = document.querySelector('#clockWeekday');
let categories = [];

// 页面结构不完整时直接停止，避免后续事件绑定产生隐性错误。
if (!categoryList || !emptyState || !searchInput || !searchCount || !clockTime || !clockWeekday) {
  throw new Error('页面缺少必要元素');
}

const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

const icons = {
  robot: '<svg viewBox="0 0 24 24" focusable="false"><rect x="5" y="7" width="14" height="11" rx="3"></rect><path d="M12 7V4"></path><circle cx="9" cy="12" r="1"></circle><circle cx="15" cy="12" r="1"></circle><path d="M9 16h6"></path><path d="M4 12H2"></path><path d="M22 12h-2"></path></svg>',
  code: '<svg viewBox="0 0 24 24" focusable="false"><path d="m8 9-4 3 4 3"></path><path d="m16 9 4 3-4 3"></path><path d="m14 5-4 14"></path></svg>',
  'graduation-cap': '<svg viewBox="0 0 24 24" focusable="false"><path d="m3 9 9-4 9 4-9 4-9-4Z"></path><path d="M7 11v5c3 2 7 2 10 0v-5"></path><path d="M21 9v6"></path></svg>',
  school: '<svg viewBox="0 0 24 24" focusable="false"><path d="M4 21V9l8-5 8 5v12"></path><path d="M9 21v-6h6v6"></path><path d="M9 10h.01"></path><path d="M15 10h.01"></path></svg>',
  server: '<svg viewBox="0 0 24 24" focusable="false"><rect x="4" y="4" width="16" height="6" rx="2"></rect><rect x="4" y="14" width="16" height="6" rx="2"></rect><path d="M8 7h.01"></path><path d="M8 17h.01"></path></svg>',
  notebook: '<svg viewBox="0 0 24 24" focusable="false"><path d="M7 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"></path><path d="M8 3v18"></path><path d="M12 8h4"></path><path d="M12 12h4"></path></svg>',
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

const getAllLinks = () => categories.flatMap(category =>
  Array.isArray(category.links) ? category.links : []
);

const faviconUrl = url => {
  try {
    const hostname = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;
  } catch {
    return '';
  }
};

const renderIcon = icon => icons[icon] || icons.code;

const createLinkCard = link => {
  const card = document.createElement('a');
  card.className = 'link-card';
  card.href = link.url;
  card.target = '_blank';
  card.rel = 'noopener noreferrer';

  const icon = document.createElement('img');
  icon.className = 'link-favicon';
  icon.src = faviconUrl(link.url);
  icon.alt = '';
  icon.width = 32;
  icon.height = 32;
  icon.loading = 'lazy';

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

  const categoryIcon = document.createElement('span');
  categoryIcon.className = 'category-icon';
  categoryIcon.setAttribute('aria-hidden', 'true');
  categoryIcon.innerHTML = renderIcon(category.icon);

  const categoryName = document.createElement('span');
  categoryName.textContent = category.name;

  const grid = document.createElement('div');
  grid.className = 'link-grid';
  links.forEach(link => grid.append(createLinkCard(link)));

  heading.append(categoryIcon, categoryName);
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

const isTextInput = element =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLTextAreaElement ||
  element instanceof HTMLSelectElement ||
  element.isContentEditable;

document.addEventListener('keydown', event => {
  if (event.key === '/' && !isTextInput(document.activeElement)) {
    event.preventDefault();
    searchInput.focus();
    return;
  }

  if (event.key === 'Escape') {
    searchInput.value = '';
    searchInput.blur();
    render();
  }
});

searchInput.addEventListener('input', render);
updateClock();
setInterval(updateClock, 1000);

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
