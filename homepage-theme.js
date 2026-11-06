(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const PRESET_TOKENS = [
    { key: "--brand", label: "Primary (Brand)", type: "color", fallback: "#ff2e7a" },
    { key: "--gc-accent-2", label: "Secondary Accent", type: "color", fallback: "#8a5bff" },
    { key: "--gc-mint", label: "Mint", type: "color", fallback: "#39d3c1" },
    { key: "--gc-peach", label: "Peach", type: "color", fallback: "#ffb193" },
    { key: "--gc-glass", label: "Glass", type: "text", fallback: "rgba(255,255,255,.66)" },
    { key: "--gc-glass-2", label: "Glass 2", type: "text", fallback: "rgba(255,255,255,.78)" },
    { key: "--gc-blur", label: "Glass Blur", type: "range", min: 6, max: 24, step: 1, unit: "px", fallback: "14px" },
    { key: "--font-sans", label: "Body Font", type: "text", fallback: "\"Manrope\", ui-sans-serif" },
    { key: "--font-serif", label: "Display Font", type: "text", fallback: "\"Fraunces\", ui-serif" },
  ];

  function parsePx(v, fb = 14) {
    const n = Number(String(v || "").replace("px", "").trim());
    return Number.isFinite(n) ? n : fb;
  }

  function tokenValue(tokens, key, fallback) {
    if (!tokens || typeof tokens !== "object") return fallback;
    const v = tokens[key];
    return typeof v === "string" && v.trim() ? v : fallback;
  }

  function setToken(key, value) {
    window.GCEditor?.patch?.((s) => {
      s.theme = s.theme || { tokens: {} };
      s.theme.tokens = s.theme.tokens || {};
      s.theme.tokens[key] = value;
    });
  }

  function buildRow(t, tokens) {
    const wrap = document.createElement("div");
    wrap.className = "e-row";
    const id = `tok_${t.key.replace(/[^a-z0-9]/gi, "_")}`;
    wrap.innerHTML = `
      <div class="e-label">${t.label}</div>
      <div class="e-text">${t.key}</div>
      <div class="e-grid2" data-token-row="${id}"></div>
    `;
    const row = $(`[data-token-row="${id}"]`, wrap);
    const val = tokenValue(tokens, t.key, t.fallback);

    if (t.type === "color") {
      const color = document.createElement("input");
      color.type = "color";
      color.className = "e-control";
      color.value = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(val.trim()) ? val.trim() : t.fallback;
      const text = document.createElement("input");
      text.type = "text";
      text.className = "e-control";
      text.value = val;
      color.addEventListener("input", () => {
        text.value = color.value;
        setToken(t.key, color.value);
      });
      text.addEventListener("input", () => setToken(t.key, text.value));
      row.appendChild(color);
      row.appendChild(text);
      return wrap;
    }

    if (t.type === "range") {
      const range = document.createElement("input");
      range.type = "range";
      range.min = String(t.min);
      range.max = String(t.max);
      range.step = String(t.step || 1);
      range.className = "e-control";
      range.value = String(parsePx(val, parsePx(t.fallback, 14)));

      const text = document.createElement("input");
      text.type = "text";
      text.className = "e-control";
      text.value = `${range.value}${t.unit || "px"}`;

      range.addEventListener("input", () => {
        text.value = `${range.value}${t.unit || "px"}`;
        setToken(t.key, text.value);
      });
      text.addEventListener("input", () => {
        setToken(t.key, text.value);
        range.value = String(parsePx(text.value, Number(range.value)));
      });

      row.appendChild(range);
      row.appendChild(text);
      return wrap;
    }

    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "e-control";
    inp.value = val;
    inp.addEventListener("input", () => setToken(t.key, inp.value));
    row.appendChild(inp);
    row.appendChild(document.createElement("div"));
    return wrap;
  }

  function build(container, editorState) {
    if (!container) return;
    const tokens = editorState?.theme?.tokens || {};
    container.innerHTML = "";
    PRESET_TOKENS.forEach((t) => container.appendChild(buildRow(t, tokens)));

    const addRow = document.createElement("div");
    addRow.className = "e-row";
    addRow.innerHTML = `
      <div class="e-label">Custom Token</div>
      <div class="e-grid2">
        <input class="e-control" type="text" placeholder="--my-var" data-custom-key>
        <input class="e-control" type="text" placeholder="value" data-custom-val>
      </div>
      <button class="e-btn e-btn--ghost" type="button" data-custom-add>Add token</button>
    `;
    const key = $("[data-custom-key]", addRow);
    const val = $("[data-custom-val]", addRow);
    const btn = $("[data-custom-add]", addRow);
    btn.addEventListener("click", () => {
      const k = String(key.value || "").trim();
      const v = String(val.value || "").trim();
      if (!k.startsWith("--") || !v) return;
      setToken(k, v);
      key.value = "";
      val.value = "";
    });
    container.appendChild(addRow);
  }

  window.GCThemeCustomizer = { build };
})();

