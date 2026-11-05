/**
 * Draws what was published in Site Studio onto the storefront: colours, motion, the top
 * banner and, on the homepage, the main banner and sections. If nothing is published or
 * anything fails, the page keeps its built-in content. Admin text is only ever inserted
 * as text, never as HTML. Inside the Studio preview, it shows the unsaved draft instead.
 */
(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const isPreview = params.get('studioPreview') === '1' && window.parent !== window;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ACCENTS = {
    rouge: { main: '#cf0a1e', deep: '#7a0612', light: '#f4606d', soft: '#ffd9d6', rgb: '207, 10, 30' },
    sapphire: { main: '#1f4fd8', deep: '#122c7a', light: '#7fa2ff', soft: '#dbe5ff', rgb: '31, 79, 216' },
    emerald: { main: '#0e7d4f', deep: '#075234', light: '#4fd39a', soft: '#d3f7e7', rgb: '14, 125, 79' },
    amber: { main: '#b45f06', deep: '#6e3a03', light: '#f5a84b', soft: '#ffe9c9', rgb: '180, 95, 6' },
  };
  const TICKER_SECONDS = { slow: 60, normal: 36, fast: 20 };
  const RIBBON_SECONDS = { slow: 60, normal: 34, fast: 18 };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = text;
    return node;
  };

  function safeUrl(value) {
    const url = String(value || '').trim();
    if (!url || url.startsWith('//') || /[\s\\]/.test(url)) return '';
    if (/^https:\/\//i.test(url)) return url;
    return /^[a-z][a-z0-9+.-]*:/i.test(url) ? '' : url;
  }

  function applyLook(look = {}) {
    const accent = ACCENTS[look.accent] || ACCENTS.rouge;
    const root = document.documentElement.style;
    root.setProperty('--rouge', accent.main);
    root.setProperty('--rouge-deep', accent.deep);
    root.setProperty('--rouge-light', accent.light);
    root.setProperty('--gold-light', accent.soft);
    root.setProperty('--gold-glow', `rgba(${accent.rgb}, .32)`);
    root.setProperty('--line-gold', `rgba(${accent.rgb}, .45)`);
    root.setProperty('--shadow-gold', `0 14px 44px rgba(${accent.rgb}, .38)`);
    root.setProperty('--zaevi-gold', accent.main);
    root.setProperty('--zaevi-gold-dark', accent.light);
    root.setProperty('--zaevi-gold-light', accent.soft);
    root.setProperty('--zaevi-gold-glow', `rgba(${accent.rgb}, .3)`);
    window.zaeviStage?.setLook?.(look);
  }

  function applyTicker(ticker) {
    if (document.body.classList.contains('checkout-page')) return;
    let bar = document.querySelector('.luxury-ticker');
    const items = (ticker?.items || []).filter((item) => item.text);
    if (!ticker?.enabled || items.length === 0) {
      bar?.remove();
      document.body.classList.remove('has-luxury-ticker');
      return;
    }
    if (!bar) {
      bar = el('aside', 'luxury-ticker');
      bar.setAttribute('role', 'region');
      bar.setAttribute('aria-label', 'House Announcements');
      document.body.insertBefore(bar, document.body.firstChild);
      document.body.classList.add('has-luxury-ticker');
    }
    const track = el('div', 'luxury-ticker-track');
    track.style.animationDuration = `${TICKER_SECONDS[ticker.speed] || TICKER_SECONDS.normal}s`;
    // Two copies make the loop seamless. The second is hidden from assistive technology.
    for (let copy = 0; copy < 2; copy += 1) {
      items.forEach((item) => {
        const link = safeUrl(item.link);
        const node = el(link ? 'a' : 'span', 'luxury-ticker-item');
        if (link) node.href = link;
        node.appendChild(el('span', '', item.text));
        if (link) {
          const arrow = el('span', 'ticker-arrow', '→');
          arrow.setAttribute('aria-hidden', 'true');
          node.appendChild(arrow);
        }
        if (copy === 1) {
          node.setAttribute('aria-hidden', 'true');
          if (link) node.tabIndex = -1;
        }
        track.appendChild(node);
      });
    }
    bar.replaceChildren(track);
  }

  function applyHero(hero) {
    const section = document.querySelector('.hero');
    if (!section || !hero) return;
    const setText = (selector, value) => {
      const node = section.querySelector(selector);
      if (node) {
        node.textContent = value || '';
        node.hidden = !value;
      }
    };
    setText('.hero-copy > .eyebrow', hero.eyebrow);
    setText('.hero-sub', hero.subtitle);
    const lines = section.querySelectorAll('h1 span');
    [hero.line1, hero.line2].forEach((text, index) => {
      if (!lines[index]) return;
      const inner = lines[index].querySelector('i');
      if (inner) inner.textContent = text || '';
      lines[index].hidden = !text;
    });
    const cta = section.querySelector('.hero-cta');
    if (cta) {
      const link = safeUrl(hero.ctaLink);
      cta.hidden = !hero.ctaLabel || !link;
      cta.href = link || '#';
      if (cta.firstChild) cta.firstChild.textContent = `${hero.ctaLabel || ''} `;
    }
  }

  function isScheduledNow(block, now) {
    if (block.showFrom && now < new Date(block.showFrom)) return false;
    if (block.showUntil && now > new Date(block.showUntil)) return false;
    if (block.type === 'event' && block.hideAfterEvent && block.date && now > new Date(block.date)) return false;
    return true;
  }

  const button = (label, href) => {
    const link = safeUrl(href);
    if (!label || !link) return null;
    const node = el('a', 'arrow studio-cta', label);
    node.href = link;
    node.appendChild(document.createTextNode(' '));
    node.appendChild(document.createElement('b'));
    return node;
  };
  const picture = (url, alt, className) => {
    const src = safeUrl(url);
    if (!src) return null;
    const img = el('img', className);
    img.src = src;
    img.alt = alt || '';
    img.loading = 'lazy';
    return img;
  };
  const append = (parent, ...children) => {
    children.filter(Boolean).forEach((child) => parent.appendChild(child));
    return parent;
  };

  const RENDERERS = {
    ribbon(block) {
      const link = safeUrl(block.link);
      const outer = el(link ? 'a' : 'div', `studio-ribbon studio-ribbon--${block.style}`);
      if (link) outer.href = link;
      outer.setAttribute('aria-label', block.text);
      const track = el('div', 'studio-ribbon-track');
      track.setAttribute('aria-hidden', 'true');
      track.style.animationDuration = `${RIBBON_SECONDS[block.speed] || RIBBON_SECONDS.normal}s`;
      if (block.direction === 'right') track.style.animationDirection = 'reverse';
      for (let i = 0; i < 16; i += 1) {
        track.appendChild(el('span', '', block.text));
        track.appendChild(el('i', '', '✦'));
      }
      outer.appendChild(track);
      return outer;
    },
    event(block) {
      const card = el('section', 'studio-event');
      const when = new Date(block.date);
      const body = append(
        el('div', 'studio-event-body'),
        el('div', 'eyebrow', 'Event'),
        el('h2', 'studio-event-title', block.title),
        el('p', 'studio-event-when', `${when.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${when.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`),
        block.location ? el('p', 'studio-event-where', block.location) : null,
        block.description ? el('p', 'copy', block.description) : null
      );
      if (block.showCountdown && when > new Date()) {
        const counter = el('div', 'studio-countdown');
        counter.dataset.countdown = when.toISOString();
        counter.setAttribute('role', 'timer');
        body.appendChild(counter);
        updateCountdown(counter);
      }
      append(body, button(block.ctaLabel, block.link));
      return append(card, picture(block.image, block.title, 'studio-event-img'), body);
    },
    banner(block) {
      const outer = el('section', 'studio-banner');
      const image = safeUrl(block.image);
      if (image) {
        const bg = picture(image, '', 'studio-banner-img');
        outer.appendChild(bg);
      }
      return append(outer, append(
        el('div', 'studio-banner-copy'),
        block.eyebrow ? el('div', 'eyebrow', block.eyebrow) : null,
        el('h2', 'studio-banner-title', block.title),
        block.subtitle ? el('p', 'studio-banner-sub', block.subtitle) : null,
        button(block.ctaLabel, block.link)
      ));
    },
    text(block) {
      return append(
        el('section', 'section intro'),
        block.eyebrow ? el('div', 'eyebrow', block.eyebrow) : null,
        el('h2', 'display', block.heading),
        block.body ? el('p', 'copy', block.body) : null,
        button(block.ctaLabel, block.link)
      );
    },
    imageText(block) {
      const outer = el('section', `studio-split studio-split--${block.side}`);
      return append(
        outer,
        picture(block.image, block.heading, 'studio-split-img'),
        append(
          el('div', 'studio-split-copy'),
          el('h2', 'studio-split-title', block.heading),
          block.body ? el('p', 'copy', block.body) : null,
          button(block.ctaLabel, block.link)
        )
      );
    },
    products(block) {
      const outer = el('section', 'shop');
      const head = append(el('div', 'shop-head'), el('h2', '', block.heading));
      const grid = el('div', 'product-grid');
      outer.append(head, grid);
      fillProducts(grid, block);
      return outer;
    },
    gallery(block) {
      const outer = el('section', 'studio-gallery');
      if (block.heading) outer.appendChild(el('h2', 'studio-gallery-title', block.heading));
      const grid = el('div', 'studio-gallery-grid');
      (block.images || []).forEach((image) => append(grid, picture(image.url, image.alt, 'studio-gallery-img')));
      outer.appendChild(grid);
      return outer;
    },
  };

  function fillProducts(grid, block, attempt = 0) {
    const shop = window.__zaeviStorefront;
    const all = shop?.getProducts?.() || [];
    if (!all.length) {
      if (attempt < 40) setTimeout(() => fillProducts(grid, block, attempt + 1), 150);
      return;
    }
    const list = all.filter((p) => p.available !== false && (block.gender === 'All' || p.gender === block.gender || p.gender === 'Unisex')
      && (!block.category || p.cat === block.category)).slice(0, block.count || 4);
    shop.renderCards(grid, list);
  }

  function updateCountdown(node) {
    const left = new Date(node.dataset.countdown).getTime() - Date.now();
    if (left <= 0) {
      node.textContent = 'Happening now';
      return;
    }
    const parts = [
      [Math.floor(left / 86400000), 'days'],
      [Math.floor(left / 3600000) % 24, 'hours'],
      [Math.floor(left / 60000) % 60, 'mins'],
      [Math.floor(left / 1000) % 60, 'secs'],
    ];
    node.replaceChildren(...parts.map(([value, label]) => {
      const cell = el('div', 'studio-countdown-cell');
      cell.append(el('strong', '', String(value).padStart(2, '0')), el('span', '', label));
      return cell;
    }));
  }
  if (!reducedMotion) {
    setInterval(() => document.querySelectorAll('[data-countdown]').forEach(updateCountdown), 1000);
  }

  const revealObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('studio-in');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 }) : null;

  const rendered = new Map(); // block id -> { json, node }

  function applyBlocks(blocks) {
    const main = document.getElementById('main');
    if (!main || !Array.isArray(blocks)) return;
    const now = new Date();
    const builtins = new Map([...main.querySelectorAll('[data-block]')].map((node) => [node.dataset.block, node]));
    const used = new Set();

    blocks.forEach((block) => {
      if (block.type === 'builtin') {
        const node = builtins.get(block.key);
        if (!node) return;
        node.hidden = !block.enabled;
        main.appendChild(node);
        used.add(block.key);
        return;
      }
      const renderer = RENDERERS[block.type];
      const cached = rendered.get(block.id);
      if (!renderer || !block.enabled || !isScheduledNow(block, now)) {
        cached?.node.remove();
        rendered.delete(block.id);
        return;
      }
      const json = JSON.stringify(block);
      let node = cached?.node;
      if (!cached || cached.json !== json) {
        cached?.node.remove();
        try {
          node = renderer(block);
        } catch {
          rendered.delete(block.id);
          return;
        }
        node.dataset.studioBlock = block.id;
        const animation = block.animation || 'rise';
        if (animation !== 'none' && !reducedMotion) {
          node.classList.add('studio-anim', `studio-anim--${animation}`);
          revealObserver?.observe(node);
        }
        rendered.set(block.id, { json, node });
      }
      main.appendChild(node);
    });

    // Sections no longer in the list.
    const liveIds = new Set(blocks.map((block) => block.id));
    [...rendered.keys()].filter((id) => !liveIds.has(id)).forEach((id) => {
      rendered.get(id).node.remove();
      rendered.delete(id);
    });
    builtins.forEach((node, key) => { if (!used.has(key)) node.hidden = true; });

    // The moving headline strip belongs just above the Women and Men tiles.
    const marquee = main.querySelector('.fx-marquee');
    const split = builtins.get('split');
    if (marquee && split) {
      split.before(marquee);
      marquee.hidden = split.hidden;
    }
  }

  function apply(state) {
    if (!state) return;
    try {
      applyLook(state.look);
      applyTicker(state.ticker);
      if (document.body.classList.contains('home-page')) {
        applyHero(state.hero);
        applyBlocks(state.blocks);
      }
    } catch (error) {
      console.error('[studio] Could not apply site content', error);
    }
  }

  function start() {
    if (isPreview) {
      window.addEventListener('message', (event) => {
        if (event.origin !== window.location.origin) return;
        const message = event.data || {};
        if (message.type === 'zaevi:studio:state') apply(message.state);
        if (message.type === 'zaevi:studio:focus') {
          document.querySelector(`[data-studio-block="${CSS.escape(String(message.id))}"], [data-block="${CSS.escape(String(message.id).replace('builtin-', ''))}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      window.parent.postMessage({ type: 'zaevi:studio:ready' }, window.location.origin);
      return;
    }
    fetch('/api/site/studio', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => apply(body?.data?.state))
      .catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
