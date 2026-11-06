/**
 * ==========================================================================
 * ZAEVI — Luxury Enhancements & 3D Interactive Client Engine
 * Haute-couture micro-interactions, 3D perspective tilt, currency switching,
 * toast notifications, Quick View modal, and bespoke client services.
 * ==========================================================================
 */

(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // -------------------------------------------------------------------------
  // 1. Currency Conversion & Currency Selector
  // -------------------------------------------------------------------------
  const CURRENCY_RATES = {
    INR: { symbol: '₹', rate: 1, locale: 'en-IN', decimals: 0 },
    USD: { symbol: '$', rate: 0.012, locale: 'en-US', decimals: 0 },
    EUR: { symbol: '€', rate: 0.011, locale: 'de-DE', decimals: 0 },
    GBP: { symbol: '£', rate: 0.0095, locale: 'en-GB', decimals: 0 },
  };

  function getActiveCurrency() {
    return localStorage.getItem('zaeviCurrency') || 'INR';
  }

  function setActiveCurrency(curr) {
    if (!CURRENCY_RATES[curr]) curr = 'INR';
    localStorage.setItem('zaeviCurrency', curr);
    updateCurrencyDisplay();
  }

  function formatLuxuryPrice(inrPaiseOrRupees) {
    const val = Number(inrPaiseOrRupees);
    if (!Number.isFinite(val)) return '₹0';
    // If value is in paise (> 100000 usually or from order API minor) vs rupees in catalog
    // Catalog uses rupees (18900 = ₹18,900). APIs use minor (paise).
    const isPaise = val > 500000 && val % 100 === 0;
    const inrRupees = isPaise ? val / 100 : val;

    const curr = getActiveCurrency();
    const cfg = CURRENCY_RATES[curr] || CURRENCY_RATES.INR;
    const converted = Math.round(inrRupees * cfg.rate);
    return cfg.symbol + converted.toLocaleString(cfg.locale, { maximumFractionDigits: cfg.decimals });
  }

  window.formatLuxuryPrice = formatLuxuryPrice;

  function updateCurrencyDisplay() {
    const stray = document.getElementById('currSelector');
    if (stray) stray.remove();
  }

  // -------------------------------------------------------------------------
  // 2. Announcement Ticker Marquee Injection (Live & Clickable)
  // -------------------------------------------------------------------------
  function setupLuxuryTicker() {
    if (document.querySelector('.luxury-ticker') || document.body.classList.contains('checkout-page')) return;

    document.body.classList.add('has-luxury-ticker');

    const ticker = document.createElement('aside');
    ticker.className = 'luxury-ticker';
    ticker.setAttribute('role', 'region');
    ticker.setAttribute('aria-label', 'House Announcements');
    ticker.innerHTML = `
      <div class="luxury-ticker-track">
        <a href="shipping.html" class="luxury-ticker-item" title="Explore Complimentary Worldwide White-Glove Delivery">
          <span>COMPLIMENTARY WORLDWIDE WHITE-GLOVE DELIVERY</span>
          <span class="ticker-arrow" aria-hidden="true">→</span>
        </a>
        <a href="collections.html" class="luxury-ticker-item" title="View Autumn / Winter 2026 Couture Editions">
          <span>AUTUMN / WINTER 2026 COUTURE EDITIONS</span>
          <span class="ticker-arrow" aria-hidden="true">→</span>
        </a>
        <a href="about.html" class="luxury-ticker-item" title="Discover Bespoke Made-to-Order Atelier Craftsmanship">
          <span>BESPOKE MADE-TO-ORDER ATELIER CRAFTSMANSHIP</span>
          <span class="ticker-arrow" aria-hidden="true">→</span>
        </a>
        <a href="returns.html" class="luxury-ticker-item" title="Learn About 14-Day Complimentary Returns and Exchanges">
          <span>14-DAY COMPLIMENTARY RETURNS &amp; EXCHANGES</span>
          <span class="ticker-arrow" aria-hidden="true">→</span>
        </a>
        <a href="shipping.html" class="luxury-ticker-item" title="Explore Complimentary Worldwide White-Glove Delivery" aria-hidden="true" tabindex="-1">
          <span>COMPLIMENTARY WORLDWIDE WHITE-GLOVE DELIVERY</span>
          <span class="ticker-arrow">→</span>
        </a>
        <a href="collections.html" class="luxury-ticker-item" title="View Autumn / Winter 2026 Couture Editions" aria-hidden="true" tabindex="-1">
          <span>AUTUMN / WINTER 2026 COUTURE EDITIONS</span>
          <span class="ticker-arrow">→</span>
        </a>
        <a href="about.html" class="luxury-ticker-item" title="Discover Bespoke Made-to-Order Atelier Craftsmanship" aria-hidden="true" tabindex="-1">
          <span>BESPOKE MADE-TO-ORDER ATELIER CRAFTSMANSHIP</span>
          <span class="ticker-arrow">→</span>
        </a>
        <a href="returns.html" class="luxury-ticker-item" title="Learn About 14-Day Complimentary Returns and Exchanges" aria-hidden="true" tabindex="-1">
          <span>14-DAY COMPLIMENTARY RETURNS &amp; EXCHANGES</span>
          <span class="ticker-arrow">→</span>
        </a>
      </div>
    `;

    document.body.insertBefore(ticker, document.body.firstChild);
  }

  // -------------------------------------------------------------------------
  // 3. Global Toast Notification System
  // -------------------------------------------------------------------------
  function ensureToastContainer() {
    let container = document.getElementById('zaevi-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'zaevi-toast-container';
      container.setAttribute('aria-live', 'polite');
      document.body.appendChild(container);
    }
    return container;
  }

  function showLuxuryToast(title, message, icon = '✦') {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = 'zaevi-toast';
    toast.innerHTML = `
      <div class="zaevi-toast-icon">${icon}</div>
      <div class="zaevi-toast-body">
        <div class="zaevi-toast-title">${title}</div>
        <div class="zaevi-toast-desc">${message}</div>
      </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 350);
    }, 4200);
  }

  window.zaeviToast = showLuxuryToast;

  // -------------------------------------------------------------------------
  // 4. 3D Perspective Card Tilt Physics & Dynamic Lighting Sheen
  // -------------------------------------------------------------------------
  function setup3DCardTilt() {
    document.querySelectorAll('.product').forEach((card) => {
      if (card.__hasTilt) return;
      card.__hasTilt = true;

      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        const inner = card.querySelector('.product-card-inner') || card;
        inner.style.transform = `perspective(1000px) rotateY(${x * 7}deg) rotateX(${-y * 7}deg) translateY(-6px)`;
        card.style.setProperty('--sheen-x', `${((x + 0.5) * 100).toFixed(1)}%`);
        card.style.setProperty('--sheen-y', `${((y + 0.5) * 100).toFixed(1)}%`);
      });

      card.addEventListener('mouseleave', () => {
        const inner = card.querySelector('.product-card-inner') || card;
        inner.style.transform = '';
      });
    });
  }

  // -------------------------------------------------------------------------
  // 5. Quick View Modal Engine
  // -------------------------------------------------------------------------
  let cachedProducts = null;

  async function getCatalogProducts() {
    if (cachedProducts) return cachedProducts;
    // The database is the live catalogue, so products edited in the admin appear here too.
    try {
      const res = await fetch('/api/products?limit=100');
      if (res.ok) {
        const body = await res.json();
        if (Array.isArray(body.data) && body.data.length) {
          cachedProducts = body.data.map((p) => ({
            id: p.id, name: p.name, cat: p.category, gender: p.gender, price: p.price, color: p.color,
            img: p.imageUrl, hover: p.hoverImageUrl, desc: p.description, sizes: p.sizes, available: p.available,
          }));
          return cachedProducts;
        }
      }
    } catch (e) {}
    try {
      const res = await fetch('products.json');
      if (res.ok) {
        cachedProducts = await res.json();
        return cachedProducts;
      }
    } catch (e) {}
    return [];
  }

  function ensureQuickViewModal() {
    let overlay = document.getElementById('quickViewOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'quickViewOverlay';
      overlay.className = 'quick-view-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.innerHTML = `
        <div class="quick-view-dialog" id="quickViewDialog" role="dialog" aria-modal="true" aria-label="Quick View">
          <button class="quick-view-close" id="quickViewClose" type="button" aria-label="Close Quick View">×</button>
          <div id="quickViewContent" style="display:contents"></div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.closest('#quickViewClose')) {
          closeQuickView();
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('active')) {
          closeQuickView();
        }
      });
    }
    return overlay;
  }

  function closeQuickView() {
    const overlay = document.getElementById('quickViewOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('lock');
    }
  }

  async function openQuickView(productId) {
    const overlay = ensureQuickViewModal();
    const content = document.getElementById('quickViewContent');
    if (!content) return;

    content.innerHTML = '<div style="padding:60px;grid-column:1/-1;text-align:center">Loading atelier piece…</div>';
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lock');

    const products = await getCatalogProducts();
    const p = products.find((x) => x.id === productId);
    if (!p) {
      content.innerHTML = '<div style="padding:60px;grid-column:1/-1;text-align:center">Piece unavailable.</div>';
      return;
    }

    const sizes = Array.isArray(p.sizes) ? p.sizes : ['One Size'];
    const formattedPrice = formatLuxuryPrice(p.price);

    content.innerHTML = `
      <div style="position:relative;background:var(--zaevi-parchment)">
        <img class="quick-view-img" src="${p.img}" alt="${p.name}">
        <span class="bespoke-chip" style="top:18px;left:18px;">ATELIER CRAFTSMANSHIP</span>
      </div>
      <div class="quick-view-content">
        <div class="eyebrow" style="margin-bottom:8px;">ZAEVI / ${p.gender.toUpperCase()} / ${p.cat.toUpperCase()}</div>
        <h2 style="font-family:var(--zaevi-font-serif);font-size:32px;font-weight:300;margin:0 0 10px;line-height:1.1;">${p.name}</h2>
        <div style="font-family:var(--zaevi-font-sans);font-size:18px;font-weight:500;color:var(--zaevi-obsidian);margin-bottom:16px;">${formattedPrice}</div>
        <p style="font-size:13.5px;line-height:1.75;color:var(--muted);margin-bottom:20px;">${p.desc || 'An impeccably tailored garment crafted on demand by the House of ZAEVI.'}</p>
        
        <div style="margin-bottom:20px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;">SELECT SIZE</span>
            <a href="size-guide.html" style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);text-decoration:underline;">Size Guide</a>
          </div>
          <div class="sizes" id="qvSizes" style="display:flex;gap:8px;flex-wrap:wrap;">
            ${sizes.map((s, idx) => `<button type="button" class="size-btn ${idx === 0 ? 'selected' : ''}" data-size="${s}" style="min-width:44px;height:40px;padding:0 12px;border:1px solid var(--line-strong);background:transparent;color:var(--ink);font-size:12px;cursor:pointer;text-transform:uppercase;">${s}</button>`).join('')}
          </div>
        </div>

        <div style="display:flex;gap:10px;margin-top:auto;">
          <button type="button" id="qvAddBtn" class="button button--primary" style="flex:1;min-height:48px;">ADD TO BAG</button>
          <a href="product.html?id=${encodeURIComponent(p.id)}" class="button button--secondary" style="min-height:48px;">FULL DETAILS</a>
        </div>

        <div style="margin-top:20px;padding:10px;background:var(--zaevi-silk);border:1px solid var(--zaevi-hairline);font-size:11.5px;color:var(--muted);line-height:1.6;">
          ✦ <strong>Made-to-Order</strong>: Tailored specifically upon order. Complimentary white-glove dispatch within 5-7 business days.
        </div>
      </div>
    `;

    // Size button selection
    const sizeBtns = content.querySelectorAll('#qvSizes .size-btn');
    let selectedSize = sizes[0] || 'One Size';
    sizeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        sizeBtns.forEach((b) => {
          b.classList.remove('selected');
          b.style.background = 'transparent';
          b.style.color = 'var(--ink)';
          b.style.borderColor = 'var(--line-strong)';
        });
        btn.classList.add('selected');
        btn.style.background = 'var(--zaevi-obsidian)';
        btn.style.color = 'var(--on-ink)';
        btn.style.borderColor = 'var(--zaevi-obsidian)';
        selectedSize = btn.dataset.size;
      });
    });

    // Initial highlight for first button
    if (sizeBtns[0]) {
      sizeBtns[0].style.background = 'var(--zaevi-obsidian)';
      sizeBtns[0].style.color = 'var(--on-ink)';
      sizeBtns[0].style.borderColor = 'var(--zaevi-obsidian)';
    }

    // Add to bag button
    const addBtn = content.querySelector('#qvAddBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        if (typeof window.add === 'function') {
          window.add(p.id, selectedSize);
        } else if (typeof window.addToBag === 'function') {
          window.addToBag(p.id, selectedSize);
        } else {
          // Fallback to localStorage cart directly
          const CART_KEY = 'zaeviCart';
          let cart = [];
          try { cart = JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch (e) {}
          const existing = cart.find((x) => x.id === p.id && x.size === selectedSize);
          if (existing) { existing.qty = (existing.qty || 1) + 1; }
          else { cart.push({ id: p.id, name: p.name, price: p.price, img: p.img, qty: 1, size: selectedSize }); }
          localStorage.setItem(CART_KEY, JSON.stringify(cart));
          document.querySelectorAll('.bagnum').forEach((el) => {
            el.textContent = cart.reduce((s, x) => s + (x.qty || 1), 0);
          });
        }
        closeQuickView();
        showLuxuryToast('Added to Atelier Bag', `${p.name} · Size ${selectedSize}`, '✦');
      });
    }
  }

  window.openQuickView = openQuickView;

  // -------------------------------------------------------------------------
  // 6. Enhance Existing Product Cards with Quick Actions
  // -------------------------------------------------------------------------
  function enhanceProductCards() {
    document.querySelectorAll('.product').forEach((card) => {
      if (card.__hasLuxuryEnhancements) return;
      card.__hasLuxuryEnhancements = true;

      // Extract product ID
      const link = card.querySelector('a[href*="product.html?id="]');
      if (!link) return;
      const url = new URL(link.href, window.location.origin);
      const id = url.searchParams.get('id');
      if (!id) return;

      // Wrap in .product-card-inner if not present
      if (!card.querySelector('.product-card-inner')) {
        const inner = document.createElement('div');
        inner.className = 'product-card-inner';
        while (card.firstChild) {
          inner.appendChild(card.firstChild);
        }
        card.appendChild(inner);
      }

      // Add Quick Action buttons
      const inner = card.querySelector('.product-card-inner');
      if (inner && !inner.querySelector('.product-quick-actions')) {
        const actions = document.createElement('div');
        actions.className = 'product-quick-actions';
        actions.innerHTML = `
          <button class="quick-view-btn" type="button" data-qv="${id}">Quick View</button>
          <button class="quick-3d-btn" type="button" data-3d="${id}" title="Experience in 3D Atelier">✦ 3D</button>
          <button class="quick-add-btn" type="button" data-qa="${id}">+ Bag</button>
        `;

        actions.querySelector('.quick-view-btn')?.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openQuickView(id);
        });

        actions.querySelector('.quick-3d-btn')?.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const products = await getCatalogProducts();
          const p = products.find((x) => x.id === id);
          if (typeof window.open3DStudio === 'function') {
            window.open3DStudio({ name: p ? p.name : 'Atelier Garment', id: id });
          } else {
            openQuickView(id);
          }
        });

        actions.querySelector('.quick-add-btn')?.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const products = await getCatalogProducts();
          const p = products.find((x) => x.id === id);
          if (!p) return;
          const defaultSize = (p.sizes && p.sizes[0]) || 'One Size';
          if (p.sizes && p.sizes.length > 1) {
            // If multiple sizes exist, open quick view for customer selection
            openQuickView(id);
          } else {
            if (typeof window.add === 'function') {
              window.add(p.id, defaultSize);
            }
            showLuxuryToast('Added to Atelier Bag', `${p.name} · ${defaultSize}`, '✦');
          }
        });

        inner.appendChild(actions);
      }
    });

    setup3DCardTilt();
  }

  // -------------------------------------------------------------------------
  // 7. Real Working Newsletter Integration
  // -------------------------------------------------------------------------
  function setupNewsletterForm() {
    document.querySelectorAll('.newsletter form').forEach((form) => {
      if (form.__hasLuxuryWire) return;
      form.__hasLuxuryWire = true;

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = form.querySelector('input[type="email"]');
        const email = String(input?.value || '').trim();
        const status = form.closest('.newsletter')?.querySelector('.newsletter-status') || form.querySelector('.newsletter-status');

        if (!email) return;

        try {
          const res = await fetch('/api/newsletter/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });

          if (res.ok) {
            // The offer comes from the server, so it always matches the real coupon.
            const body = await res.json().catch(() => ({}));
            const offer = body.data?.offer;
            if (status) {
              status.textContent = `Thank you for subscribing to ZAEVI.${offer ? ` ${offer.message}` : ''}${body.data?.emailNotice ? ` ${body.data.emailNotice}` : ''}`;
              status.className = 'newsletter-status is-visible';
            }
            showLuxuryToast('Welcome to ZAEVI', 'Your subscription is active.', '✦');
            if (input) input.value = '';
          } else {
            const err = await res.json().catch(() => ({}));
            if (status) {
              status.textContent = err.error?.message || 'Could not subscribe. Please check your email.';
              status.className = 'newsletter-status is-error';
            }
          }
        } catch (err) {
          if (status) {
            status.textContent = 'We could not reach the server. Please try again.';
            status.className = 'newsletter-status is-error';
          }
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // 8. Contact Concierge Service Submission
  // -------------------------------------------------------------------------
  function setupContactForm() {
    const form = document.querySelector('.contact-form');
    if (!form || form.__hasLuxuryWire) return;
    form.__hasLuxuryWire = true;

    const status = document.getElementById('contactStatus');
    const button = form.querySelector('button[type="submit"]');
    const say = (text, isError) => {
      if (!status) return;
      status.textContent = text;
      status.classList.toggle('is-error', Boolean(isError));
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = (id) => document.getElementById(id)?.value || '';
      say('Sending your message…');
      if (button) button.disabled = true;
      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: value('contactName'),
            email: value('contactEmail'),
            order: value('contactOrder'),
            subject: value('contactSubject'),
            message: value('contactMessage'),
            website: form.querySelector('[name="website"]')?.value || '',
          }),
        });
        if (res.ok) {
          say(`Thank you. We have received your message and will reply to ${value('contactEmail')}.`);
          form.reset();
        } else {
          const body = await res.json().catch(() => ({}));
          say(body.error?.message || 'Your message could not be sent. Please try again.', true);
        }
      } catch (err) {
        say('Your message could not be sent. Please check your connection and try again.', true);
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  // -------------------------------------------------------------------------
  // 9. Interactive Size Guide Unit Switcher
  // -------------------------------------------------------------------------
  function setupSizeGuideUnitToggle() {
    const tableWrap = document.querySelector('.table-wrap');
    if (!tableWrap || document.getElementById('unitToggleContainer')) return;

    const toggle = document.createElement('div');
    toggle.id = 'unitToggleContainer';
    toggle.className = 'size-unit-toggle';
    toggle.innerHTML = `
      <button type="button" class="unit-toggle-btn active" data-unit="cm">Centimetres (CM)</button>
      <button type="button" class="unit-toggle-btn" data-unit="in">Inches (IN)</button>
    `;

    tableWrap.parentNode.insertBefore(toggle, tableWrap);

    const originalRows = [
      { size: 'XS', bust: [80, 84], waist: [62, 66], hip: [88, 92] },
      { size: 'S', bust: [84, 88], waist: [66, 70], hip: [92, 96] },
      { size: 'M', bust: [88, 92], waist: [70, 74], hip: [96, 100] },
      { size: 'L', bust: [92, 97], waist: [74, 79], hip: [100, 105] },
      { size: 'XL', bust: [97, 102], waist: [79, 84], hip: [105, 110] },
    ];

    const tbody = document.querySelector('.size-table tbody');
    const thead = document.querySelector('.size-table thead');

    toggle.querySelectorAll('.unit-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        toggle.querySelectorAll('.unit-toggle-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const unit = btn.dataset.unit;

        if (thead) {
          thead.innerHTML = `<tr><th scope="col">Size</th><th scope="col">Bust (${unit.toUpperCase()})</th><th scope="col">Waist (${unit.toUpperCase()})</th><th scope="col">Hip (${unit.toUpperCase()})</th></tr>`;
        }

        if (tbody) {
          tbody.innerHTML = originalRows.map((r) => {
            if (unit === 'in') {
              const b1 = (r.bust[0] / 2.54).toFixed(1), b2 = (r.bust[1] / 2.54).toFixed(1);
              const w1 = (r.waist[0] / 2.54).toFixed(1), w2 = (r.waist[1] / 2.54).toFixed(1);
              const h1 = (r.hip[0] / 2.54).toFixed(1), h2 = (r.hip[1] / 2.54).toFixed(1);
              return `<tr><th scope="row">${r.size}</th><td>${b1}–${b2}</td><td>${w1}–${w2}</td><td>${h1}–${h2}</td></tr>`;
            } else {
              return `<tr><th scope="row">${r.size}</th><td>${r.bust[0]}–${r.bust[1]}</td><td>${r.waist[0]}–${r.waist[1]}</td><td>${r.hip[0]}–${r.hip[1]}</td></tr>`;
            }
          }).join('');
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // 10. Interactive Journal Reading Modal
  // -------------------------------------------------------------------------
  const JOURNAL_STORIES = {
    0: {
      title: 'The Language of Black',
      subtitle: 'Obsidian, Noir and the Architecture of Shadow',
      date: 'Autumn / Winter 2026',
      author: 'Atelier Director',
      img: 'https://images.unsplash.com/photo-1445205170230-053b83016050?auto=format&fit=crop&w=1400&q=90',
      content: `
        <p>In high fashion, black is never merely the absence of light; it is a sculpted discipline of proportion, silhouette, and tactile depth. Within the ZAEVI Autumn/Winter 2026 atelier, our obsession with noir begins with the choice of yarn.</p>
        <p>We source heavy double-faced wool crepe and fluid mulberry silk that absorb and refract ambient luminescence in distinct measures. When a coat moves, the fold catches a shadow; when the lapel turns, the matte finish gives way to subtle satin piping.</p>
        <blockquote>"Elegance is the refusal to shout in an echo chamber of excess."</blockquote>
        <p>Each piece in the Nocturne edit was developed over twelve months of draping directly on live house models in our workshop. The result is tailoring that feels weightless yet possesses resolute presence.</p>
      `,
    },
    1: {
      title: 'Behind the Collection',
      subtitle: 'From Atelier Sketch to the Finished Silhouette',
      date: 'Autumn / Winter 2026',
      author: 'House of ZAEVI',
      img: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1400&q=90',
      content: `
        <p>Every collection begins with a tactile dialogue between fabric and architecture. Rather than drawing seasonal trends, our design studio works with enduring geometric forms: the column, the ellipse, the sharp shoulder line.</p>
        <p>Because ZAEVI champions bespoke on-demand production, no excess yardage is committed before an order is placed. When a client commissions a jacket or gown, our master patternmakers grade the garment individually.</p>
        <p>The buttons are carved from sustainably harvested horn; the interlinings use natural horsehair canvas that breathes and shapes to the wearer's contours over years of wear.</p>
      `,
    },
    2: {
      title: 'The New Silhouette',
      subtitle: 'Modern Draping and Uncompromising Fluidity',
      date: 'Autumn / Winter 2026',
      author: 'Senior Couturier',
      img: 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=1400&q=90',
      content: `
        <p>A dress must celebrate the human form in motion. When designing the Aurelia dress, our goal was to eliminate rigid horizontal seams across the waistline, allowing the silk georgette to cascade in an uninterrupted diagonal sweep.</p>
        <p>The subtle asymmetry at the hemline creates dynamic momentum as the wearer walks, embodying the effortless modern elegance that defines the ZAEVI house code.</p>
      `,
    },
  };

  function setupJournalModal() {
    const journalGrid = document.querySelector('.journal-page .catalog .product-grid');
    if (!journalGrid || journalGrid.__hasWire) return;
    journalGrid.__hasWire = true;

    journalGrid.querySelectorAll('.product').forEach((card, index) => {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        const story = JOURNAL_STORIES[index] || JOURNAL_STORIES[0];
        openJournalStory(story);
      });
    });
  }

  function openJournalStory(story) {
    let overlay = document.getElementById('journalStoryOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'journalStoryOverlay';
      overlay.className = 'quick-view-overlay';
      overlay.innerHTML = `
        <div class="quick-view-dialog" style="max-width:760px;display:block;padding:clamp(28px,5vw,56px);background:var(--paper-soft);" role="dialog" aria-modal="true" aria-label="Journal story">
          <button class="quick-view-close" id="journalClose" type="button" aria-label="Close">×</button>
          <div id="journalStoryBody"></div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.closest('#journalClose')) {
          overlay.classList.remove('active');
          document.body.classList.remove('lock');
        }
      });
    }

    const body = document.getElementById('journalStoryBody');
    body.innerHTML = `
      <div class="eyebrow" style="color:var(--zaevi-gold-dark);margin-bottom:8px;">${story.date} · ${story.author}</div>
      <h1 style="font-family:var(--zaevi-font-serif);font-size:clamp(36px,5vw,54px);font-weight:300;margin:0 0 10px;line-height:1.05;">${story.title}</h1>
      <div style="font-size:14px;color:var(--muted);letter-spacing:0.12em;text-transform:uppercase;margin-bottom:24px;">${story.subtitle}</div>
      <img src="${story.img}" alt="${story.title}" style="width:100%;height:320px;object-fit:cover;border-radius:2px;margin-bottom:28px;">
      <div style="font-size:15px;line-height:1.9;color:var(--ink-2);">${story.content}</div>
      <div style="margin-top:36px;padding-top:20px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);">ZAEVI EDITORIAL ARCHIVE</span>
        <a href="collections.html" class="button button--primary" style="padding:10px 20px;">EXPLORE COLLECTION</a>
      </div>
    `;

    overlay.classList.add('active');
    document.body.classList.add('lock');
  }

  // -------------------------------------------------------------------------
  // 11. PDP Accordions & Related Products
  // -------------------------------------------------------------------------
  function setupPdpAccordions() {
    document.querySelectorAll('.pdp-accordion-toggle').forEach((btn) => {
      if (btn.__hasWire) return;
      btn.__hasWire = true;
      btn.addEventListener('click', () => {
        const item = btn.closest('.pdp-accordion-item');
        if (!item) return;
        const isOpen = item.classList.contains('open');
        item.classList.toggle('open', !isOpen);
        const content = item.querySelector('.pdp-accordion-content');
        if (content) content.style.display = isOpen ? 'none' : 'block';
      });
    });
  }

  async function setupPdpRelatedProducts() {
    const grid = document.getElementById('relatedGrid');
    if (!grid) return;
    const currentId = new URLSearchParams(window.location.search).get('id');
    const products = await getCatalogProducts();
    const related = products.filter((p) => p.id !== currentId).slice(0, 4);

    grid.innerHTML = related.map((p) => {
      const liked = (function () {
        try { return (JSON.parse(localStorage.getItem('zaeviWish')) || []).includes(p.id); } catch (e) { return false; }
      })();
      return `
        <article class="product reveal in" data-cat="${p.cat}" data-name="${p.name}" data-price="${p.price}">
          <div class="product-card-inner">
            <a href="product.html?id=${encodeURIComponent(p.id)}">
              <div class="product-img">
                <img class="p1" src="${p.img}" alt="${p.name}" loading="lazy">
                <img class="p2" src="${p.hover}" alt="${p.name}" loading="lazy">
                <span class="badge bespoke-chip">CURATED PAIRING</span>
              </div>
              <div class="meta"><span>${p.name}</span><span>${formatLuxuryPrice(p.price)}</span></div>
              <div class="sub">${p.cat} · ${p.color}</div>
            </a>
            <div class="product-quick-actions">
              <button class="quick-view-btn" type="button" data-qv="${p.id}">Quick View</button>
              <button class="quick-add-btn" type="button" data-qa="${p.id}">+ Bag</button>
            </div>
            <button class="wish" type="button" data-wish="${p.id}" aria-label="Wishlist" aria-pressed="${liked}"><span aria-hidden="true">${liked ? '♥' : '♡'}</span></button>
          </div>
        </article>
      `;
    }).join('');

    enhanceProductCards();
  }

  // -------------------------------------------------------------------------
  // Official contact address: shown only once it has been configured on the server
  // -------------------------------------------------------------------------
  async function applyOfficialContactEmail() {
    if (!document.querySelector('[data-official-email]')) return;
    try {
      const res = await fetch('/api/contact/config');
      const body = res.ok ? await res.json() : null;
      const email = body?.data?.email;
      if (!email) return;
      document.querySelectorAll('[data-official-email]').forEach((link) => {
        link.href = `mailto:${email}`;
        link.textContent = email;
      });
      document.querySelectorAll('[data-official-email-block]').forEach((block) => { block.hidden = false; });
    } catch (e) { /* the contact form remains available */ }
  }

  // -------------------------------------------------------------------------
  // 12. Master Boot Orchestrator
  // -------------------------------------------------------------------------
  function initLuxuryExperience() {
    const stray = document.getElementById('currSelector');
    if (stray) stray.remove();

    setupLuxuryTicker();
    setupNewsletterForm();
    setupContactForm();
    applyOfficialContactEmail();
    setupSizeGuideUnitToggle();
    setupJournalModal();
    setupPdpAccordions();
    setupPdpRelatedProducts();

    enhanceProductCards();

    // Re-check cards when dynamically rendered (debounced and targeted)
    let cardEnhanceDebounce = null;
    const observer = new MutationObserver((mutations) => {
      const hasAddedCards = mutations.some((m) => {
        if (!m.addedNodes || m.addedNodes.length === 0) return false;
        for (let i = 0; i < m.addedNodes.length; i++) {
          const node = m.addedNodes[i];
          if (node.nodeType === 1 && (node.matches?.('.product, article') || node.querySelector?.('.product, article'))) {
            return true;
          }
        }
        return false;
      });

      if (!hasAddedCards) return;

      if (cardEnhanceDebounce) clearTimeout(cardEnhanceDebounce);
      cardEnhanceDebounce = setTimeout(() => {
        enhanceProductCards();
        cardEnhanceDebounce = null;
      }, 120);
    });

    const candidateRoots = document.querySelectorAll('#homeGrid, #catalogGrid, #wishGrid, #relatedGrid, .products, .grid');
    if (candidateRoots.length > 0) {
      candidateRoots.forEach((root) => {
        observer.observe(root, { childList: true, subtree: true });
      });
    } else {
      const main = document.getElementById('main') || document.body;
      observer.observe(main, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLuxuryExperience);
  } else {
    initLuxuryExperience();
  }
})();
