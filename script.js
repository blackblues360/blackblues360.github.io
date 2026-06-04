// 读取上次保存的主题
const themeFromUrl = new URLSearchParams(window.location.search).get('theme');
const readSavedTheme = () => {
  try {
    return localStorage.getItem('theme');
  } catch {
    return null;
  }
};

const writeSavedTheme = theme => {
  try {
    localStorage.setItem('theme', theme);
  } catch {
    // 允许 file:// 或隐私模式下 localStorage 不可用时仍能切换当前页面。
  }
};

const saved = themeFromUrl || readSavedTheme() || 'dark';
if (themeFromUrl) writeSavedTheme(saved);
document.documentElement.setAttribute('data-theme', saved);
updateIcon(saved);

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  writeSavedTheme(next);
  updateIcon(next);
}

function updateIcon(theme) {
  const themeButton = document.getElementById('theme-btn');
  if (themeButton) themeButton.textContent = theme === 'dark' ? '☀️' : '🌙';
}

window.toggleTheme = toggleTheme;

const themeButton = document.getElementById('theme-btn');
if (themeButton) {
  themeButton.addEventListener('click', toggleTheme);
}

document.querySelectorAll('a[href]').forEach(link => {
  link.addEventListener('click', () => {
    const rawHref = link.getAttribute('href');
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:')) return;

    const url = new URL(rawHref, window.location.href);
    if (url.protocol !== 'file:' && url.origin !== window.location.origin) return;

    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    url.searchParams.set('theme', theme);
    link.href = url.href;
  });
});

const navToggle = document.querySelector('.nav-toggle');

document.querySelectorAll('.nav-links a').forEach(link => {
  link.addEventListener('click', () => {
    if (navToggle) navToggle.checked = false;
  });
});

const animatedItems = document.querySelectorAll('.blog-item, .bookmark-card, .music-item');

if (!('IntersectionObserver' in window)) {
  animatedItems.forEach(el => {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  });
} else {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.08 });

  animatedItems.forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(16px)';
    el.style.transition = `opacity 0.5s ${i * 0.06}s, transform 0.5s ${i * 0.06}s`;
    observer.observe(el);
  });
}
