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
