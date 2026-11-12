import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { CMS_DEFAULT_HOMEPAGE_STATE } from '../src/models/cms.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const editorSource = readFileSync(path.join(ROOT, '..', 'frontend', 'js', 'homepage-editor.js'), 'utf8');
const sidebarSource = readFileSync(path.join(ROOT, '..', 'frontend', 'js', 'homepage-sidebar.js'), 'utf8');

class MockTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return true;
  }
}

class MockCustomEvent {
  constructor(type, { detail } = {}) {
    this.type = type;
    this.detail = detail;
  }
}

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    },
  };
}

function createEditor({ fetch, initialState = CMS_DEFAULT_HOMEPAGE_STATE }) {
  const calls = [];
  const saveButton = new MockTarget();
  saveButton.textContent = '';
  saveButton.disabled = false;
  const status = { textContent: '' };
  const elements = new Map([
    ['[data-editor-bootstrap]', { textContent: JSON.stringify({ stateUrl: '/api/admin/cms/homepage', applyUrl: '/api/admin/cms/homepage' }) }],
    ['[data-editor-shell]', {}],
    ['[data-editor-status]', status],
    ['[data-editor-iframe]', null],
    ['[data-editor-save]', saveButton],
    ['[data-editor-reload]', new MockTarget()],
    ['[data-editor-search]', new MockTarget()],
    ['[data-editor-publish]', null],
  ]);
  const document = {
    cookie: '',
    readyState: 'complete',
    querySelector(selector) {
      return elements.get(selector) ?? null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
  };
  const window = new MockTarget();
  Object.assign(window, {
    location: { origin: 'https://zaevi.test' },
    setTimeout,
    clearTimeout,
  });
  const context = {
    window,
    document,
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      return fetch(url, options, calls, initialState);
    },
    EventTarget: MockTarget,
    CustomEvent: MockCustomEvent,
    console: { error() {} },
    setTimeout,
    clearTimeout,
    Date,
    JSON,
    Array,
    String,
    Number,
    Math,
    Promise,
  };
  vm.runInNewContext(editorSource, context, { filename: 'homepage-editor.js' });
  return { editor: window.GCEditor, calls, saveButton, status };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('homepage editor loads the complete server draft without dropping supported fields', async () => {
  const draft = structuredClone(CMS_DEFAULT_HOMEPAGE_STATE);
  draft.theme.tokens = { '--brand': '#123456' };
  draft.announcement.text = 'Draft announcement';
  draft.navigation.links = [{ label: 'Shop', href: '/shop.html', enabled: true, isPill: false, sortOrder: 0 }];
  draft.footer.aboutText = 'Footer draft';
  draft.sections[0].enabled = false;
  draft.hero.slides = [{
    id: 42,
    enabled: true,
    sortOrder: 0,
    kicker: 'New',
    headline: 'Draft hero',
    headline2: '',
    sub: 'Subtext',
    primaryLabel: 'Shop',
    primaryHref: '/shop.html',
    secondaryLabel: '',
    secondaryHref: '',
    overlayBg: '',
    buttonStyles: {},
    background: { id: null, url: '/assets/zaevi-icon.png' },
    cardA: null,
    cardB: null,
    cardC: null,
    ribbons: [],
    meta: [],
  }];
  draft.reels.items = [{ title: 'Reel', productImage: '/assets/zaevi-icon.png', href: '/shop.html' }];
  draft.features.cards = [{ title: 'Feature', desc: 'Saved feature' }];
  draft.story.buttonLabel = 'Read story';
  for (const sectionId of ['reels', 'features', 'story']) {
    const section = draft.sections.find((item) => item.sectionId === sectionId);
    draft[sectionId].title = section.title;
  }
  draft.promoStrip.title = 'Promo';
  draft.appBanner.title = 'App';
  draft.logos = [{ id: 7, enabled: true, sortOrder: 0, name: 'Logo', href: '/about.html', logo: { id: null, url: '/assets/zaevi-icon.png' } }];
  draft.testimonials = [{ id: 8, enabled: true, sortOrder: 0, name: 'Buyer', meta: 'Verified', rating: 5, text: 'Great', avatar: null }];
  draft.productSections = [{ kind: 'bestsellers', enabled: true, sortOrder: 0, title: 'Best', subtitle: '', viewAllHref: '/shop.html', tabs: [] }];

  const runtime = createEditor({
    initialState: draft,
    fetch: async () => jsonResponse(200, { data: { state: draft } }),
  });
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.editor.getState())), JSON.parse(JSON.stringify(draft)));
  assert.match(runtime.status.textContent, /Preview is unavailable until Phase C/);
  assert.equal(runtime.saveButton.disabled, true);
});

test('homepage editor migrates legacy section content into the canonical homepage fields', async () => {
  const draft = structuredClone(CMS_DEFAULT_HOMEPAGE_STATE);
  const reels = draft.sections.find((section) => section.sectionId === 'reels');
  reels.settings = { items: [{ title: 'Legacy reel', productImage: '/assets/reel.png', href: '/shop.html' }], subtitle: 'Legacy reels subtitle', bg: '#fff' };
  const features = draft.sections.find((section) => section.sectionId === 'features');
  features.settings = { cards: [{ title: 'Legacy feature', desc: 'Legacy description' }] };
  const story = draft.sections.find((section) => section.sectionId === 'story');
  story.settings = { buttonLabel: 'Legacy story', buttonHref: '/about.html', imageUrl: '/assets/story.png' };

  const runtime = createEditor({
    fetch: async () => jsonResponse(200, { data: { state: draft } }),
  });
  await settle();
  const loaded = runtime.editor.getState();
  assert.deepEqual(loaded.reels.items, reels.settings.items);
  assert.equal(loaded.reels.subtitle, 'Legacy reels subtitle');
  assert.deepEqual(loaded.features.cards, features.settings.cards);
  assert.equal(loaded.story.buttonLabel, 'Legacy story');
  assert.equal(loaded.story.imageUrl, '/assets/story.png');
  assert.equal(loaded.sections.find((section) => section.sectionId === 'reels').settings.bg, '#fff');
  assert.equal(Object.hasOwn(loaded.sections.find((section) => section.sectionId === 'reels').settings, 'items'), false);
});

test('homepage editor normalizes duplicated settings using the canonical root and section values', async () => {
  const draft = structuredClone(CMS_DEFAULT_HOMEPAGE_STATE);
  draft.hero.autoplayMs = 6400;
  draft.sections.find((section) => section.sectionId === 'hero').settings.autoplayMs = 9000;
  draft.sections.find((section) => section.sectionId === 'promoStrip').enabled = false;
  draft.promoStrip.enabled = true;
  draft.sections.find((section) => section.sectionId === 'appBanner').enabled = true;
  draft.appBanner.enabled = false;

  const runtime = createEditor({ fetch: async () => jsonResponse(200, { data: { state: draft } }) });
  await settle();
  const loaded = runtime.editor.getState();
  assert.equal(loaded.hero.autoplayMs, 6400);
  assert.equal(Object.hasOwn(loaded.sections.find((section) => section.sectionId === 'hero').settings, 'autoplayMs'), false);
  assert.equal(loaded.sections.find((section) => section.sectionId === 'promoStrip').enabled, false);
  assert.equal(loaded.sections.find((section) => section.sectionId === 'appBanner').enabled, true);
  assert.equal(Object.hasOwn(loaded.promoStrip, 'enabled'), false);
  assert.equal(Object.hasOwn(loaded.appBanner, 'enabled'), false);
});

test('sidebar state updates preserve active text and textarea controls', () => {
  const textControl = { tagName: 'INPUT', type: 'text', selectionStart: 3, selectionEnd: 3 };
  const host = {
    innerHTML: '<input class="active">',
    contains: (element) => element === textControl,
    appendChild() {
      this.innerHTML = 'replaced';
    },
  };
  const handlers = new Map();
  const window = {
    GCEditor: {
      on(name, handler) {
        handlers.set(name, handler);
      },
      getState() {
        return {};
      },
    },
  };
  const document = {
    readyState: 'complete',
    activeElement: textControl,
    querySelector(selector) {
      return selector === '[data-editor-panels]' ? host : null;
    },
    querySelectorAll() {
      return [];
    },
  };
  vm.runInNewContext(sidebarSource, { window, document, console, Set, Array, String, Number, Math });

  handlers.get('gc:state')({ announcement: { text: 'A typed character' } });
  assert.equal(host.innerHTML, '<input class="active">');
  assert.equal(document.activeElement, textControl);
  assert.equal(textControl.selectionStart, 3);

  document.activeElement = { tagName: 'TEXTAREA', selectionStart: 2, selectionEnd: 2 };
  host.contains = (element) => element === document.activeElement;
  handlers.get('gc:state')({ footer: { aboutText: 'More text' } });
  assert.equal(host.innerHTML, '<input class="active">');
  assert.equal(document.activeElement.selectionStart, 2);
});

test('homepage editor sends a CSRF-protected PUT draft and clears dirty state only on confirmation', async () => {
  const runtime = createEditor({
    fetch: async (_url, options, calls, initialState) => {
      if (options.method === 'PUT') {
        return jsonResponse(200, { data: { state: JSON.parse(options.body).state } });
      }
      return jsonResponse(200, { data: { state: initialState } });
    },
  });
  await settle();
  runtime.editor.patch((state) => {
    state.announcement.text = 'Changed locally';
  });
  assert.equal(runtime.saveButton.disabled, false);

  runtime.saveButton.dispatchEvent({ type: 'click' });
  await settle();

  const save = runtime.calls.find((call) => call.options.method === 'PUT');
  assert.ok(save);
  assert.equal(save.url, '/api/admin/cms/homepage');
  assert.equal(save.options.headers['x-csrf-token'], '');
  assert.equal(JSON.parse(save.options.body).state.announcement.text, 'Changed locally');
  assert.equal(runtime.saveButton.textContent, 'Save Draft');
  assert.equal(runtime.saveButton.disabled, true);
  assert.match(runtime.status.textContent, /Draft saved/);
});

test('homepage editor keeps the draft dirty and exposes validation errors after a rejected save', async () => {
  const runtime = createEditor({
    fetch: async (_url, options, _calls, initialState) => options.method === 'PUT'
      ? jsonResponse(400, { error: { status: 400, message: 'homepage.announcement.ctaHref must be a safe URL' } })
      : jsonResponse(200, { data: { state: initialState } }),
  });
  await settle();
  runtime.editor.patch((state) => {
    state.announcement.ctaHref = 'javascript:alert(1)';
  });
  runtime.saveButton.dispatchEvent({ type: 'click' });
  await settle();

  assert.equal(runtime.editor.getState().announcement.ctaHref, 'javascript:alert(1)');
  assert.equal(runtime.saveButton.textContent, 'Save Draft*');
  assert.equal(runtime.saveButton.disabled, false);
  assert.match(runtime.status.textContent, /homepage\.announcement\.ctaHref must be a safe URL/);
});

test('homepage editor reports network failures without clearing dirty state', async () => {
  const runtime = createEditor({
    fetch: async (_url, options, _calls, initialState) => {
      if (options.method === 'PUT') throw new TypeError('private network detail');
      return jsonResponse(200, { data: { state: initialState } });
    },
  });
  await settle();
  runtime.editor.patch((state) => {
    state.footer.aboutText = 'Unsaved';
  });
  runtime.saveButton.dispatchEvent({ type: 'click' });
  await settle();

  assert.equal(runtime.saveButton.textContent, 'Save Draft*');
  assert.match(runtime.status.textContent, /Network error/);
  assert.doesNotMatch(runtime.status.textContent, /private network detail/);
});

test('homepage editor blocks duplicate saves and keeps edits made during a save dirty', async () => {
  let finishSave;
  const runtime = createEditor({
    fetch: async (_url, options, _calls, initialState) => {
      if (options.method !== 'PUT') return jsonResponse(200, { data: { state: initialState } });
      const saveState = JSON.parse(options.body).state;
      return new Promise((resolve) => {
        finishSave = () => resolve(jsonResponse(200, { data: { state: saveState } }));
      });
    },
  });
  await settle();
  runtime.editor.patch((state) => {
    state.announcement.text = 'First edit';
  });
  runtime.saveButton.dispatchEvent({ type: 'click' });
  await settle();
  runtime.saveButton.dispatchEvent({ type: 'click' });
  runtime.editor.patch((state) => {
    state.announcement.text = 'Newer edit';
  });
  assert.equal(runtime.calls.filter((call) => call.options.method === 'PUT').length, 1);

  finishSave();
  await settle();
  assert.equal(runtime.editor.getState().announcement.text, 'Newer edit');
  assert.equal(runtime.saveButton.textContent, 'Save Draft*');
  assert.match(runtime.status.textContent, /Newer edits are still unsaved/);

  runtime.saveButton.dispatchEvent({ type: 'click' });
  await settle();
  const saves = runtime.calls.filter((call) => call.options.method === 'PUT');
  assert.equal(saves.length, 2);
  assert.equal(JSON.parse(saves[1].options.body).state.announcement.text, 'Newer edit');
  finishSave();
  await settle();
  assert.equal(runtime.saveButton.textContent, 'Save Draft');
  assert.equal(runtime.saveButton.disabled, true);
});

test('homepage editor distinguishes a failed load from a valid empty draft', async () => {
  const runtime = createEditor({
    fetch: async () => jsonResponse(503, { error: { status: 503, message: 'private server detail' } }),
  });
  await settle();
  assert.equal(runtime.editor.getState(), null);
  assert.match(runtime.status.textContent, /Load failed/);
  assert.doesNotMatch(runtime.status.textContent, /private server detail/);
  assert.equal(runtime.saveButton.disabled, true);
});
