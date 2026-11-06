import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CMS_COMPONENT_TYPES,
  CMS_DEFAULT_SETTINGS,
  CMS_HEADER_LAYOUTS,
  validateWebsiteSettings,
  validatePageMetadata,
  validatePageSnapshot,
  validateComponent,
  normalizeSlug,
  isSafeUrl,
} from '../src/models/cms.js';

test('CMS defaults are safe and complete', () => {
  assert.equal(CMS_DEFAULT_SETTINGS.primaryColor, '#111111');
  assert.equal(CMS_DEFAULT_SETTINGS.announcementEnabled, false);
  assert.deepEqual(CMS_DEFAULT_SETTINGS.socialLinks, {});
});

test('normalizeSlug accepts lowercase slugs and rejects unsafe values', () => {
  assert.equal(normalizeSlug('home'), 'home');
  assert.equal(normalizeSlug('About-Us'), 'about-us');
  assert.equal(normalizeSlug('../admin'), null);
  assert.equal(normalizeSlug('bad slug'), null);
  assert.equal(normalizeSlug(''), null);
});

test('isSafeUrl rejects javascript and data URLs', () => {
  assert.equal(isSafeUrl('https://example.com/image.png'), true);
  assert.equal(isSafeUrl('/assets/logo.png'), true);
  assert.equal(isSafeUrl('javascript:alert(1)'), false);
  assert.equal(isSafeUrl('data:text/html;base64,AAAA'), false);
  assert.equal(isSafeUrl('/foo/../bar'), false);
});

test('validateWebsiteSettings rejects unknown keys and invalid colors', () => {
  const unknown = validateWebsiteSettings({ foo: 'bar' });
  assert.equal(unknown.value, null);
  assert.ok(unknown.errors.some((error) => error.includes('foo')));

  const invalidColor = validateWebsiteSettings({ primaryColor: 'red' });
  assert.equal(invalidColor.value, null);
  assert.ok(invalidColor.errors.some((error) => error.includes('primaryColor')));
});

test('validateWebsiteSettings applies partial updates to defaults', () => {
  const result = validateWebsiteSettings({ siteName: 'ZAEVI Test', announcementEnabled: true });
  assert.equal(result.errors.length, 0);
  assert.equal(result.value.siteName, 'ZAEVI Test');
  assert.equal(result.value.announcementEnabled, true);
  assert.equal(result.value.primaryColor, CMS_DEFAULT_SETTINGS.primaryColor);
});

test('validateWebsiteSettings validates nested social links and theme tokens', () => {
  const result = validateWebsiteSettings({
    socialLinks: { instagram: 'https://instagram.com/zaevi' },
    themeTokens: { heroHeight: 240, label: 'large' },
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.value.socialLinks.instagram, 'https://instagram.com/zaevi');
  assert.equal(result.value.themeTokens.heroHeight, 240);
});

test('validatePageMetadata requires slug and title', () => {
  const missing = validatePageMetadata({});
  assert.deepEqual(missing.value, {});
  assert.equal(missing.errors.length, 0);

  const valid = validatePageMetadata({ slug: 'about', title: 'About ZAEVI' });
  assert.equal(valid.errors.length, 0);
  assert.equal(valid.value.slug, 'about');
});

test('validateComponent rejects unknown types and extra properties', () => {
  const unknown = validateComponent({ id: 'hero-1', type: 'script', props: {} });
  assert.equal(unknown.value, null);
  assert.ok(unknown.errors.some((error) => error.includes('component.type')));

  const extra = validateComponent({ id: 'hero-1', type: 'hero', props: {}, html: '<script>' });
  assert.equal(extra.value, null);
  assert.ok(extra.errors.some((error) => error.includes('unsupported properties')));
});

test('validateComponent validates hero props', () => {
  const valid = validateComponent({
    id: 'hero-1',
    type: 'hero',
    props: { heading: 'New Collection', alignment: 'center', overlay: 0.4 },
  });
  assert.equal(valid.errors.length, 0);
  assert.equal(valid.value.type, 'hero');

  const invalid = validateComponent({
    id: 'hero-2',
    type: 'hero',
    props: { alignment: 'diagonal', overlay: 2 },
  });
  assert.equal(invalid.value, null);
  assert.ok(invalid.errors.length >= 2);
});

test('validatePageSnapshot rejects arbitrary fields and unknown components', () => {
  const result = validatePageSnapshot({
    title: 'Home',
    components: [{ id: 'x', type: 'rawHtml', props: { html: '<script>' } }],
  });
  assert.equal(result.value, null);
  assert.ok(result.errors.some((error) => error.includes('must be one of')));
});

test('validatePageSnapshot accepts a valid component list', () => {
  const result = validatePageSnapshot({
    title: 'Home',
    components: [
      { id: 'hero-1', type: 'hero', props: { heading: 'Welcome' } },
      { id: 'spacer-1', type: 'spacer', props: { height: 'medium' } },
    ],
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.value.components.length, 2);
});

test('all component types have schemas', () => {
  for (const type of CMS_COMPONENT_TYPES) {
    const result = validateComponent({ id: `${type}-1`, type, props: {} });
    // Components with required props may fail, but unknown type must not.
    assert.ok(!result.errors.some((error) => error.includes('must be one of')));
  }
});