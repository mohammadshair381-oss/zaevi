(function () {
  'use strict';

  const ALLOWED_COMPONENTS = new Set([
    'hero', 'richText', 'imageText', 'gallery', 'featuredProducts',
    'productGrid', 'collectionShowcase', 'promoBanner', 'testimonials',
    'newsletter', 'faq', 'cta', 'spacer', 'divider',
    'headerVariant', 'footerVariant'
  ]);

  function isSafeUrl(value) {
    if (typeof value !== 'string' || value.trim() === '') return false;
    const url = value.trim();
    if (url.startsWith('/')) {
      return /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(url) && !url.includes('..') && !url.includes('\\');
    }
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  function isSafeColor(value) {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim());
  }

  function text(value) {
    return value == null ? '' : String(value);
  }

  function appendText(parent, tag, value, className) {
    if (typeof value !== 'string' || value.trim() === '') return;
    const node = document.createElement(tag);
    node.textContent = value.trim();
    if (className) node.className = className;
    parent.appendChild(node);
  }

  function appendImage(parent, url, alt) {
    if (!isSafeUrl(url)) return;
    const img = document.createElement('img');
    img.src = url.trim();
    img.alt = typeof alt === 'string' ? alt : '';
    img.loading = 'lazy';
    parent.appendChild(img);
  }

  function appendLink(parent, url, label, className) {
    if (typeof label !== 'string' || label.trim() === '' || !isSafeUrl(url)) return;
    const link = document.createElement('a');
    link.textContent = label.trim();
    link.href = url.trim();
    if (className) link.className = className;
    parent.appendChild(link);
  }

  function renderHero(props, section, document) {
    appendText(section, 'h1', props.heading);
    appendText(section, 'p', props.subheading);
    appendImage(section, props.image, props.alt);
    appendLink(section, props.ctaUrl, props.ctaLabel);
  }

  function renderRichText(props, section) {
    const paragraph = document.createElement('p');
    paragraph.textContent = text(props.text);
    section.appendChild(paragraph);
  }

  function renderImageText(props, section) {
    appendImage(section, props.image, props.alt);
    appendText(section, 'h2', props.heading);
    appendText(section, 'p', props.body);
    appendLink(section, props.buttonUrl, props.buttonLabel);
  }

  function renderGallery(props, section, document) {
    if (!Array.isArray(props.images)) return;
    const grid = document.createElement('div');
    grid.className = 'cms-gallery';
    const columns = Number.isInteger(props.columns) && props.columns >= 1 && props.columns <= 4 ? props.columns : 3;
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(' + columns + ', minmax(0, 1fr))';
    grid.style.gap = props.gap === 'small' ? '8px' : props.gap === 'large' ? '24px' : '16px';
    for (const image of props.images) {
      if (!image || typeof image !== 'object') continue;
      appendImage(grid, image.url, image.alt);
    }
    section.appendChild(grid);
  }

  function renderFeaturedProducts(props, section, document) {
    const title = document.createElement('h2');
    title.textContent = typeof props.title === 'string' ? props.title.trim() : 'Featured Products';
    section.appendChild(title);
    const list = document.createElement('div');
    list.className = 'cms-product-list';
    section.appendChild(list);
    const ids = Array.isArray(props.productIds) ? props.productIds.filter((id) => typeof id === 'string') : [];
    fetch('/api/products?limit=100', { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        const products = payload && Array.isArray(payload.data) ? payload.data : [];
        const byId = new Map(products.map((product) => [product.id, product]));
        for (const id of ids) {
          const product = byId.get(id);
          if (!product) continue;
          const card = document.createElement('article');
          card.className = 'cms-product-card';
          const name = document.createElement('h3');
          name.textContent = product.name;
          card.appendChild(name);
          const price = document.createElement('p');
          price.textContent = '₹' + Number(product.price).toLocaleString('en-IN');
          card.appendChild(price);
          if (isSafeUrl('/product.html?id=' + encodeURIComponent(product.id))) {
            const link = document.createElement('a');
            link.textContent = 'View product';
            link.href = '/product.html?id=' + encodeURIComponent(product.id);
            card.appendChild(link);
          }
          list.appendChild(card);
        }
        if (list.childElementCount === 0) {
          const empty = document.createElement('p');
          empty.textContent = 'No featured products are available.';
          list.appendChild(empty);
        }
      })
      .catch(() => {
        const error = document.createElement('p');
        error.textContent = 'Products are currently unavailable.';
        list.appendChild(error);
      });
  }

  function renderProductGrid(props, section) {
    const title = document.createElement('h2');
    title.textContent = typeof props.title === 'string' ? props.title.trim() : 'Products';
    section.appendChild(title);
    const list = document.createElement('div');
    list.className = 'cms-product-list';
    section.appendChild(list);

    const params = new URLSearchParams();
    if (typeof props.category === 'string' && props.category.trim() !== '') params.set('category', props.category.trim());
    if (typeof props.gender === 'string' && props.gender !== 'All') params.set('gender', props.gender);
    params.set('limit', String(Number.isInteger(props.limit) ? props.limit : 8));
    fetch('/api/products?' + params.toString(), { credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        const products = payload && Array.isArray(payload.data) ? payload.data : [];
        for (const product of products) {
          const card = document.createElement('article');
          card.className = 'cms-product-card';
          const name = document.createElement('h3');
          name.textContent = product.name;
          card.appendChild(name);
          const price = document.createElement('p');
          price.textContent = '₹' + Number(product.price).toLocaleString('en-IN');
          card.appendChild(price);
          const link = document.createElement('a');
          link.textContent = 'View product';
          link.href = '/product.html?id=' + encodeURIComponent(product.id);
          card.appendChild(link);
          list.appendChild(card);
        }
        if (list.childElementCount === 0) {
          const empty = document.createElement('p');
          empty.textContent = 'No products match this section.';
          list.appendChild(empty);
        }
      })
      .catch(() => {
        const error = document.createElement('p');
        error.textContent = 'Products are currently unavailable.';
        list.appendChild(error);
      });
  }

  function renderCollectionShowcase(props, section) {
    const title = document.createElement('h2');
    title.textContent = typeof props.title === 'string' ? props.title.trim() : 'Collections';
    section.appendChild(title);
    const list = document.createElement('ul');
    const collections = Array.isArray(props.collections) ? props.collections : [];
    for (const collection of collections) {
      if (typeof collection !== 'string' || collection.trim() === '') continue;
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.textContent = collection.trim();
      link.href = '/collections.html';
      item.appendChild(link);
      list.appendChild(item);
    }
    if (list.childElementCount === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No collections are configured.';
      section.appendChild(empty);
    } else {
      section.appendChild(list);
    }
  }

  function renderPromoBanner(props, section) {
    if (isSafeColor(props.backgroundColor)) section.style.backgroundColor = props.backgroundColor.trim();
    appendText(section, 'h2', props.text);
    appendImage(section, props.image, props.alt);
    appendLink(section, props.link, props.linkLabel || 'Learn more');
  }

  function renderTestimonials(props, section) {
    if (!Array.isArray(props.items)) return;
    for (const item of props.items) {
      if (!item || typeof item !== 'object') continue;
      const block = document.createElement('blockquote');
      const quote = document.createElement('p');
      quote.textContent = typeof item.quote === 'string' ? item.quote : '';
      block.appendChild(quote);
      const author = document.createElement('cite');
      author.textContent = typeof item.author === 'string' ? item.author : '';
      block.appendChild(author);
      if (isSafeUrl(item.avatar)) {
        const avatar = document.createElement('img');
        avatar.src = item.avatar.trim();
        avatar.alt = typeof item.author === 'string' ? item.author : '';
        avatar.loading = 'lazy';
        block.appendChild(avatar);
      }
      if (Number.isInteger(item.rating)) {
        const rating = document.createElement('p');
        rating.textContent = 'Rating: ' + item.rating + '/5';
        block.appendChild(rating);
      }
      section.appendChild(block);
    }
  }

  function renderNewsletter(props, section) {
    appendText(section, 'h2', props.heading);
    appendText(section, 'p', props.description);
    const form = document.createElement('form');
    const input = document.createElement('input');
    input.type = 'email';
    input.placeholder = typeof props.placeholder === 'string' ? props.placeholder : 'Your email address';
    form.appendChild(input);
    const button = document.createElement('button');
    button.type = isSafeUrl(props.actionUrl) ? 'submit' : 'button';
    button.textContent = typeof props.buttonLabel === 'string' ? props.buttonLabel : 'Subscribe';
    if (isSafeUrl(props.actionUrl)) form.action = props.actionUrl.trim();
    form.appendChild(button);
    section.appendChild(form);
  }

  function renderFaq(props, section) {
    if (!Array.isArray(props.items)) return;
    for (const item of props.items) {
      if (!item || typeof item !== 'object') continue;
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = typeof item.question === 'string' ? item.question : '';
      details.appendChild(summary);
      const answer = document.createElement('p');
      answer.textContent = typeof item.answer === 'string' ? item.answer : '';
      details.appendChild(answer);
      section.appendChild(details);
    }
  }

  function renderCta(props, section) {
    appendText(section, 'h2', props.heading);
    appendText(section, 'p', props.text);
    if (isSafeColor(props.backgroundColor)) section.style.backgroundColor = props.backgroundColor.trim();
    appendLink(section, props.buttonUrl, props.buttonLabel);
  }

  function renderHeaderVariant(props, section) {
    section.dataset.variant = typeof props.layout === 'string' ? props.layout : 'default';
    const label = document.createElement('p');
    label.textContent = 'Header variant: ' + (typeof props.layout === 'string' ? props.layout : 'default');
    section.appendChild(label);
  }

  function renderFooterVariant(props, section) {
    section.dataset.variant = typeof props.layout === 'string' ? props.layout : 'default';
    const label = document.createElement('p');
    label.textContent = 'Footer variant: ' + (typeof props.layout === 'string' ? props.layout : 'default');
    section.appendChild(label);
  }

  function renderComponent(component, document) {
    if (!component || typeof component !== 'object' || Array.isArray(component)) return null;
    if (!ALLOWED_COMPONENTS.has(component.type)) return null;
    if (typeof component.id !== 'string' || component.id.trim() === '') return null;
    if (!component.props || typeof component.props !== 'object' || Array.isArray(component.props)) return null;

    const props = component.props;
    const section = document.createElement('section');
    section.className = 'cms-section cms-' + component.type;
    section.dataset.cmsId = component.id;

    switch (component.type) {
      case 'hero': renderHero(props, section, document); break;
      case 'richText': renderRichText(props, section); break;
      case 'imageText': renderImageText(props, section); break;
      case 'gallery': renderGallery(props, section, document); break;
      case 'featuredProducts': renderFeaturedProducts(props, section, document); break;
      case 'productGrid': renderProductGrid(props, section); break;
      case 'collectionShowcase': renderCollectionShowcase(props, section); break;
      case 'promoBanner': renderPromoBanner(props, section); break;
      case 'testimonials': renderTestimonials(props, section); break;
      case 'newsletter': renderNewsletter(props, section); break;
      case 'faq': renderFaq(props, section); break;
      case 'cta': renderCta(props, section); break;
      case 'spacer': {
        const spacer = document.createElement('div');
        spacer.className = 'cms-spacer';
        spacer.dataset.size = typeof props.height === 'string' ? props.height : 'medium';
        section.appendChild(spacer);
        break;
      }
      case 'divider':
        section.appendChild(document.createElement('hr'));
        break;
      case 'headerVariant':
        renderHeaderVariant(props, section);
        break;
      case 'footerVariant':
        renderFooterVariant(props, section);
        break;
      default:
        return null;
    }

    return section;
  }

  function renderComponents(components, document, container) {
    if (!Array.isArray(components) || !container) return;
    container.replaceChildren();
    for (const component of components) {
      const node = renderComponent(component, document);
      if (node) container.appendChild(node);
    }
    container.hidden = container.childElementCount === 0;
  }

  async function applySettings() {
    try {
      const response = await fetch('/api/cms/settings/public', { credentials: 'same-origin' });
      if (!response.ok) return;
      const payload = await response.json();
      const settings = payload && payload.data ? payload.data : null;
      if (!settings || typeof settings !== 'object') return;

      const root = document.documentElement;
      if (isSafeColor(settings.primaryColor)) root.style.setProperty('--zaevi-primary', settings.primaryColor.trim());
      if (isSafeColor(settings.secondaryColor)) root.style.setProperty('--zaevi-secondary', settings.secondaryColor.trim());
      if (isSafeColor(settings.accentColor)) root.style.setProperty('--zaevi-accent', settings.accentColor.trim());
      if (isSafeColor(settings.backgroundColor)) root.style.setProperty('--zaevi-bg', settings.backgroundColor.trim());
      if (isSafeColor(settings.textColor)) root.style.setProperty('--zaevi-text', settings.textColor.trim());

      if (typeof settings.headingFont === 'string') root.style.setProperty('--zaevi-heading-font', settings.headingFont);
      if (typeof settings.bodyFont === 'string') root.style.setProperty('--zaevi-body-font', settings.bodyFont);

      if (typeof settings.logoUrl === 'string' && isSafeUrl(settings.logoUrl)) {
        document.querySelectorAll('img[data-cms="logo"]').forEach(function (img) {
          img.src = settings.logoUrl.trim();
        });
      }

      if (typeof settings.defaultSeoTitle === 'string' && settings.defaultSeoTitle.trim() !== '') {
        document.title = settings.defaultSeoTitle.trim();
      }
      if (typeof settings.defaultSeoDescription === 'string' && settings.defaultSeoDescription.trim() !== '') {
        const defaultMeta = document.querySelector('meta[name="description"]');
        if (defaultMeta) defaultMeta.setAttribute('content', settings.defaultSeoDescription.trim());
      }
      if (typeof settings.faviconUrl === 'string' && isSafeUrl(settings.faviconUrl)) {
        const icon = document.querySelector('link[rel~="icon"]');
        if (icon) icon.href = settings.faviconUrl.trim();
      }

      document.body.dataset.cmsHeader = typeof settings.headerLayout === 'string' ? settings.headerLayout : 'default';
      document.body.dataset.cmsFooter = typeof settings.footerLayout === 'string' ? settings.footerLayout : 'default';

      if (settings.announcementEnabled === true && typeof settings.announcementText === 'string' && settings.announcementText.trim() !== '') {
        let bar = document.getElementById('cms-announcement');
        if (!bar) {
          bar = document.createElement('div');
          bar.id = 'cms-announcement';
          bar.className = 'cms-announcement';
          if (document.body.firstChild) document.body.insertBefore(bar, document.body.firstChild);
          else document.body.appendChild(bar);
        }
        bar.textContent = settings.announcementText.trim();
        if (isSafeUrl(settings.announcementLink)) bar.dataset.href = settings.announcementLink.trim();
      }
    } catch (error) {
      // Public rendering must fail closed and leave the existing page intact.
    }
  }

  async function applyPageContent() {
    const mount = document.querySelector('#cms-root[data-cms-page]');
    if (!mount) return;
    const slug = mount.dataset.cmsPage;
    if (typeof slug !== 'string' || slug.trim() === '') return;

    try {
      const response = await fetch('/api/cms/pages/' + encodeURIComponent(slug.trim()) + '/published', {
        credentials: 'same-origin',
      });
      if (!response.ok) return;
      const payload = await response.json();
      const page = payload && payload.data ? payload.data : null;
      const snapshot = page && page.revision && page.revision.snapshot ? page.revision.snapshot : null;
      if (!snapshot || !Array.isArray(snapshot.components)) return;

      if (typeof page.seoTitle === 'string' && page.seoTitle.trim() !== '') document.title = page.seoTitle.trim();
      else if (typeof snapshot.title === 'string' && snapshot.title.trim() !== '') document.title = snapshot.title.trim();

      if (typeof page.seoDescription === 'string' && page.seoDescription.trim() !== '') {
        const pageMeta = document.querySelector('meta[name="description"]');
        if (pageMeta) pageMeta.setAttribute('content', page.seoDescription.trim());
      }

      renderComponents(snapshot.components, document, mount);
    } catch (error) {
      // Leave the existing storefront content in place.
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      applySettings();
      applyPageContent();
    });
  } else {
    applySettings();
    applyPageContent();
  }
})();