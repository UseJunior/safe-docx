/* Safe DOCX — site interactivity */

(function () {
  'use strict';

  /* ── Scroll reveal ───────────────────────────────── */

  var revealEls = document.querySelectorAll('.reveal');

  if (revealEls.length && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    revealEls.forEach(function (el) {
      observer.observe(el);
    });
  } else {
    // Fallback: make everything visible immediately
    revealEls.forEach(function (el) {
      el.classList.add('is-visible');
    });
  }

  /* ── Mobile nav toggle ───────────────────────────── */

  var toggle = document.querySelector('.topnav-toggle');
  var topbar = document.querySelector('.topbar');

  function closeNav() {
    if (topbar && topbar.classList.contains('nav-open')) {
      topbar.classList.remove('nav-open');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }
  }

  if (toggle && topbar) {
    toggle.addEventListener('click', function () {
      var isOpen = topbar.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeNav();
    });

    // Close nav when viewport grows past mobile breakpoint
    var mql = window.matchMedia('(min-width: 641px)');
    if (mql.addEventListener) {
      mql.addEventListener('change', function (e) {
        if (e.matches) closeNav();
      });
    } else if (mql.addListener) {
      mql.addListener(function (e) {
        if (e.matches) closeNav();
      });
    }
  }

  /* ── Copy-to-clipboard ───────────────────────────── */

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy]');
    if (!btn) return;

    var text = btn.getAttribute('data-copy');
    if (!text) return;

    navigator.clipboard.writeText(text).then(function () {
      var prev = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(function () {
        btn.textContent = prev;
      }, 1500);
    });
  });
})();
