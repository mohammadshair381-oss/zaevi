/**
 * ==========================================================================
 * ZAEVI — Motion
 * Refined motion for the Maison theme: a cursor ring that follows the pointer (the
 * normal cursor stays visible), buttons that lean towards the pointer, a soft veil
 * between pages, parallax on large photographs, headlines that rise into place, a
 * hairline that tracks scroll progress, a serif band that moves with the scroll, and
 * small confirmations for the bag and the wishlist. Everything stops for visitors who
 * prefer reduced motion.
 * ==========================================================================
 */

(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // =========================================================================
  // 1. Luxury Custom Cursor
  // =========================================================================
  function initLuxuryCursor() {
    if (prefersReducedMotion || isTouchDevice) return;

    let dot = document.getElementById('zaevi-cursor-dot');
    let ring = document.getElementById('zaevi-cursor-ring');

    if (!dot) {
      dot = document.createElement('div');
      dot.id = 'zaevi-cursor-dot';
      document.body.appendChild(dot);
    }

    if (!ring) {
      ring = document.createElement('div');
      ring.id = 'zaevi-cursor-ring';
      document.body.appendChild(ring);
    }

    document.body.classList.add('has-custom-cursor');

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let ringX = mouseX;
    let ringY = mouseY;
    let isVisible = false;

    window.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;

      dot.style.transform = `translate(${mouseX}px, ${mouseY}px) translate(-50%, -50%)`;

      if (!isVisible) {
        dot.style.opacity = '1';
        ring.style.opacity = '1';
        isVisible = true;
      }
    }, { passive: true });

    // Smooth lerp loop for outer ring
    function renderCursor() {
      ringX += (mouseX - ringX) * 0.16;
      ringY += (mouseY - ringY) * 0.16;

      ring.style.transform = `translate(${ringX}px, ${ringY}px) translate(-50%, -50%)`;
      requestAnimationFrame(renderCursor);
    }
    requestAnimationFrame(renderCursor);

    // Hover scale & magnetic snap
    document.addEventListener('mouseover', (e) => {
      const target = e.target.closest('a, button, input, select, textarea, .product, .size-btn, [role="button"], .hero-3d-btn');
      if (target) {
        ring.classList.add('is-hovering');
      } else {
        ring.classList.remove('is-hovering');
      }
    });

    document.addEventListener('mousedown', () => {
      ring.classList.add('is-clicking');
    });

    document.addEventListener('mouseup', () => {
      ring.classList.remove('is-clicking');
    });

    document.addEventListener('mouseleave', () => {
      dot.style.opacity = '0';
      ring.style.opacity = '0';
      isVisible = false;
    });
  }

  // =========================================================================
  // 2. Cinematic Page Veil Transition
  // =========================================================================
  function initPageVeil() {
    let veil = document.getElementById('zaevi-page-veil');
    if (!veil) {
      veil = document.createElement('div');
      veil.id = 'zaevi-page-veil';
      veil.innerHTML = `
        <img class="veil-monogram" src="assets/zaevi-icon.png" alt="ZAEVI">
        <div class="veil-line"></div>
      `;
      document.body.appendChild(veil);
    }

    let veilSafetyTimer = null;

    function dismissVeil() {
      if (veilSafetyTimer) {
        clearTimeout(veilSafetyTimer);
        veilSafetyTimer = null;
      }
      veil.classList.remove('active');
    }

    // Intercept internal link navigations for seamless couture fade
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const link = e.target.closest('a[href]');
      if (!link || link.hasAttribute('download')) return;

      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || link.target === '_blank') return;
      if (href.startsWith('http') && !href.startsWith(window.location.origin)) return;

      // Do not intercept if modifier keys are pressed
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      e.preventDefault();
      veil.classList.add('active');

      // Fail-safe watchdog: dismiss after 2500ms if navigation fails or is aborted
      if (veilSafetyTimer) clearTimeout(veilSafetyTimer);
      veilSafetyTimer = setTimeout(dismissVeil, 2500);

      setTimeout(() => {
        window.location.href = href;
      }, 220);
    });

    // Fade out veil on initial page entrance and back/forward cache
    window.addEventListener('pageshow', dismissVeil);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) dismissVeil();
    });
  }

  // =========================================================================
  // 3. Magnetic Button Micro-Interactions
  // =========================================================================
  function initMagneticButtons() {
    if (prefersReducedMotion || isTouchDevice) return;

    const targets = document.querySelectorAll('.button--primary, .hero-cta, .checkout, .add, .house-cta, .tile-cta');

    targets.forEach((btn) => {
      if (btn.__hasMagnetic) return;
      btn.__hasMagnetic = true;

      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - (rect.left + rect.width / 2);
        const y = e.clientY - (rect.top + rect.height / 2);

        // Clamp the pull so wide buttons (Add to bag, Checkout) don't drift out from under the cursor.
        const clamp = (v) => Math.max(-6, Math.min(6, v * 0.14));
        btn.style.transform = `translate(${clamp(x)}px, ${clamp(y)}px)`;
      });

      btn.addEventListener('mouseleave', () => {
        btn.style.transform = '';
      });
    });
  }

  // =========================================================================
  // 4. Bag confirmation
  // =========================================================================
  function triggerFlyToBag(sourceEl) {
    if (prefersReducedMotion) return;

    const bagIcon = document.querySelector('.bagnum') || document.querySelector('[data-cart]');
    if (!bagIcon) return;

    // A quiet confirmation: the bag count swells once.
    bagIcon.animate([
      { transform: 'scale(1)' },
      { transform: 'scale(1.3)' },
      { transform: 'scale(1)' },
    ], { duration: 500, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }

  window.triggerFlyToBag = triggerFlyToBag;

  // Attach to Bag Add Buttons
  document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.pdp-add, .quick-add-btn, #qvAddBtn, .add[data-add]');
    if (addBtn) {
      triggerFlyToBag(addBtn);
    }
  });

  // =========================================================================
  // 5. Wishlist confirmation
  // =========================================================================
  function triggerWishlistBurst(btn) {
    if (prefersReducedMotion || !btn) return;

    // A small, single pulse of the heart.
    btn.animate([
      { transform: 'scale(1)' },
      { transform: 'scale(1.18)' },
      { transform: 'scale(1)' }
    ], { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }

  window.triggerWishlistBurst = triggerWishlistBurst;

  document.addEventListener('click', (e) => {
    const wishBtn = e.target.closest('.wish');
    if (wishBtn) {
      triggerWishlistBurst(wishBtn);
    }
  });

  // =========================================================================
  // 6. Scroll-Triggered Parallax & Editorial Shimmer
  // =========================================================================
  function initScrollAnimations() {
    if (prefersReducedMotion) return;

    // Parallax on scroll for split hero & feature backgrounds
    const parallaxBgs = document.querySelectorAll('.hero-bg, .feature-img .bg, .tile .bg');
    if (parallaxBgs.length) {
      window.addEventListener('scroll', () => {
        const vh = window.innerHeight;
        parallaxBgs.forEach((bg) => {
          const rect = bg.parentElement.getBoundingClientRect();
          if (rect.top < vh && rect.bottom > 0) {
            const offset = (rect.top + rect.height / 2 - vh / 2) * -0.03;
            bg.style.transform = `translateY(${offset.toFixed(1)}px) scale(1.06)`;
          }
        });
      }, { passive: true });
    }
  }

  // =========================================================================
  // 7. Live Effects
  // =========================================================================
  function initScrollProgress() {
    const bar = document.createElement('div');
    bar.className = 'fx-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    let queued = false;
    const paint = () => {
      queued = false;
      const range = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = `scaleX(${range > 0 ? Math.min(1, window.scrollY / range) : 0})`;
    };
    const request = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(paint);
    };
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request, { passive: true });
    paint();
  }

  // Words rise into place when a static headline scrolls into view. Runs once at
  // load, so headlines that scripts render or rewrite later are left untouched.
  function initHeadlineRise() {
    const headlines = document.querySelectorAll('#main .display, #main .shop-head h2, #main .feature-top h2, #main .tools h2, #main .newsletter h2');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('fx-words-in');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.2 });

    headlines.forEach((headline) => {
      if (headline.classList.contains('luxury-shimmer') || headline.closest('[hidden]')) return;
      let index = 0;
      Array.from(headline.childNodes).forEach((node) => {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) return;
        const fragment = document.createDocumentFragment();
        node.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) {
            fragment.appendChild(document.createTextNode(' '));
            return;
          }
          const word = document.createElement('span');
          word.className = 'fx-word';
          const inner = document.createElement('span');
          inner.textContent = part;
          inner.style.transitionDelay = `${index * 55}ms`;
          word.appendChild(inner);
          fragment.appendChild(word);
          index += 1;
        });
        node.replaceWith(fragment);
      });
      if (!index) return;
      headline.classList.add('fx-words');
      observer.observe(headline);
    });
  }

  // Cards animate as they enter, without hiding anything beforehand, so a card can
  // never get stuck invisible. Filtering or re-rendering a grid plays it again.
  const cardObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const card = entry.target;
      const siblings = Array.from(card.parentElement ? card.parentElement.children : []);
      card.style.setProperty('--fx-delay', `${(siblings.indexOf(card) % 4) * 70}ms`);
      card.classList.add('fx-rise');
      cardObserver.unobserve(card);
    });
  }, { rootMargin: '0px 0px -4% 0px' });

  function watchProductCards() {
    document.querySelectorAll('.product:not(.fx-watched)').forEach((card) => {
      card.classList.add('fx-watched');
      cardObserver.observe(card);
    });
  }

  // Follows the pointer: a spotlight on panels, and slight depth on large image captions.
  function initPointerEffects() {
    if (isTouchDevice) return;
    const panels = '.auth-card, .checkout-summary, .track-result, .acct-stat, .acct-track-card, .address-card, .quick-view-content, .faq-item';
    const frames = '.feature-img, .tile';
    let pending = null;
    let frame = null;
    const apply = () => {
      frame = null;
      const e = pending;
      if (!e || !e.target || !e.target.closest) return;
      const panel = e.target.closest(panels);
      if (panel) {
        const rect = panel.getBoundingClientRect();
        panel.style.setProperty('--mx', `${(e.clientX - rect.left).toFixed(0)}px`);
        panel.style.setProperty('--my', `${(e.clientY - rect.top).toFixed(0)}px`);
      }
      const image = e.target.closest(frames);
      if (image) {
        const rect = image.getBoundingClientRect();
        image.style.setProperty('--px', ((e.clientX - rect.left) / rect.width - 0.5).toFixed(3));
        image.style.setProperty('--py', ((e.clientY - rect.top) / rect.height - 0.5).toFixed(3));
      }
    };
    document.addEventListener('pointermove', (e) => {
      pending = e;
      if (!frame) frame = requestAnimationFrame(apply);
    }, { passive: true });
  }

  // Ribbons: every moving band (the announcement bar and Site Studio ribbons) flows here,
  // without ever stopping. A ribbon slows to a quarter of its speed under the pointer so
  // its links stay easy to click, then picks up again. Speed and direction come from the
  // ribbon's own settings (Site Studio writes them as the animation duration and direction).
  // For visitors who prefer reduced motion, ribbons keep moving at half speed.
  function initRibbons() {
    const SELECTOR = '.luxury-ticker-track, .studio-ribbon-track';
    const gentle = prefersReducedMotion ? 0.5 : 1;
    const states = new WeakMap();
    let tracks = [];
    let refreshQueued = false;
    const refresh = () => {
      refreshQueued = false;
      tracks = Array.from(document.querySelectorAll(SELECTOR));
    };
    refresh();
    new MutationObserver(() => {
      if (!refreshQueued) {
        refreshQueued = true;
        requestAnimationFrame(refresh);
      }
    }).observe(document.body, { childList: true, subtree: true });

    const stateOf = (track) => {
      let s = states.get(track);
      if (!s) {
        s = { offset: 0, speed: 0 };
        states.set(track, s);
        track.classList.add('is-flowing');
      }
      const fallback = track.classList.contains('luxury-ticker-track') ? 36 : 34;
      s.seconds = parseFloat(track.style.animationDuration) || fallback;
      s.dir = track.style.animationDirection === 'reverse' ? 1 : -1;
      return s;
    };

    let last = 0;
    const frame = (now) => {
      requestAnimationFrame(frame);
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      if (document.hidden || !dt) return;
      for (const track of tracks) {
        if (!track.isConnected) continue;
        const half = track.scrollWidth / 2;
        if (!half) continue;
        const s = stateOf(track);
        const hovered = track.parentElement && track.parentElement.matches(':hover');
        const target = (half / s.seconds) * gentle * (hovered ? 0.25 : 1);
        s.speed += (target - s.speed) * (1 - Math.exp(-dt * 3));
        s.offset += s.dir * s.speed * dt;
        if (s.offset <= -half) s.offset += half;
        if (s.offset > 0) s.offset -= half;
        track.style.transform = `translate3d(${s.offset.toFixed(2)}px,0,0)`;
      }
    };
    requestAnimationFrame(frame);
  }

  // A large homepage band of serif type that flows constantly; it picks up speed and
  // leans with the scroll (for reduced motion it simply flows, more slowly).
  function initMarquee() {
    const anchor = document.querySelector('.home-page .split');
    if (!anchor) return;
    const band = document.createElement('div');
    band.className = 'fx-marquee';
    band.setAttribute('aria-hidden', 'true');
    const phrase = '<span>The Art of Elegance</span><i>✦</i><span>Made to Order</span><i>✦</i><span>Autumn / Winter 2026</span><i>✦</i>';
    band.innerHTML = `<div class="fx-marquee-track">${phrase.repeat(6)}</div>`;
    anchor.parentNode.insertBefore(band, anchor);
    const track = band.firstElementChild;

    let offset = 0;
    let velocity = 0;
    let lastY = window.scrollY;
    let lastTime = 0;
    let raf = null;
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
      lastTime = now;
      const moved = window.scrollY - lastY;
      lastY = window.scrollY;
      velocity += (moved - velocity) * 0.12;
      if (prefersReducedMotion) velocity = 0;
      offset -= ((prefersReducedMotion ? 26 : 45) + Math.abs(velocity) * 22) * dt;
      const half = track.scrollWidth / 2;
      if (half > 0 && -offset >= half) offset += half;
      const lean = Math.max(-7, Math.min(7, velocity * 0.32));
      track.style.transform = `translate3d(${offset.toFixed(1)}px, 0, 0) skewX(${(-lean).toFixed(2)}deg)`;
    };
    new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        if (!raf) {
          lastTime = 0;
          lastY = window.scrollY;
          raf = requestAnimationFrame(tick);
        }
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    }).observe(band);
  }

  function initLiveEffects() {
    initRibbons();
    initMarquee();
    if (prefersReducedMotion) return;
    initScrollProgress();
    initHeadlineRise();
    watchProductCards();
  }

  // =========================================================================
  // 8. Initialize Everything on DOM Ready
  // =========================================================================
  function initMotionEngine() {
    initLuxuryCursor();
    initPageVeil();
    initMagneticButtons();
    initScrollAnimations();
    initLiveEffects();

    // Optimized & debounced re-binding for dynamically added interactive buttons
    let debounceTimer = null;
    const observer = new MutationObserver((mutations) => {
      // Filter out internal cursor and transient particle DOM mutations to avoid loops
      const hasRelevantMutation = mutations.some((m) => {
        const t = m.target;
        if (!t) return false;
        if (t.id === 'zaevi-cursor-dot' || t.id === 'zaevi-cursor-ring') return false;
        if (t.classList && (t.classList.contains('fly-to-bag-particle') || t.classList.contains('wish-burst-particle'))) return false;
        return true;
      });

      if (!hasRelevantMutation) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        initMagneticButtons();
        if (!prefersReducedMotion) watchProductCards();
        debounceTimer = null;
      }, 160);
    });

    const targetNode = document.getElementById('main') || document.body;
    observer.observe(targetNode, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMotionEngine);
  } else {
    initMotionEngine();
  }
})();

