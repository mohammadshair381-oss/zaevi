(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const host = $("[data-editor-panels]");
  if (!host) return;

  const ui = {
    openKeys: new Set(["theme", "sections", "hero"]),
    slideId: null,
    testimonialId: null,
    logoId: null,
  };
  const SECTION_STATE_KEYS = { reels: "reels", features: "features", story: "story" };

  function isActiveTextControl(element) {
    return element?.tagName === "TEXTAREA" || (element?.tagName === "INPUT" && element.type === "text");
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function acc(key, title, sub, bodyEl) {
    const d = document.createElement("details");
    d.className = "e-acc";
    d.dataset.acc = key;
    if (ui.openKeys.has(key)) d.open = true;
    d.innerHTML = `
      <summary class="e-acc__head">
        <div>
          <b>${esc(title)}</b>
          <div><span>${esc(sub || "")}</span></div>
        </div>
        <span class="e-acc__chev">▾</span>
      </summary>
    `;
    const body = document.createElement("div");
    body.className = "e-acc__body";
    body.appendChild(bodyEl);
    d.appendChild(body);
    d.addEventListener("toggle", () => {
      if (d.open) ui.openKeys.add(key);
      else ui.openKeys.delete(key);
    });
    return d;
  }

  function rowLabel(text) {
    const el = document.createElement("div");
    el.className = "e-row";
    el.innerHTML = `<div class="e-label">${esc(text)}</div>`;
    return el;
  }

  function inputRow(label, value, opts = {}) {
    const wrap = document.createElement("div");
    wrap.className = "e-row";
    wrap.innerHTML = `
      <div class="e-label">${esc(label)}</div>
      <input class="e-control" type="${esc(opts.type || "text")}" placeholder="${esc(opts.placeholder || "")}" value="${esc(value || "")}">
    `;
    const inp = $(".e-control", wrap);
    if (typeof opts.onInput === "function") inp.addEventListener("input", () => opts.onInput(inp.value));
    if (typeof opts.onChange === "function") inp.addEventListener("change", () => opts.onChange(inp.value));
    return wrap;
  }

  function textareaRow(label, value, opts = {}) {
    const wrap = document.createElement("div");
    wrap.className = "e-row";
    wrap.innerHTML = `
      <div class="e-label">${esc(label)}</div>
      <textarea class="e-control" rows="${esc(opts.rows || 3)}" placeholder="${esc(opts.placeholder || "")}">${esc(value || "")}</textarea>
    `;
    const inp = $(".e-control", wrap);
    if (typeof opts.onInput === "function") inp.addEventListener("input", () => opts.onInput(inp.value));
    return wrap;
  }

  function toggleRow(label, checked, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "e-toggle";
    wrap.innerHTML = `
      <label class="e-switch">
        <input type="checkbox" ${checked ? "checked" : ""}>
        <span></span>
      </label>
      <div class="e-label">${esc(label)}</div>
    `;
    const inp = $("input", wrap);
    inp.addEventListener("change", () => onChange(!!inp.checked));
    return wrap;
  }

  function button(label, cls, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `e-btn ${cls || "e-btn--ghost"}`;
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function miniListItem(id, title, meta, enabled) {
    const el = document.createElement("div");
    el.className = "e-item";
    el.dataset.id = String(id);
    el.innerHTML = `
      <div class="e-item__handle" title="Drag">⋮⋮</div>
      <div class="e-item__main">
        <div class="e-item__title">${esc(title || "Untitled")}</div>
        <div class="e-item__meta">${esc(meta || "")}</div>
      </div>
      <label class="e-item__toggle">
        <input type="checkbox" ${enabled ? "checked" : ""} data-item-enabled>
        <span></span>
      </label>
    `;
    return el;
  }

  function initSortable(listEl, onOrder) {
    if (!listEl || typeof Sortable === "undefined") return null;
    return Sortable.create(listEl, {
      handle: ".e-item__handle",
      animation: 160,
      ghostClass: "e-item--ghost",
      onSort: () => {
        const order = $$(".e-item", listEl).map((x) => x.dataset.id);
        onOrder(order);
      },
    });
  }

  function getSection(state, id) {
    return (state.sections || []).find((s) => s.sectionId === id) || null;
  }

  function ensureSectionSettings(sectionId, mutator) {
    window.GCEditor.patch((s) => {
      const sec = (s.sections || []).find((x) => x.sectionId === sectionId);
      if (!sec) return;
      sec.settings = sec.settings || {};
      mutator(sec.settings, sec);
    });
  }

  function ensureHomepageSection(stateKey, mutator) {
    window.GCEditor.patch((state) => {
      state[stateKey] = state[stateKey] || {};
      mutator(state[stateKey]);
    });
  }

  function setSectionMetadata(state, sectionId, key, value) {
    const section = (state.sections || []).find((item) => item.sectionId === sectionId);
    if (!section) return;
    if (key === "title") section.title = value;
    const stateKey = SECTION_STATE_KEYS[sectionId];
    if (stateKey) {
      state[stateKey] = state[stateKey] || {};
      state[stateKey][key] = value;
      return;
    }
    section.settings = section.settings || {};
    section.settings[key] = value;
  }

  /* -------- Panels -------- */
  function panelTheme(state) {
    const wrap = document.createElement("div");
    wrap.appendChild(rowLabel("Edit theme tokens for the homepage draft. Preview becomes available in Phase C."));
    const body = document.createElement("div");
    body.dataset.themeHost = "1";
    wrap.appendChild(body);
    window.GCThemeCustomizer?.build?.(body, state);
    return acc("theme", "Theme Settings", "Colors • typography • glass", wrap);
  }

  function panelAnnouncement(state) {
    const wrap = document.createElement("div");
    wrap.appendChild(
      toggleRow("Enable announcement bar", !!state.announcement?.enabled, (v) =>
        window.GCEditor.patch((s) => {
          s.announcement = s.announcement || {};
          s.announcement.enabled = v;
        }),
      ),
    );
    wrap.appendChild(
      inputRow("Badge", state.announcement?.badge || "", {
        onInput: (v) => window.GCEditor.patch((s) => (s.announcement.badge = v)),
        placeholder: "UP TO 20% OFF",
      }),
    );
    wrap.appendChild(
      inputRow("Text", state.announcement?.text || "", {
        onInput: (v) => window.GCEditor.patch((s) => (s.announcement.text = v)),
        placeholder: "Free gifts on orders…",
      }),
    );
    wrap.appendChild(
      inputRow("CTA Text", state.announcement?.ctaText || "", { onInput: (v) => window.GCEditor.patch((s) => (s.announcement.ctaText = v)) }),
    );
    wrap.appendChild(
      inputRow("CTA Link", state.announcement?.ctaHref || "", { onInput: (v) => window.GCEditor.patch((s) => (s.announcement.ctaHref = v)), placeholder: "/shop" }),
    );
    wrap.appendChild(
      inputRow("Background (CSS)", state.announcement?.bg || "", { onInput: (v) => window.GCEditor.patch((s) => (s.announcement.bg = v)), placeholder: "linear-gradient(...)" }),
    );
    wrap.appendChild(
      inputRow("Start (ISO)", state.announcement?.startAt || "", {
        onChange: (v) => window.GCEditor.patch((s) => (s.announcement.startAt = v)),
        placeholder: "2026-05-08T10:00:00",
      }),
    );
    wrap.appendChild(
      inputRow("End (ISO)", state.announcement?.endAt || "", {
        onChange: (v) => window.GCEditor.patch((s) => (s.announcement.endAt = v)),
        placeholder: "2026-05-10T10:00:00",
      }),
    );
    return acc("announcement", "Announcement Bar", "Ribbon + scheduling", wrap);
  }

  function panelSections(state) {
    const wrap = document.createElement("div");
    wrap.appendChild(rowLabel("Drag sections to reorder. Toggle to hide. Title updates headings."));

    const list = document.createElement("div");
    list.className = "e-list";
    list.dataset.sectionsList = "1";
    const items = Array.isArray(state.sections) ? state.sections.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) : [];
    items.forEach((s) => {
      const block = document.createElement("div");
      block.className = "e-block";
      const it = miniListItem(s.sectionId, s.sectionId, s.title || "", s.enabled !== false);
      it.addEventListener("click", (e) => {
        if (e.target.closest?.("input")) return;
        const focus = it.querySelector("input,button");
        focus?.focus?.();
      });
      $("input[data-item-enabled]", it).addEventListener("change", (e) => {
        const on = !!e.target.checked;
        window.GCEditor.patch((st) => {
          const sec = (st.sections || []).find((x) => x.sectionId === s.sectionId);
          if (sec) sec.enabled = on;
        });
      });
      block.appendChild(it);

      // title editor inline
      const stateKey = SECTION_STATE_KEYS[s.sectionId];
      const titleRow = inputRow("Title", stateKey ? (state[stateKey]?.title || s.title || "") : (s.title || ""), {
        onInput: (v) =>
          window.GCEditor.patch((st) => {
            setSectionMetadata(st, s.sectionId, "title", v);
          }),
        placeholder: "Section heading",
      });
      titleRow.classList.add("e-row--compact");
      block.appendChild(titleRow);

      const subRow = inputRow("Subtitle", stateKey ? (state[stateKey]?.subtitle || s.settings?.subtitle || "") : ((s.settings && s.settings.subtitle) || ""), {
        onInput: (v) =>
          window.GCEditor.patch((st) => {
            setSectionMetadata(st, s.sectionId, "subtitle", v);
          }),
        placeholder: "Optional subheading",
      });
      subRow.classList.add("e-row--compact");
      block.appendChild(subRow);

      const bgRow = inputRow("Background (CSS)", (s.settings && s.settings.bg) || "", {
        onInput: (v) =>
          window.GCEditor.patch((st) => {
            const sec = (st.sections || []).find((x) => x.sectionId === s.sectionId);
            if (!sec) return;
            sec.settings = sec.settings || {};
            sec.settings.bg = v;
          }),
        placeholder: "linear-gradient(...)",
      });
      bgRow.classList.add("e-row--compact");
      block.appendChild(bgRow);
      list.appendChild(block);
    });

    wrap.appendChild(list);
    initSortable(list, (order) => {
      window.GCEditor.patch((st) => {
        const next = [];
        order.forEach((id, idx) => {
          const obj = (st.sections || []).find((x) => x.sectionId === id);
          if (obj) {
            obj.sortOrder = idx;
            next.push(obj);
          }
        });
        // keep any missing at end
        (st.sections || []).forEach((s) => {
          if (!next.includes(s)) next.push(s);
        });
        st.sections = next;
      });
    });

    return acc("sections", "Homepage Sections", "Drag & drop builder", wrap);
  }

  function heroSlideEditor(slide) {
    const wrap = document.createElement("div");
    if (!slide) {
      wrap.innerHTML = `<div class="e-text">Select a slide to edit.</div>`;
      return wrap;
    }
    wrap.appendChild(
      toggleRow("Slide enabled", slide.enabled !== false, (v) =>
        window.GCEditor.patch((s) => {
          const sl = (s.hero?.slides || []).find((x) => x.id === slide.id);
          if (sl) sl.enabled = v;
        }),
      ),
    );
    wrap.appendChild(inputRow("Kicker", slide.kicker || "", { onInput: (v) => window.GCEditor.patch((s) => ((s.hero.slides.find((x) => x.id === slide.id) || {}).kicker = v)), placeholder: "Limited drop" }));
    wrap.appendChild(inputRow("Headline", slide.headline || "", { onInput: (v) => window.GCEditor.patch((s) => ((s.hero.slides.find((x) => x.id === slide.id) || {}).headline = v)), placeholder: "Berry" }));
    wrap.appendChild(inputRow("Headline 2", slide.headline2 || "", { onInput: (v) => window.GCEditor.patch((s) => ((s.hero.slides.find((x) => x.id === slide.id) || {}).headline2 = v)), placeholder: "Crumbly" }));
    wrap.appendChild(textareaRow("Sub text", slide.sub || "", { onInput: (v) => window.GCEditor.patch((s) => ((s.hero.slides.find((x) => x.id === slide.id) || {}).sub = v)), rows: 3 }));

    wrap.appendChild(inputRow("Primary Button", slide.primaryLabel || "", { onInput: (v) => window.GCEditor.patch((s) => ((s.hero.slides.find((x) => x.id === slide.id) || {}).primaryLabel = v)), placeholder: "Shop now" }));
    wrap.appendChild(inputRow("Primary Link", slide.primaryHref || "", { onInput: (v) => window.GCEditor.patch((s) => ((s.hero.slides.find((x) => x.id === slide.id) || {}).primaryHref = v)), placeholder: "/shop" }));
    wrap.appendChild(inputRow("Secondary Button", slide.secondaryLabel || "", { onInput: (v) => window.GCEditor.patch((s) => ((s.hero.slides.find((x) => x.id === slide.id) || {}).secondaryLabel = v)), placeholder: "Explore" }));
    wrap.appendChild(inputRow("Secondary Link", slide.secondaryHref || "", { onInput: (v) => window.GCEditor.patch((s) => ((s.hero.slides.find((x) => x.id === slide.id) || {}).secondaryHref = v)), placeholder: "/shop" }));

    wrap.appendChild(inputRow("Overlay Gradient (CSS)", slide.overlayBg || "", { onInput: (v) => window.GCEditor.patch((s) => ((s.hero.slides.find((x) => x.id === slide.id) || {}).overlayBg = v)), placeholder: "linear-gradient(...)" }));

    const mediaRow = document.createElement("div");
    mediaRow.className = "e-row";
    mediaRow.innerHTML = `<div class="e-label">Media</div><div class="e-text">Pick background and floating cards.</div>`;
    const grid = document.createElement("div");
    grid.className = "e-grid2";
    function mediaBtn(label, kind, targetKey) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "e-btn e-btn--ghost e-btn--full";
      const cur = slide[targetKey];
      b.innerHTML = `${esc(label)}<small class="e-btn__sub">${cur?.url ? "Selected" : "None"}</small>`;
      b.addEventListener("click", () => {
        window.GCMediaLibrary?.open?.({
          accept: kind ? [kind] : null,
          onSelect: (item) => {
            window.GCEditor.patch((s) => {
              const sl = (s.hero?.slides || []).find((x) => x.id === slide.id);
              if (!sl) return;
              sl[targetKey] = { id: item.id, url: item.url, kind: item.kind };
            });
          },
        });
      });
      return b;
    }
    grid.appendChild(mediaBtn("Background", null, "background"));
    grid.appendChild(mediaBtn("Card A", "image", "cardA"));
    grid.appendChild(mediaBtn("Card B", "image", "cardB"));
    grid.appendChild(mediaBtn("Card C", "image", "cardC"));
    mediaRow.appendChild(grid);
    wrap.appendChild(mediaRow);

    const ribbons = Array.isArray(slide.ribbons) ? slide.ribbons : [];
    const ribWrap = document.createElement("div");
    ribWrap.className = "e-row";
    ribWrap.innerHTML = `<div class="e-label">Ribbons</div><div class="e-text">Inline promo chips in the hero slide.</div>`;
    const list = document.createElement("div");
    list.className = "e-sublist";
    ribbons.forEach((r, idx) => {
      const item = document.createElement("div");
      item.className = "e-subitem";
      item.innerHTML = `
        <input class="e-control" placeholder="Label" value="${esc(r.label || "")}" data-rib-label="${idx}">
        <input class="e-control" placeholder="Value" value="${esc(r.value || "")}" data-rib-value="${idx}">
        <button class="e-miniBtn" type="button" data-rib-del="${idx}">×</button>
      `;
      list.appendChild(item);
    });
    list.addEventListener("input", (e) => {
      const li = e.target.getAttribute?.("data-rib-label");
      const vi = e.target.getAttribute?.("data-rib-value");
      if (li == null && vi == null) return;
      const idx = Number(li ?? vi);
      const key = li != null ? "label" : "value";
      window.GCEditor.patch((s) => {
        const sl = (s.hero?.slides || []).find((x) => x.id === slide.id);
        if (!sl) return;
        sl.ribbons = Array.isArray(sl.ribbons) ? sl.ribbons : [];
        sl.ribbons[idx] = sl.ribbons[idx] || { label: "", value: "" };
        sl.ribbons[idx][key] = e.target.value;
      });
    });
    list.addEventListener("click", (e) => {
      const del = e.target.closest?.("[data-rib-del]")?.getAttribute("data-rib-del");
      if (del == null) return;
      const idx = Number(del);
      window.GCEditor.patch((s) => {
        const sl = (s.hero?.slides || []).find((x) => x.id === slide.id);
        if (!sl) return;
        sl.ribbons = (sl.ribbons || []).filter((_, i) => i !== idx);
      });
    });
    ribWrap.appendChild(list);
    ribWrap.appendChild(
      button("Add ribbon", "e-btn--ghost", () =>
        window.GCEditor.patch((s) => {
          const sl = (s.hero?.slides || []).find((x) => x.id === slide.id);
          if (!sl) return;
          sl.ribbons = Array.isArray(sl.ribbons) ? sl.ribbons : [];
          sl.ribbons.push({ label: "UP TO 20% OFF", value: "Free gifts" });
        }),
      ),
    );
    wrap.appendChild(ribWrap);

    wrap.appendChild(
      button("Delete slide", "e-btn--danger", async () => {
        if (!confirm("Delete this slide?")) return;
        try {
          window.GCEditor.patch((s) => {
            s.hero.slides = (s.hero.slides || []).filter((x) => x.id !== slide.id);
          });
          ui.slideId = null;
        } catch (e) {
          console.error(e);
        }
      }),
    );

    return wrap;
  }

  function panelHero(state) {
    const wrap = document.createElement("div");
    wrap.appendChild(rowLabel("Hero slider: drag slides, edit text, pick media. Autoplay supports swipe & dots."));

    wrap.appendChild(
      inputRow("Autoplay (ms)", String(state.hero?.autoplayMs || 5200), {
        type: "number",
        onChange: (v) =>
          window.GCEditor.patch((s) => {
            s.hero = s.hero || {};
            s.hero.autoplayMs = Math.max(2500, Math.min(12000, Number(v) || 5200));
          }),
      }),
    );

    const slides = Array.isArray(state.hero?.slides) ? state.hero.slides.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) : [];
    if (!ui.slideId && slides[0]?.id) ui.slideId = slides[0].id;

    const list = document.createElement("div");
    list.className = "e-list";
    list.dataset.heroSlides = "1";
    slides.forEach((sl) => {
      const title = sl.headline ? `${sl.headline}${sl.headline2 ? " " + sl.headline2 : ""}` : `Slide #${sl.id}`;
      const it = miniListItem(sl.id, title, sl.kicker || "Hero slide", sl.enabled !== false);
      if (String(ui.slideId) === String(sl.id)) it.dataset.active = "1";
      it.addEventListener("click", (e) => {
        if (e.target.closest?.("input")) return;
        ui.slideId = sl.id;
        window.GCEditor.emit("gc:rerender", {});
      });
      $("input[data-item-enabled]", it).addEventListener("change", (e) => {
        const on = !!e.target.checked;
        window.GCEditor.patch((s) => {
          const x = (s.hero?.slides || []).find((a) => a.id === sl.id);
          if (x) x.enabled = on;
        });
      });
      list.appendChild(it);
    });
    wrap.appendChild(list);

    initSortable(list, (order) => {
      window.GCEditor.patch((s) => {
        const next = [];
        order.forEach((id, idx) => {
          const sl = (s.hero?.slides || []).find((x) => String(x.id) === String(id));
          if (sl) {
            sl.sortOrder = idx;
            next.push(sl);
          }
        });
        (s.hero?.slides || []).forEach((x) => {
          if (!next.includes(x)) next.push(x);
        });
        s.hero.slides = next;
      });
    });

    const actions = document.createElement("div");
    actions.className = "e-actions";
    actions.appendChild(
      button("Add slide", "e-btn--primary", async () => {
        try {
          const id = Date.now();
          window.GCEditor.patch((s) => {
            s.hero = s.hero || { slides: [] };
            s.hero.slides = Array.isArray(s.hero.slides) ? s.hero.slides : [];
            s.hero.slides.push({
              id,
              enabled: true,
              sortOrder: s.hero.slides.length,
              kicker: "New drop",
              headline: "Glow",
              headline2: "Ritual",
              sub: "Edit this hero slide in the sidebar and hit Save.",
              primaryLabel: "Shop now",
              primaryHref: "/shop.html",
              secondaryLabel: "Learn more",
              secondaryHref: "/",
              overlayBg: "linear-gradient(120deg, rgba(255,46,122,.18), rgba(138,91,255,.16))",
              background: { id: null, url: "", kind: "" },
              cardA: { id: null, url: "" },
              cardB: { id: null, url: "" },
              cardC: { id: null, url: "" },
              ribbons: [{ label: "UP TO 20% OFF", value: "Free gifts" }],
              meta: [],
              buttonStyles: {},
            });
          });
          ui.slideId = id;
          window.GCEditor.emit("gc:rerender", {});
        } catch (e) {
          console.error(e);
        }
      }),
    );
    wrap.appendChild(actions);

    const selected = slides.find((x) => String(x.id) === String(ui.slideId));
    wrap.appendChild(rowLabel("Slide Editor"));
    wrap.appendChild(heroSlideEditor(selected));

    return acc("hero", "Hero Section", "Slides • ribbons • parallax", wrap);
  }

  function panelReels(state) {
    const wrap = document.createElement("div");
    wrap.appendChild(rowLabel("Reels / video-style showcase (cards). Items are editable and reorderable."));
    const items = Array.isArray(state.reels?.items) ? state.reels.items : [];
    const list = document.createElement("div");
    list.className = "e-list";
    items.forEach((it, idx) => {
      const block = document.createElement("div");
      block.className = "e-block";
      const head = miniListItem(`reel_${idx}`, it.title || `Reel ${idx + 1}`, it.href || "", true);
      head.querySelector("input[data-item-enabled]")?.closest?.("label")?.remove();
      block.appendChild(head);
      block.appendChild(
        inputRow("Title", it.title || "", {
          onInput: (v) => ensureHomepageSection("reels", (st) => {
            st.items = Array.isArray(st.items) ? st.items : [];
            st.items[idx] = st.items[idx] || { title: "", productImage: "", href: "" };
            st.items[idx].title = v;
          }),
        }),
      );
      block.appendChild(
        inputRow("Href", it.href || "", {
          onInput: (v) => ensureHomepageSection("reels", (st) => {
            st.items = Array.isArray(st.items) ? st.items : [];
            st.items[idx] = st.items[idx] || { title: "", productImage: "", href: "" };
            st.items[idx].href = v;
          }),
        }),
      );
      block.appendChild(
        button(it.productImage ? "Change image" : "Pick image", "e-btn--ghost", () =>
          window.GCMediaLibrary.open({
            accept: ["image"],
            onSelect: (m) => ensureHomepageSection("reels", (st) => {
              st.items = Array.isArray(st.items) ? st.items : [];
              st.items[idx] = st.items[idx] || { title: "", productImage: "", href: "" };
              st.items[idx].productImage = m.url;
            }),
          }),
        ),
      );
      block.appendChild(
        button("Remove item", "e-btn--danger", () => ensureHomepageSection("reels", (st) => {
          st.items = (st.items || []).filter((_, i) => i !== idx);
        })),
      );
      list.appendChild(block);
    });
    wrap.appendChild(list);
    initSortable(list, (order) =>
      ensureHomepageSection("reels", (st) => {
        const cur = Array.isArray(st.items) ? st.items : [];
        const next = [];
        order.forEach((id) => {
          const idx = Number(String(id).replace("reel_", ""));
          if (Number.isFinite(idx) && cur[idx]) next.push(cur[idx]);
        });
        // keep any missing
        cur.forEach((x) => {
          if (!next.includes(x)) next.push(x);
        });
        st.items = next;
      }),
    );
    wrap.appendChild(
      button("Add reel item", "e-btn--ghost", () =>
        ensureHomepageSection("reels", (st) => {
          st.items = Array.isArray(st.items) ? st.items : [];
          st.items.push({ title: "New reel", productImage: "", href: "/shop.html" });
        }),
      ),
    );
    return acc("reels", "Reels Showcase", "Video-style cards", wrap);
  }

  function panelFeatures(state) {
    const wrap = document.createElement("div");
    wrap.appendChild(rowLabel("Clean beauty / features cards. Edit titles and descriptions."));
    const cards = Array.isArray(state.features?.cards) ? state.features.cards : [];
    const list = document.createElement("div");
    list.className = "e-sublist";
    cards.forEach((c, idx) => {
      const item = document.createElement("div");
      item.className = "e-subitem e-subitem--stack";
      item.innerHTML = `
        <div class="e-subhead">
          <input class="e-control" placeholder="Title" value="${esc(c.title || "")}" data-feat-title="${idx}">
          <button class="e-miniBtn" type="button" data-feat-del="${idx}">×</button>
        </div>
        <textarea class="e-control" rows="2" placeholder="Description" data-feat-desc="${idx}">${esc(c.desc || "")}</textarea>
      `;
      list.appendChild(item);
    });
    list.addEventListener("input", (e) => {
      const idx = e.target.getAttribute?.("data-feat-title") ?? e.target.getAttribute?.("data-feat-desc");
      if (idx == null) return;
      const i = Number(idx);
      const key = e.target.hasAttribute("data-feat-title") ? "title" : "desc";
      ensureHomepageSection("features", (st) => {
        st.cards = Array.isArray(st.cards) ? st.cards : [];
        st.cards[i] = st.cards[i] || { title: "", desc: "" };
        st.cards[i][key] = e.target.value;
      });
    });
    list.addEventListener("click", (e) => {
      const del = e.target.closest?.("[data-feat-del]")?.getAttribute("data-feat-del");
      if (del == null) return;
      const i = Number(del);
      ensureHomepageSection("features", (st) => {
        st.cards = (st.cards || []).filter((_, idx) => idx !== i);
      });
    });
    wrap.appendChild(list);
    wrap.appendChild(
      button("Add feature card", "e-btn--ghost", () =>
        ensureHomepageSection("features", (st) => {
          st.cards = Array.isArray(st.cards) ? st.cards : [];
          st.cards.push({ title: "Cruelty-free", desc: "No animal testing. Clean choices, premium feel." });
        }),
      ),
    );
    return acc("features", "Clean Beauty", "Feature cards", wrap);
  }

  function panelStory(state) {
    const wrap = document.createElement("div");
    wrap.appendChild(rowLabel("About / story banner. Change image and CTA."));
    const st = state.story || {};
    wrap.appendChild(
      inputRow("Button label", st.buttonLabel || "", { onInput: (v) => ensureHomepageSection("story", (s) => (s.buttonLabel = v)), placeholder: "Our story" }),
    );
    wrap.appendChild(
      inputRow("Button href", st.buttonHref || "", { onInput: (v) => ensureHomepageSection("story", (s) => (s.buttonHref = v)), placeholder: "about.html" }),
    );
    wrap.appendChild(
      button(st.imageUrl ? "Change banner image" : "Pick banner image", "e-btn--ghost", () =>
        window.GCMediaLibrary.open({
          accept: ["image"],
          onSelect: (m) => ensureHomepageSection("story", (s) => (s.imageUrl = m.url)),
        }),
      ),
    );
    wrap.appendChild(
      inputRow("Image URL", st.imageUrl || "", { onInput: (v) => ensureHomepageSection("story", (s) => (s.imageUrl = v)), placeholder: "https://…" }),
    );
    return acc("story", "Story Banner", "About section", wrap);
  }

  function panelPromo(state) {
    const wrap = document.createElement("div");
    wrap.appendChild(toggleRow("Enable promo strip", getSection(state, "promoStrip")?.enabled !== false, (v) => window.GCEditor.patch((s) => {
      const section = (s.sections || []).find((item) => item.sectionId === "promoStrip");
      if (section) section.enabled = v;
    })));
    wrap.appendChild(inputRow("Title", state.promoStrip?.title || "", { onInput: (v) => window.GCEditor.patch((s) => (s.promoStrip.title = v)) }));
    wrap.appendChild(inputRow("Subtitle", state.promoStrip?.subtitle || "", { onInput: (v) => window.GCEditor.patch((s) => (s.promoStrip.subtitle = v)) }));
    wrap.appendChild(textareaRow("Pills (comma)", (state.promoStrip?.pills || []).join(", "), { onInput: (v) => window.GCEditor.patch((s) => (s.promoStrip.pills = v.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12))) }));
    wrap.appendChild(inputRow("Button label", state.promoStrip?.buttonLabel || "", { onInput: (v) => window.GCEditor.patch((s) => (s.promoStrip.buttonLabel = v)) }));
    wrap.appendChild(inputRow("Button link", state.promoStrip?.buttonHref || "", { onInput: (v) => window.GCEditor.patch((s) => (s.promoStrip.buttonHref = v)) }));
    wrap.appendChild(inputRow("Background (CSS)", state.promoStrip?.bg || "", { onInput: (v) => window.GCEditor.patch((s) => (s.promoStrip.bg = v)) }));
    wrap.appendChild(inputRow("Start (ISO)", state.promoStrip?.startAt || "", { onChange: (v) => window.GCEditor.patch((s) => (s.promoStrip.startAt = v)), placeholder: "2026-05-08T10:00:00" }));
    wrap.appendChild(inputRow("End (ISO)", state.promoStrip?.endAt || "", { onChange: (v) => window.GCEditor.patch((s) => (s.promoStrip.endAt = v)), placeholder: "2026-05-10T10:00:00" }));
    return acc("promo", "Promo Banner", "Offer strip / CTA", wrap);
  }

  function panelAppBanner(state) {
    const wrap = document.createElement("div");
    wrap.appendChild(toggleRow("Enable app banner", getSection(state, "appBanner")?.enabled !== false, (v) => window.GCEditor.patch((s) => {
      const section = (s.sections || []).find((item) => item.sectionId === "appBanner");
      if (section) section.enabled = v;
    })));
    wrap.appendChild(inputRow("Title", state.appBanner?.title || "", { onInput: (v) => window.GCEditor.patch((s) => (s.appBanner.title = v)) }));
    wrap.appendChild(textareaRow("Subtitle", state.appBanner?.subtitle || "", { onInput: (v) => window.GCEditor.patch((s) => (s.appBanner.subtitle = v)), rows: 2 }));
    wrap.appendChild(inputRow("Background (CSS)", state.appBanner?.bg || "", { onInput: (v) => window.GCEditor.patch((s) => (s.appBanner.bg = v)) }));
    wrap.appendChild(rowLabel("Store buttons"));
    const stores = Array.isArray(state.appBanner?.stores) ? state.appBanner.stores : [];
    const list = document.createElement("div");
    list.className = "e-sublist";
    stores.forEach((st, idx) => {
      const item = document.createElement("div");
      item.className = "e-subitem e-subitem--stack";
      item.innerHTML = `
        <div class="e-subhead">
          <input class="e-control" placeholder="kind (apple/google)" value="${esc(st.kind || "")}" data-store-kind="${idx}">
          <button class="e-miniBtn" type="button" data-store-del="${idx}">×</button>
        </div>
        <div class="e-grid2">
          <input class="e-control" placeholder="label" value="${esc(st.label || "")}" data-store-label="${idx}">
          <input class="e-control" placeholder="title" value="${esc(st.title || "")}" data-store-title="${idx}">
        </div>
        <input class="e-control" placeholder="href" value="${esc(st.href || "")}" data-store-href="${idx}">
      `;
      list.appendChild(item);
    });
    list.addEventListener("input", (e) => {
      const idx =
        e.target.getAttribute?.("data-store-kind") ??
        e.target.getAttribute?.("data-store-label") ??
        e.target.getAttribute?.("data-store-title") ??
        e.target.getAttribute?.("data-store-href");
      if (idx == null) return;
      const i = Number(idx);
      const key = e.target.hasAttribute("data-store-kind")
        ? "kind"
        : e.target.hasAttribute("data-store-label")
          ? "label"
          : e.target.hasAttribute("data-store-title")
            ? "title"
            : "href";
      window.GCEditor.patch((s) => {
        s.appBanner.stores = Array.isArray(s.appBanner.stores) ? s.appBanner.stores : [];
        s.appBanner.stores[i] = s.appBanner.stores[i] || { kind: "", label: "", title: "", href: "" };
        s.appBanner.stores[i][key] = e.target.value;
      });
    });
    list.addEventListener("click", (e) => {
      const del = e.target.closest?.("[data-store-del]")?.getAttribute("data-store-del");
      if (del == null) return;
      const i = Number(del);
      window.GCEditor.patch((s) => {
        s.appBanner.stores = (s.appBanner.stores || []).filter((_, idx) => idx !== i);
      });
    });
    wrap.appendChild(list);
    wrap.appendChild(
      button("Add store", "e-btn--ghost", () =>
        window.GCEditor.patch((s) => {
          s.appBanner.stores = Array.isArray(s.appBanner.stores) ? s.appBanner.stores : [];
          s.appBanner.stores.push({ kind: "apple", label: "Download on the", title: "App Store", href: "#" });
        }),
      ),
    );
    return acc("app", "App Banner", "Download strip", wrap);
  }

  function panelNav(state) {
    const wrap = document.createElement("div");
    wrap.appendChild(rowLabel("Edit navbar links for the homepage draft. Preview becomes available in Phase C."));

    const list = document.createElement("div");
    list.className = "e-list";
    list.dataset.navLinks = "1";
    const links = Array.isArray(state.navigation?.links) ? state.navigation.links : [];
    links.forEach((l, index) => {
      const block = document.createElement("div");
      block.className = "e-block";
      const itemId = `nav_${index}`;
      const it = miniListItem(itemId, l.label || "Link", l.href || "", l.enabled !== false);
      it.dataset.kind = "nav";
      $("input[data-item-enabled]", it).addEventListener("change", (e) => {
        const on = !!e.target.checked;
        window.GCEditor.patch((s) => {
          const x = s.navigation?.links?.[index];
          if (x) x.enabled = on;
        });
      });
      block.appendChild(it);

      const grid = document.createElement("div");
      grid.className = "e-grid2";
      grid.appendChild(
        inputRow("Label", l.label || "", {
          onInput: (v) =>
            window.GCEditor.patch((s) => {
              const x = s.navigation?.links?.[index];
              if (x) x.label = v;
            }),
        }),
      );
      grid.appendChild(
        inputRow("Href", l.href || "", {
          onInput: (v) =>
            window.GCEditor.patch((s) => {
              const x = s.navigation?.links?.[index];
              if (x) x.href = v;
            }),
        }),
      );
      block.appendChild(grid);

      block.appendChild(
        toggleRow("Pill style", !!l.isPill, (v) =>
          window.GCEditor.patch((s) => {
            const x = s.navigation?.links?.[index];
            if (x) x.isPill = v;
          }),
        ),
      );
      block.appendChild(button("Delete link", "e-btn--danger", () =>
        window.GCEditor.patch((s) => {
          s.navigation.links = (s.navigation.links || []).filter((_, linkIndex) => linkIndex !== index);
        }),
      ));
      list.appendChild(block);
    });
    wrap.appendChild(list);

    initSortable(list, (order) => {
      window.GCEditor.patch((s) => {
        const next = [];
        order.forEach((id, idx) => {
          const sourceIndex = Number(String(id).replace("nav_", ""));
          const x = (s.navigation.links || [])[sourceIndex];
          if (x) {
            x.sortOrder = idx;
            next.push(x);
          }
        });
        s.navigation.links = next;
      });
    });

    wrap.appendChild(
      button("Add link", "e-btn--ghost", () =>
        window.GCEditor.patch((s) => {
          s.navigation = s.navigation || { links: [] };
          s.navigation.links = Array.isArray(s.navigation.links) ? s.navigation.links : [];
          s.navigation.links.push({ label: "New", href: "/shop.html", isPill: false, enabled: true, sortOrder: s.navigation.links.length });
        }),
      ),
    );
    return acc("nav", "Navbar", "Menus + pills", wrap);
  }

  function panelFooter(state) {
    const wrap = document.createElement("div");
    const f = state.footer || { aboutText: "", chips: [], bottomLeft: "", bottomRight: "", columns: [] };
    wrap.appendChild(textareaRow("About text", f.aboutText || "", { onInput: (v) => window.GCEditor.patch((s) => (s.footer.aboutText = v)), rows: 3 }));
    wrap.appendChild(textareaRow("Chips (comma)", (f.chips || []).join(", "), { onInput: (v) => window.GCEditor.patch((s) => (s.footer.chips = v.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12))) }));
    wrap.appendChild(inputRow("Bottom left", f.bottomLeft || "", { onInput: (v) => window.GCEditor.patch((s) => (s.footer.bottomLeft = v)) }));
    wrap.appendChild(inputRow("Bottom right", f.bottomRight || "", { onInput: (v) => window.GCEditor.patch((s) => (s.footer.bottomRight = v)) }));
    const columnsRow = textareaRow("Columns (JSON)", JSON.stringify(f.columns || [], null, 2), { rows: 6 });
    const columnsInput = $("textarea", columnsRow);
    const columnsError = document.createElement("div");
    columnsError.className = "e-text";
    columnsError.setAttribute("role", "status");
    columnsRow.appendChild(columnsError);
    columnsInput.addEventListener("input", () => {
      try {
        const parsed = JSON.parse(columnsInput.value);
        if (!Array.isArray(parsed)) throw new Error("Footer columns must be a JSON array.");
        window.GCEditor.patch((s) => (s.footer.columns = parsed));
        columnsError.textContent = "";
        columnsInput.removeAttribute("aria-invalid");
      } catch {
        columnsError.textContent = "Enter a valid JSON array to update footer columns.";
        columnsInput.setAttribute("aria-invalid", "true");
      }
    });
    wrap.appendChild(columnsRow);
    return acc("footer", "Footer", "Newsletter + links", wrap);
  }

  function panelLogos(state) {
    const wrap = document.createElement("div");
    wrap.appendChild(rowLabel("Homepage brand showcase. Drag to reorder."));

    const items = Array.isArray(state.logos) ? state.logos.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) : [];
    if (!ui.logoId && items[0]?.id) ui.logoId = items[0].id;

    const list = document.createElement("div");
    list.className = "e-list";
    items.forEach((l) => {
      const it = miniListItem(l.id, l.name || "Logo", l.logo?.url ? "Media selected" : "Pick image", l.enabled !== false);
      if (String(ui.logoId) === String(l.id)) it.dataset.active = "1";
      it.addEventListener("click", (e) => {
        if (e.target.closest?.("input")) return;
        ui.logoId = l.id;
        window.GCEditor.emit("gc:rerender", {});
      });
      $("input[data-item-enabled]", it).addEventListener("change", (e) => window.GCEditor.patch((s) => { const x = (s.logos||[]).find((a)=>a.id===l.id); if (x) x.enabled = !!e.target.checked; }));
      list.appendChild(it);
    });
    wrap.appendChild(list);
    initSortable(list, (order) => window.GCEditor.patch((s) => {
      const next=[]; order.forEach((id,idx)=>{const x=(s.logos||[]).find((a)=>String(a.id)===String(id)); if(x){x.sortOrder=idx; next.push(x);} });
      (s.logos||[]).forEach((x)=>{if(!next.includes(x)) next.push(x);}); s.logos=next;
    }));

    wrap.appendChild(
      button("Add logo", "e-btn--ghost", async () => {
        const id = Date.now();
        window.GCEditor.patch((s) => {
          s.logos = Array.isArray(s.logos) ? s.logos : [];
          s.logos.push({ id, enabled: true, sortOrder: s.logos.length, name: "Media", logo: { id: null, url: "" } });
        });
        ui.logoId = id;
        window.GCEditor.emit("gc:rerender", {});
      }),
    );

    const cur = items.find((x) => String(x.id) === String(ui.logoId));
    if (cur) {
      wrap.appendChild(inputRow("Name", cur.name || "", { onInput: (v) => window.GCEditor.patch((s) => { const x=(s.logos||[]).find((a)=>a.id===cur.id); if(x) x.name=v; }) }));
      wrap.appendChild(inputRow("URL (optional)", cur.href || "", { onInput: (v) => window.GCEditor.patch((s) => { const x=(s.logos||[]).find((a)=>a.id===cur.id); if(x) x.href=v; }) }));
      wrap.appendChild(
        button(cur.logo?.url ? "Change logo image" : "Pick logo image", "e-btn--ghost", () =>
          window.GCMediaLibrary.open({
            accept: ["image"],
            onSelect: (item) => window.GCEditor.patch((s) => { const x=(s.logos||[]).find((a)=>a.id===cur.id); if(x) x.logo={ id: item.id, url: item.url }; }),
          }),
        ),
      );
      wrap.appendChild(
        button("Delete logo", "e-btn--danger", async () => {
          if (!confirm("Delete this logo?")) return;
          window.GCEditor.patch((s) => (s.logos = (s.logos || []).filter((x) => x.id !== cur.id)));
          ui.logoId = null;
          window.GCEditor.emit("gc:rerender", {});
        }),
      );
    }

    return acc("logos", "Brand Showcase", "Homepage brand logos", wrap);
  }

  function panelTestimonials(state) {
    const wrap = document.createElement("div");
    wrap.appendChild(rowLabel("Reviews carousel. Drag to reorder, edit text, set rating."));
    const items = Array.isArray(state.testimonials) ? state.testimonials.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) : [];
    if (!ui.testimonialId && items[0]?.id) ui.testimonialId = items[0].id;

    const list = document.createElement("div");
    list.className = "e-list";
    items.forEach((t) => {
      const it = miniListItem(t.id, t.name || "Customer", `${t.rating || 5}★ • ${t.meta || ""}`, t.enabled !== false);
      if (String(ui.testimonialId) === String(t.id)) it.dataset.active = "1";
      it.addEventListener("click", (e) => {
        if (e.target.closest?.("input")) return;
        ui.testimonialId = t.id;
        window.GCEditor.emit("gc:rerender", {});
      });
      $("input[data-item-enabled]", it).addEventListener("change", (e) => window.GCEditor.patch((s) => { const x=(s.testimonials||[]).find((a)=>a.id===t.id); if(x) x.enabled=!!e.target.checked; }));
      list.appendChild(it);
    });
    wrap.appendChild(list);
    initSortable(list, (order) => window.GCEditor.patch((s) => {
      const next=[]; order.forEach((id,idx)=>{const x=(s.testimonials||[]).find((a)=>String(a.id)===String(id)); if(x){x.sortOrder=idx; next.push(x);} });
      (s.testimonials||[]).forEach((x)=>{if(!next.includes(x)) next.push(x);}); s.testimonials=next;
    }));

    wrap.appendChild(
      button("Add testimonial", "e-btn--ghost", async () => {
        const id = Date.now();
        window.GCEditor.patch((s) => {
          s.testimonials = Array.isArray(s.testimonials) ? s.testimonials : [];
          s.testimonials.push({ id, enabled: true, sortOrder: s.testimonials.length, name: "Customer", meta: "Verified buyer", rating: 5, text: "", avatar: { id: null, url: "" } });
        });
        ui.testimonialId = id;
        window.GCEditor.emit("gc:rerender", {});
      }),
    );

    const cur = items.find((x) => String(x.id) === String(ui.testimonialId));
    if (cur) {
      wrap.appendChild(inputRow("Name", cur.name || "", { onInput: (v) => window.GCEditor.patch((s) => { const x=(s.testimonials||[]).find((a)=>a.id===cur.id); if(x) x.name=v; }) }));
      wrap.appendChild(inputRow("Meta", cur.meta || "", { onInput: (v) => window.GCEditor.patch((s) => { const x=(s.testimonials||[]).find((a)=>a.id===cur.id); if(x) x.meta=v; }) }));
      wrap.appendChild(inputRow("Rating (0–5)", String(cur.rating ?? 5), { type: "number", onChange: (v) => window.GCEditor.patch((s) => { const x=(s.testimonials||[]).find((a)=>a.id===cur.id); if(x) x.rating=Math.max(0, Math.min(5, Number(v)||5)); }) }));
      wrap.appendChild(textareaRow("Text", cur.text || "", { rows: 4, onInput: (v) => window.GCEditor.patch((s) => { const x=(s.testimonials||[]).find((a)=>a.id===cur.id); if(x) x.text=v; }) }));
      wrap.appendChild(
        button(cur.avatar?.url ? "Change avatar" : "Pick avatar", "e-btn--ghost", () =>
          window.GCMediaLibrary.open({
            accept: ["image"],
            onSelect: (item) => window.GCEditor.patch((s) => { const x=(s.testimonials||[]).find((a)=>a.id===cur.id); if(x) x.avatar={ id: item.id, url: item.url }; }),
          }),
        ),
      );
      wrap.appendChild(
        button("Delete testimonial", "e-btn--danger", async () => {
          if (!confirm("Delete this testimonial?")) return;
          window.GCEditor.patch((s) => (s.testimonials = (s.testimonials || []).filter((x) => x.id !== cur.id)));
          ui.testimonialId = null;
          window.GCEditor.emit("gc:rerender", {});
        }),
      );
    }

    return acc("testimonials", "Testimonials", "Reviews + carousel", wrap);
  }

  function panelProductSections(state) {
    const wrap = document.createElement("div");
    wrap.appendChild(rowLabel("Edit product rails, tabs and filters (badge/category/concern/search)."));
    const items = Array.isArray(state.productSections)
      ? state.productSections.map((section, index) => ({ section, index })).sort((a, b) => (a.section.sortOrder ?? a.index) - (b.section.sortOrder ?? b.index))
      : [];
    items.forEach(({ section: ps, index: sectionIndex }, orderIndex) => {
      const box = document.createElement("div");
      box.className = "e-box";
      box.innerHTML = `<div class="e-box__title">${esc(ps.kind || "section")}</div>`;
      box.appendChild(toggleRow("Enabled", ps.enabled !== false, (v) => window.GCEditor.patch((s) => { const x=s.productSections?.[sectionIndex]; if(x) x.enabled=v; })));
      box.appendChild(inputRow("Title", ps.title || "", { onInput: (v) => window.GCEditor.patch((s) => { const x=s.productSections?.[sectionIndex]; if(x) x.title=v; }) }));
      box.appendChild(textareaRow("Subtitle", ps.subtitle || "", { rows: 2, onInput: (v) => window.GCEditor.patch((s) => { const x=s.productSections?.[sectionIndex]; if(x) x.subtitle=v; }) }));
      box.appendChild(inputRow("View all link", ps.viewAllHref || "", { onInput: (v) => window.GCEditor.patch((s) => { const x=s.productSections?.[sectionIndex]; if(x) x.viewAllHref=v; }) }));

      const tabs = Array.isArray(ps.tabs) ? ps.tabs : [];
      const tabHost = document.createElement("div");
      tabHost.className = "e-sublist";
      tabs.forEach((t, idx) => {
        const item = document.createElement("div");
        item.className = "e-subitem e-subitem--stack";
        const f = t.filter || {};
        item.innerHTML = `
          <div class="e-subhead">
            <input class="e-control" placeholder="Tab label" value="${esc(t.label || "")}" data-tab-label="${idx}">
            <button class="e-miniBtn" type="button" data-tab-del="${idx}">×</button>
          </div>
          <div class="e-grid2">
            <input class="e-control" placeholder="badge" value="${esc(f.badge || "")}" data-tab-badge="${idx}">
            <input class="e-control" placeholder="category" value="${esc(f.category || "")}" data-tab-category="${idx}">
          </div>
          <div class="e-grid2">
            <input class="e-control" placeholder="concern" value="${esc(f.concern || "")}" data-tab-concern="${idx}">
            <input class="e-control" placeholder="search" value="${esc(f.search || "")}" data-tab-search="${idx}">
          </div>
        `;
        tabHost.appendChild(item);
      });
      tabHost.addEventListener("input", (e) => {
        const attr = e.target.getAttribute?.("data-tab-label") || e.target.getAttribute?.("data-tab-badge") || e.target.getAttribute?.("data-tab-category") || e.target.getAttribute?.("data-tab-concern") || e.target.getAttribute?.("data-tab-search");
        if (attr == null) return;
        const idx = Number(attr);
        const key =
          e.target.hasAttribute("data-tab-label")
            ? "label"
            : e.target.hasAttribute("data-tab-badge")
              ? "badge"
              : e.target.hasAttribute("data-tab-category")
                ? "category"
                : e.target.hasAttribute("data-tab-concern")
                  ? "concern"
                  : "search";
        window.GCEditor.patch((s) => {
          const x = s.productSections?.[sectionIndex];
          if (!x) return;
          x.tabs = Array.isArray(x.tabs) ? x.tabs : [];
          x.tabs[idx] = x.tabs[idx] || { id: `t${idx}`, label: "", filter: {} };
          if (key === "label") x.tabs[idx].label = e.target.value;
          else {
            x.tabs[idx].filter = x.tabs[idx].filter || {};
            x.tabs[idx].filter[key] = e.target.value;
          }
        });
      });
      tabHost.addEventListener("click", (e) => {
        const del = e.target.closest?.("[data-tab-del]")?.getAttribute("data-tab-del");
        if (del == null) return;
        const idx = Number(del);
        window.GCEditor.patch((s) => {
          const x = s.productSections?.[sectionIndex];
          if (!x) return;
          x.tabs = (x.tabs || []).filter((_, i) => i !== idx);
        });
      });
      box.appendChild(rowLabel("Tabs"));
      box.appendChild(tabHost);
      box.appendChild(
        button("Add tab", "e-btn--ghost", () =>
          window.GCEditor.patch((s) => {
            const x = s.productSections?.[sectionIndex];
            if (!x) return;
            x.tabs = Array.isArray(x.tabs) ? x.tabs : [];
            x.tabs.push({ id: `t${Date.now()}`, label: "All", filter: {} });
          }),
        ),
      );
      const actions = document.createElement("div");
      actions.className = "e-actions";
      if (orderIndex > 0) {
        actions.appendChild(button("Move up", "e-btn--ghost", () => {
          const ordered = items.map((item) => item.section);
          [ordered[orderIndex - 1], ordered[orderIndex]] = [ordered[orderIndex], ordered[orderIndex - 1]];
          window.GCEditor.patch((s) => {
            s.productSections = ordered.map((item, sortOrder) => ({ ...item, sortOrder }));
          });
        }));
      }
      if (orderIndex < items.length - 1) {
        actions.appendChild(button("Move down", "e-btn--ghost", () => {
          const ordered = items.map((item) => item.section);
          [ordered[orderIndex], ordered[orderIndex + 1]] = [ordered[orderIndex + 1], ordered[orderIndex]];
          window.GCEditor.patch((s) => {
            s.productSections = ordered.map((item, sortOrder) => ({ ...item, sortOrder }));
          });
        }));
      }
      actions.appendChild(button("Delete product section", "e-btn--danger", () => {
        window.GCEditor.patch((s) => {
          s.productSections = (s.productSections || []).filter((_, index) => index !== sectionIndex);
        });
      }));
      box.appendChild(actions);

      wrap.appendChild(box);
    });
    wrap.appendChild(button("Add product section", "e-btn--ghost", () =>
      window.GCEditor.patch((s) => {
        s.productSections = Array.isArray(s.productSections) ? s.productSections : [];
        s.productSections.push({
          kind: `custom-${Date.now()}`,
          enabled: true,
          sortOrder: s.productSections.length,
          title: "New product section",
          subtitle: "",
          viewAllHref: "",
          tabs: [],
        });
      }),
    ));
    return acc("productSections", "Product Sections", "Tabs + filters", wrap);
  }

  function renderAll(state) {
    host.innerHTML = "";
    host.appendChild(panelTheme(state));
    host.appendChild(panelAnnouncement(state));
    host.appendChild(panelSections(state));
    host.appendChild(panelHero(state));
    host.appendChild(panelReels(state));
    host.appendChild(panelFeatures(state));
    host.appendChild(panelStory(state));
    host.appendChild(panelPromo(state));
    host.appendChild(panelAppBanner(state));
    host.appendChild(panelProductSections(state));
    host.appendChild(panelLogos(state));
    host.appendChild(panelTestimonials(state));
    host.appendChild(panelNav(state));
    host.appendChild(panelFooter(state));
  }

  function applySearch(q) {
    const query = String(q || "").trim();
    const accs = $$("details.e-acc", host);
    if (!query) {
      accs.forEach((a) => (a.hidden = false));
      return;
    }
    accs.forEach((a) => {
      const text = a.textContent.toLowerCase();
      a.hidden = !text.includes(query);
      if (!a.hidden) a.open = true;
    });
  }

  function init() {
    if (!window.GCEditor?.on) return;
    window.GCEditor.on("gc:state", (st) => {
      if (host.contains(document.activeElement) && isActiveTextControl(document.activeElement)) return;
      renderAll(st);
    });
    window.GCEditor.on("gc:search", ({ q }) => applySearch(q));
    window.GCEditor.on("gc:rerender", () => renderAll(window.GCEditor.getState()));
    const current = window.GCEditor.getState?.();
    if (current?.sections) renderAll(current); // a draft that loaded before this subscription
  }

  // Deferred scripts run while readyState is "interactive", before homepage-editor.js
  // has defined GCEditor, so wait for DOMContentLoaded unless parsing already finished.
  if (document.readyState === "complete") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
