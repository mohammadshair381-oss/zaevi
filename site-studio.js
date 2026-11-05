/**
 * Site Studio editor. Edits appear straight away in the preview and are saved as a
 * draft automatically. Shoppers see nothing until Publish is pressed.
 */
(function () {
  'use strict';

  const API = '/api/admin/studio';
  const $ = (id) => document.getElementById(id);
  const MAX_IMAGE_SIDE = 1800;
  // The server accepts photos up to 700 KB; base64 text is about a third larger than the file.
  const MAX_IMAGE_TEXT_LENGTH = 880000;

  const BUILTIN_NAMES = {
    intro: 'Welcome message',
    feature: 'New season feature',
    shop: 'Featured products',
    split: 'Women and Men photos',
    manifesto: 'Philosophy statement',
    craft: 'Craftsmanship message',
    journal: 'Journal feature',
    newsletter: 'Newsletter sign-up',
  };

  const SPEEDS = [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']];
  const APPEAR = [['rise', 'Rise up'], ['curtain', 'Curtain open'], ['slide', 'Slide in'], ['zoom', 'Zoom in'], ['none', 'No movement']];
  const BUTTON_FIELDS = [
    { key: 'ctaLabel', label: 'Button text (optional)' },
    { key: 'link', label: 'Button link, for example women.html', hint: true },
  ];

  const BLOCKS = {
    ribbon: {
      name: 'Moving ribbon', help: 'A strip of scrolling text',
      fields: [
        { key: 'text', label: 'Ribbon text' },
        { key: 'link', label: 'Link when clicked (optional)' },
        { key: 'speed', label: 'Speed', options: SPEEDS },
        { key: 'direction', label: 'Direction', options: [['left', 'To the left'], ['right', 'To the right']] },
        { key: 'style', label: 'Style', options: [['accent', 'Brand colour'], ['solid', 'Light'], ['outline', 'Outline']] },
      ],
      create: () => ({ text: 'New season now available', link: 'collections.html', speed: 'normal', direction: 'left', style: 'accent', animation: 'none' }),
      title: (b) => b.text,
    },
    event: {
      name: 'Event', help: 'Date, place and live countdown',
      fields: [
        { key: 'title', label: 'Event name' },
        { key: 'date', label: 'Date and time', type: 'datetime' },
        { key: 'location', label: 'Place' },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'image', label: 'Photo', type: 'image' },
        ...BUTTON_FIELDS,
        { key: 'showCountdown', label: 'Show a live countdown', type: 'check' },
        { key: 'hideAfterEvent', label: 'Hide automatically once it has happened', type: 'check' },
      ],
      create: () => ({ title: 'Private preview', date: new Date(Date.now() + 14 * 864e5).toISOString(), location: '', description: 'Join us for a first look at the new collection.', image: '', ctaLabel: 'Reserve your place', link: 'contact.html', showCountdown: true, hideAfterEvent: true }),
      title: (b) => b.title,
    },
    banner: {
      name: 'Photo banner', help: 'Large photo with a headline',
      fields: [
        { key: 'image', label: 'Photo', type: 'image' },
        { key: 'eyebrow', label: 'Small heading (optional)' },
        { key: 'title', label: 'Headline' },
        { key: 'subtitle', label: 'Subtitle (optional)' },
        ...BUTTON_FIELDS,
      ],
      create: () => ({ image: '', eyebrow: '', title: 'Your headline', subtitle: '', ctaLabel: 'Discover', link: 'collections.html', animation: 'curtain' }),
      title: (b) => b.title,
    },
    text: {
      name: 'Text', help: 'A heading and a paragraph',
      fields: [
        { key: 'eyebrow', label: 'Small heading (optional)' },
        { key: 'heading', label: 'Heading' },
        { key: 'body', label: 'Paragraph (optional)', type: 'textarea' },
        ...BUTTON_FIELDS,
      ],
      create: () => ({ eyebrow: '', heading: 'Your heading', body: 'Write something about your brand here.', ctaLabel: '', link: '' }),
      title: (b) => b.heading,
    },
    imageText: {
      name: 'Photo and text', help: 'Side by side',
      fields: [
        { key: 'image', label: 'Photo', type: 'image' },
        { key: 'side', label: 'Photo position', options: [['left', 'Left'], ['right', 'Right']] },
        { key: 'heading', label: 'Heading' },
        { key: 'body', label: 'Paragraph (optional)', type: 'textarea' },
        ...BUTTON_FIELDS,
      ],
      create: () => ({ image: '', side: 'left', heading: 'Your heading', body: 'Tell the story behind this piece.', ctaLabel: '', link: '', animation: 'slide' }),
      title: (b) => b.heading,
    },
    products: {
      name: 'Products', help: 'A row of your products',
      fields: [
        { key: 'heading', label: 'Heading' },
        { key: 'gender', label: 'Show products for', options: [['All', 'Everyone'], ['Women', 'Women'], ['Men', 'Men']] },
        { key: 'category', label: 'Only this category (optional), for example Dresses' },
        { key: 'count', label: 'How many', options: [[4, '4'], [8, '8'], [12, '12']], number: true },
      ],
      create: () => ({ heading: 'New arrivals', gender: 'All', category: '', count: 4 }),
      title: (b) => b.heading,
    },
    gallery: {
      name: 'Photo gallery', help: 'A grid of photos',
      fields: [
        { key: 'heading', label: 'Heading (optional)' },
        { key: 'images', label: 'Photos', type: 'gallery' },
      ],
      create: () => ({ heading: 'The edit', images: [] }),
      title: (b) => b.heading || 'Photo gallery',
    },
  };

  const ACCENTS = [['rouge', 'Rouge', '#cf0a1e'], ['sapphire', 'Sapphire', '#1f4fd8'], ['emerald', 'Emerald', '#0e7d4f'], ['amber', 'Amber', '#b45f06']];

  let draft = null;
  let meta = {};
  let tab = 'sections';
  let openBlockId = null;
  let saveTimer = null;
  let previewTimer = null;
  let dirty = false;
  let saving = false;
  let editCount = 0;

  const csrf = () => {
    const part = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('zaevi.csrf='));
    return part ? decodeURIComponent(part.slice('zaevi.csrf='.length)) : '';
  };

  async function call(path, method = 'GET', body) {
    const res = await fetch(API + path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 404) {
      window.location.href = '/account.html?next=/admin/studio';
      throw new Error('Please sign in again');
    }
    if (!res.ok) throw new Error(json.error?.message || 'Something went wrong. Please try again.');
    return json.data;
  }

  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? '' : value);
    });
    children.flat().filter(Boolean).forEach((child) => node.appendChild(child));
    return node;
  };

  function setStatus(text, ok) {
    $('saveStatus').textContent = text;
    $('saveStatus').classList.toggle('is-ok', Boolean(ok));
  }
  function showError(message) {
    $('errorBar').textContent = message || '';
    $('errorBar').hidden = !message;
  }

  function syncButtons() {
    $('publishBtn').disabled = saving || !(meta.hasUnpublishedChanges || dirty || !meta.isPublished);
    $('discardBtn').disabled = saving || !(meta.hasUnpublishedChanges || dirty) || !meta.isPublished;
    $('undoBtn').disabled = saving || !meta.canUndo;
  }

  function sendPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      $('preview').contentWindow?.postMessage({ type: 'zaevi:studio:state', state: draft }, window.location.origin);
    }, 80);
  }

  // Keep the names in the section list in step with what is being typed.
  function refreshSectionNames() {
    if (tab !== 'sections') return;
    const names = document.querySelectorAll('.st-list > .st-item .st-item-name strong');
    draft.blocks.forEach((block, index) => {
      if (names[index]) names[index].textContent = blockTitle(block);
    });
  }

  function changed() {
    dirty = true;
    editCount += 1;
    refreshSectionNames();
    setStatus('Saving draft…');
    syncButtons();
    sendPreview();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 800);
  }

  async function saveDraft() {
    clearTimeout(saveTimer);
    const savingEdit = editCount;
    try {
      meta = await call('', 'PUT', { draft });
      showError('');
      // Typing may have continued while this save was on its way; that edit has its own save coming.
      if (savingEdit === editCount) {
        dirty = false;
        setStatus(meta.hasUnpublishedChanges ? 'Draft saved. Not live yet.' : 'Everything is live.', true);
      }
    } catch (error) {
      showError(error.message);
      setStatus('Draft not saved');
    }
    syncButtons();
    return !dirty;
  }

  /* ---------- field builders ---------- */
  async function uploadImage(file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        // Large phone photos are reduced here so they upload quickly and load fast for shoppers.
        let side = MAX_IMAGE_SIDE;
        let quality = 0.84;
        let data = '';
        do {
          const scale = Math.min(1, side / Math.max(image.width, image.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(image.width * scale);
          canvas.height = Math.round(image.height * scale);
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          data = canvas.toDataURL('image/jpeg', quality);
          side -= 300;
          quality -= 0.06;
        } while (data.length > MAX_IMAGE_TEXT_LENGTH && side >= 600);
        URL.revokeObjectURL(url);
        resolve(data);
      };
      image.onerror = () => reject(new Error('That file could not be read as an image.'));
      image.src = url;
    });
    const res = await fetch('/api/admin/cms/media', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf() },
      body: JSON.stringify({ data: dataUrl, mimeType: 'image/jpeg', alt: file.name.slice(0, 200) }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.data?.url) throw new Error(json.error?.message || 'The photo could not be uploaded.');
    return json.data.url;
  }

  function toLocalInput(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function imageField(label, value, onChange) {
    const input = el('input', { type: 'text', value: value || '', placeholder: 'Upload a photo or paste an https:// link' });
    const thumb = el('img', { class: 'st-thumb', alt: '', hidden: !value });
    if (value) thumb.src = value;
    input.addEventListener('input', () => {
      thumb.hidden = !input.value;
      if (input.value) thumb.src = input.value;
      onChange(input.value.trim());
    });
    const picker = el('input', { type: 'file', accept: 'image/*', 'aria-label': `Upload ${label}` });
    const uploadLabel = el('span', { class: 'st-btn st-btn--small', text: 'Upload' });
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      if (!file) return;
      uploadLabel.textContent = 'Uploading…';
      try {
        const url = await uploadImage(file);
        input.value = url;
        thumb.src = url;
        thumb.hidden = false;
        onChange(url);
        showError('');
      } catch (error) {
        showError(error.message);
      }
      uploadLabel.textContent = 'Upload';
      picker.value = '';
    });
    return el('div', { class: 'st-field' },
      el('span', { text: label }),
      el('div', { class: 'st-image-row' }, input, el('div', { class: 'st-upload' }, uploadLabel, picker)),
      thumb);
  }

  function galleryField(block) {
    const wrap = el('div', { class: 'st-field' }, el('span', { text: 'Photos' }));
    const list = el('div');
    const draw = () => {
      list.replaceChildren(...block.images.map((image, index) => {
        const url = el('input', { type: 'text', value: image.url, 'aria-label': `Photo ${index + 1} link` });
        url.addEventListener('input', () => { image.url = url.value.trim(); changed(); });
        const preview = el('img', { alt: '' });
        preview.src = image.url;
        return el('div', { class: 'st-gallery-row' }, preview, url, el('button', {
          type: 'button', class: 'st-icon', text: '×', 'aria-label': `Remove photo ${index + 1}`,
          onclick: () => { block.images.splice(index, 1); draw(); changed(); },
        }));
      }));
    };
    draw();
    const picker = el('input', { type: 'file', accept: 'image/*', multiple: true, 'aria-label': 'Add photos' });
    const label = el('span', { class: 'st-btn st-btn--small', text: 'Add photos' });
    picker.addEventListener('change', async () => {
      label.textContent = 'Uploading…';
      try {
        for (const file of picker.files) {
          if (block.images.length >= 12) break;
          block.images.push({ url: await uploadImage(file), alt: '' });
        }
        draw();
        changed();
        showError('');
      } catch (error) {
        showError(error.message);
      }
      label.textContent = 'Add photos';
      picker.value = '';
    });
    wrap.append(list, el('div', { class: 'st-upload', style: 'display:inline-block' }, label, picker));
    return wrap;
  }

  function fieldFor(target, field) {
    const value = target[field.key];
    const update = (next) => { target[field.key] = next; changed(); };
    if (field.type === 'image') return imageField(field.label, value, update);
    if (field.type === 'gallery') return galleryField(target);
    if (field.type === 'check') {
      return el('label', { class: 'st-check' },
        el('input', { type: 'checkbox', checked: Boolean(value), onchange: (e) => update(e.target.checked) }),
        el('span', { text: field.label }));
    }
    let input;
    if (field.options) {
      input = el('select', { onchange: (e) => update(field.number ? Number(e.target.value) : e.target.value) },
        field.options.map(([optionValue, label]) => el('option', { value: optionValue, selected: String(value) === String(optionValue), text: label })));
    } else if (field.type === 'textarea') {
      input = el('textarea', { oninput: (e) => update(e.target.value) });
      input.value = value || '';
    } else if (field.type === 'datetime') {
      input = el('input', {
        type: 'datetime-local',
        value: toLocalInput(value),
        oninput: (e) => update(e.target.value ? new Date(e.target.value).toISOString() : ''),
      });
    } else {
      input = el('input', { type: 'text', value: value || '', oninput: (e) => update(e.target.value) });
    }
    return el('label', { class: 'st-field' }, el('span', { text: field.label }), input);
  }

  /* ---------- sections tab ---------- */
  function moveBlock(from, to) {
    if (to < 0 || to >= draft.blocks.length || from === to) return;
    const [block] = draft.blocks.splice(from, 1);
    draft.blocks.splice(to, 0, block);
    changed();
    render();
  }

  function blockTitle(block) {
    if (block.type === 'builtin') return BUILTIN_NAMES[block.key] || block.key;
    return BLOCKS[block.type].title(block) || BLOCKS[block.type].name;
  }

  function sectionEditor(block) {
    const def = BLOCKS[block.type];
    return el('div', { class: 'st-editor' },
      def.fields.map((field) => fieldFor(block, field)),
      el('details', { class: 'st-more' },
        el('summary', { text: 'Movement and timing' }),
        fieldFor(block, { key: 'animation', label: 'How it appears', options: APPEAR }),
        fieldFor(block, { key: 'showFrom', label: 'Show from (optional)', type: 'datetime' }),
        fieldFor(block, { key: 'showUntil', label: 'Hide after (optional)', type: 'datetime' })),
      el('div', { class: 'st-editor-actions' },
        el('button', {
          type: 'button', class: 'st-btn st-btn--small', text: 'Duplicate',
          onclick: () => {
            const copy = { ...JSON.parse(JSON.stringify(block)), id: `${block.type}-${Date.now()}` };
            draft.blocks.splice(draft.blocks.indexOf(block) + 1, 0, copy);
            openBlockId = copy.id;
            changed();
            render();
          },
        }),
        el('button', {
          type: 'button', class: 'st-btn st-btn--small st-btn--danger', text: 'Delete',
          onclick: () => {
            if (!window.confirm(`Delete "${blockTitle(block)}"?`)) return;
            draft.blocks.splice(draft.blocks.indexOf(block), 1);
            changed();
            render();
          },
        })));
  }

  let dragIndex = null;
  function sectionItem(block, index) {
    const isBuiltin = block.type === 'builtin';
    const open = openBlockId === block.id && !isBuiltin;
    const item = el('li', { class: `st-item${block.enabled ? '' : ' is-off'}`, draggable: 'true' },
      el('div', { class: 'st-item-head' },
        el('span', { class: 'st-grip', text: '⠿', title: 'Drag to reorder', 'aria-hidden': 'true' }),
        el('button', {
          type: 'button', class: 'st-item-name', 'aria-expanded': isBuiltin ? undefined : String(open),
          onclick: () => {
            if (!isBuiltin) openBlockId = open ? null : block.id;
            $('preview').contentWindow?.postMessage({ type: 'zaevi:studio:focus', id: block.id }, window.location.origin);
            render();
          },
        }, el('strong', { text: blockTitle(block) }), el('span', { text: isBuiltin ? 'Built-in section' : BLOCKS[block.type].name })),
        el('button', { type: 'button', class: 'st-icon', text: '↑', 'aria-label': `Move ${blockTitle(block)} up`, disabled: index === 0, onclick: () => moveBlock(index, index - 1) }),
        el('button', { type: 'button', class: 'st-icon', text: '↓', 'aria-label': `Move ${blockTitle(block)} down`, disabled: index === draft.blocks.length - 1, onclick: () => moveBlock(index, index + 1) }),
        el('label', { class: 'st-switch', title: 'Show or hide' },
          el('input', {
            type: 'checkbox', checked: block.enabled, 'aria-label': `Show ${blockTitle(block)}`,
            onchange: (e) => { block.enabled = e.target.checked; changed(); render(); },
          }), el('i'))));
    if (open) item.appendChild(sectionEditor(block));
    item.addEventListener('dragstart', (e) => {
      if (e.target.closest('input, textarea, select')) { e.preventDefault(); return; }
      dragIndex = index;
      item.classList.add('is-dragging');
    });
    item.addEventListener('dragend', () => { dragIndex = null; item.classList.remove('is-dragging'); });
    item.addEventListener('dragover', (e) => { e.preventDefault(); item.classList.add('is-over'); });
    item.addEventListener('dragleave', () => item.classList.remove('is-over'));
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('is-over');
      if (dragIndex !== null) moveBlock(dragIndex, index);
    });
    return item;
  }

  function renderSections(body) {
    body.append(
      el('p', { class: 'st-help', text: 'Your homepage, from top to bottom. Drag or use the arrows to change the order, and use the switch to show or hide a section.' }),
      el('ul', { class: 'st-list' }, draft.blocks.map(sectionItem)),
      el('div', { class: 'st-add-title', text: 'Add a section' }),
      el('div', { class: 'st-add-grid' }, Object.entries(BLOCKS).map(([type, def]) => el('button', {
        type: 'button', class: 'st-add',
        onclick: () => {
          const block = { id: `${type}-${Date.now()}`, type, enabled: true, animation: 'rise', showFrom: '', showUntil: '', ...def.create() };
          draft.blocks.push(block);
          openBlockId = block.id;
          changed();
          render();
          setTimeout(() => $('preview').contentWindow?.postMessage({ type: 'zaevi:studio:focus', id: block.id }, window.location.origin), 300);
        },
      }, el('strong', { text: `+ ${def.name}` }), el('span', { text: def.help })))));
  }

  /* ---------- other tabs ---------- */
  function renderHero(body) {
    body.append(
      el('p', { class: 'st-help', text: 'The large opening message over the moving silk.' }),
      ...[
        { key: 'eyebrow', label: 'Small heading' },
        { key: 'line1', label: 'Headline, first line' },
        { key: 'line2', label: 'Headline, second line' },
        { key: 'subtitle', label: 'Subtitle' },
        { key: 'ctaLabel', label: 'Button text' },
        { key: 'ctaLink', label: 'Button link, for example collections.html' },
      ].map((field) => fieldFor(draft.hero, field)));
  }

  function renderTicker(body) {
    const items = draft.ticker.items;
    body.append(
      el('p', { class: 'st-help', text: 'The scrolling strip at the very top of every page.' }),
      fieldFor(draft.ticker, { key: 'enabled', label: 'Show the top strip', type: 'check' }),
      fieldFor(draft.ticker, { key: 'speed', label: 'Speed', options: SPEEDS }),
      el('div', {}, items.map((item, index) => el('div', { class: 'st-item', style: 'padding:10px;margin-bottom:8px' },
        fieldFor(item, { key: 'text', label: `Message ${index + 1}` }),
        fieldFor(item, { key: 'link', label: 'Link (optional)' }),
        el('button', {
          type: 'button', class: 'st-btn st-btn--small st-btn--danger', text: 'Remove',
          onclick: () => { items.splice(index, 1); changed(); render(); },
        })))),
      el('button', {
        type: 'button', class: 'st-btn st-btn--wide', text: '+ Add a message',
        onclick: () => { items.push({ text: 'New message', link: '' }); changed(); render(); },
      }));
  }

  function renderLook(body) {
    const look = draft.look;
    body.append(
      el('span', { class: 'st-row-title', text: 'Brand colour' }),
      el('div', { class: 'st-swatches' }, ACCENTS.map(([value, label, colour]) => el('button', {
        type: 'button', class: `st-swatch${look.accent === value ? ' is-on' : ''}`, 'aria-pressed': String(look.accent === value),
        onclick: () => { look.accent = value; changed(); render(); },
      }, el('i', { style: `background:${colour}` }), el('span', { text: label })))),
      fieldFor(look, { key: 'motion', label: 'Background movement', options: [['still', 'Still'], ['calm', 'Calm'], ['normal', 'Normal'], ['lively', 'Lively']] }),
      fieldFor(look, { key: 'silkColor', label: 'Silk colour', options: [['silk', 'Brand colour'], ['monolith', 'Black']] }),
      fieldFor(look, { key: 'silkEnabled', label: 'Show the moving 3D silk', type: 'check' }),
      fieldFor(look, { key: 'monogramEnabled', label: 'Show the 3D logo on the homepage', type: 'check' }),
      el('p', { class: 'st-help', text: 'People who have asked their device to reduce motion always see a still version.' }));
  }

  function render() {
    const body = $('panelBody');
    const scroll = body.scrollTop;
    body.replaceChildren();
    if (tab === 'sections') renderSections(body);
    if (tab === 'hero') renderHero(body);
    if (tab === 'ticker') renderTicker(body);
    if (tab === 'look') renderLook(body);
    body.scrollTop = scroll;
    syncButtons();
  }

  /* ---------- top bar ---------- */
  function liveMessage() {
    if (!meta.isPublished) return 'Not published yet. Your site shows its standard content.';
    return meta.hasUnpublishedChanges ? 'Draft saved. Not live yet.' : 'Everything is live.';
  }

  async function runAction(label, action, done) {
    saving = true;
    syncButtons();
    setStatus(label);
    try {
      await action();
      showError('');
      setStatus(done, true);
    } catch (error) {
      showError(error.message);
      setStatus('That did not work');
    }
    saving = false;
    syncButtons();
  }

  $('publishBtn').addEventListener('click', () => runAction('Publishing…', async () => {
    if (!(await saveDraft())) throw new Error($('errorBar').textContent || 'Please fix the problem above, then publish.');
    meta = await call('/publish', 'POST', {});
    dirty = false;
  }, 'Published. Your changes are live.'));

  async function reload() {
    meta = await call('');
    draft = meta.draft;
    dirty = false;
    openBlockId = null;
    render();
    sendPreview();
  }

  $('undoBtn').addEventListener('click', () => {
    if (!window.confirm('Go back to the version that was live before your last publish?')) return;
    runAction('Going back…', async () => { await call('/undo', 'POST', {}); await reload(); }, 'Done. The previous version is live again.');
  });

  $('discardBtn').addEventListener('click', () => {
    if (!window.confirm('Throw away your unpublished changes?')) return;
    clearTimeout(saveTimer);
    runAction('Discarding…', async () => { await call('/discard', 'POST', {}); await reload(); }, 'Changes discarded.');
  });

  document.querySelectorAll('.st-tab').forEach((button) => button.addEventListener('click', () => {
    tab = button.dataset.tab;
    document.querySelectorAll('.st-tab').forEach((other) => {
      other.classList.toggle('is-on', other === button);
      other.setAttribute('aria-selected', String(other === button));
    });
    render();
  }));

  document.querySelectorAll('[data-device]').forEach((button) => button.addEventListener('click', () => {
    $('previewFrame').classList.toggle('is-phone', button.dataset.device === 'phone');
    document.querySelectorAll('[data-device]').forEach((other) => {
      other.classList.toggle('is-on', other === button);
      other.setAttribute('aria-pressed', String(other === button));
    });
  }));

  window.addEventListener('message', (event) => {
    if (event.origin === window.location.origin && event.data?.type === 'zaevi:studio:ready' && draft) sendPreview();
  });

  window.addEventListener('beforeunload', (event) => {
    if (dirty) event.preventDefault();
  });

  reload().then(() => setStatus(liveMessage(), meta.isPublished && !meta.hasUnpublishedChanges)).catch((error) => showError(error.message));
})();
