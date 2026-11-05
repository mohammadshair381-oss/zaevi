/**
 * CMS validation and component schema.
 *
 * These helpers are intentionally database-free so they can be unit-tested
 * without a live database. They enforce the
 * CMS-1 safety rules: no arbitrary HTML/CSS/JavaScript, no unknown component
 * types, no unknown properties, bounded payload sizes, and safe URLs/colors.
 */

export const CMS_PAGE_STATUSES = Object.freeze(['draft', 'published']);

export const CMS_COMPONENT_TYPES = Object.freeze([
  'hero',
  'richText',
  'imageText',
  'gallery',
  'featuredProducts',
  'productGrid',
  'collectionShowcase',
  'promoBanner',
  'testimonials',
  'newsletter',
  'faq',
  'cta',
  'spacer',
  'divider',
  'headerVariant',
  'footerVariant',
]);

export const CMS_HEADER_LAYOUTS = Object.freeze(['default', 'centered', 'minimal', 'stacked']);
export const CMS_FOOTER_LAYOUTS = Object.freeze(['default', 'minimal', 'stacked', 'columns']);
export const CMS_FONT_FAMILIES = Object.freeze([
  'Playfair Display',
  'Inter',
  'Georgia',
  'Helvetica',
  'Arial',
  'system-ui',
]);

export const CMS_DEFAULT_SETTINGS = Object.freeze({
  siteName: 'ZAEVI',
  logoUrl: '/assets/zaevi-wordmark.png',
  faviconUrl: '/assets/zaevi-icon.png',
  primaryColor: '#111111',
  secondaryColor: '#f5f5f3',
  accentColor: '#111111',
  backgroundColor: '#ffffff',
  textColor: '#111111',
  headingFont: 'Playfair Display',
  bodyFont: 'Inter',
  headerLayout: 'default',
  footerLayout: 'default',
  announcementEnabled: false,
  announcementText: '',
  announcementLink: '',
  socialLinks: {},
  defaultSeoTitle: 'ZAEVI',
  defaultSeoDescription: 'Production-on-demand fashion by ZAEVI.',
  themeTokens: {},
});

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMPONENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const RELATIVE_PATH_PATTERN = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/;

const ENUMS = Object.freeze({
  alignment: ['left', 'center', 'right'],
  height: ['small', 'medium', 'large'],
  imagePosition: ['left', 'right'],
  gap: ['small', 'medium', 'large'],
  columns: [1, 2, 3, 4],
  dividerStyle: ['solid', 'dashed', 'dotted'],
  collectionLayout: ['grid', 'carousel', 'list'],
  productGender: ['Women', 'Men', 'Unisex', 'All'],
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addError(errors, field, message) {
  errors.push(`${field}: ${message}`);
}

function validateString(value, field, errors, { required = false, maxLength = 1000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) {
    if (required) addError(errors, field, 'is required');
    return null;
  }
  if (typeof value !== 'string') {
    addError(errors, field, 'must be a string');
    return null;
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed === '') {
    addError(errors, field, 'must not be empty');
    return null;
  }
  if (trimmed.length > maxLength) {
    addError(errors, field, `must be at most ${maxLength} characters`);
    return null;
  }
  return trimmed;
}

export function isSafeUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const url = value.trim();
  if (url.startsWith('/')) {
    return RELATIVE_PATH_PATTERN.test(url) && !url.includes('..') && !url.includes('\\');
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateUrl(value, field, errors, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) addError(errors, field, 'is required');
    return null;
  }
  if (typeof value !== 'string') {
    addError(errors, field, 'must be a string');
    return null;
  }
  const trimmed = value.trim();
  if (!isSafeUrl(trimmed)) {
    addError(errors, field, 'must be a safe http(s) or relative URL');
    return null;
  }
  return trimmed;
}

function validateColor(value, field, errors) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !HEX_COLOR.test(value.trim())) {
    addError(errors, field, 'must be a 6-digit hex color');
    return null;
  }
  return value.trim().toLowerCase();
}

function validateInteger(value, field, errors, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < min || value > max) {
    addError(errors, field, `must be an integer between ${min} and ${max}`);
    return null;
  }
  return value;
}

function validateEnum(value, field, errors, allowed) {
  if (value === undefined || value === null || value === '') return null;
  if (!allowed.includes(value)) {
    addError(errors, field, `must be one of: ${allowed.join(', ')}`);
    return null;
  }
  return value;
}

function validateObject(value, field, errors, { maxKeys = 50 } = {}) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    addError(errors, field, 'must be an object');
    return null;
  }
  if (Object.keys(value).length > maxKeys) {
    addError(errors, field, `must have at most ${maxKeys} keys`);
    return null;
  }
  return value;
}

function validateArray(value, field, errors, { maxItems = 50, itemValidator } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    addError(errors, field, 'must be an array');
    return null;
  }
  if (value.length > maxItems) {
    addError(errors, field, `must contain at most ${maxItems} items`);
    return null;
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = itemValidator ? itemValidator(value[index], `${field}[${index}]`, errors) : value[index];
    if (item !== undefined) result.push(item);
  }
  return errors.length ? null : result;
}

const PROP_SCHEMAS = Object.freeze({
  hero: {
    heading: { type: 'string', max: 120 },
    subheading: { type: 'string', max: 240 },
    image: { type: 'url' },
    ctaLabel: { type: 'string', max: 40 },
    ctaUrl: { type: 'url' },
    alignment: { type: 'enum', allowed: ENUMS.alignment },
    height: { type: 'enum', allowed: ENUMS.height },
    overlay: { type: 'number', min: 0, max: 1 },
  },
  richText: {
    text: { type: 'string', max: 5000, required: true },
    format: { type: 'enum', allowed: ['plain'] },
  },
  imageText: {
    image: { type: 'url', required: true },
    alt: { type: 'string', max: 200 },
    heading: { type: 'string', max: 120 },
    body: { type: 'string', max: 1000 },
    buttonLabel: { type: 'string', max: 40 },
    buttonUrl: { type: 'url' },
    imagePosition: { type: 'enum', allowed: ENUMS.imagePosition },
  },
  gallery: {
    images: { type: 'array', max: 12, item: 'image' },
    columns: { type: 'integer', min: 1, max: 4 },
    gap: { type: 'enum', allowed: ENUMS.gap },
  },
  featuredProducts: {
    title: { type: 'string', max: 120 },
    productIds: { type: 'stringArray', max: 12 },
    columns: { type: 'integer', min: 1, max: 4 },
    ctaLabel: { type: 'string', max: 40 },
    ctaUrl: { type: 'url' },
  },
  productGrid: {
    title: { type: 'string', max: 120 },
    category: { type: 'string', max: 100 },
    gender: { type: 'enum', allowed: ENUMS.productGender },
    limit: { type: 'integer', min: 1, max: 24 },
    columns: { type: 'integer', min: 1, max: 4 },
  },
  collectionShowcase: {
    title: { type: 'string', max: 120 },
    collections: { type: 'stringArray', max: 12 },
    layout: { type: 'enum', allowed: ENUMS.collectionLayout },
  },
  promoBanner: {
    text: { type: 'string', max: 240, required: true },
    image: { type: 'url' },
    link: { type: 'url' },
    backgroundColor: { type: 'color' },
  },
  testimonials: {
    items: { type: 'array', max: 10, item: 'testimonial' },
  },
  newsletter: {
    heading: { type: 'string', max: 120 },
    description: { type: 'string', max: 320 },
    buttonLabel: { type: 'string', max: 40 },
    placeholder: { type: 'string', max: 80 },
    actionUrl: { type: 'url' },
  },
  faq: {
    items: { type: 'array', max: 20, item: 'faqItem' },
  },
  cta: {
    heading: { type: 'string', max: 120, required: true },
    text: { type: 'string', max: 320 },
    buttonLabel: { type: 'string', max: 40, required: true },
    buttonUrl: { type: 'url', required: true },
    backgroundColor: { type: 'color' },
  },
  spacer: {
    height: { type: 'enum', allowed: ENUMS.height },
  },
  divider: {
    style: { type: 'enum', allowed: ENUMS.dividerStyle },
  },
  headerVariant: {
    layout: { type: 'enum', allowed: CMS_HEADER_LAYOUTS },
  },
  footerVariant: {
    layout: { type: 'enum', allowed: CMS_FOOTER_LAYOUTS },
  },
});

const ITEM_SCHEMAS = Object.freeze({
  image: {
    url: { type: 'url', required: true },
    alt: { type: 'string', max: 200 },
  },
  testimonial: {
    quote: { type: 'string', max: 500, required: true },
    author: { type: 'string', max: 120, required: true },
    avatar: { type: 'url' },
    rating: { type: 'integer', min: 1, max: 5 },
  },
  faqItem: {
    question: { type: 'string', max: 240, required: true },
    answer: { type: 'string', max: 2000, required: true },
  },
});

function validateValue(spec, value, field, errors) {
  switch (spec.type) {
    case 'string':
      return validateString(value, field, errors, {
        required: spec.required,
        maxLength: spec.max,
        allowEmpty: !spec.required,
      });
    case 'url':
      return validateUrl(value, field, errors, { required: spec.required });
    case 'color':
      return validateColor(value, field, errors);
    case 'integer':
      return validateInteger(value, field, errors, { min: spec.min, max: spec.max });
    case 'number':
      if (value === undefined || value === null) return spec.required ? (addError(errors, field, 'is required'), null) : null;
      if (typeof value !== 'number' || Number.isNaN(value) || value < spec.min || value > spec.max) {
        addError(errors, field, `must be a number between ${spec.min} and ${spec.max}`);
        return null;
      }
      return value;
    case 'enum':
      return validateEnum(value, field, errors, spec.allowed);
    case 'array':
      return validateArray(value, field, errors, {
        maxItems: spec.max,
        itemValidator: (item, itemField, itemErrors) => validateObjectFields(ITEM_SCHEMAS[spec.item], item, itemField, itemErrors),
      });
    case 'stringArray':
      return validateArray(value, field, errors, {
        maxItems: spec.max,
        itemValidator: (item, itemField, itemErrors) => {
          if (typeof item !== 'string' || item.trim() === '' || item.trim().length > 120) {
            addError(itemErrors, itemField, 'must be a non-empty string of at most 120 characters');
            return null;
          }
          return item.trim();
        },
      });
    default:
      addError(errors, field, 'has an unsupported validator');
      return null;
  }
}

function validateObjectFields(schema, value, field, errors) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    addError(errors, field, 'must be an object');
    return null;
  }
  const result = {};
  const allowed = new Set(Object.keys(schema));
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addError(errors, `${field}.${key}`, 'is not allowed');
    }
  }
  if (errors.length) return null;
  for (const [key, spec] of Object.entries(schema)) {
    const validated = validateValue(spec, value[key], `${field}.${key}`, errors);
    if (validated !== null || (value[key] !== undefined && value[key] !== null && value[key] !== '')) {
      result[key] = validated;
    }
  }
  // Preserve explicit false/0 values that validateValue may return as null only
  // when they were absent. Required booleans are not currently used.
  for (const key of Object.keys(schema)) {
    if (value[key] === false || value[key] === 0) result[key] = value[key];
  }
  return errors.length ? null : result;
}

export function validateComponent(component) {
  const errors = [];
  if (!isPlainObject(component)) {
    return { value: null, errors: ['component: must be an object'] };
  }
  if (!COMPONENT_ID_PATTERN.test(component.id || '')) {
    addError(errors, 'component.id', 'must be 1-64 characters using letters, numbers, underscores, or hyphens');
  }
  if (!CMS_COMPONENT_TYPES.includes(component.type)) {
    addError(errors, 'component.type', `must be one of: ${CMS_COMPONENT_TYPES.join(', ')}`);
  }
  if (!isPlainObject(component.props)) {
    addError(errors, 'component.props', 'must be an object');
  }
  if (Object.prototype.hasOwnProperty.call(component, 'children')) {
    addError(errors, 'component.children', 'nested children are not supported in this phase');
  }
  if (Object.keys(component).some((key) => !['id', 'type', 'props'].includes(key))) {
    addError(errors, 'component', 'contains unsupported properties');
  }

  let props = null;
  if (errors.length === 0) {
    const schema = PROP_SCHEMAS[component.type];
    const validated = validateObjectFields(schema, component.props, 'props', errors);
    if (validated) props = validated;
  }

  if (errors.length) return { value: null, errors };
  return { value: { id: component.id, type: component.type, props }, errors: [] };
}

export function validatePageSnapshot(snapshot) {
  const errors = [];
  if (!isPlainObject(snapshot)) {
    return { value: null, errors: ['snapshot: must be an object'] };
  }
  const allowedTopLevel = new Set(['title', 'seoTitle', 'seoDescription', 'components']);
  for (const key of Object.keys(snapshot)) {
    if (!allowedTopLevel.has(key)) addError(errors, `snapshot.${key}`, 'is not allowed');
  }
  if (errors.length) return { value: null, errors };

  const value = {};
  if (snapshot.title !== undefined) {
    const title = validateString(snapshot.title, 'snapshot.title', errors, { maxLength: 200 });
    if (title !== null) value.title = title;
  }
  if (snapshot.seoTitle !== undefined) {
    const seoTitle = validateString(snapshot.seoTitle, 'snapshot.seoTitle', errors, { maxLength: 160 });
    if (seoTitle !== null) value.seoTitle = seoTitle;
  }
  if (snapshot.seoDescription !== undefined) {
    const seoDescription = validateString(snapshot.seoDescription, 'snapshot.seoDescription', errors, { maxLength: 320 });
    if (seoDescription !== null) value.seoDescription = seoDescription;
  }

  const components = validateArray(snapshot.components === undefined ? [] : snapshot.components, 'snapshot.components', errors, {
    maxItems: 100,
    itemValidator: (item, field, itemErrors) => {
      const result = validateComponent(item);
      if (result.errors.length) {
        for (const error of result.errors) itemErrors.push(error.replace(/^component/, field));
        return null;
      }
      return result.value;
    },
  });
  if (components !== null) value.components = components;

  if (errors.length) return { value: null, errors };
  if (value.components === undefined) value.components = [];
  return { value, errors: [] };
}

export function validateWebsiteSettings(input, current = null) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { value: null, errors: ['settings: must be an object'] };
  }

  const base = isPlainObject(current) ? { ...current } : { ...CMS_DEFAULT_SETTINGS };
  const value = { ...base };
  const allowed = new Set([
    'siteName',
    'logoUrl',
    'faviconUrl',
    'primaryColor',
    'secondaryColor',
    'accentColor',
    'backgroundColor',
    'textColor',
    'headingFont',
    'bodyFont',
    'headerLayout',
    'footerLayout',
    'announcementEnabled',
    'announcementText',
    'announcementLink',
    'socialLinks',
    'defaultSeoTitle',
    'defaultSeoDescription',
    'themeTokens',
  ]);

  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) addError(errors, `settings.${key}`, 'is not allowed');
  }
  if (errors.length) return { value: null, errors };

  if (input.siteName !== undefined) {
    const siteName = validateString(input.siteName, 'settings.siteName', errors, { required: true, maxLength: 120, allowEmpty: false });
    if (siteName !== null) value.siteName = siteName;
  }
  if (input.logoUrl !== undefined) {
    const logoUrl = validateUrl(input.logoUrl, 'settings.logoUrl', errors);
    if (logoUrl !== null || input.logoUrl === null) value.logoUrl = logoUrl;
  }
  if (input.faviconUrl !== undefined) {
    const faviconUrl = validateUrl(input.faviconUrl, 'settings.faviconUrl', errors);
    if (faviconUrl !== null || input.faviconUrl === null) value.faviconUrl = faviconUrl;
  }
  for (const field of ['primaryColor', 'secondaryColor', 'accentColor', 'backgroundColor', 'textColor']) {
    if (input[field] !== undefined) {
      const color = validateColor(input[field], `settings.${field}`, errors);
      if (color !== null || input[field] === null) value[field] = color;
    }
  }
  if (input.headingFont !== undefined) {
    const font = validateEnum(input.headingFont, 'settings.headingFont', errors, CMS_FONT_FAMILIES);
    if (font !== null) value.headingFont = font;
  }
  if (input.bodyFont !== undefined) {
    const font = validateEnum(input.bodyFont, 'settings.bodyFont', errors, CMS_FONT_FAMILIES);
    if (font !== null) value.bodyFont = font;
  }
  if (input.headerLayout !== undefined) {
    const layout = validateEnum(input.headerLayout, 'settings.headerLayout', errors, CMS_HEADER_LAYOUTS);
    if (layout !== null) value.headerLayout = layout;
  }
  if (input.footerLayout !== undefined) {
    const layout = validateEnum(input.footerLayout, 'settings.footerLayout', errors, CMS_FOOTER_LAYOUTS);
    if (layout !== null) value.footerLayout = layout;
  }
  if (input.announcementEnabled !== undefined) {
    if (typeof input.announcementEnabled !== 'boolean') {
      addError(errors, 'settings.announcementEnabled', 'must be a boolean');
    } else {
      value.announcementEnabled = input.announcementEnabled;
    }
  }
  if (input.announcementText !== undefined) {
    const text = validateString(input.announcementText, 'settings.announcementText', errors, { maxLength: 240 });
    if (text !== null) value.announcementText = text;
  }
  if (input.announcementLink !== undefined) {
    const link = validateUrl(input.announcementLink, 'settings.announcementLink', errors);
    if (link !== null || input.announcementLink === '') value.announcementLink = link || '';
  }
  if (input.socialLinks !== undefined) {
    const socialLinks = validateObject(input.socialLinks, 'settings.socialLinks', errors, { maxKeys: 20 });
    if (socialLinks) {
      const normalized = {};
      for (const [key, url] of Object.entries(socialLinks)) {
        if (typeof key !== 'string' || key.trim() === '' || key.length > 40) {
          addError(errors, 'settings.socialLinks', 'keys must be 1-40 characters');
          continue;
        }
        if (url !== null && url !== '') {
          const safeUrl = validateUrl(url, `settings.socialLinks.${key}`, errors);
          if (safeUrl === null && url !== null && url !== '') continue;
          normalized[key.trim()] = safeUrl;
        } else {
          normalized[key.trim()] = null;
        }
      }
      if (!errors.length) value.socialLinks = normalized;
    }
  }
  if (input.defaultSeoTitle !== undefined) {
    const title = validateString(input.defaultSeoTitle, 'settings.defaultSeoTitle', errors, { maxLength: 160 });
    if (title !== null) value.defaultSeoTitle = title;
  }
  if (input.defaultSeoDescription !== undefined) {
    const description = validateString(input.defaultSeoDescription, 'settings.defaultSeoDescription', errors, { maxLength: 320 });
    if (description !== null) value.defaultSeoDescription = description;
  }
  if (input.themeTokens !== undefined) {
    const tokens = validateObject(input.themeTokens, 'settings.themeTokens', errors, { maxKeys: 30 });
    if (tokens) {
      const normalized = {};
      for (const [key, token] of Object.entries(tokens)) {
        if (typeof key !== 'string' || key.trim() === '' || key.length > 40) {
          addError(errors, 'settings.themeTokens', 'keys must be 1-40 characters');
          continue;
        }
        if (typeof token === 'string') {
          if (token.length > 100) {
            addError(errors, `settings.themeTokens.${key}`, 'must be at most 100 characters');
            continue;
          }
          normalized[key.trim()] = token;
        } else if (typeof token === 'number' && Number.isFinite(token)) {
          normalized[key.trim()] = token;
        } else if (token === null) {
          normalized[key.trim()] = null;
        } else {
          addError(errors, `settings.themeTokens.${key}`, 'must be a string, finite number, or null');
        }
      }
      if (!errors.length) value.themeTokens = normalized;
    }
  }

  if (errors.length) return { value: null, errors };
  return { value, errors: [] };
}

export function normalizeSlug(value) {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase();
  if (slug === '' || slug.length > 80 || !SLUG_PATTERN.test(slug)) return null;
  return slug;
}

export function validatePageMetadata(input) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { value: null, errors: ['page: must be an object'] };
  }
  const allowed = new Set(['slug', 'title', 'seoTitle', 'seoDescription']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) addError(errors, `page.${key}`, 'is not allowed');
  }
  if (errors.length) return { value: null, errors };

  const value = {};
  if (input.slug !== undefined) {
    const slug = normalizeSlug(input.slug);
    if (!slug) addError(errors, 'page.slug', 'must be a lowercase slug using letters, numbers, and hyphens');
    else value.slug = slug;
  }
  if (input.title !== undefined) {
    const title = validateString(input.title, 'page.title', errors, { required: true, maxLength: 200, allowEmpty: false });
    if (title !== null) value.title = title;
  }
  if (input.seoTitle !== undefined) {
    const seoTitle = validateString(input.seoTitle, 'page.seoTitle', errors, { maxLength: 160 });
    if (seoTitle !== null) value.seoTitle = seoTitle;
  }
  if (input.seoDescription !== undefined) {
    const seoDescription = validateString(input.seoDescription, 'page.seoDescription', errors, { maxLength: 320 });
    if (seoDescription !== null) value.seoDescription = seoDescription;
  }
  if (errors.length) return { value: null, errors };
  return { value, errors: [] };
}

export const CMS_DEFAULT_HOMEPAGE_STATE = Object.freeze({
  version: 1,
  theme: { tokens: {} },
  announcement: { enabled: false, badge: '', text: '', ctaText: '', ctaHref: '', bg: '', startAt: '', endAt: '' },
  navigation: { links: [] },
  footer: { aboutText: '', chips: [], bottomLeft: '', bottomRight: '', columns: [] },
  sections: [
    { sectionId: 'hero', enabled: true, title: '', sortOrder: 0, settings: {} },
    { sectionId: 'bestsellers', enabled: true, title: 'Bestsellers', sortOrder: 1, settings: { subtitle: 'Loved by customers' } },
    { sectionId: 'promoStrip', enabled: false, title: '', sortOrder: 2, settings: {} },
    { sectionId: 'newArrivals', enabled: true, title: 'New Arrivals', sortOrder: 3, settings: {} },
    { sectionId: 'appBanner', enabled: false, title: '', sortOrder: 4, settings: {} },
    { sectionId: 'skinConcerns', enabled: true, title: 'Skin Concerns', sortOrder: 5, settings: {} },
    { sectionId: 'reels', enabled: true, title: 'Watch It. Love It', sortOrder: 6, settings: {} },
    { sectionId: 'features', enabled: true, title: 'Clean Beauty', sortOrder: 7, settings: {} },
    { sectionId: 'story', enabled: true, title: 'Our Story', sortOrder: 8, settings: {} },
    { sectionId: 'logos', enabled: true, title: 'Featured In', sortOrder: 9, settings: {} },
    { sectionId: 'testimonials', enabled: true, title: 'Feels Good Stories', sortOrder: 10, settings: {} },
  ],
  hero: { autoplayMs: 5200, slides: [] },
  promoStrip: { title: '', subtitle: '', pills: [], buttonLabel: '', buttonHref: '', bg: '', startAt: '', endAt: '' },
  appBanner: { title: '', subtitle: '', stores: [], bg: '' },
  testimonials: [],
  logos: [],
  productSections: [],
  reels: { title: 'Watch It. Love It', subtitle: '', items: [] },
  features: { title: 'Clean Beauty', subtitle: '', cards: [] },
  story: { title: 'Our Story', subtitle: '', buttonLabel: '', buttonHref: '', imageUrl: '' },
});

function validateCssValue(value, field, errors) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') {
    addError(errors, field, 'must be a string');
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length > 240) {
    addError(errors, field, 'must be at most 240 characters');
    return null;
  }
  if (!/^[A-Za-z0-9#(),.%\s\-]+$/.test(trimmed) || /(?:expression|url)\s*\(/i.test(trimmed)) {
    addError(errors, field, 'must be a safe CSS value');
    return null;
  }
  return trimmed;
}

function rejectUnknownKeys(value, allowed, field, errors) {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addError(errors, `${field}.${key}`, 'is not allowed');
  }
}

function validateBoolean(value, field, errors, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    addError(errors, field, 'must be a boolean');
    return fallback;
  }
  return value;
}

function validateSortOrder(value, field, errors, fallback = 0) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    addError(errors, field, 'must be a non-negative integer no greater than 10000');
    return fallback;
  }
  return value;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function homepageString(object, key, fallback, field, errors, maxLength, { url = false, css = false } = {}) {
  if (!hasOwn(object, key)) return fallback;
  const input = object[key];
  if (typeof input !== 'string') {
    addError(errors, field, 'must be a string');
    return fallback;
  }
  if (url) {
    if (input.length > 1024) {
      addError(errors, field, 'must be at most 1024 characters');
      return fallback;
    }
    if (input === '' || input === '#') return input;
    return validateUrl(input, field, errors) ?? fallback;
  }
  if (css) {
    if (input.length > maxLength) {
      addError(errors, field, `must be at most ${maxLength} characters`);
      return fallback;
    }
    return validateCssValue(input, field, errors) ?? fallback;
  }
  return validateString(input, field, errors, { maxLength }) ?? fallback;
}

function homepageObject(input, fallback, field, allowed, errors) {
  if (input !== undefined && !isPlainObject(input)) {
    addError(errors, field, 'must be an object');
    return {};
  }
  if (input !== undefined) rejectUnknownKeys(input, new Set(allowed), field, errors);
  const base = isPlainObject(fallback) ? fallback : {};
  return { ...structuredClone(base), ...(input === undefined ? {} : structuredClone(input)) };
}

function homepageArray(input, fallback, field, errors, maxItems, itemValidator) {
  const value = input === undefined ? fallback : input;
  if (!Array.isArray(value)) {
    addError(errors, field, 'must be an array');
    return [];
  }
  if (value.length > maxItems) {
    addError(errors, field, `must contain at most ${maxItems} items`);
    return [];
  }
  return value.map((item, index) => itemValidator(item, `${field}[${index}]`, index));
}

function homepageId(value, field, errors) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 1) {
    addError(errors, field, 'must be a positive integer or null');
    return null;
  }
  return value;
}

function homepageMedia(value, field, errors) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    addError(errors, field, 'must be an object or null');
    return null;
  }
  rejectUnknownKeys(value, new Set(['id', 'url', 'kind']), field, errors);
  const result = {};
  if (hasOwn(value, 'id')) result.id = homepageId(value.id, `${field}.id`, errors);
  if (hasOwn(value, 'url')) {
    result.url = homepageString(value, 'url', '', `${field}.url`, errors, 1024, { url: true });
  }
  if (hasOwn(value, 'kind')) {
    result.kind = homepageString(value, 'kind', '', `${field}.kind`, errors, 30);
  }
  return result;
}

function homepageTextArray(value, field, errors, maxItems, maxLength) {
  if (!Array.isArray(value)) {
    addError(errors, field, 'must be an array');
    return [];
  }
  if (value.length > maxItems) {
    addError(errors, field, `must contain at most ${maxItems} items`);
    return [];
  }
  return value.map((item, index) => {
    if (typeof item !== 'string') {
      addError(errors, `${field}[${index}]`, 'must be a string');
      return '';
    }
    return validateString(item, `${field}[${index}]`, errors, { maxLength }) ?? '';
  });
}

function validateHomepageFilter(value, field, errors) {
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    addError(errors, field, 'must be an object');
    return {};
  }
  rejectUnknownKeys(value, new Set(['badge', 'category', 'concern', 'search']), field, errors);
  const result = {};
  for (const key of ['badge', 'category', 'concern', 'search']) {
    if (hasOwn(value, key)) result[key] = homepageString(value, key, '', `${field}.${key}`, errors, 80);
  }
  return result;
}

function validateHomepageReel(item, field, errors) {
  if (!isPlainObject(item)) {
    addError(errors, field, 'must be an object');
    return {};
  }
  rejectUnknownKeys(item, new Set(['title', 'productImage', 'href']), field, errors);
  return {
    title: homepageString(item, 'title', '', `${field}.title`, errors, 100),
    productImage: homepageString(item, 'productImage', '', `${field}.productImage`, errors, 1024, { url: true }),
    href: homepageString(item, 'href', '', `${field}.href`, errors, 1024, { url: true }),
  };
}

function validateHomepageFeature(item, field, errors) {
  if (!isPlainObject(item)) {
    addError(errors, field, 'must be an object');
    return {};
  }
  rejectUnknownKeys(item, new Set(['title', 'desc']), field, errors);
  return {
    title: homepageString(item, 'title', '', `${field}.title`, errors, 100),
    desc: homepageString(item, 'desc', '', `${field}.desc`, errors, 500),
  };
}

function validateHomepageState(input, current = null) {
  const errors = [];
  if (!isPlainObject(input)) return { value: null, errors: ['homepage: must be an object'] };

  const base = isPlainObject(current) ? current : CMS_DEFAULT_HOMEPAGE_STATE;
  const baseSection = (id) => (Array.isArray(base.sections) ? base.sections.find((section) => section?.sectionId === id) : undefined);
  rejectUnknownKeys(input, new Set(Object.keys(CMS_DEFAULT_HOMEPAGE_STATE)), 'homepage', errors);

  const version = input.version === undefined ? base.version : input.version;
  if (version !== 1) addError(errors, 'homepage.version', 'must equal 1');

  const themeInput = homepageObject(input.theme, base.theme ?? CMS_DEFAULT_HOMEPAGE_STATE.theme, 'homepage.theme', ['tokens'], errors);
  const themeBaseTokens = isPlainObject(base.theme?.tokens) ? base.theme.tokens : {};
  const tokensInput = homepageObject(themeInput.tokens, themeBaseTokens, 'homepage.theme.tokens', Object.keys(themeInput.tokens || {}), errors);
  const tokens = {};
  for (const [key, token] of Object.entries(tokensInput)) {
    if (!/^--[A-Za-z0-9_-]{1,38}$/.test(key)) addError(errors, `homepage.theme.tokens.${key}`, 'must be a valid CSS custom property name');
    else if (typeof token === 'number' && Number.isFinite(token)) tokens[key] = token;
    else if (token === null) tokens[key] = null;
    else if (typeof token === 'string' && token.length <= 100 && /^[A-Za-z0-9#(),.%\s\-_'"/+*]*$/.test(token) && !/(?:expression|url)\s*\(/i.test(token)) tokens[key] = token;
    else addError(errors, `homepage.theme.tokens.${key}`, 'must be a safe string, finite number, or null');
  }

  const announcementInput = homepageObject(input.announcement, base.announcement ?? CMS_DEFAULT_HOMEPAGE_STATE.announcement, 'homepage.announcement',
    ['enabled', 'badge', 'text', 'ctaText', 'ctaHref', 'bg', 'startAt', 'endAt'], errors);
  const announcement = {
    enabled: validateBoolean(announcementInput.enabled, 'homepage.announcement.enabled', errors, false),
    badge: homepageString(announcementInput, 'badge', '', 'homepage.announcement.badge', errors, 40),
    text: homepageString(announcementInput, 'text', '', 'homepage.announcement.text', errors, 160),
    ctaText: homepageString(announcementInput, 'ctaText', '', 'homepage.announcement.ctaText', errors, 40),
    ctaHref: homepageString(announcementInput, 'ctaHref', '', 'homepage.announcement.ctaHref', errors, 1024, { url: true }),
    bg: homepageString(announcementInput, 'bg', '', 'homepage.announcement.bg', errors, 240, { css: true }),
    startAt: homepageString(announcementInput, 'startAt', '', 'homepage.announcement.startAt', errors, 40),
    endAt: homepageString(announcementInput, 'endAt', '', 'homepage.announcement.endAt', errors, 40),
  };

  const navigationInput = homepageObject(input.navigation, base.navigation ?? CMS_DEFAULT_HOMEPAGE_STATE.navigation, 'homepage.navigation', ['links'], errors);
  const navigationLinks = homepageArray(navigationInput.links, base.navigation?.links ?? [], 'homepage.navigation.links', errors, 32, (item, field, index) => {
    if (!isPlainObject(item)) {
      addError(errors, field, 'must be an object');
      return {};
    }
    rejectUnknownKeys(item, new Set(['label', 'href', 'isPill', 'enabled', 'sortOrder']), field, errors);
    return {
      label: homepageString(item, 'label', '', `${field}.label`, errors, 40),
      href: homepageString(item, 'href', '#', `${field}.href`, errors, 1024, { url: true }),
      isPill: validateBoolean(item.isPill, `${field}.isPill`, errors, false),
      enabled: validateBoolean(item.enabled, `${field}.enabled`, errors, true),
      sortOrder: validateSortOrder(item.sortOrder, `${field}.sortOrder`, errors, index),
    };
  });

  const footerInput = homepageObject(input.footer, base.footer ?? CMS_DEFAULT_HOMEPAGE_STATE.footer, 'homepage.footer',
    ['aboutText', 'chips', 'bottomLeft', 'bottomRight', 'columns'], errors);
  const footerChips = footerInput.chips === undefined
    ? homepageTextArray(base.footer?.chips ?? [], 'homepage.footer.chips', errors, 12, 60)
    : homepageTextArray(footerInput.chips, 'homepage.footer.chips', errors, 12, 60);
  const footerColumns = homepageArray(footerInput.columns, base.footer?.columns ?? [], 'homepage.footer.columns', errors, 6, (column, field) => {
    if (!isPlainObject(column)) {
      addError(errors, field, 'must be an object');
      return {};
    }
    rejectUnknownKeys(column, new Set(['title', 'muted', 'links', 'social']), field, errors);
    const previousColumn = base.footer?.columns?.find((item) => item?.title === column.title);
    const links = homepageArray(column.links, previousColumn?.links ?? [], `${field}.links`, errors, 12, (link, linkField) => {
      if (!isPlainObject(link)) {
        addError(errors, linkField, 'must be an object');
        return {};
      }
      rejectUnknownKeys(link, new Set(['label', 'href']), linkField, errors);
      return {
        label: homepageString(link, 'label', '', `${linkField}.label`, errors, 80),
        href: homepageString(link, 'href', '', `${linkField}.href`, errors, 1024, { url: true }),
      };
    });
    const social = homepageArray(column.social, previousColumn?.social ?? [], `${field}.social`, errors, 8, (item, socialField) => {
      if (!isPlainObject(item)) {
        addError(errors, socialField, 'must be an object');
        return {};
      }
      rejectUnknownKeys(item, new Set(['label', 'href', 'aria']), socialField, errors);
      return {
        label: homepageString(item, 'label', '', `${socialField}.label`, errors, 10),
        href: homepageString(item, 'href', '', `${socialField}.href`, errors, 1024, { url: true }),
        aria: homepageString(item, 'aria', '', `${socialField}.aria`, errors, 60),
      };
    });
    return {
      title: homepageString(column, 'title', '', `${field}.title`, errors, 50),
      muted: homepageString(column, 'muted', '', `${field}.muted`, errors, 120),
      links,
      social,
    };
  });
  const footer = {
    aboutText: homepageString(footerInput, 'aboutText', '', 'homepage.footer.aboutText', errors, 1000),
    chips: footerChips,
    bottomLeft: homepageString(footerInput, 'bottomLeft', '', 'homepage.footer.bottomLeft', errors, 140),
    bottomRight: homepageString(footerInput, 'bottomRight', '', 'homepage.footer.bottomRight', errors, 140),
    columns: footerColumns,
  };

  const sectionInput = input.sections === undefined ? base.sections ?? CMS_DEFAULT_HOMEPAGE_STATE.sections : input.sections;
  const knownSectionIds = new Set(CMS_DEFAULT_HOMEPAGE_STATE.sections.map((section) => section.sectionId));
  const sections = homepageArray(sectionInput, [], 'homepage.sections', errors, 20, (section, field, index) => {
    if (!isPlainObject(section)) {
      addError(errors, field, 'must be an object');
      return {};
    }
    rejectUnknownKeys(section, new Set(['sectionId', 'enabled', 'title', 'sortOrder', 'settings']), field, errors);
    const sectionId = section.sectionId;
    if (typeof sectionId !== 'string' || !knownSectionIds.has(sectionId)) addError(errors, `${field}.sectionId`, 'must be a supported homepage section id');
    const id = typeof sectionId === 'string' && knownSectionIds.has(sectionId) ? sectionId : '';
    const settingsAllowed = {
      hero: ['autoplayMs'],
      reels: ['subtitle', 'bg', 'items'],
      features: ['subtitle', 'bg', 'cards'],
      story: ['subtitle', 'bg', 'buttonLabel', 'buttonHref', 'imageUrl'],
    };
    const settingsKeys = new Set(['subtitle', 'bg', ...(settingsAllowed[id] || [])]);
    const settings = homepageObject(section.settings, {}, `${field}.settings`, [...settingsKeys], errors);
    const normalizedSettings = {};
    if (hasOwn(settings, 'subtitle')) normalizedSettings.subtitle = homepageString(settings, 'subtitle', '', `${field}.settings.subtitle`, errors, 160);
    if (hasOwn(settings, 'bg')) normalizedSettings.bg = homepageString(settings, 'bg', '', `${field}.settings.bg`, errors, 240, { css: true });
    if (id === 'hero' && hasOwn(settings, 'autoplayMs')) {
      const autoplay = settings.autoplayMs;
      if (!Number.isInteger(autoplay) || autoplay < 2500 || autoplay > 12000) addError(errors, `${field}.settings.autoplayMs`, 'must be an integer between 2500 and 12000');
      else normalizedSettings.autoplayMs = autoplay;
    }
    if (id === 'reels' && hasOwn(settings, 'items')) {
      normalizedSettings.items = homepageArray(settings.items, [], `${field}.settings.items`, errors, 30, (item, itemField) => validateHomepageReel(item, itemField, errors));
    }
    if (id === 'features' && hasOwn(settings, 'cards')) {
      normalizedSettings.cards = homepageArray(settings.cards, [], `${field}.settings.cards`, errors, 20, (item, itemField) => validateHomepageFeature(item, itemField, errors));
    }
    if (id === 'story') {
      for (const [key, max] of [['buttonLabel', 40], ['buttonHref', 1024], ['imageUrl', 1024]]) {
        if (!hasOwn(settings, key)) continue;
        normalizedSettings[key] = homepageString(settings, key, '', `${field}.settings.${key}`, errors, max, { url: key !== 'buttonLabel' });
      }
    }
    return {
      sectionId: id,
      enabled: validateBoolean(section.enabled, `${field}.enabled`, errors, true),
      title: homepageString(section, 'title', '', `${field}.title`, errors, 80),
      sortOrder: validateSortOrder(section.sortOrder, `${field}.sortOrder`, errors, index),
      settings: normalizedSettings,
    };
  });

  const findSection = (id) => sections.find((section) => section.sectionId === id);
  const heroInput = homepageObject(input.hero, base.hero ?? CMS_DEFAULT_HOMEPAGE_STATE.hero, 'homepage.hero', ['autoplayMs', 'slides'], errors);
  const heroSection = findSection('hero');
  const legacyAutoplay = heroSection?.settings?.autoplayMs;
  const rootAutoplay = heroInput.autoplayMs;
  const hasRootAutoplay = hasOwn(input.hero || {}, 'autoplayMs') || (isPlainObject(current) && hasOwn(base.hero || {}, 'autoplayMs'));
  let autoplayMs = hasRootAutoplay ? rootAutoplay : legacyAutoplay ?? 5200;
  if (!Number.isInteger(autoplayMs) || autoplayMs < 2500 || autoplayMs > 12000) {
    addError(errors, 'homepage.hero.autoplayMs', 'must be an integer between 2500 and 12000');
    autoplayMs = 5200;
  }
  if (heroSection) delete heroSection.settings.autoplayMs;
  const heroSlides = homepageArray(heroInput.slides, base.hero?.slides ?? [], 'homepage.hero.slides', errors, 10, (slide, field, index) => {
    if (!isPlainObject(slide)) {
      addError(errors, field, 'must be an object');
      return {};
    }
    rejectUnknownKeys(slide, new Set([
      'id', 'enabled', 'sortOrder', 'kicker', 'headline', 'headline2', 'sub', 'primaryLabel', 'primaryHref',
      'secondaryLabel', 'secondaryHref', 'overlayBg', 'buttonStyles', 'background', 'cardA', 'cardB', 'cardC', 'ribbons', 'meta',
    ]), field, errors);
    let buttonStyles = slide.buttonStyles === undefined ? {} : slide.buttonStyles;
    if (!isPlainObject(buttonStyles)) {
      addError(errors, `${field}.buttonStyles`, 'must be an object');
      buttonStyles = {};
    }
    rejectUnknownKeys(buttonStyles, new Set(['primary', 'secondary']), `${field}.buttonStyles`, errors);
    const styles = {};
    for (const key of ['primary', 'secondary']) {
      if (!hasOwn(buttonStyles, key)) continue;
      const style = buttonStyles[key];
      if (!isPlainObject(style)) {
        addError(errors, `${field}.buttonStyles.${key}`, 'must be an object');
        continue;
      }
      rejectUnknownKeys(style, new Set(['background', 'color', 'border', 'borderRadius', 'padding', 'fontSize', 'fontWeight']), `${field}.buttonStyles.${key}`, errors);
      styles[key] = {};
      for (const styleKey of Object.keys(style)) {
        styles[key][styleKey] = homepageString(style, styleKey, '', `${field}.buttonStyles.${key}.${styleKey}`, errors, 80, { css: true });
      }
    }
    const ribbons = homepageArray(slide.ribbons, [], `${field}.ribbons`, errors, 12, (ribbon, ribbonField) => {
      if (!isPlainObject(ribbon)) {
        addError(errors, ribbonField, 'must be an object');
        return {};
      }
      rejectUnknownKeys(ribbon, new Set(['label', 'value']), ribbonField, errors);
      return {
        label: homepageString(ribbon, 'label', '', `${ribbonField}.label`, errors, 80),
        value: homepageString(ribbon, 'value', '', `${ribbonField}.value`, errors, 160),
      };
    });
    return {
      id: homepageId(slide.id, `${field}.id`, errors),
      enabled: validateBoolean(slide.enabled, `${field}.enabled`, errors, true),
      sortOrder: validateSortOrder(slide.sortOrder, `${field}.sortOrder`, errors, index),
      kicker: homepageString(slide, 'kicker', '', `${field}.kicker`, errors, 90),
      headline: homepageString(slide, 'headline', '', `${field}.headline`, errors, 40),
      headline2: homepageString(slide, 'headline2', '', `${field}.headline2`, errors, 40),
      sub: homepageString(slide, 'sub', '', `${field}.sub`, errors, 220),
      primaryLabel: homepageString(slide, 'primaryLabel', '', `${field}.primaryLabel`, errors, 30),
      primaryHref: homepageString(slide, 'primaryHref', '', `${field}.primaryHref`, errors, 1024, { url: true }),
      secondaryLabel: homepageString(slide, 'secondaryLabel', '', `${field}.secondaryLabel`, errors, 30),
      secondaryHref: homepageString(slide, 'secondaryHref', '', `${field}.secondaryHref`, errors, 1024, { url: true }),
      overlayBg: homepageString(slide, 'overlayBg', '', `${field}.overlayBg`, errors, 240, { css: true }),
      buttonStyles: styles,
      background: homepageMedia(slide.background, `${field}.background`, errors),
      cardA: homepageMedia(slide.cardA, `${field}.cardA`, errors),
      cardB: homepageMedia(slide.cardB, `${field}.cardB`, errors),
      cardC: homepageMedia(slide.cardC, `${field}.cardC`, errors),
      ribbons,
      meta: homepageTextArray(slide.meta === undefined ? [] : slide.meta, `${field}.meta`, errors, 12, 120),
    };
  });

  const validatePromoOrApp = (key, allowed, fallback) => {
    const source = homepageObject(input[key], base[key] ?? fallback, `homepage.${key}`, [...allowed, 'enabled'], errors);
    const legacyEnabled = hasOwn(source, 'enabled')
      ? validateBoolean(source.enabled, `homepage.${key}.enabled`, errors, false)
      : undefined;
    const result = {};
    for (const field of allowed) {
      if (field === 'enabled') continue;
      if (field === 'stores') continue;
      if (['buttonHref'].includes(field)) result[field] = homepageString(source, field, '', `homepage.${key}.${field}`, errors, 1024, { url: true });
      else if (field === 'bg') result[field] = homepageString(source, field, '', `homepage.${key}.${field}`, errors, 240, { css: true });
      else if (field === 'pills') result[field] = homepageTextArray(source.pills === undefined ? [] : source.pills, `homepage.${key}.pills`, errors, 12, 100);
      else if (field === 'startAt' || field === 'endAt') result[field] = homepageString(source, field, '', `homepage.${key}.${field}`, errors, 40);
      else result[field] = homepageString(source, field, '', `homepage.${key}.${field}`, errors, field === 'subtitle' ? 240 : 160);
    }
    return { result, legacyEnabled };
  };

  const promo = validatePromoOrApp('promoStrip', ['title', 'subtitle', 'pills', 'buttonLabel', 'buttonHref', 'bg', 'startAt', 'endAt'], CMS_DEFAULT_HOMEPAGE_STATE.promoStrip);
  const app = validatePromoOrApp('appBanner', ['title', 'subtitle', 'stores', 'bg'], CMS_DEFAULT_HOMEPAGE_STATE.appBanner);
  const appSource = homepageObject(input.appBanner, base.appBanner ?? CMS_DEFAULT_HOMEPAGE_STATE.appBanner, 'homepage.appBanner',
    ['enabled', 'title', 'subtitle', 'stores', 'bg'], errors);
  app.result.stores = homepageArray(appSource.stores, base.appBanner?.stores ?? [], 'homepage.appBanner.stores', errors, 8, (store, field) => {
    if (!isPlainObject(store)) {
      addError(errors, field, 'must be an object');
      return {};
    }
    rejectUnknownKeys(store, new Set(['kind', 'label', 'title', 'href']), field, errors);
    const kind = homepageString(store, 'kind', 'apple', `${field}.kind`, errors, 10);
    if (!['apple', 'google'].includes(kind)) addError(errors, `${field}.kind`, 'must be apple or google');
    return {
      kind: ['apple', 'google'].includes(kind) ? kind : 'apple',
      label: homepageString(store, 'label', '', `${field}.label`, errors, 60),
      title: homepageString(store, 'title', '', `${field}.title`, errors, 80),
      href: homepageString(store, 'href', '#', `${field}.href`, errors, 1024, { url: true }),
    };
  });

  const reelsInput = homepageObject(input.reels, base.reels ?? CMS_DEFAULT_HOMEPAGE_STATE.reels, 'homepage.reels', ['title', 'subtitle', 'items'], errors);
  const reelsItems = homepageArray(reelsInput.items, base.reels?.items ?? [], 'homepage.reels.items', errors, 30, (item, field) => validateHomepageReel(item, field, errors));
  const featuresInput = homepageObject(input.features, base.features ?? CMS_DEFAULT_HOMEPAGE_STATE.features, 'homepage.features', ['title', 'subtitle', 'cards'], errors);
  const featureCards = homepageArray(featuresInput.cards, base.features?.cards ?? [], 'homepage.features.cards', errors, 20, (item, field) => validateHomepageFeature(item, field, errors));
  homepageObject(input.story, base.story ?? CMS_DEFAULT_HOMEPAGE_STATE.story, 'homepage.story',
    ['title', 'subtitle', 'buttonLabel', 'buttonHref', 'imageUrl'], errors);
  const rootForSection = (key, sectionId, legacyFields) => {
    const section = findSection(sectionId);
    const source = homepageObject(input[key], base[key] ?? CMS_DEFAULT_HOMEPAGE_STATE[key], `homepage.${key}`,
      key === 'reels' ? ['title', 'subtitle', 'items'] : key === 'features' ? ['title', 'subtitle', 'cards'] :
        ['title', 'subtitle', 'buttonLabel', 'buttonHref', 'imageUrl'], errors);
    if (!section) return source;
    if (!source.title && section.title) source.title = section.title;
    if (!source.subtitle && section.settings?.subtitle) source.subtitle = section.settings.subtitle;
    for (const field of legacyFields) {
      if ((source[field] === undefined || (Array.isArray(source[field]) && source[field].length === 0) || source[field] === '') && section.settings?.[field] !== undefined) {
        source[field] = section.settings[field];
      }
      delete section.settings[field];
    }
    delete section.settings.subtitle;
    if (source.title) section.title = source.title;
    return source;
  };
  const normalizedReels = rootForSection('reels', 'reels', ['items']);
  const normalizedFeatures = rootForSection('features', 'features', ['cards']);
  const normalizedStory = rootForSection('story', 'story', ['buttonLabel', 'buttonHref', 'imageUrl']);

  const validateEnabledSection = (key, legacyEnabled) => {
    const section = findSection(key);
    if (!section) return;
    const inputSection = Array.isArray(input.sections) ? input.sections.find((item) => item?.sectionId === key) : undefined;
    if (inputSection && hasOwn(inputSection, 'enabled')) return;
    const baseSectionValue = baseSection(key);
    if (isPlainObject(current) && baseSectionValue && hasOwn(baseSectionValue, 'enabled')) return;
    if (legacyEnabled !== undefined) section.enabled = legacyEnabled;
  };
  validateEnabledSection('promoStrip', promo.legacyEnabled);
  validateEnabledSection('appBanner', app.legacyEnabled);

  const productSections = homepageArray(input.productSections, base.productSections ?? [], 'homepage.productSections', errors, 20, (section, field, index) => {
    if (!isPlainObject(section)) {
      addError(errors, field, 'must be an object');
      return {};
    }
    rejectUnknownKeys(section, new Set(['kind', 'enabled', 'sortOrder', 'title', 'subtitle', 'viewAllHref', 'tabs', 'filter']), field, errors);
    const kind = homepageString(section, 'kind', '', `${field}.kind`, errors, 64);
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(kind)) addError(errors, `${field}.kind`, 'must be a section identifier');
    const tabs = homepageArray(section.tabs, [], `${field}.tabs`, errors, 20, (tab, tabField, tabIndex) => {
      if (!isPlainObject(tab)) {
        addError(errors, tabField, 'must be an object');
        return {};
      }
      rejectUnknownKeys(tab, new Set(['id', 'label', 'filter']), tabField, errors);
      return {
        id: homepageString(tab, 'id', `t${tabIndex}`, `${tabField}.id`, errors, 40),
        label: homepageString(tab, 'label', '', `${tabField}.label`, errors, 60),
        filter: validateHomepageFilter(tab.filter, `${tabField}.filter`, errors),
      };
    });
    const result = {
      kind,
      enabled: validateBoolean(section.enabled, `${field}.enabled`, errors, true),
      sortOrder: validateSortOrder(section.sortOrder, `${field}.sortOrder`, errors, index),
      title: homepageString(section, 'title', '', `${field}.title`, errors, 100),
      subtitle: homepageString(section, 'subtitle', '', `${field}.subtitle`, errors, 240),
      viewAllHref: homepageString(section, 'viewAllHref', '', `${field}.viewAllHref`, errors, 1024, { url: true }),
      tabs,
    };
    if (hasOwn(section, 'filter')) result.filter = validateHomepageFilter(section.filter, `${field}.filter`, errors);
    return result;
  });

  const testimonials = homepageArray(input.testimonials, base.testimonials ?? [], 'homepage.testimonials', errors, 20, (item, field, index) => {
    if (!isPlainObject(item)) {
      addError(errors, field, 'must be an object');
      return {};
    }
    rejectUnknownKeys(item, new Set(['id', 'enabled', 'sortOrder', 'name', 'meta', 'rating', 'text', 'avatar']), field, errors);
    const rating = item.rating === undefined ? 5 : item.rating;
    if (typeof rating !== 'number' || !Number.isFinite(rating) || rating < 0 || rating > 5) addError(errors, `${field}.rating`, 'must be a number between 0 and 5');
    return {
      id: homepageId(item.id, `${field}.id`, errors),
      enabled: validateBoolean(item.enabled, `${field}.enabled`, errors, true),
      sortOrder: validateSortOrder(item.sortOrder, `${field}.sortOrder`, errors, index),
      name: homepageString(item, 'name', '', `${field}.name`, errors, 60),
      meta: homepageString(item, 'meta', '', `${field}.meta`, errors, 80),
      rating: typeof rating === 'number' && Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : 5,
      text: homepageString(item, 'text', '', `${field}.text`, errors, 1600),
      avatar: homepageMedia(item.avatar, `${field}.avatar`, errors),
    };
  });
  const logos = homepageArray(input.logos, base.logos ?? [], 'homepage.logos', errors, 20, (item, field, index) => {
    if (!isPlainObject(item)) {
      addError(errors, field, 'must be an object');
      return {};
    }
    rejectUnknownKeys(item, new Set(['id', 'enabled', 'sortOrder', 'name', 'href', 'logo']), field, errors);
    return {
      id: homepageId(item.id, `${field}.id`, errors),
      enabled: validateBoolean(item.enabled, `${field}.enabled`, errors, true),
      sortOrder: validateSortOrder(item.sortOrder, `${field}.sortOrder`, errors, index),
      name: homepageString(item, 'name', '', `${field}.name`, errors, 40),
      href: homepageString(item, 'href', '', `${field}.href`, errors, 1024, { url: true }),
      logo: homepageMedia(item.logo, `${field}.logo`, errors),
    };
  });

  const value = {
    version: 1,
    theme: { tokens },
    announcement,
    navigation: { links: navigationLinks },
    footer,
    sections,
    hero: { autoplayMs, slides: heroSlides },
    promoStrip: promo.result,
    appBanner: app.result,
    testimonials,
    logos,
    productSections,
    reels: {
      title: homepageString(normalizedReels, 'title', '', 'homepage.reels.title', errors, 80),
      subtitle: homepageString(normalizedReels, 'subtitle', '', 'homepage.reels.subtitle', errors, 160),
      items: homepageArray(normalizedReels.items, reelsItems, 'homepage.reels.items', errors, 30, (item, field) => validateHomepageReel(item, field, errors)),
    },
    features: {
      title: homepageString(normalizedFeatures, 'title', '', 'homepage.features.title', errors, 80),
      subtitle: homepageString(normalizedFeatures, 'subtitle', '', 'homepage.features.subtitle', errors, 160),
      cards: homepageArray(normalizedFeatures.cards, featureCards, 'homepage.features.cards', errors, 20, (item, field) => validateHomepageFeature(item, field, errors)),
    },
    story: {
      title: homepageString(normalizedStory, 'title', '', 'homepage.story.title', errors, 80),
      subtitle: homepageString(normalizedStory, 'subtitle', '', 'homepage.story.subtitle', errors, 160),
      buttonLabel: homepageString(normalizedStory, 'buttonLabel', '', 'homepage.story.buttonLabel', errors, 40),
      buttonHref: homepageString(normalizedStory, 'buttonHref', '', 'homepage.story.buttonHref', errors, 1024, { url: true }),
      imageUrl: homepageString(normalizedStory, 'imageUrl', '', 'homepage.story.imageUrl', errors, 1024, { url: true }),
    },
  };
  if (errors.length) return { value: null, errors };
  return { value, errors: [] };
}

export { validateHomepageState };

export default {
  CMS_COMPONENT_TYPES,
  CMS_PAGE_STATUSES,
  CMS_DEFAULT_SETTINGS,
  CMS_DEFAULT_HOMEPAGE_STATE,
  validateComponent,
  validatePageSnapshot,
  validateWebsiteSettings,
  validatePageMetadata,
  validateHomepageState,
  normalizeSlug,
  isSafeUrl,
};