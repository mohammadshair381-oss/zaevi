import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Regression tests for the account-page LOGOUT button bug.
//
// Root cause: POST /api/auth/register creates the account but intentionally
// does not start a session. The consolidated registerUser() only re-rendered
// after registration, so a freshly registered customer landed on the sign-in
// form again — the authenticated view (welcome header + LOGOUT button) never
// rendered. registerUser must sign the customer in (existing login() flow)
// after a 201, and loginUser must honour the validated `next` return path.
//
// main.js is a classic (non-module) browser script evaluated in an isolated
// `node:vm` context with a stub DOM (same approach as main-storage.test.js).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'main.js'), 'utf8');

function makeElement(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(),
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: {}, dataset: {}, textContent: '', innerHTML: '', hidden: false, value: '',
    _handlers: {},
    addEventListener(type, handler) { (this._handlers[type] ||= []).push(handler); },
    append() {}, appendChild(child) { (this._appended ||= []).push(child); }, insertAdjacentHTML() {}, insertBefore(node) { this.appendChild(node); }, remove() {},
    setAttribute() {}, removeAttribute() {},
    getAttribute() { return null; },
    parentNode: null,
    _appended: null,
    querySelector(sel) { if (sel === '.order-history' || sel === '.logout-btn') return null; return null; },
    querySelectorAll() { return []; },
    onclick: null,
  };
}

/**
 * Boot main.js in a vm that simulates the account page:
 * - `.zveiauth` section present, sign-in/sign-up field elements present;
 * - `/api/auth/me` answered by `meResponder` (defaults to signed-out);
 * - the optional fetch route table `routes` answers other API paths.
 */
function boot({ store = {}, meResponder, routes = {}, locationSearch = '', confirm } = {}) {
  const localStorage = {
    _s: { ...store },
    getItem(key) { return Object.prototype.hasOwnProperty.call(this._s, key) ? String(this._s[key]) : null; },
    setItem(key, value) { this._s[key] = String(value); },
    removeItem(key) { delete this._s[key]; },
  };
  const authSection = makeElement('div');
  const els = {
    loginEmail: makeElement('input'),
    loginPassword: makeElement('input'),
    loginError: makeElement('p'),
    logoutMessage: makeElement('p'),
    logoutStatus: makeElement('p'),
    regName: makeElement('input'),
    regEmail: makeElement('input'),
    regPhone: makeElement('input'),
    regPassword: makeElement('input'),
    loginForm: makeElement('div'),
    registerForm: makeElement('div'),
    tabSignIn: makeElement('button'),
    tabRegister: makeElement('button'),
    loginAltNotice: makeElement('p'),
  };
  const created = [];
  const fetchCalls = [];
  const fetchDetails = [];
  const fetchStub = async (url, opts) => {
    opts = opts || {};
    fetchCalls.push(String(url));
    fetchDetails.push({
      u: String(url),
      m: opts.method || 'GET',
      csrf: opts.headers && opts.headers['x-csrf-token'],
    });
    if (String(url).indexOf('/api/auth/me') >= 0) {
      return meResponder ? meResponder() : { ok: true, status: 200, json: async () => ({ data: null }) };
    }
    const route = routes[Object.keys(routes).find((k) => String(url).indexOf(k) === 0)];
    if (route) return route();
    return { ok: false, status: 503, json: async () => ({}) };
  };
  const document = {
    querySelector(sel) { return sel === '.zveiauth' ? authSection : null; },
    querySelectorAll() { return []; },
    getElementById(id) { return els[id] || null; },
    createElement(tag) { const el = makeElement(tag); created.push(el); return el; },
    body: makeElement(),
    title: '',
    cookie: 'zaevi.csrf=t0',
    addEventListener() {},
  };
  const ctx = {
    console,
    localStorage,
    document,
    location: { href: 'http://localhost/account.html', search: locationSearch, pathname: '/account.html' },
    scrollY: 0,
    addEventListener() {},
    matchMedia: () => ({ matches: false }),
    IntersectionObserver: class { observe() {} },
    URLSearchParams,
    setTimeout: () => 0,
    clearTimeout() {},
    requestAnimationFrame: () => 0,
    confirm: confirm || (() => false),
    fetch: fetchStub,
    Promise,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  let threw = null;
  try { vm.runInContext(mainSource, ctx, 'main.js'); } catch (error) { threw = error; }
  return { ctx, authSection, els, created, fetchCalls, fetchDetails, threw };
}

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const ordersRoute = () => ({ ok: true, status: 200, json: async () => ({ data: [] }) });
const registerOk = () => ({ ok: true, status: 201, json: async () => ({ data: { id: 9, email: 'new@zaevi.test', name: 'New User' } }) });
const loginOk = () => ({ ok: true, status: 200, json: async () => ({ data: { id: 9, email: 'new@zaevi.test', name: 'New User' } }) });
const meAuthed = () => ({ ok: true, status: 200, json: async () => ({ data: { id: 9, email: 'new@zaevi.test', name: 'New User' } }) });

test('registration signs the customer in and renders the authenticated view with a LOGOUT button', async () => {
  const state = { meAuthed: false };
  const { ctx, authSection, created, fetchCalls, threw } = boot({
    meResponder: async () => (state.meAuthed ? meAuthed() : { ok: true, status: 200, json: async () => ({ data: null }) }),
    routes: {
      '/api/auth/register': registerOk,
      // the session only exists after the auto sign-in POST /api/auth/login
      '/api/auth/login': async () => { state.meAuthed = true; return loginOk(); },
      '/api/customer/orders': ordersRoute,
    },
  });
  assert.equal(threw, null);
  ctx.document.getElementById('regName').value = 'New User';
  ctx.document.getElementById('regEmail').value = 'new@zaevi.test';
  ctx.document.getElementById('regPhone').value = '+91 9000000001';
  ctx.document.getElementById('regPassword').value = 'Str0ngPass!';
  ctx.registerUser();
  await settle(60);
  // the flow must have called register AND then login (auto sign-in)
  assert.ok(fetchCalls.some((u) => u.indexOf('/api/auth/register') === 0), 'register was called');
  assert.ok(fetchCalls.some((u) => u.indexOf('/api/auth/login') === 0), 'login was called automatically after registration');
  assert.equal(ctx.location.href, 'http://localhost/account.html', 'no spurious redirect without ?next');
  // the authenticated view was rendered and a LOGOUT button was appended
  assert.ok(String(authSection.innerHTML).indexOf('WELCOME BACK') >= 0, 'welcome view rendered');
  const logoutBtn = (created || []).find((el) => el.className === 'add logout-btn');
  assert.ok(logoutBtn, 'a LOGOUT button was created');
  assert.equal(logoutBtn.textContent, 'LOGOUT');
  assert.ok((logoutBtn._handlers.click || []).length === 1, 'the LOGOUT button is bound to the logout handler');
});

test('account rendering escapes profile and order values before using innerHTML', async () => {
  const payload = '<img src=x onerror=alert(1)>';
  const { ctx, authSection, threw } = boot({
    meResponder: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: 1, email: 'buyer@zaevi.test', name: payload } }),
    }),
    routes: {
      '/api/auth/login': loginOk,
      '/api/customer/orders': () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{
            reference: 'ZV-20261020-abcdef0123456789',
            status: 'pending',
            createdAt: '2026-10-20T00:00:00.000Z',
            totalMinor: 100,
            items: [{ productName: payload, quantity: 1, size: payload }],
          }],
        }),
      }),
    },
  });
  assert.equal(threw, null);
  ctx.document.getElementById('loginEmail').value = 'buyer@zaevi.test';
  ctx.document.getElementById('loginPassword').value = 'Str0ngPass!';
  ctx.loginUser();
  await settle(60);
  const html = String(authSection.innerHTML);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'the value is rendered as text');
  assert.ok(!html.includes('<img src=x'), 'no raw profile or order markup is injected');
});

test('a failed registration does NOT attempt an auto sign-in and surfaces the server error', async () => {
  const { ctx, els, fetchCalls } = boot({
    routes: { '/api/auth/register': () => ({ ok: false, status: 409, json: async () => ({ error: { message: 'An account with this email already exists' } }) }) },
  });
  ctx.document.getElementById('regName').value = 'New User';
  ctx.document.getElementById('regEmail').value = 'taken@zaevi.test';
  ctx.document.getElementById('regPhone').value = '';
  ctx.document.getElementById('regPassword').value = 'Str0ngPass!';
  ctx.registerUser();
  await settle(60);
  assert.ok(fetchCalls.some((u) => u.indexOf('/api/auth/register') === 0));
  assert.ok(!fetchCalls.some((u) => u.indexOf('/api/auth/login') === 0), 'no auto login after a failed registration');
  assert.equal(els.loginError.textContent, 'An account with this email already exists');
});

test('sign-in renders the authenticated view with the LOGOUT button', async () => {
  const state = { meAuthed: false };
  const { ctx, authSection, created, fetchCalls } = boot({
    meResponder: async () => (state.meAuthed ? meAuthed() : { ok: true, status: 200, json: async () => ({ data: null }) }),
    routes: { '/api/auth/login': async () => { state.meAuthed = true; return loginOk(); }, '/api/customer/orders': ordersRoute },
  });
  ctx.document.getElementById('loginEmail').value = 'u@zaevi.test';
  ctx.document.getElementById('loginPassword').value = 'Str0ngPass!';
  ctx.loginUser();
  await settle(60);
  assert.ok(fetchCalls.some((u) => u.indexOf('/api/auth/login') === 0), 'login was called');
  assert.ok(String(authSection.innerHTML).indexOf('WELCOME BACK') >= 0, 'welcome view rendered');
  const logoutBtn = (created || []).find((el) => el.className === 'add logout-btn');
  assert.ok(logoutBtn, 'LOGOUT button present in the authenticated view');
});

test('sign-in honours the validated `next` return path instead of staying on the account page', async () => {
  const { ctx } = boot({
    locationSearch: '?next=' + encodeURIComponent('checkout.html'),
    meResponder: async () => ({ ok: true, status: 200, json: async () => ({ data: { id: 1, email: 'u@zaevi.test', name: 'U' } }) }),
    routes: { '/api/auth/login': loginOk, '/api/customer/orders': ordersRoute },
  });
  ctx.document.getElementById('loginEmail').value = 'u@zaevi.test';
  ctx.document.getElementById('loginPassword').value = 'Str0ngPass!';
  ctx.loginUser();
  await settle(60);
  assert.equal(ctx.location.href, 'checkout.html', 'redirected to the validated next target');
});

test('the return path is validated: absolute/javascript/traversal targets are refused', () => {
  const { ctx } = boot({ profile: null });
  assert.equal(ctx.safeNextPath('https://evil.example/x.html'), null);
  assert.equal(ctx.safeNextPath('javascript:alert(1)'), null);
  assert.equal(ctx.safeNextPath('../secret.html'), null);
  assert.equal(ctx.safeNextPath('account.html'), 'account.html');
});

test('auth tabs toggle visibility between loginForm and registerForm', () => {
  const { ctx, els } = boot();
  assert.equal(typeof ctx.switchAuthTab, 'function');

  // Initial state: loginForm visible, registerForm hidden
  // (registerForm starts with hidden attribute in the HTML template)

  // Switch to register
  ctx.switchAuthTab('register');
  assert.equal(els.loginForm.hidden, true, 'loginForm must be hidden on register tab');
  assert.equal(els.registerForm.hidden, false, 'registerForm must be visible on register tab');
  assert.equal(els.loginAltNotice.hidden, true, 'loginAltNotice must be hidden on register tab');

  // Tab styling: register tab active, sign-in tab inactive
  assert.equal(els.tabRegister.style.fontWeight, '600', 'register tab bold when active');
  assert.equal(els.tabSignIn.style.fontWeight, '500', 'sign-in tab deemphasized when inactive');

  // Switch back to login
  ctx.switchAuthTab('login');
  assert.equal(els.loginForm.hidden, false, 'loginForm must be visible on login tab');
  assert.equal(els.registerForm.hidden, true, 'registerForm must be hidden on login tab');
  assert.equal(els.loginAltNotice.hidden, false, 'loginAltNotice must be visible on login tab');

  // Tab styling: sign-in tab active, register tab inactive
  assert.equal(els.tabSignIn.style.fontWeight, '600', 'sign-in tab bold when active');
  assert.equal(els.tabRegister.style.fontWeight, '500', 'register tab deemphasized when inactive');

  // Repeated toggling works without issues
  ctx.switchAuthTab('register');
  ctx.switchAuthTab('login');
  ctx.switchAuthTab('register');
  assert.equal(els.loginForm.hidden, true, 'loginForm hidden after repeated toggling');
  assert.equal(els.registerForm.hidden, false, 'registerForm visible after repeated toggling');
});

test('switching to register clears any previous login error', () => {
  const { ctx, els } = boot();
  els.loginError.textContent = 'Invalid email or password';
  ctx.switchAuthTab('register');
  assert.equal(els.loginError.textContent, '', 'login error cleared when switching to register');
});

test('failed login on 401 surfaces clear guidance pointing to registration', async () => {
  const { ctx, els } = boot({
    routes: {
      '/api/auth/login': () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { status: 401, message: 'Invalid email or password' } }),
      }),
    },
  });
  ctx.document.getElementById('loginEmail').value = 'unknown@zaevi.test';
  ctx.document.getElementById('loginPassword').value = 'WrongPassword123!';
  ctx.loginUser();
  await settle(60);
  assert.ok(els.loginError.textContent.includes('CREATE ACCOUNT') || els.loginError.textContent.includes('Create an account'),
    `Expected guidance to create account, got: "${els.loginError.textContent}"`);
});

// ---------------------------------------------------------------------------
// LOGOUT button confirmation flow
// ---------------------------------------------------------------------------

const meProfile = () => ({ id: 1, email: 'u@zaevi.test', name: 'U' });
const meAuthedResp = () => ({ ok: true, status: 200, json: async () => ({ data: meProfile() }) });
const meAnonResp = () => ({ ok: true, status: 200, json: async () => ({ data: null }) });
const logoutOkResp = () => ({ ok: true, status: 200, json: async () => ({ data: { message: 'Logged out successfully' } }) });

/**
 * Boots an authenticated view (sign-in → welcome + LOGOUT) and returns the
 * LOGOUT button plus the harness state object shared by the me/logout routes.
 */
async function bootAuthenticated({ confirmAnswer = true, logoutRoute } = {}) {
  const state = { signedIn: true };
  const conf = { calls: [], answer: confirmAnswer };
  const { ctx, els, created, fetchCalls, fetchDetails, threw } = boot({
    meResponder: async () => (state.signedIn ? meAuthedResp() : meAnonResp()),
    routes: {
      '/api/auth/login': loginOk,
      '/api/auth/logout': async () => {
        const resp = await (logoutRoute || logoutOkResp)();
        // Mirror the server: only a 200 actually destroys the session.
        if (resp && resp.status === 200) state.signedIn = false;
        return resp;
      },
      '/api/customer/orders': ordersRoute,
    },
    confirm: (message) => { conf.calls.push(String(message)); return conf.answer; },
  });
  assert.equal(threw, null);
  ctx.document.getElementById('loginEmail').value = 'u@zaevi.test';
  ctx.document.getElementById('loginPassword').value = 'Str0ngPass!';
  ctx.loginUser();
  await settle(60);
  const logoutBtn = (created || []).find((el) => el.className === 'add logout-btn');
  assert.ok(logoutBtn, 'authenticated view rendered with a LOGOUT button');
  const postCount = () => fetchDetails.filter((d) => d.u.indexOf('/api/auth/logout') === 0 && d.m === 'POST').length;
  const meCount = () => fetchDetails.filter((d) => d.u.indexOf('/api/auth/me') >= 0).length;
  return { ctx, els, logoutBtn, conf, postCount, meCount, state, fetchDetails };
}

test('clicking LOGOUT shows the confirmation popup', async () => {
  const { logoutBtn, conf } = await bootAuthenticated({});
  assert.equal(conf.calls.length, 0, 'no popup before the click');
  (logoutBtn._handlers.click || []).forEach((h) => h({ preventDefault() {} }));
  assert.equal(conf.calls.length, 1, 'exactly one confirmation popup on click');
  assert.equal(conf.calls[0], 'Are you sure you want to logout?');
});

test('confirming calls the logout API exactly once, with CSRF, and reflects the signed-out state', async () => {
  const { els, logoutBtn, conf, postCount, fetchDetails } = await bootAuthenticated({});
  (logoutBtn._handlers.click || []).forEach((h) => h({ preventDefault() {} }));
  await settle(80);
  assert.equal(conf.calls.length, 1);
  assert.equal(conf.calls[0], 'Are you sure you want to logout?');
  assert.equal(postCount(), 1, 'the logout API was called exactly once');
  const post = fetchDetails.find((d) => d.u.indexOf('/api/auth/logout') === 0 && d.m === 'POST');
  assert.equal(post.csrf, 't0', 'the CSRF token from the zaevi.csrf cookie was sent');
  assert.equal(els.loginError.textContent, '', 'no error is shown on success');
  // the me check after logout reported signed-out → the fresh sign-in view
  // rendered with the one-shot success notice
  assert.equal(els.logoutMessage.textContent, 'You have been logged out.');
});

test('cancelling the popup keeps the customer signed in and never calls the API', async () => {
  const { els, logoutBtn, conf, postCount, meCount, state } = await bootAuthenticated({ confirmAnswer: false });
  const meBefore = meCount();
  (logoutBtn._handlers.click || []).forEach((h) => h({ preventDefault() {} }));
  await settle(80);
  assert.equal(conf.calls.length, 1, 'popup was shown once');
  assert.equal(postCount(), 0, 'no logout request was sent');
  assert.equal(meCount(), meBefore, 'no extra render pass (state untouched)');
  assert.equal(state.signedIn, true, 'session state untouched');
  assert.equal(els.logoutStatus.textContent, '', 'no error surfaced on cancel');
  assert.equal(els.logoutMessage.textContent, '', 'no success notice on cancel');
});

test('a 403 rejection keeps the authenticated UI and surfaces the error (no false sign-out)', async () => {
  const { els, logoutBtn, postCount, state } = await bootAuthenticated({
    logoutRoute: () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'Invalid CSRF token' } }) }),
  });
  (logoutBtn._handlers.click || []).forEach((h) => h({ preventDefault() {} }));
  await settle(80);
  assert.equal(postCount(), 1, 'the attempt was made');
  assert.equal(state.signedIn, true, 'me still reports authenticated — UI must agree');
  assert.equal(els.logoutStatus.textContent, 'Invalid CSRF token', 'error surfaced next to the button');
  // a retry after the failure is possible: the in-progress guard was released
  (logoutBtn._handlers.click || []).forEach((h) => h({ preventDefault() {} }));
  await settle(60);
});

test('a network failure keeps the authenticated UI and surfaces a message', async () => {
  const { els, logoutBtn, postCount, state } = await bootAuthenticated({
    logoutRoute: () => { throw new Error('Network error'); },
  });
  (logoutBtn._handlers.click || []).forEach((h) => h({ preventDefault() {} }));
  await settle(80);
  assert.equal(postCount(), 1);
  assert.equal(state.signedIn, true, 'still authenticated after a transport failure');
  assert.match(els.logoutStatus.textContent, /could not|network/i);
});

test('rapid double-click cannot issue a second request or popup while one is pending', async () => {
  const conf = { calls: [] };
  let release;
  const gate = new Promise((r) => { release = r; });
  const state = { signedIn: true };
  const { ctx, els, created, fetchDetails } = boot({
    meResponder: async () => (state.signedIn ? meAuthedResp() : meAnonResp()),
    routes: {
      '/api/auth/login': loginOk,
      '/api/auth/logout': async () => { await gate; return logoutOkResp(); },
      '/api/customer/orders': ordersRoute,
    },
    confirm: (m) => { conf.calls.push(String(m)); return true; },
  });
  ctx.document.getElementById('loginEmail').value = 'u@zaevi.test';
  ctx.document.getElementById('loginPassword').value = 'Str0ngPass!';
  ctx.loginUser();
  await settle(60);
  const btn = (created || []).find((el) => el.className === 'add logout-btn');
  assert.ok(btn, 'LOGOUT button present');
  const click = () => (btn._handlers.click || []).forEach((h) => h({ preventDefault() {} }));
  click();
  click(); // while the first POST is still pending
  assert.equal(conf.calls.length, 1, 'only one popup despite the double click');
  assert.equal(fetchDetails.filter((d) => d.u.indexOf('/api/auth/logout') >= 0).length, 1, 'only one POST in flight');
  release();
  await settle(40);
  assert.equal(els.logoutStatus.textContent, '', 'no error after the gated success');
});

test('calling logout() directly is programmatic: no popup, single POST to the API', async () => {
  const conf = { calls: [] };
  const state = { signedIn: true };
  const { ctx, fetchDetails } = boot({
    meResponder: async () => (state.signedIn ? meAuthedResp() : meAnonResp()),
    routes: {
      '/api/auth/login': loginOk,
      '/api/auth/logout': async () => { state.signedIn = false; return logoutOkResp(); },
      '/api/customer/orders': ordersRoute,
    },
    confirm: (m) => { conf.calls.push(String(m)); return true; },
  });
  ctx.document.getElementById('loginEmail').value = 'u@zaevi.test';
  ctx.document.getElementById('loginPassword').value = 'Str0ngPass!';
  ctx.loginUser();
  await settle(60);
  const result = await ctx.logout();
  assert.equal(result.status, 200);
  assert.equal(conf.calls.length, 0, 'no confirmation popup for programmatic sign-out');
  assert.equal(fetchDetails.filter((d) => d.u.indexOf('/api/auth/logout') >= 0).length, 1);
  assert.equal(state.signedIn, false);
});

