/**
 * Public CMS rendering helpers.
 *
 * Rendering is intentionally schema-driven: component objects are converted to
 * DOM nodes using safe DOM APIs. No stored HTML, CSS, or JavaScript is inserted
 * through innerHTML.
 */

const ALLOWED_COMPONENT_TYPES = new Set([
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

export function isSafePublicUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const url = value.trim();
  if (url.startsWith('/')) {
    return /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(url) && !url.includes('..') && !url.includes('\\');
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isSafeColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

export function escapeText(value) {
  return String(value ?? '');
}

export function renderComponent(component, document) {
  if (!component || typeof component !== 'object' || Array.isArray(component)) return null;
  if (!ALLOWED_COMPONENT_TYPES.has(component.type)) return null;
  if (typeof component.id !== 'string' || component.id.trim() === '') return null;
  if (!component.props || typeof component.props !== 'object' || Array.isArray(component.props)) return null;

  const props = component.props;
  const section = document.createElement('section');
  section.className = `cms-section cms-${component.type}`;
  section.dataset.cmsId = component.id;

  switch (component.type) {
    case 'hero': {
      const heading = document.createElement('h1');
      heading.textContent = escapeText(props.heading);
      section.appendChild(heading);
      if (typeof props.subheading === 'string') {
        const sub = document.createElement('p');
        sub.textContent = props.subheading;
        section.appendChild(sub);
      }
      if (isSafePublicUrl(props.image)) {
        const img = document.createElement('img');
        img.src = props.image.trim();
        img.alt = typeof props.alt === 'string' ? props.alt : '';
        img.loading = 'lazy';
        section.appendChild(img);
      }
      if (typeof props.ctaLabel === 'string' && isSafePublicUrl(props.ctaUrl)) {
        const link = document.createElement('a');
        link.textContent = props.ctaLabel;
        link.href = props.ctaUrl.trim();
        section.appendChild(link);
      }
      return section;
    }
    case 'richText': {
      const paragraph = document.createElement('p');
      paragraph.textContent = escapeText(props.text);
      section.appendChild(paragraph);
      return section;
    }
    case 'imageText': {
      if (isSafePublicUrl(props.image)) {
        const img = document.createElement('img');
        img.src = props.image.trim();
        img.alt = typeof props.alt === 'string' ? props.alt : '';
        img.loading = 'lazy';
        section.appendChild(img);
      }
      if (typeof props.heading === 'string') {
        const heading = document.createElement('h2');
        heading.textContent = props.heading;
        section.appendChild(heading);
      }
      if (typeof props.body === 'string') {
        const body = document.createElement('p');
        body.textContent = props.body;
        section.appendChild(body);
      }
      if (typeof props.buttonLabel === 'string' && isSafePublicUrl(props.buttonUrl)) {
        const link = document.createElement('a');
        link.textContent = props.buttonLabel;
        link.href = props.buttonUrl.trim();
        section.appendChild(link);
      }
      return section;
    }
    case 'spacer': {
      const spacer = document.createElement('div');
      spacer.className = 'cms-spacer';
      spacer.dataset.size = typeof props.height === 'string' ? props.height : 'medium';
      section.appendChild(spacer);
      return section;
    }
    case 'divider': {
      const hr = document.createElement('hr');
      section.appendChild(hr);
      return section;
    }
    default: {
      const fallback = document.createElement('div');
      fallback.textContent = '';
      section.appendChild(fallback);
      return section;
    }
  }
}

export function renderComponents(components, document, container) {
  if (!Array.isArray(components) || !container) return;
  container.replaceChildren();
  for (const component of components) {
    const node = renderComponent(component, document);
    if (node) container.appendChild(node);
  }
}

export default {
  isSafePublicUrl,
  isSafeColor,
  renderComponent,
  renderComponents,
};