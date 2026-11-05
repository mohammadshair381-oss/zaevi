(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const modal = $("[data-media-modal]");
  const grid = $("[data-media-grid]");
  const statusEl = $("[data-media-status]");
  const fileInp = $("[data-media-file]");
  const titleInp = $("[data-media-title]");
  const altInp = $("[data-media-alt]");
  const kindSel = $("[data-media-kind]");
  const uploadBtn = $("[data-media-upload]");

  const closeBtns = $$("[data-media-close]");

  const state = {
    open: false,
    loading: false,
    items: [],
    onSelect: null,
    accept: null,
  };

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function setOpen(next) {
    state.open = !!next;
    if (!modal) return;
    modal.hidden = !state.open;
    document.documentElement.style.overflow = state.open ? "hidden" : "";
  }

  function setStatus(message) {
    if (statusEl) statusEl.textContent = message;
  }

  function getErrorMessage(payload, status) {
    if (status >= 500) return "The media service could not complete the request. Try again later.";
    if (typeof payload?.error === "string") return payload.error;
    if (typeof payload?.error?.message === "string") return payload.error.message;
    return `Media request failed (${status}).`;
  }

  function render() {
    if (!grid) return;
    const accept = state.accept;
    const items = Array.isArray(state.items) ? state.items : [];
    const filtered = accept && Array.isArray(accept) ? items.filter((x) => accept.includes(x.kind)) : items;
    grid.innerHTML = filtered
      .map((a) => {
        const thumb =
          a.kind === "video"
            ? `<video src="${esc(a.url)}" muted playsinline></video>`
            : `<img src="${esc(a.url)}" alt="${esc(a.alt || a.title || "")}" loading="lazy">`;
        return `
          <div class="m-item" data-media-item="${esc(a.id)}">
            <div class="m-thumb">${thumb}</div>
            <div class="m-meta">
              <b title="${esc(a.title || "")}">${esc(a.title || "Untitled")}</b>
              <small>${esc(a.kind || "image")}</small>
              <div class="m-actions">
                <button class="m-mini" type="button" data-media-select="${esc(a.id)}">Select</button>
                <button class="m-mini m-mini--danger" type="button" data-media-del="${esc(a.id)}">Delete</button>
              </div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  async function refresh() {
    if (!window.GCEditor?.api?.get) return;
    state.loading = true;
    setStatus("Loading media…");
    try {
      const json = await window.GCEditor.api.get(window.GCEditor.boot?.mediaUrl);
      const rows = Array.isArray(json?.data) ? json.data : (Array.isArray(json?.items) ? json.items : []);
      state.items = rows.map((a) => ({
        id: a.id,
        kind: String(a.mimeType || '').startsWith('video/') ? 'video' : 'image',
        title: a.alt || a.url || 'Media',
        alt: a.alt || '',
        url: a.url,
      }));
      render();
      setStatus(`${state.items.length} media item${state.items.length === 1 ? "" : "s"} loaded.`);
    } catch (e) {
      console.error(e);
      setStatus(`Could not load media: ${String(e?.message || "request failed")}`);
    } finally {
      state.loading = false;
    }
  }

  function bootstrapUrls() {
    const boot = window.GCEditor?.boot || null;
    if (!boot?.mediaUrl) return null;
    return boot;
  }

  async function upload() {
    const boot = bootstrapUrls();
    if (!boot?.mediaUrl || !fileInp?.files?.[0]) return;
    const file = fileInp.files[0];
    const reader = new FileReader();
    reader.onload = async () => {
      const data = String(reader.result || '');
      uploadBtn.disabled = true;
      setStatus("Uploading media…");
      try {
        const res = await fetch(boot.mediaUrl, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "x-csrf-token": window.GCEditor?.csrf || "" },
          body: JSON.stringify({ data, alt: altInp?.value || file.name, mimeType: file.type }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(getErrorMessage(json, res.status));
        if (json?.data) state.items.unshift({
          id: json.data.id,
          kind: String(json.data.mimeType || '').startsWith('video/') ? 'video' : 'image',
          title: json.data.alt || file.name,
          alt: json.data.alt || '',
          url: json.data.url,
        });
        fileInp.value = "";
        titleInp.value = "";
        altInp.value = "";
        render();
        setStatus("Media uploaded.");
      } catch (e) {
        console.error(e);
        setStatus(`Upload failed: ${String(e?.message || "request failed")}`);
      } finally {
        uploadBtn.disabled = false;
      }
    };
    reader.onerror = () => setStatus("Upload failed: the selected file could not be read.");
    reader.readAsDataURL(file);
  }

  async function del(id) {
    const boot = bootstrapUrls();
    if (!boot?.mediaDeleteUrlTmpl) return;
    const url = window.GCEditor.api.withPk(boot.mediaDeleteUrlTmpl, id);
    try {
      const res = await fetch(url, { method: "DELETE", credentials: "same-origin", headers: { "x-csrf-token": window.GCEditor?.csrf || "" } });
      if (res.status === 204 || res.ok) {
        state.items = state.items.filter((item) => String(item.id) !== String(id));
        render();
        setStatus("Media deleted.");
      } else {
        const json = await res.json().catch(() => ({}));
        setStatus(`Delete failed: ${getErrorMessage(json, res.status)}`);
      }
    } catch (e) {
      console.error(e);
      setStatus(`Delete failed: ${String(e?.message || "network error")}`);
    }
  }

  function open(opts = {}) {
    state.onSelect = typeof opts.onSelect === "function" ? opts.onSelect : null;
    state.accept = Array.isArray(opts.accept) ? opts.accept : null;
    setOpen(true);
    refresh();
  }

  function close() {
    state.onSelect = null;
    state.accept = null;
    setOpen(false);
  }

  function pick(id) {
    const item = state.items.find((x) => String(x.id) === String(id));
    if (!item) return;
    const cb = state.onSelect;
    close();
    cb?.(item);
  }

  function init() {
    if (!modal) return;
    closeBtns.forEach((b) => b.addEventListener("click", close));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.open) close();
    });
    grid?.addEventListener("click", (e) => {
      const sel = e.target.closest?.("[data-media-select]")?.getAttribute("data-media-select");
      const delId = e.target.closest?.("[data-media-del]")?.getAttribute("data-media-del");
      if (sel) {
        pick(sel);
        return;
      }
      if (delId) {
        del(delId);
      }
    });
    uploadBtn?.addEventListener("click", upload);
  }

  window.GCMediaLibrary = { open, close, refresh };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();


window.addEventListener('DOMContentLoaded', () => {

    const modal =
        document.querySelector('.media-library-modal') ||
        document.querySelector('.media-modal') ||
        document.querySelector('#mediaLibrary') ||
        document.querySelector('[data-media-library]');

    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('open', 'active', 'show');

        const closeBtn =
            modal.querySelector('.close') ||
            modal.querySelector('.close-btn') ||
            modal.querySelector('.modal-close') ||
            modal.querySelector('[data-close]');

        function closeModal() {
            modal.style.display = 'none';
            modal.classList.remove('open', 'active', 'show');
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeModal();
            }
        });
    }
});


window.addEventListener('load', () => {

    const mediaPopup = [...document.querySelectorAll('div')]
        .find(el => el.innerText && el.innerText.includes('Media Library'));

    if (mediaPopup) {
        mediaPopup.style.display = 'none';
    }

});