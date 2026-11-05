import test from 'node:test';
import assert from 'node:assert/strict';

import { CMS_DEFAULT_HOMEPAGE_STATE, validateHomepageState, validatePageSnapshot, isSafeUrl } from '../src/models/cms.js';
import { getOrCreateHomepagePage } from '../src/routes/cms.js';

test('CMS_DEFAULT_HOMEPAGE_STATE passes homepage validation', () => {
  const result = validateHomepageState(CMS_DEFAULT_HOMEPAGE_STATE);
  assert.equal(result.errors.length, 0);
  assert.equal(result.value.version, 1);
  assert.ok(Array.isArray(result.value.sections));
});

test('generic validatePageSnapshot rejects unsupported homepage field', () => {
  const result = validatePageSnapshot({ title: 'Home', homepage: CMS_DEFAULT_HOMEPAGE_STATE });
  assert.equal(result.value, null);
  assert.ok(result.errors.some((error) => error.includes('homepage')));
});

test('validateHomepageState accepts valid footer links and local media URLs', () => {
  const state = structuredClone(CMS_DEFAULT_HOMEPAGE_STATE);
  state.footer.columns = [
    {
      title: 'Links',
      muted: '',
      links: [{ label: 'Home', href: '/index.html' }],
      social: [{ label: 'IG', href: 'https://example.com', aria: 'Instagram' }],
    },
  ];
  state.logos = [{ id: 1, enabled: true, sortOrder: 0, name: 'Logo', href: '/about.html', logo: { id: 2, url: '/api/cms/media/logo.png' } }];
  state.testimonials = [{ id: 3, enabled: true, sortOrder: 0, name: 'A', meta: 'm', rating: 5, text: 't', avatar: { id: 4, url: '/assets/zaevi-icon.png' } }];

  const result = validateHomepageState(state);
  assert.equal(result.errors.length, 0);
  assert.equal(result.value.footer.columns[0].links[0].href, '/index.html');
  assert.equal(result.value.logos[0].logo.url, '/api/cms/media/logo.png');
});

test('validateHomepageState rejects unsafe footer href', () => {
  const state = structuredClone(CMS_DEFAULT_HOMEPAGE_STATE);
  state.footer.columns = [{ title: 'Links', muted: '', links: [{ label: 'Bad', href: 'javascript:alert(1)' }], social: [] }];
  const result = validateHomepageState(state);
  assert.equal(result.value, null);
  assert.ok(result.errors.some((error) => error.includes('href')));
});

test('validateHomepageState rejects unsafe logo and testimonial URLs', () => {
  const state = structuredClone(CMS_DEFAULT_HOMEPAGE_STATE);
  state.logos = [{ id: 1, enabled: true, sortOrder: 0, name: 'Logo', href: 'javascript:alert(1)', logo: { id: 2, url: 'data:text/html;base64,AAAA' } }];
  state.testimonials = [{ id: 3, enabled: true, sortOrder: 0, name: 'A', meta: 'm', rating: 5, text: 't', avatar: { id: 4, url: 'javascript:alert(1)' } }];

  const result = validateHomepageState(state);
  assert.equal(result.value, null);
  assert.ok(result.errors.length > 0);
});

test('validateHomepageState preserves safe local homepage media and rejects unsafe panel URLs', () => {
  const state = structuredClone(CMS_DEFAULT_HOMEPAGE_STATE);
  state.reels.items = [{ title: 'Reel', productImage: '/api/cms/media/reel.png', href: '/shop.html' }];
  state.story.imageUrl = '/assets/zaevi-icon.png';
  state.story.buttonHref = '/about.html';
  state.productSections = [{ kind: 'bestsellers', viewAllHref: '/shop.html', tabs: [{ label: 'All', filter: {} }] }];
  const valid = validateHomepageState(state);
  assert.equal(valid.errors.length, 0);
  assert.equal(valid.value.reels.items[0].productImage, '/api/cms/media/reel.png');
  assert.equal(valid.value.story.imageUrl, '/assets/zaevi-icon.png');

  state.story.imageUrl = 'javascript:alert(1)';
  const invalid = validateHomepageState(state);
  assert.ok(invalid.errors.some((error) => error.includes('homepage.story.imageUrl')));
});

test('validateHomepageState accepts states shaped like the homepage editor contract', () => {
  const state = structuredClone(CMS_DEFAULT_HOMEPAGE_STATE);
  state.theme.tokens = { '--brand': '#123456', '--font-sans': '"Manrope", ui-sans-serif', '--gc-blur': '14px' };
  state.announcement = { ...state.announcement, enabled: true, text: 'Limited offer', ctaHref: '/shop.html' };
  state.navigation.links = [{ label: 'Shop', href: '/shop.html', isPill: true, enabled: true, sortOrder: 0 }];
  state.footer.chips = ['Cruelty-free'];
  state.hero.slides = [{
    id: 1,
    enabled: true,
    sortOrder: 0,
    kicker: 'New',
    headline: 'Glow',
    headline2: 'Ritual',
    sub: 'Everyday care',
    primaryLabel: 'Shop',
    primaryHref: '/shop.html',
    secondaryLabel: 'Learn more',
    secondaryHref: '/about.html',
    overlayBg: 'linear-gradient(120deg, rgba(255,46,122,.18), rgba(138,91,255,.16))',
    buttonStyles: {},
    background: { id: null, url: '/api/cms/media/hero.png', kind: 'image' },
    cardA: { id: null, url: '' },
    cardB: null,
    cardC: null,
    ribbons: [{ label: 'OFFER', value: '10%' }],
    meta: ['Campaign'],
  }];
  state.reels.items = [{ title: 'Routine', productImage: '/assets/reel.png', href: '/shop.html' }];
  state.features.cards = [{ title: 'Clean', desc: 'Thoughtfully made.' }];
  state.story.buttonHref = '/about.html';
  state.story.imageUrl = '/api/cms/media/story.png';
  state.promoStrip.title = 'Gift with purchase';
  state.appBanner.stores = [{ kind: 'apple', label: 'Download on the', title: 'App Store', href: '#' }];
  state.logos = [{ id: 2, enabled: true, sortOrder: 0, name: 'Featured', href: '/about.html', logo: { id: null, url: '/assets/logo.png' } }];
  state.testimonials = [{ id: 3, enabled: true, sortOrder: 0, name: 'Customer', meta: 'Verified', rating: 5, text: 'Lovely', avatar: null }];
  state.productSections = [{
    kind: 'bestsellers',
    enabled: true,
    sortOrder: 0,
    title: 'Best sellers',
    subtitle: '',
    viewAllHref: '/shop.html',
    tabs: [{ id: 'all', label: 'All', filter: { badge: 'Bestseller', category: 'care', concern: '', search: '' } }],
  }];

  const result = validateHomepageState(state);
  assert.deepEqual(result.errors, []);
  assert.equal(result.value.hero.slides[0].background.url, '/api/cms/media/hero.png');
  assert.equal(result.value.appBanner.stores[0].href, '#');
  assert.deepEqual(result.value.productSections[0].tabs[0].filter, { badge: 'Bestseller', category: 'care', concern: '', search: '' });
});

test('validateHomepageState rejects malformed nested homepage structures and unknown fields', () => {
  const invalidStates = [
    (state) => { state.story = 'not an object'; },
    (state) => { state.productSections = [{ kind: 'bestsellers', tabs: 'not-an-array' }]; },
    (state) => { state.productSections = [{ kind: 'bestsellers', tabs: [{ label: 'All', filter: 'not-an-object' }] }]; },
    (state) => { state.hero.slides = [{ ribbons: { label: 'OFFER' } }]; },
    (state) => { state.productSections = [{ kind: 'bestsellers', tabs: [{ label: 'All', filter: {}, extra: { href: 'javascript:alert(1)' } }] }]; },
    (state) => { state.reels.items = [{ title: 'Reel', href: 'javascript:alert(1)' }]; },
    (state) => { state.announcement.enabled = 'true'; },
    (state) => { state.navigation.links = [{ label: 'Shop', href: '/shop.html', enabled: 'yes' }]; },
  ];

  for (const makeInvalid of invalidStates) {
    const state = structuredClone(CMS_DEFAULT_HOMEPAGE_STATE);
    makeInvalid(state);
    const result = validateHomepageState(state);
    assert.equal(result.value, null, `expected invalid state to fail: ${JSON.stringify(state)}`);
    assert.ok(result.errors.length > 0);
  }

  const nestedUnknown = structuredClone(CMS_DEFAULT_HOMEPAGE_STATE);
  nestedUnknown.productSections = [{
    kind: 'bestsellers',
    tabs: [{ label: 'All', filter: { badge: '', category: '', concern: '', search: '' }, unrecognized: 'javascript:alert(1)' }],
  }];
  const rejected = validateHomepageState(nestedUnknown);
  assert.ok(rejected.errors.some((error) => error.includes('unrecognized')));
});

test('validateHomepageState canonicalizes duplicate settings with explicit legacy precedence', () => {
  const conflicting = structuredClone(CMS_DEFAULT_HOMEPAGE_STATE);
  conflicting.hero.autoplayMs = 6500;
  conflicting.sections.find((section) => section.sectionId === 'hero').settings.autoplayMs = 9000;
  conflicting.promoStrip.enabled = true;
  conflicting.sections.find((section) => section.sectionId === 'promoStrip').enabled = false;
  conflicting.appBanner.enabled = false;
  conflicting.sections.find((section) => section.sectionId === 'appBanner').enabled = true;

  const result = validateHomepageState(conflicting);
  assert.deepEqual(result.errors, []);
  assert.equal(result.value.hero.autoplayMs, 6500);
  assert.equal(Object.hasOwn(result.value.sections.find((section) => section.sectionId === 'hero').settings, 'autoplayMs'), false);
  assert.equal(result.value.sections.find((section) => section.sectionId === 'promoStrip').enabled, false);
  assert.equal(result.value.sections.find((section) => section.sectionId === 'appBanner').enabled, true);
  assert.equal(Object.hasOwn(result.value.promoStrip, 'enabled'), false);
  assert.equal(Object.hasOwn(result.value.appBanner, 'enabled'), false);

  const legacy = {
    sections: [{ sectionId: 'hero', settings: { autoplayMs: 7000 } }, { sectionId: 'promoStrip' }, { sectionId: 'appBanner' }],
    promoStrip: { enabled: true },
    appBanner: { enabled: true },
  };
  const migrated = validateHomepageState(legacy);
  assert.deepEqual(migrated.errors, []);
  assert.equal(migrated.value.hero.autoplayMs, 7000);
  assert.equal(migrated.value.sections.find((section) => section.sectionId === 'promoStrip').enabled, true);
  assert.equal(migrated.value.sections.find((section) => section.sectionId === 'appBanner').enabled, true);
});

test('validateHomepageState preserves omitted fields from the current valid draft', () => {
  const current = structuredClone(CMS_DEFAULT_HOMEPAGE_STATE);
  current.theme.tokens = { '--brand': '#abcdef' };
  current.announcement.text = 'Keep this announcement';
  current.promoStrip.buttonHref = '/shop.html';
  current.reels.items = [{ title: 'Existing reel', productImage: '/assets/reel.png', href: '/shop.html' }];

  const result = validateHomepageState({
    theme: { tokens: { '--gc-mint': '#39d3c1' } },
    announcement: { enabled: true },
    promoStrip: { title: 'Updated promo' },
    reels: { subtitle: 'Updated subtitle' },
  }, current);

  assert.deepEqual(result.errors, []);
  assert.equal(result.value.theme.tokens['--brand'], '#abcdef');
  assert.equal(result.value.theme.tokens['--gc-mint'], '#39d3c1');
  assert.equal(result.value.announcement.text, 'Keep this announcement');
  assert.equal(result.value.promoStrip.buttonHref, '/shop.html');
  assert.deepEqual(result.value.reels.items, current.reels.items);
});

test('getOrCreateHomepagePage preserves homepage state on bootstrap', async () => {
  const prisma = {
    cmsPage: {
      findUnique: async () => null,
      create: async ({ data }) => ({ id: 1, ...data }),
      update: async ({ data }) => ({
        id: 1,
        slug: 'home',
        draftRevisionId: data.draftRevisionId,
        draftRevision: {
          id: 1,
          version: 1,
          snapshot: {
            title: 'Home',
            seoTitle: null,
            seoDescription: null,
            components: [],
            homepage: CMS_DEFAULT_HOMEPAGE_STATE,
          },
          createdAt: new Date(),
        },
        publishedRevision: null,
      }),
    },
    cmsPageRevision: {
      create: async ({ data }) => ({ id: 1, ...data, createdAt: new Date() }),
    },
    $transaction: async (callback) => callback(prisma),
  };

  const page = await getOrCreateHomepagePage(prisma);
  assert.equal(page.slug, 'home');
  assert.deepEqual(page.draftRevision.snapshot.homepage, CMS_DEFAULT_HOMEPAGE_STATE);
});

test('getOrCreateHomepagePage handles a concurrent uniqueness conflict', async () => {
  const existingPage = {
    id: 2,
    slug: 'home',
    draftRevision: {
      id: 2,
      version: 1,
      snapshot: { title: 'Home', seoTitle: null, seoDescription: null, components: [], homepage: CMS_DEFAULT_HOMEPAGE_STATE },
      createdAt: new Date(),
    },
    publishedRevision: null,
  };

  let findCount = 0;
  const prisma = {
    cmsPage: {
      findUnique: async () => {
        findCount += 1;
        return findCount === 1 ? null : existingPage;
      },
      create: async () => {
        const error = new Error('Unique constraint failed');
        error.code = 'P2002';
        throw error;
      },
    },
    $transaction: async (callback) => callback(prisma),
  };

  const page = await getOrCreateHomepagePage(prisma);
  assert.equal(page.id, existingPage.id);
  assert.deepEqual(page.draftRevision.snapshot.homepage, CMS_DEFAULT_HOMEPAGE_STATE);
});

test('isSafeUrl still accepts supported local media URLs', () => {
  assert.equal(isSafeUrl('/api/cms/media/example.png'), true);
  assert.equal(isSafeUrl('/assets/zaevi-icon.png'), true);
});