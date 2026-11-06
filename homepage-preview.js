(() => {
  const CMS_KEY = "glowcare_home_cms_v1";

  function post(type, payload) {
    if (window.parent === window) return;
    window.parent.postMessage({ type, payload }, window.location.origin);
  }

  function ready() {
    post("gc:preview:ready", { at: Date.now() });
  }

  function applyCfg(cfg) {
    try {
      localStorage.setItem(CMS_KEY, JSON.stringify(cfg || {}));
    } catch {}
    if (window.GlowCareHomepage?.apply) {
      window.GlowCareHomepage.apply(cfg);
      return;
    }
    // fallback
    window.location.reload();
  }

  function init() {
    const onMsg = (ev) => {
      if (ev.origin !== window.location.origin) return;
      const msg = ev.data || {};
      if (msg.type === "gc:cms:update") {
        applyCfg(msg.payload);
      }
      if (msg.type === "gc:cms:ping") {
        post("gc:preview:ready", { at: Date.now() });
      }
    };
    window.addEventListener("message", onMsg);

    // Let parent know we are listening even if homepage JS hasn't loaded yet.
    ready();

    // If parent loads after, request current state.
    window.setTimeout(() => post("gc:preview:request", { at: Date.now() }), 220);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

