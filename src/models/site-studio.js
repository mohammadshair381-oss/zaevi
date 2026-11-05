/**
 * Site Studio content model: what an administrator can add, order and animate on the
 * storefront. Everything is validated here, so a mistake in the editor can never break
 * the live site. Text is always rendered as text, never as HTML.
 */
const ANIMATIONS = ['rise', 'curtain', 'slide', 'zoom', 'none'];
const SPEEDS = ['slow', 'normal', 'fast'];
const BUILTIN_KEYS = ['intro', 'feature', 'shop', 'split', 'manifesto', 'craft', 'journal', 'newsletter'];
const MAX_BLOCKS = 40;
const MAX_TICKER_ITEMS = 12;
const MAX_GALLERY_IMAGES = 12;

export const STUDIO_ACCENTS = ['rouge', 'sapphire', 'emerald', 'amber'];
export const STUDIO_BLOCK_TYPES = ['builtin', 'ribbon', 'event', 'banner', 'text', 'imageText', 'products', 'gallery'];

export const STUDIO_DEFAULT_STATE = Object.freeze({
  version: 1,
  look: { accent: 'rouge', silkColor: 'silk', motion: 'normal', silkEnabled: true, monogramEnabled: true },
  ticker: {
    enabled: true,
    speed: 'normal',
    items: [
      { text: 'Complimentary worldwide white-glove delivery', link: 'shipping.html' },
      { text: 'Autumn / Winter 2026 couture editions', link: 'collections.html' },
      { text: 'Bespoke made-to-order atelier craftsmanship', link: 'about.html' },
      { text: '14-day complimentary returns & exchanges', link: 'returns.html' },
    ],
  },
  hero: {
    eyebrow: 'ZAEVI — Autumn / Winter 2026',
    line1: 'The Art',
    line2: 'of Elegance',
    subtitle: 'A new expression of timeless luxury',
    ctaLabel: 'Discover the collection',
    ctaLink: 'collections.html',
  },
  blocks: BUILTIN_KEYS.map((key) => ({ id: `builtin-${key}`, type: 'builtin', key, enabled: true })),
});

/** https links, or links inside this site. Blocks javascript:, data: and //other-site. */
export function isSafeStudioUrl(value) {
  if (typeof value !== 'string') return false;
  const url = value.trim();
  if (url === '') return true;
  if (url.startsWith('//') || /[\s\\]/.test(url)) return false;
  if (/^https:\/\//i.test(url)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false;
  return true;
}

class Reader {
  constructor(errors, where) {
    this.errors = errors;
    this.where = where;
  }

  text(source, key, max, { required = false, label = key } = {}) {
    const raw = source?.[key];
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      this.errors.push(`${this.where}: ${label} must be text`);
      return '';
    }
    const value = String(raw ?? '').trim();
    if (value.length > max) this.errors.push(`${this.where}: ${label} must be ${max} characters or fewer`);
    if (required && !value) this.errors.push(`${this.where}: ${label} is required`);
    return value.slice(0, max);
  }

  url(source, key, { label = key } = {}) {
    const value = this.text(source, key, 1024, { label });
    if (!isSafeStudioUrl(value)) {
      this.errors.push(`${this.where}: ${label} must be a page on this site or an https:// link`);
      return '';
    }
    return value;
  }

  choice(source, key, options, fallback) {
    const value = source?.[key];
    if (value === undefined || value === null || value === '') return fallback;
    if (!options.includes(value)) {
      this.errors.push(`${this.where}: ${key} must be one of ${options.join(', ')}`);
      return fallback;
    }
    return value;
  }

  bool(source, key, fallback) {
    const value = source?.[key];
    return typeof value === 'boolean' ? value : fallback;
  }

  date(source, key, { required = false, label = key } = {}) {
    const raw = source?.[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) this.errors.push(`${this.where}: ${label} is required`);
      return '';
    }
    const parsed = new Date(raw);
    if (typeof raw !== 'string' || Number.isNaN(parsed.getTime())) {
      this.errors.push(`${this.where}: ${label} must be a valid date`);
      return '';
    }
    return parsed.toISOString();
  }
}

function validateBlock(input, index, errors, seenIds) {
  const where = `Section ${index + 1}`;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push(`${where}: invalid section`);
    return null;
  }
  const read = new Reader(errors, where);
  const type = read.choice(input, 'type', STUDIO_BLOCK_TYPES, null);
  if (!type) {
    errors.push(`${where}: a section type is required`);
    return null;
  }

  let id = read.text(input, 'id', 64);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || seenIds.has(id)) id = `${type}-${index + 1}-${seenIds.size + 1}`;
  seenIds.add(id);

  const common = {
    id,
    type,
    enabled: read.bool(input, 'enabled', true),
    animation: read.choice(input, 'animation', ANIMATIONS, 'rise'),
    showFrom: read.date(input, 'showFrom', { label: 'Show from' }),
    showUntil: read.date(input, 'showUntil', { label: 'Show until' }),
  };
  if (common.showFrom && common.showUntil && common.showFrom > common.showUntil) {
    errors.push(`${where}: Show until must be after Show from`);
  }

  switch (type) {
    case 'builtin': {
      const key = read.choice(input, 'key', BUILTIN_KEYS, null);
      if (!key) {
        errors.push(`${where}: unknown built-in section`);
        return null;
      }
      return { id, type, key, enabled: common.enabled };
    }
    case 'ribbon':
      return {
        ...common,
        text: read.text(input, 'text', 120, { required: true, label: 'Ribbon text' }),
        link: read.url(input, 'link', { label: 'Link' }),
        speed: read.choice(input, 'speed', SPEEDS, 'normal'),
        direction: read.choice(input, 'direction', ['left', 'right'], 'left'),
        style: read.choice(input, 'style', ['outline', 'solid', 'accent'], 'accent'),
      };
    case 'event':
      return {
        ...common,
        title: read.text(input, 'title', 120, { required: true, label: 'Event name' }),
        date: read.date(input, 'date', { required: true, label: 'Event date' }),
        location: read.text(input, 'location', 120),
        description: read.text(input, 'description', 600),
        image: read.url(input, 'image', { label: 'Image' }),
        ctaLabel: read.text(input, 'ctaLabel', 40, { label: 'Button text' }),
        link: read.url(input, 'link', { label: 'Button link' }),
        showCountdown: read.bool(input, 'showCountdown', true),
        hideAfterEvent: read.bool(input, 'hideAfterEvent', true),
      };
    case 'banner':
      return {
        ...common,
        eyebrow: read.text(input, 'eyebrow', 80),
        title: read.text(input, 'title', 120, { required: true, label: 'Title' }),
        subtitle: read.text(input, 'subtitle', 240),
        image: read.url(input, 'image', { label: 'Image' }),
        ctaLabel: read.text(input, 'ctaLabel', 40, { label: 'Button text' }),
        link: read.url(input, 'link', { label: 'Button link' }),
      };
    case 'text':
      return {
        ...common,
        eyebrow: read.text(input, 'eyebrow', 80),
        heading: read.text(input, 'heading', 160, { required: true, label: 'Heading' }),
        body: read.text(input, 'body', 1200),
        ctaLabel: read.text(input, 'ctaLabel', 40, { label: 'Button text' }),
        link: read.url(input, 'link', { label: 'Button link' }),
      };
    case 'imageText':
      return {
        ...common,
        heading: read.text(input, 'heading', 160, { required: true, label: 'Heading' }),
        body: read.text(input, 'body', 1200),
        image: read.url(input, 'image', { label: 'Image' }),
        side: read.choice(input, 'side', ['left', 'right'], 'left'),
        ctaLabel: read.text(input, 'ctaLabel', 40, { label: 'Button text' }),
        link: read.url(input, 'link', { label: 'Button link' }),
      };
    case 'products': {
      const count = Number(input.count);
      return {
        ...common,
        heading: read.text(input, 'heading', 120, { required: true, label: 'Heading' }),
        gender: read.choice(input, 'gender', ['All', 'Women', 'Men'], 'All'),
        category: read.text(input, 'category', 100),
        count: [4, 8, 12].includes(count) ? count : 4,
      };
    }
    case 'gallery': {
      const images = Array.isArray(input.images) ? input.images : [];
      if (images.length > MAX_GALLERY_IMAGES) errors.push(`${where}: a gallery can hold ${MAX_GALLERY_IMAGES} images`);
      return {
        ...common,
        heading: read.text(input, 'heading', 120),
        images: images.slice(0, MAX_GALLERY_IMAGES).map((image) => ({
          url: read.url(image, 'url', { label: 'Image' }),
          alt: read.text(image, 'alt', 160, { label: 'Image description' }),
        })).filter((image) => image.url),
      };
    }
    default:
      return null;
  }
}

/** Returns { value, errors }. `value` is safe to store and render only when errors is empty. */
export function validateStudioState(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { value: null, errors: ['The site content must be an object'] };
  }

  const lookRead = new Reader(errors, 'Look and movement');
  const look = {
    accent: lookRead.choice(input.look, 'accent', STUDIO_ACCENTS, 'rouge'),
    silkColor: lookRead.choice(input.look, 'silkColor', ['silk', 'monolith'], 'silk'),
    motion: lookRead.choice(input.look, 'motion', ['still', 'calm', 'normal', 'lively'], 'normal'),
    silkEnabled: lookRead.bool(input.look, 'silkEnabled', true),
    monogramEnabled: lookRead.bool(input.look, 'monogramEnabled', true),
  };

  const tickerRead = new Reader(errors, 'Top banner');
  const tickerItems = Array.isArray(input.ticker?.items) ? input.ticker.items : [];
  if (tickerItems.length > MAX_TICKER_ITEMS) errors.push(`Top banner: at most ${MAX_TICKER_ITEMS} messages`);
  const ticker = {
    enabled: tickerRead.bool(input.ticker, 'enabled', true),
    speed: tickerRead.choice(input.ticker, 'speed', SPEEDS, 'normal'),
    items: tickerItems.slice(0, MAX_TICKER_ITEMS).map((item) => ({
      text: tickerRead.text(item, 'text', 120, { required: true, label: 'Message' }),
      link: tickerRead.url(item, 'link', { label: 'Link' }),
    })),
  };

  const heroRead = new Reader(errors, 'Main banner');
  const hero = {
    eyebrow: heroRead.text(input.hero, 'eyebrow', 80, { label: 'Small heading' }),
    line1: heroRead.text(input.hero, 'line1', 40, { required: true, label: 'Headline line 1' }),
    line2: heroRead.text(input.hero, 'line2', 40, { label: 'Headline line 2' }),
    subtitle: heroRead.text(input.hero, 'subtitle', 160, { label: 'Subtitle' }),
    ctaLabel: heroRead.text(input.hero, 'ctaLabel', 40, { label: 'Button text' }),
    ctaLink: heroRead.url(input.hero, 'ctaLink', { label: 'Button link' }),
  };

  const rawBlocks = Array.isArray(input.blocks) ? input.blocks : [];
  if (rawBlocks.length > MAX_BLOCKS) errors.push(`A page can hold ${MAX_BLOCKS} sections`);
  const seenIds = new Set();
  const blocks = rawBlocks.slice(0, MAX_BLOCKS)
    .map((block, index) => validateBlock(block, index, errors, seenIds))
    .filter(Boolean);

  return { value: { version: 1, look, ticker, hero, blocks }, errors };
}
