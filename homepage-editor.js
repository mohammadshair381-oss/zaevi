(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function safeJson(text, fallback) {
    try {
      const v = JSON.parse(text);
      return v ?? fallback;
    } catch {
      return fallback;
    }
  }

  function readBootstrap() {
    const el = $("[data-editor-bootstrap]");
    return el ? safeJson(el.textContent || "{}", {}) : {};
  }

  function readCsrf() {
    const parts = document.cookie.split(';').map((c) => c.trim());
    for (const part of parts) {
      if (part.indexOf('zaevi.csrf=') === 0) return decodeURIComponent(part.slice('zaevi.csrf='.length));
    }
    return '';
  }

  function withPk(tmpl, pk) {
    const s = String(tmpl || "");
    // Templates are rendered as ".../0/" or ".../0/delete/" for easy replacement.
    return s.replace("/0/delete/", `/${pk}/delete/`).replace("/0/", `/${pk}/`);
  }

  function deepClone(obj) {
    return obj ? safeJson(JSON.stringify(obj), obj) : obj;
  }

  function normalizeHomepageState(input) {
    const data = deepClone(input);
    const mappings = [
      { sectionId: "reels", stateKey: "reels", fields: ["items"] },
      { sectionId: "features", stateKey: "features", fields: ["cards"] },
      { sectionId: "story", stateKey: "story", fields: ["buttonLabel", "buttonHref", "imageUrl"] },
    ];

    mappings.forEach(({ sectionId, stateKey, fields }) => {
      const section = data.sections.find((item) => item.sectionId === sectionId);
      const root = data[stateKey];
      if (!section || !root) return;
      section.settings = section.settings && typeof section.settings === "object" ? section.settings : {};

      if (!String(root.title || "").trim() && section.title) root.title = section.title;
      else if (root.title) section.title = root.title;
      if (!String(root.subtitle || "").trim() && section.settings.subtitle) root.subtitle = section.settings.subtitle;
      else if (root.subtitle) section.settings.subtitle = root.subtitle;

      fields.forEach((field) => {
        const savedValue = root[field];
        const sectionValue = section.settings[field];
        const rootIsEmpty = Array.isArray(savedValue)
          ? savedValue.length === 0
          : typeof savedValue === "string"
            ? savedValue.length === 0
            : savedValue == null;
        const sectionHasValue = Array.isArray(sectionValue)
          ? sectionValue.length > 0
          : typeof sectionValue === "string"
            ? sectionValue.length > 0
            : sectionValue != null;
        if (rootIsEmpty && sectionHasValue) root[field] = deepClone(sectionValue);
        delete section.settings[field];
      });
      delete section.settings.subtitle;
    });

    const heroSection = data.sections.find((item) => item.sectionId === "hero");
    if (heroSection) {
      heroSection.settings = heroSection.settings && typeof heroSection.settings === "object" ? heroSection.settings : {};
      const rootAutoplay = Number(data.hero?.autoplayMs);
      const legacyAutoplay = Number(heroSection.settings.autoplayMs);
      if (!Number.isInteger(rootAutoplay) || rootAutoplay < 2500 || rootAutoplay > 12000) {
        data.hero.autoplayMs = Number.isInteger(legacyAutoplay) && legacyAutoplay >= 2500 && legacyAutoplay <= 12000
          ? legacyAutoplay
          : 5200;
      }
      delete heroSection.settings.autoplayMs;
    }

    for (const [stateKey, sectionId] of [["promoStrip", "promoStrip"], ["appBanner", "appBanner"]]) {
      const section = data.sections.find((item) => item.sectionId === sectionId);
      if (!section) continue;
      if (typeof section.enabled !== "boolean" && typeof data[stateKey]?.enabled === "boolean") {
        section.enabled = data[stateKey].enabled;
      }
      if (data[stateKey]) delete data[stateKey].enabled;
    }
    return data;
  }

  function debounce(fn, ms = 80) {
    let t = 0;
    return (...args) => {
      window.clearTimeout(t);
      t = window.setTimeout(() => fn(...args), ms);
    };
  }

  const BOOT = readBootstrap();
  const csrf = readCsrf();

  const shell = $("[data-editor-shell]");
  const statusEl = $("[data-editor-status]");
  const iframe = $("[data-editor-iframe]");
  const saveBtn = $("[data-editor-save]");
  const reloadBtn = $("[data-editor-reload]");
  const searchInp = $("[data-editor-search]");

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  const bus = new EventTarget();
  const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));
  const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

  const state = {
    boot: BOOT,
    csrf,
    loaded: false,
    dirty: false,
    saving: false,
    data: null,
    savedData: null,
    lastSentHash: "",
    previewReady: false,
    saveToken: 0,
  };

  function canonicalJson(value) {
    try {
      const sortKeys = (item) => {
        if (Array.isArray(item)) return item.map(sortKeys);
        if (item && typeof item === "object") {
          return Object.keys(item).sort().reduce((result, key) => {
            result[key] = sortKeys(item[key]);
            return result;
          }, {});
        }
        return item;
      };
      return JSON.stringify(sortKeys(value ?? null));
    } catch {
      return "";
    }
  }

  function updateSaveButton() {
    if (!saveBtn) return;
    saveBtn.textContent = state.saving ? "Saving…" : state.dirty ? "Save Draft*" : "Save Draft";
    saveBtn.disabled = state.saving || !state.loaded || !state.dirty;
  }

  function markDirty(next = true) {
    state.dirty = !!next;
    updateSaveButton();
  }

  function syncDirty() {
    state.dirty = canonicalJson(state.data) !== canonicalJson(state.savedData);
    updateSaveButton();
  }

  function responseError(payload, status) {
    if (status >= 500) return new Error("The server could not complete the request. Try again later.");
    const message = typeof payload?.error === "string"
      ? payload.error
      : typeof payload?.error?.message === "string"
        ? payload.error.message
        : typeof payload?.message === "string"
          ? payload.message
          : `Request failed (${status}).`;
    return new Error(message);
  }

  async function apiRequest(url, { method = "GET", payload } = {}) {
    let res;
    try {
      res = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: method === "GET" ? undefined : {
          "Content-Type": "application/json",
          "x-csrf-token": state.csrf,
        },
        body: method === "GET" ? undefined : JSON.stringify(payload || {}),
      });
    } catch {
      throw new Error("Network error. Check your connection and try again.");
    }
    let json;
    try {
      json = await res.json();
    } catch {
      if (!res.ok) throw responseError(null, res.status);
      throw new Error("The server returned an invalid response.");
    }
    if (!res.ok || json?.ok === false) throw responseError(json, res.status);
    return json;
  }

  const apiGet = (url) => apiRequest(url);
  const apiPostJson = (url, payload) => apiRequest(url, { method: "POST", payload });
  const apiPutJson = (url, payload) => apiRequest(url, { method: "PUT", payload });

  function buildPreviewConfigFromState(s) {
    const out = {
      version: 1,
      theme: s?.theme?.tokens || {},
      announcement: {
        enabled: !!s?.announcement?.enabled,
        badge: s?.announcement?.badge || "",
        text: s?.announcement?.text || "",
        ctaText: s?.announcement?.ctaText || "",
        ctaHref: s?.announcement?.ctaHref || "",
        bg: s?.announcement?.bg || "",
      },
      navigation: {
        links: Array.isArray(s?.navigation?.links)
          ? s.navigation.links
              .filter(Boolean)
              .map((l) => ({ label: l.label || "", href: l.href || "#", pill: !!l.isPill }))
          : [],
      },
      footer: s?.footer || null,
      sections: Array.isArray(s?.sections) ? s.sections.map((x) => ({ id: x.sectionId, enabled: !!x.enabled, title: x.title || "", settings: x.settings || {} })) : [],
      hero: {
        autoplayMs: Number(s?.hero?.autoplayMs || 5200),
        slides: Array.isArray(s?.hero?.slides)
          ? s.hero.slides
              .filter(Boolean)
              .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
              .filter((sl) => sl.enabled !== false)
              .map((sl) => ({
                kicker: sl.kicker || "",
                headline: sl.headline || "",
                headline2: sl.headline2 || "",
                sub: sl.sub || "",
                primary: { label: sl.primaryLabel || "", href: sl.primaryHref || "" },
                secondary: { label: sl.secondaryLabel || "", href: sl.secondaryHref || "" },
                cards: [sl.cardA?.url || "", sl.cardB?.url || "", sl.cardC?.url || ""],
                background: { kind: sl.background?.kind || "", url: sl.background?.url || "" },
                overlayBg: sl.overlayBg || "",
                buttonStyles: sl.buttonStyles || {},
                ribbons: Array.isArray(sl.ribbons) ? sl.ribbons : [],
                meta: Array.isArray(sl.meta) ? sl.meta : [],
              }))
          : [],
      },
      promoStrip: s?.promoStrip
        ? {
            title: s.promoStrip.title || "",
            subtitle: s.promoStrip.subtitle || "",
            pills: Array.isArray(s.promoStrip.pills) ? s.promoStrip.pills : [],
            button: { label: s.promoStrip.buttonLabel || "", href: s.promoStrip.buttonHref || "" },
            bg: s.promoStrip.bg || "",
          }
        : null,
      appBanner: s?.appBanner
        ? {
            title: s.appBanner.title || "",
            subtitle: s.appBanner.subtitle || "",
            stores: Array.isArray(s.appBanner.stores) ? s.appBanner.stores : [],
            bg: s.appBanner.bg || "",
          }
        : null,
      logos: {
        media: Array.isArray(s?.logos)
          ? s.logos
              .filter((x) => x.enabled !== false)
              .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
              .map((x) => ({ name: x.name || "", logo: x.logo?.url || "", href: x.href || "" }))
          : [],
      },
      testimonials: {
        items: Array.isArray(s?.testimonials)
          ? s.testimonials
              .filter((x) => x.enabled !== false)
              .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
              .map((t) => ({ name: t.name || "", meta: t.meta || "", rating: Number(t.rating || 5), text: t.text || "", avatar: t.avatar?.url || "" }))
          : [],
      },
      productSections: {},
    };

    if (Array.isArray(s?.productSections)) {
      s.productSections.forEach((ps) => {
        if (!ps || !ps.kind) return;
        out.productSections[ps.kind] = {
          title: ps.title || "",
          subtitle: ps.subtitle || "",
          viewAllHref: ps.viewAllHref || "",
          tabs: Array.isArray(ps.tabs) ? ps.tabs : [],
        };
      });
    }

    return out;
  }

  function hashLite(obj) {
    const s = JSON.stringify(obj || {});
    let h = 0;
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return String(h);
  }

  function postToPreview(type, payload) {
    const win = iframe?.contentWindow;
    if (!win) return;
    win.postMessage({ type, payload }, window.location.origin);
  }

  const sendPreviewDebounced = debounce(() => {
    if (!state.data) return;
    const cfg = buildPreviewConfigFromState(state.data);
    const h = hashLite(cfg);
    if (h === state.lastSentHash) return;
    state.lastSentHash = h;
    postToPreview("gc:cms:update", cfg);
  }, 60);

  function setData(next, opts = { markDirty: false, sendPreview: true }) {
    state.data = next;
    if (opts?.markDirty) markDirty(true);
    else syncDirty();
    emit("gc:state", deepClone(state.data));
    if (opts?.sendPreview) sendPreviewDebounced();
  }

  function patch(fn, opts = { markDirty: true, sendPreview: true }) {
    const next = deepClone(state.data || {});
    fn(next);
    setData(next, opts);
  }

  async function load() {
    setStatus("Loading…");
    try {
      const response = await apiGet(state.boot.stateUrl);
      const responseState = response?.data?.state ?? response?.state;
      if (!responseState || typeof responseState !== "object" || responseState.version !== 1 || !Array.isArray(responseState.sections)) {
        throw new Error("The homepage draft response did not contain a valid state.");
      }
      const data = normalizeHomepageState(responseState);
      state.loaded = true;
      state.savedData = deepClone(data);
      setData(data, { markDirty: false, sendPreview: false });
      syncDirty();
      sendPreviewDebounced();
      setStatus("Draft loaded. Preview is unavailable until Phase C.");
      updateSaveButton();
    } catch (e) {
      console.error(e);
      state.loaded = false;
      updateSaveButton();
      setStatus(`Load failed: ${String(e?.message || "Unable to load the homepage draft.")}`);
    }
  }

  async function saveAll() {
    if (!state.data || !state.dirty || state.saving) return;
    state.saving = true;
    const saveBaseline = deepClone(state.data);
    const saveToken = (state.saveToken += 1);
    updateSaveButton();
    setStatus("Saving…");
    try {
      const response = await apiPutJson(state.boot.applyUrl, { state: saveBaseline });
      const savedState = response?.data?.state;
      if (!savedState || typeof savedState !== "object" || savedState.version !== 1) {
        throw new Error("The server did not confirm the saved homepage draft.");
      }
      if (saveToken !== state.saveToken) return;
      state.savedData = deepClone(savedState);
      if (canonicalJson(state.data) === canonicalJson(saveBaseline)) {
        state.data = deepClone(savedState);
        emit("gc:state", deepClone(state.data));
      }
      syncDirty();
      updateSaveButton();
      setStatus(state.dirty
        ? "Draft saved. Newer edits are still unsaved; preview is unavailable until Phase C."
        : "Draft saved. Preview is unavailable until Phase C.");
    } catch (e) {
      console.error(e);
      if (saveToken !== state.saveToken) return;
      syncDirty();
      setStatus(`Save failed: ${String(e?.message || "Unable to save the homepage draft.")}`);
    } finally {
      if (saveToken === state.saveToken) {
        state.saving = false;
        updateSaveButton();
      }
    }
  }

  function initIframeBridge() {
    if (!iframe) return;
    const onMsg = (ev) => {
      if (ev.origin !== window.location.origin) return;
      const msg = ev.data || {};
      if (msg?.type === "gc:preview:ready") {
        state.previewReady = true;
        // send current state
        sendPreviewDebounced();
      }
      if (msg?.type === "gc:preview:request") {
        sendPreviewDebounced();
      }
    };
    window.addEventListener("message", onMsg);
    iframe.addEventListener("load", () => {
      state.previewReady = false;
      postToPreview("gc:cms:ping", { at: Date.now() });
      window.setTimeout(() => sendPreviewDebounced(), 250);
    });
  }

  function initActions() {
    window.addEventListener("beforeunload", (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
    if (saveBtn) saveBtn.addEventListener("click", () => saveAll());
    if (reloadBtn)
      reloadBtn.addEventListener("click", () => {
        if (!iframe) return;
        setStatus("Reloading…");
        iframe.contentWindow?.location?.reload?.();
      });

    if (searchInp) {
      searchInp.addEventListener(
        "input",
        debounce(() => emit("gc:search", { q: (searchInp.value || "").trim().toLowerCase() }), 60),
      );
    }

    // Ctrl/Cmd+S to save
    document.addEventListener("keydown", (e) => {
      const isSave = (e.ctrlKey || e.metaKey) && String(e.key || "").toLowerCase() === "s";
      if (!isSave) return;
      e.preventDefault();
      saveAll();
    });
  }

  // public surface for other modules
  window.GCEditor = {
    getState: () => deepClone(state.data),
    setState: (next, opts) => setData(next, opts),
    patch,
    on,
    emit,
    boot: state.boot,
    csrf: state.csrf,
    api: {
      get: apiGet,
      post: apiPostJson,
      put: apiPutJson,
      withPk,
    },
    preview: {
      sendNow: () => {
        state.lastSentHash = "";
        sendPreviewDebounced();
      },
    },
    ui: {
      setStatus,
      markDirty,
    },
  };

  function boot() {
    if (!shell || !state.boot?.stateUrl) {
      setStatus("Missing config");
      return;
    }
    initIframeBridge();
    initActions();
    load().catch((e) => {
      console.error(e);
      setStatus("Failed");
    });
  }

  const publishBtn = document.querySelector("[data-editor-publish]");
  if (publishBtn) {
    publishBtn.addEventListener("click", async () => {
      const token = readCsrf();
      const res = await fetch("/api/admin/cms/pages/home/publish", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-csrf-token": token },
        body: "{}",
      });
      if (res.ok) setStatus("Published");
      else setStatus("Publish failed");
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
