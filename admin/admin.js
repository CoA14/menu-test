/* Menu admin: edits content/menu.json, content/settings.json and content/images/.
   Saves to the local test server when one is running, otherwise straight to the GitHub repository. */
(function () {
  'use strict';
  const {
    LANGS, TAGS, SOCIAL, DAYS, translator, localized, plural, linkUrl, socialProfile,
    savedLang, saveLang, esc, formatPrice, getJSON,
  } = window.DM;

  const ROOT = new URL('../', location.href);
  const MENU_PATH = 'content/menu.json';
  const SETTINGS_PATH = 'content/settings.json';
  const IMAGE_DIR = 'content/images/';
  const TOKEN_KEY = 'dm-github';
  const LANG_KEY = 'dm-admin-lang';

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  // The admin page's own language (independent of the language guests pick on the menu).
  let lang = savedLang(LANG_KEY) || 'sr';
  const t = translator(window.ADMIN_STRINGS, () => lang);
  const itemCount = n => `${n} ${plural(n, lang, { sr: ['stavka', 'stavke', 'stavki'], en: ['item', 'items'] })}`;

  let store = null;               // where changes are saved (LocalStore or a GitHubStore)
  let menu = null, settings = null;
  let savedMenu = '', savedSettings = '';
  const pendingImages = new Map(); // path -> Blob, uploaded on publish
  const previewUrls = new Map();   // path -> object URL, for photos that aren't live yet
  let themes = [];
  let editing = null;              // item being edited: { catId, isNew, draft }
  let editingCat = null;           // section being edited: { isNew, draft }
  let busy = false;

  /* ---------- helpers ---------- */

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}`;
  }

  function slug(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'photo';
  }

  function imgSrc(path) {
    return path ? previewUrls.get(path) || new URL(path, ROOT).href : '';
  }

  function readStorage(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }

  function writeStorage(key, value) {
    try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  }

  let toastTimer;
  function toast(message, type = '') {
    const el = $('#toast');
    el.textContent = message;
    el.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, type === 'error' ? 7000 : 3500);
  }

  function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  async function toBase64(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(await data.arrayBuffer());
    return bytesToBase64(bytes);
  }

  function base64ToText(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }

  // Shrinks a photo in the browser so a 5 MB phone picture becomes ~150 KB.
  async function processImage(file, maxSize, keepTransparency) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error(t('badImage')));
        i.src = url;
      });
      const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const encode = (type, quality) => new Promise(r => canvas.toBlob(r, type, quality));
      let blob = await encode('image/webp', 0.82);
      if (!blob || blob.type !== 'image/webp') {
        blob = keepTransparency ? await encode('image/png') : await encode('image/jpeg', 0.85);
      }
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function addPendingImage(blob, baseName) {
    const ext = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }[blob.type] || 'jpg';
    const path = `${IMAGE_DIR}${slug(baseName)}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    pendingImages.set(path, blob);
    previewUrls.set(path, URL.createObjectURL(blob));
    return path;
  }

  function imageRefs(m, s) {
    const refs = new Set();
    (m.categories || []).forEach(c => (c.items || []).forEach(i => i.image && refs.add(i.image)));
    if (s.logo) refs.add(s.logo);
    return refs;
  }

  // Accepts what people type in Serbia and elsewhere: 250, 2,50, 2.50, 1.250, 1.250,50, 1,250.50.
  // Anything that isn't a digit, dot or comma is dropped, so "250 RSD" is also fine.
  function parsePrice(text) {
    let s = text.replace(/[^\d.,]/g, '');
    if (s === '') return null;
    if (s.includes(',') && s.includes('.')) {
      const decimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
      s = s.split(decimal === ',' ? '.' : ',').join('').replace(',', '.');
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');
    }
    return Number(s);
  }

  const isDirty = () => JSON.stringify(menu) !== savedMenu || JSON.stringify(settings) !== savedSettings;
  const findCat = id => menu.categories.find(c => c.id === id);

  /* ---------- storage: local test server ---------- */

  const LocalStore = {
    kind: 'local',
    async load(path) {
      const res = await fetch(new URL(path, ROOT), { cache: 'no-store' });
      if (!res.ok) throw new Error(t('loadFailed', { path, status: res.status }));
      return res.text();
    },
    async publish({ writes, deletes }) {
      for (const { path, data } of writes) await this.request('PUT', path, data);
      for (const path of deletes) await this.request('DELETE', path);
    },
    async request(method, path, body) {
      const res = await fetch(new URL(`api/files?path=${encodeURIComponent(path)}`, ROOT), { method, body });
      if (!res.ok) throw new Error((await res.text()) || t('saveFailed', { path, status: res.status }));
    },
  };

  async function isLocalServer() {
    try {
      const res = await fetch(new URL('api/status', ROOT), { cache: 'no-store' });
      return res.ok && (await res.json()).mode === 'local';
    } catch {
      return false;
    }
  }

  /* ---------- storage: GitHub repository ---------- */

  function GitHubStore(cfg) {
    const base = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
    const branchPath = cfg.branch.split('/').map(encodeURIComponent).join('/');
    const loadedShas = new Map(); // json path -> blob sha when this page loaded it

    async function gh(method, path, body) {
      const res = await fetch(base + path, {
        method,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${cfg.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        let message = t('ghError', { status: res.status });
        try { const j = await res.json(); if (j.message) message += `: ${j.message}`; } catch { /* no body */ }
        if (res.status === 401) message = t('ghBadToken');
        if (res.status === 404 && !path) message = t('ghNotFound');
        const err = new Error(message);
        err.status = res.status;
        throw err;
      }
      return res.status === 204 ? null : res.json();
    }

    const contents = path => `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(cfg.branch)}`;

    return {
      kind: 'github',
      repoName: `${cfg.owner}/${cfg.repo}`,
      async verify() {
        const repo = await gh('GET', '');
        if (!repo.permissions || !repo.permissions.push) throw new Error(t('ghReadOnly'));
      },
      async load(path) {
        const file = await gh('GET', contents(path));
        loadedShas.set(path, file.sha);
        return base64ToText(file.content);
      },
      // Saves every change as a single commit, so the live site rebuilds only once.
      async publish({ writes, deletes }, message) {
        for (const { path } of writes) {
          if (!loadedShas.has(path)) continue;
          const current = await gh('GET', contents(path));
          if (current.sha !== loadedShas.get(path)) {
            throw new Error(t('ghConflict'));
          }
        }
        const ref = await gh('GET', `/git/ref/heads/${branchPath}`);
        const head = await gh('GET', `/git/commits/${ref.object.sha}`);
        const tree = [];
        for (const { path, data } of writes) {
          const blob = await gh('POST', '/git/blobs', { content: await toBase64(data), encoding: 'base64' });
          tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
          if (loadedShas.has(path)) loadedShas.set(path, blob.sha);
        }
        if (deletes.length) {
          const existing = await gh('GET', `/git/trees/${head.tree.sha}?recursive=1`);
          const paths = new Set(existing.tree.map(t => t.path));
          deletes.filter(p => paths.has(p)).forEach(path => tree.push({ path, mode: '100644', type: 'blob', sha: null }));
        }
        const newTree = await gh('POST', '/git/trees', { base_tree: head.tree.sha, tree });
        const commit = await gh('POST', '/git/commits', { message, tree: newTree.sha, parents: [ref.object.sha] });
        await gh('PATCH', `/git/refs/heads/${branchPath}`, { sha: commit.sha });
      },
    };
  }

  // On *.github.io the owner and repository can be read from the address.
  function guessRepo(hint) {
    const host = location.hostname;
    if (host.endsWith('.github.io')) {
      const owner = host.split('.')[0];
      const first = location.pathname.split('/').filter(Boolean)[0];
      return { owner, repo: first && first !== 'admin' ? first : `${owner}.github.io`, branch: 'main' };
    }
    return { owner: hint?.owner || '', repo: hint?.repo || '', branch: hint?.branch || 'main' };
  }

  /* ---------- language ---------- */

  // Fills every data-i18n* element, then redraws the parts built in code.
  function applyLanguage() {
    document.documentElement.lang = lang;
    document.title = t('pageTitle');
    $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
    $$('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
    $$('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    $$('.lang-switch').forEach(el => {
      el.innerHTML = LANGS.map(l => `<span lang="${l}" class="${l === lang ? 'active' : ''}">${l.toUpperCase()}</span>`).join('');
    });
    if (menu) {
      renderStatus();
      fillSettingsForm();
      renderAll();
    }
  }

  // One tap flips between the two languages.
  document.addEventListener('click', e => {
    if (!e.target.closest('.lang-switch')) return;
    lang = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];
    saveLang(LANG_KEY, lang);
    applyLanguage();
  });

  /* ---------- screens ---------- */

  function showScreen(id) {
    ['screen-loading', 'screen-connect', 'screen-main'].forEach(s => { $(`#${s}`).hidden = s !== id; });
  }

  function showConnect(cfg, error) {
    $('#c-owner').value = cfg.owner || '';
    $('#c-repo').value = cfg.repo || '';
    $('#c-branch').value = cfg.branch || 'main';
    $('#c-token').value = '';
    $('#connect-error').hidden = !error;
    $('#connect-error').textContent = error || '';
    showScreen('screen-connect');
  }

  $('#connect-form').addEventListener('submit', async e => {
    e.preventDefault();
    const cfg = {
      owner: $('#c-owner').value.trim(),
      repo: $('#c-repo').value.trim(),
      branch: $('#c-branch').value.trim() || 'main',
      token: $('#c-token').value.trim(),
    };
    const button = e.target.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = t('connecting');
    try {
      const candidate = GitHubStore(cfg);
      await candidate.verify();
      writeStorage(TOKEN_KEY, cfg);
      store = candidate;
      await start();
    } catch (err) {
      $('#connect-error').hidden = false;
      $('#connect-error').textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = t('connect');
    }
  });

  async function init() {
    applyLanguage();
    themes = await loadThemes();
    if (await isLocalServer()) {
      store = LocalStore;
      return start();
    }
    const saved = readStorage(TOKEN_KEY);
    if (saved && saved.token) {
      try {
        store = GitHubStore(saved);
        await store.verify();
        return start();
      } catch (err) {
        return showConnect(saved, err.message);
      }
    }
    let hint = null;
    try { hint = (await getJSON(new URL(SETTINGS_PATH, ROOT))).repo; } catch { /* no settings yet */ }
    showConnect(guessRepo(hint));
  }

  async function loadThemes() {
    try {
      const ids = await getJSON(new URL('themes/index.json', ROOT));
      return Promise.all(ids.map(async id => {
        try { return { id, ...(await getJSON(new URL(`themes/${id}/theme.json`, ROOT))) }; } catch { return { id, name: id }; }
      }));
    } catch {
      return [];
    }
  }

  async function start() {
    const [menuText, settingsText] = await Promise.all([store.load(MENU_PATH), store.load(SETTINGS_PATH)]);
    menu = JSON.parse(menuText);
    settings = JSON.parse(settingsText);
    menu.categories = menu.categories || [];
    menu.categories.forEach(c => { c.items = c.items || []; });
    // Fields added in later versions, so older settings files don't count as "changed" on open.
    ['instagram', 'facebook', 'tiktok', 'website'].forEach(k => { settings[k] = settings[k] || ''; });
    settings.links = Array.isArray(settings.links) ? settings.links : [];
    settings.schedule = Array.isArray(settings.schedule) ? settings.schedule : [];
    settings.location = settings.location || null;
    savedMenu = JSON.stringify(menu);
    savedSettings = JSON.stringify(settings);

    $('#disconnect').hidden = store.kind !== 'github';
    $('#view-link').href = ROOT.href;

    renderStatus();
    fillSettingsForm();
    renderAll();
    showScreen('screen-main');
  }

  function renderStatus() {
    $('#mode-badge').textContent = t(store.kind === 'local' ? 'badgeLocal' : 'badgeLive');
    $('#mode-badge').classList.toggle('live', store.kind === 'github');
    $('#connection-info').textContent = t('savingTo', {
      where: store.kind === 'local' ? t('whereLocal') : t('whereGitHub', { repo: store.repoName }),
    });
  }

  function renderAll() {
    $('#cafe-name').textContent = settings.name || t('tabMenu');
    document.body.classList.toggle('no-english', settings.english === false);
    renderMenu();
    updateSavebar();
  }

  function updateSavebar() {
    const dirty = isDirty();
    $('#savebar').hidden = !dirty;
    document.body.classList.toggle('has-savebar', dirty);
  }

  /* ---------- tabs ---------- */

  $$('.tab').forEach(tab => tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.toggle('active', t === tab));
    $('#tab-menu').hidden = tab.dataset.tab !== 'menu';
    $('#tab-settings').hidden = tab.dataset.tab !== 'settings';
    window.scrollTo(0, 0);
  }));

  /* ---------- menu tab ---------- */

  function renderMenu() {
    const cats = menu.categories;
    $('#tab-menu').innerHTML = `
      ${cats.length ? '' : `
        <div class="empty">
          <h2>${t('emptyTitle')}</h2>
          <p>${t('emptyText')}</p>
        </div>`}
      ${cats.map((c, ci) => `
        <section class="cat-card" data-cat="${esc(c.id)}">
          <header class="cat-bar">
            <button class="cat-title" data-action="cat-edit" type="button">
              <h2>${esc(c.name)}</h2>
              <span class="count">${itemCount(c.items.length)} · ${t('edit')}</span>
            </button>
            <div class="btn-row">
              <button class="icon-btn" data-action="cat-up" type="button" aria-label="${t('moveSectionUp')}" ${ci === 0 ? 'disabled' : ''}>↑</button>
              <button class="icon-btn" data-action="cat-down" type="button" aria-label="${t('moveSectionDown')}" ${ci === cats.length - 1 ? 'disabled' : ''}>↓</button>
            </div>
          </header>
          <ul class="item-list">
            ${c.items.map((it, ii) => `
              <li class="item-row${it.available === false ? ' is-off' : ''}" data-item="${esc(it.id)}">
                <button class="item-main" data-action="item-edit" type="button">
                  ${it.image ? `<img src="${esc(imgSrc(it.image))}" alt="">` : `<span class="noimg">${esc((it.name || '?').charAt(0))}</span>`}
                  <span class="item-text">
                    <strong>${esc(it.name)}</strong>
                    <span>${esc(formatPrice(it.price, settings)) || '—'}${it.available === false ? ` · <em>${t('soldOut')}</em>` : ''}</span>
                  </span>
                </button>
                <label class="switch" title="${t('available')}"><input type="checkbox" data-action="item-toggle" ${it.available !== false ? 'checked' : ''} aria-label="${t('available')}"><span></span></label>
                <div class="reorder">
                  <button class="icon-btn sm" data-action="item-up" type="button" aria-label="${t('moveUp')}" ${ii === 0 ? 'disabled' : ''}>↑</button>
                  <button class="icon-btn sm" data-action="item-down" type="button" aria-label="${t('moveDown')}" ${ii === c.items.length - 1 ? 'disabled' : ''}>↓</button>
                </div>
              </li>`).join('')}
          </ul>
          <button class="add-btn" data-action="item-add" type="button">${t('addItem')}</button>
        </section>`).join('')}
      <button class="add-btn big" data-action="cat-add" type="button">${t('addSection')}</button>`;
  }

  function move(list, index, delta) {
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
  }

  $('#tab-menu').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.dataset.action === 'item-toggle') return;
    const catEl = btn.closest('[data-cat]');
    const cat = catEl && findCat(catEl.dataset.cat);
    const itemEl = btn.closest('[data-item]');
    const itemIndex = itemEl ? cat.items.findIndex(i => i.id === itemEl.dataset.item) : -1;
    const catIndex = cat ? menu.categories.indexOf(cat) : -1;

    switch (btn.dataset.action) {
      case 'cat-add': return openCatDialog(null);
      case 'cat-edit': return openCatDialog(cat);
      case 'cat-up': move(menu.categories, catIndex, -1); break;
      case 'cat-down': move(menu.categories, catIndex, 1); break;
      case 'item-add': return openItemDialog(cat, null);
      case 'item-edit': return openItemDialog(cat, cat.items[itemIndex]);
      case 'item-up': move(cat.items, itemIndex, -1); break;
      case 'item-down': move(cat.items, itemIndex, 1); break;
    }
    renderAll();
  });

  $('#tab-menu').addEventListener('change', e => {
    if (e.target.dataset.action !== 'item-toggle') return;
    const cat = findCat(e.target.closest('[data-cat]').dataset.cat);
    const item = cat.items.find(i => i.id === e.target.closest('[data-item]').dataset.item);
    item.available = e.target.checked;
    renderAll();
  });

  /* ---------- section dialog ---------- */

  function openCatDialog(cat) {
    editingCat = { isNew: !cat, draft: cat || { id: uid('c'), name: '', nameEn: '', description: '', descriptionEn: '', items: [] } };
    $('#cat-dialog-title').textContent = t(cat ? 'editSection' : 'newSection');
    $('#s-name').value = editingCat.draft.name;
    $('#s-desc').value = editingCat.draft.description || '';
    $('#s-name-en').value = editingCat.draft.nameEn || '';
    $('#s-desc-en').value = editingCat.draft.descriptionEn || '';
    $('#cat-delete').hidden = !cat;
    $('#cat-dialog').showModal();
    if (!cat) $('#s-name').focus();
  }

  $('#cat-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!e.target.reportValidity()) return;
    const d = editingCat.draft;
    d.name = $('#s-name').value.trim();
    d.description = $('#s-desc').value.trim();
    d.nameEn = $('#s-name-en').value.trim();
    d.descriptionEn = $('#s-desc-en').value.trim();
    if (editingCat.isNew) menu.categories.push(d);
    $('#cat-dialog').close();
    renderAll();
  });

  $('#cat-delete').addEventListener('click', () => {
    const cat = editingCat.draft;
    const n = cat.items.length;
    if (!confirm(n ? t('confirmDeleteSection', { name: cat.name, count: itemCount(n) }) : t('confirmDelete', { name: cat.name }))) return;
    menu.categories = menu.categories.filter(c => c !== cat);
    $('#cat-dialog').close();
    renderAll();
  });

  /* ---------- item dialog ---------- */

  function renderPhoto() {
    const path = editing.draft.image;
    $('#f-photo').innerHTML = path ? `<img src="${esc(imgSrc(path))}" alt="">` : `<span>${t('noPhoto')}</span>`;
    $('#f-photo-remove').hidden = !path;
  }

  function openItemDialog(cat, item) {
    editing = {
      catId: cat.id,
      isNew: !item,
      draft: item
        ? { ...item, tags: [...(item.tags || [])] }
        : { id: uid('i'), name: '', nameEn: '', description: '', descriptionEn: '', price: null, size: '', image: '', tags: [], available: true },
    };
    const d = editing.draft;
    $('#item-dialog-title').textContent = t(item ? 'editItem' : 'newItem');
    $('#f-name').value = d.name;
    $('#f-desc').value = d.description || '';
    $('#f-name-en').value = d.nameEn || '';
    $('#f-desc-en').value = d.descriptionEn || '';
    $('#f-price').value = d.price == null || d.price === '' ? '' : String(d.price);
    $('#f-currency').textContent = settings.currency || '';
    // Size is stored as one text ("250 g"); the form splits it into number and unit.
    const size = /^(.*?)\s*(ml|l|g|kg|kom|cm)$/i.exec(d.size || '');
    $('#f-size').value = size && size[1] ? size[1] : d.size || '';
    $('#f-unit').value = size && size[1] ? size[2].toLowerCase() : '';
    $('#f-cat').innerHTML = menu.categories.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    $('#f-cat').value = cat.id;
    $('#f-tags').innerHTML = Object.entries(TAGS).map(([key, tag]) => `
      <label class="tag-opt"><input type="checkbox" value="${key}" ${d.tags.includes(key) ? 'checked' : ''}><span>${tag.icon} ${tag[lang]}</span></label>`).join('');
    $('#f-available').checked = d.available !== false;
    $('#item-delete').hidden = !item;
    renderPhoto();
    $('#item-dialog').showModal();
    $('#item-dialog .dialog-body').scrollTop = 0;
    if (!item) $('#f-name').focus();
  }

  $('#f-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const blob = await processImage(file, 1200, false);
      editing.draft.image = addPendingImage(blob, $('#f-name').value || 'photo');
      renderPhoto();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#f-photo-remove').addEventListener('click', () => {
    editing.draft.image = '';
    renderPhoto();
  });

  $('#item-form').addEventListener('submit', e => {
    e.preventDefault();
    const price = parsePrice($('#f-price').value);
    $('#f-price').setCustomValidity(price !== null && (isNaN(price) || price < 0) ? t('priceInvalid') : '');
    if (!e.target.reportValidity()) return;

    const d = editing.draft;
    d.name = $('#f-name').value.trim();
    d.description = $('#f-desc').value.trim();
    d.nameEn = $('#f-name-en').value.trim();
    d.descriptionEn = $('#f-desc-en').value.trim();
    d.price = price;
    const amount = $('#f-size').value.trim();
    d.size = amount && $('#f-unit').value ? `${amount} ${$('#f-unit').value}` : amount;
    d.tags = $$('#f-tags input:checked').map(i => i.value);
    d.available = $('#f-available').checked;

    const from = findCat(editing.catId);
    const to = findCat($('#f-cat').value);
    const index = from.items.findIndex(i => i.id === d.id);
    if (index >= 0 && from === to) {
      from.items[index] = d;
    } else {
      if (index >= 0) from.items.splice(index, 1);
      to.items.push(d);
    }
    $('#item-dialog').close();
    renderAll();
  });

  $('#item-delete').addEventListener('click', () => {
    const d = editing.draft;
    if (!confirm(t('confirmDelete', { name: d.name }))) return;
    const cat = findCat(editing.catId);
    cat.items = cat.items.filter(i => i.id !== d.id);
    $('#item-dialog').close();
    renderAll();
  });

  $$('dialog').forEach(dialog => {
    dialog.addEventListener('click', e => {
      if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
    });
  });

  /* ---------- settings tab ---------- */

  const settingsForm = $('#settings-form');

  function fillSettingsForm() {
    $$('[name]', settingsForm).forEach(field => {
      const value = settings[field.name];
      field.value = value == null ? '' : String(value);
    });
    $('#theme-field').hidden = themes.length < 2;
    $('#theme-select').innerHTML = themes.map(th => `<option value="${esc(th.id)}">${esc(localized(th, 'name', lang) || th.id)}</option>`).join('');
    $('#english-on').checked = settings.english !== false;
    $('#theme-select').value = settings.theme || (themes[0] && themes[0].id) || '';
    $('#accent-on').checked = !!settings.accent;
    $('#accent-color').value = settings.accent || '#b5651d';
    $('#accent-color').disabled = !settings.accent;
    renderLogo();
    renderLinks();
    renderSchedule();
    renderMapStatus();
    $$('[data-link-kind]', settingsForm).forEach(checkLink);
    renderPriceExample();
  }

  /* ---------- links ---------- */

  // Shows the warning under a link field when what's typed can't become a link.
  function checkLink(input) {
    const warn = input.parentElement.querySelector('.field-warn');
    if (warn) warn.hidden = !input.value.trim() || !!linkUrl(input.value, input.dataset.linkKind);
  }

  // Social fields are tidied when the owner leaves them: full link, no tracking junk (?igsh=…).
  settingsForm.addEventListener('change', e => {
    const field = e.target;
    const p = field.name in SOCIAL && socialProfile(field.value, field.name);
    if (p && p.url !== field.value) {
      field.value = settings[field.name] = p.url;
      renderAll();
    }
  });

  // The owner's own links (name + link), e.g. Google reviews or a delivery app.
  function renderLinks() {
    $('#links-list').innerHTML = settings.links.map((l, i) => `
      <div class="link-row">
        <input data-link="${i}" data-key="label" value="${esc(l.label)}" placeholder="${esc(t('linkNamePlaceholder'))}" aria-label="${esc(t('linkName'))}" maxlength="40">
        <input data-link="${i}" data-key="url" data-link-kind="link" value="${esc(l.url)}" type="url" inputmode="url" placeholder="https://…" aria-label="${esc(t('linkUrl'))}" autocapitalize="off" spellcheck="false">
        <button class="icon-btn" type="button" data-remove="${i}" aria-label="${esc(t('removeLink'))}">×</button>
        <small class="field-warn" hidden>${esc(t('linkWarn'))}</small>
      </div>`).join('');
  }

  /* ---------- opening hours ---------- */

  function renderSchedule() {
    const names = DAYS[lang].names;
    const dayOptions = sel => names.map((n, d) => `<option value="${d}"${d === sel ? ' selected' : ''}>${n}</option>`).join('');
    $('#schedule').innerHTML = settings.schedule.map((r, i) => `
      <div class="sched-row${r.closed ? ' is-closed' : ''}">
        <select data-sched="${i}" data-key="from" aria-label="${esc(t('dayFrom'))}">${dayOptions(r.from)}</select>
        <span class="dash">–</span>
        <select data-sched="${i}" data-key="to" aria-label="${esc(t('dayTo'))}">${dayOptions(r.to)}</select>
        <input type="time" data-sched="${i}" data-key="open" value="${esc(r.open)}" aria-label="${esc(t('openAt'))}" ${r.closed ? 'disabled' : ''}>
        <span class="dash">–</span>
        <input type="time" data-sched="${i}" data-key="close" value="${esc(r.close)}" aria-label="${esc(t('closeAt'))}" ${r.closed ? 'disabled' : ''}>
        <div class="sched-foot">
          <label class="check"><input type="checkbox" data-sched="${i}" data-key="closed" ${r.closed ? 'checked' : ''}> ${esc(t('closedDay'))}</label>
          <button class="link-btn" type="button" data-sched-remove="${i}">${esc(t('removeRow'))}</button>
        </div>
      </div>`).join('');
    const legacy = !settings.schedule.length && settings.hours;
    $('#hours-legacy').hidden = !legacy;
    $('#hours-legacy').textContent = legacy ? t('legacyHours', { text: legacy.replace(/\n/g, ', ') }) : '';
  }

  // A new row continues from the day after the last one, with the same times.
  $('#schedule-add').addEventListener('click', () => {
    const last = settings.schedule[settings.schedule.length - 1];
    settings.schedule.push(last
      ? { from: Math.min(last.to + 1, 6), to: 6, open: last.open, close: last.close, closed: false }
      : { from: 0, to: 4, open: '08:00', close: '22:00', closed: false });
    renderSchedule();
    renderAll();
  });

  $('#schedule').addEventListener('click', e => {
    const btn = e.target.closest('[data-sched-remove]');
    if (!btn) return;
    settings.schedule.splice(Number(btn.dataset.schedRemove), 1);
    renderSchedule();
    renderAll();
  });

  function updateSchedule(field) {
    const row = settings.schedule[Number(field.dataset.sched)];
    const key = field.dataset.key;
    if (key === 'closed') {
      row.closed = field.checked;
      renderSchedule();
    } else {
      row[key] = key === 'from' || key === 'to' ? Number(field.value) : field.value;
    }
  }

  /* ---------- address on the map (Leaflet + OpenStreetMap, loaded on first use) ---------- */

  const NOMINATIM = 'https://nominatim.openstreetmap.org/';
  let leafletReady = null, map = null, marker = null, picked = null;
  let pickedAddress = null;   // address parts from a search hit, until the pin is moved by hand

  function loadLeaflet() {
    if (!leafletReady) {
      leafletReady = new Promise((resolve, reject) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
        document.head.appendChild(css);
        const js = document.createElement('script');
        js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
        js.onload = () => resolve(window.L);
        js.onerror = () => { leafletReady = null; js.remove(); reject(new Error(t('mapLoadFailed'))); };
        document.head.appendChild(js);
      });
    }
    return leafletReady;
  }

  function renderMapStatus() {
    $('#map-status').textContent = t(settings.location ? 'mapSet' : 'mapNotSet');
    $('#map-clear').hidden = !settings.location;
  }

  function placePin(latlng, pan = true, address = null) {
    pickedAddress = address;
    picked = { lat: Number(Number(latlng.lat).toFixed(7)), lng: Number(Number(latlng.lng).toFixed(7)) };
    if (!marker) {
      const icon = window.L.divIcon({ className: 'map-pin', iconSize: [28, 28], iconAnchor: [14, 34] });
      marker = window.L.marker(picked, { draggable: true, icon }).addTo(map);
      marker.on('dragend', () => placePin(marker.getLatLng(), false));
    } else {
      marker.setLatLng(picked);
    }
    if (pan) map.panTo(picked);
  }

  async function nominatim(path) {
    const res = await fetch(`${NOMINATIM}${path}&format=jsonv2&accept-language=sr-Latn,sr,en`);
    if (!res.ok) throw new Error(t('mapNotFound'));
    return res.json();
  }

  $('#map-open').addEventListener('click', async () => {
    $('#map-q').value = settings.address || '';
    $('#map-results').innerHTML = '';
    $('#map-here').hidden = !(window.isSecureContext && navigator.geolocation);
    $('#map-dialog').showModal();
    try {
      await loadLeaflet();
    } catch (err) {
      $('#map-dialog').close();
      return toast(err.message, 'error');
    }
    const start = settings.location || { lat: 44.8125, lng: 20.4612 };   // Belgrade until something is picked
    const zoom = settings.location ? 17 : 12;
    if (!map) {
      map = window.L.map('map').setView(start, zoom);
      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
      map.on('click', e => placePin(e.latlng, false));
    } else {
      map.setView(start, zoom);
    }
    picked = null;
    if (marker) { marker.remove(); marker = null; }
    if (settings.location) placePin(settings.location, false);
    setTimeout(() => map.invalidateSize(), 60);
  });

  function goTo(hit) {
    $('#map-results').innerHTML = '';
    map.setView([hit.lat, hit.lon], 18);
    placePin({ lat: hit.lat, lng: hit.lon }, false, hit.address);
  }

  // Places near what the map shows come first. The same street name exists in many towns,
  // so with several matches the owner picks the right one from a short list.
  let searchHits = [];
  async function findOnMap() {
    const q = $('#map-q').value.trim();
    if (!q || !map) return;
    try {
      const b = map.getBounds();
      const box = [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].map(n => n.toFixed(4)).join(',');
      searchHits = await nominatim(`search?q=${encodeURIComponent(q)}&limit=5&viewbox=${box}&addressdetails=1`);
      if (!searchHits.length) throw new Error(t('mapNotFound'));
      if (searchHits.length === 1) return goTo(searchHits[0]);
      $('#map-results').innerHTML = searchHits.map((h, i) => {
        const parts = h.display_name.split(', ');
        return `<li><button type="button" data-hit="${i}"><strong>${esc(parts.slice(0, 2).join(', '))}</strong><span>${esc(parts.slice(2, 5).join(', '))}</span></button></li>`;
      }).join('');
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  $('#map-results').addEventListener('click', e => {
    const btn = e.target.closest('[data-hit]');
    if (btn) goTo(searchHits[Number(btn.dataset.hit)]);
  });
  $('#map-find').addEventListener('click', findOnMap);
  $('#map-q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findOnMap(); } });

  $('#map-here').addEventListener('click', () => {
    navigator.geolocation.getCurrentPosition(
      pos => { map.setView([pos.coords.latitude, pos.coords.longitude], 18); placePin({ lat: pos.coords.latitude, lng: pos.coords.longitude }, false); },
      () => toast(t('mapNoGps'), 'error'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });

  // Saves the pin, then fills the address from it (street and number, city) for the owner to correct.
  $('#map-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!picked) return toast(t('mapPickFirst'), 'error');
    settings.location = picked;
    $('#map-dialog').close();
    try {
      // A pin on a building outline can come back without a street, so ask again at street level.
      // Without a street the typed address is kept rather than replaced by just the city.
      let a = pickedAddress || {};
      for (const zoom of [18, 17, 16]) {
        if (a.road || a.pedestrian || a.square) break;
        a = (await nominatim(`reverse?lat=${picked.lat}&lon=${picked.lng}&zoom=${zoom}&addressdetails=1`)).address || {};
      }
      const street = a.road || a.pedestrian || a.square || '';
      const place = a.city || a.town || a.village || a.municipality || '';
      const text = street ? [a.house_number ? `${street} ${a.house_number}` : street, place].filter(Boolean).join(', ') : '';
      if (text) {
        settings.address = text;
        $('#address-input').value = text;
        toast(t('mapAddressFilled'), 'success');
        $('#address-input').focus();
      }
    } catch { /* keep the typed address */ }
    renderMapStatus();
    renderAll();
  });

  $('#map-clear').addEventListener('click', () => {
    settings.location = null;
    renderMapStatus();
    renderAll();
  });

  $('#link-add').addEventListener('click', () => {
    settings.links.push({ label: '', url: '' });
    renderLinks();
    renderAll();
    $(`#links-list [data-link="${settings.links.length - 1}"]`).focus();
  });

  $('#links-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    settings.links.splice(Number(btn.dataset.remove), 1);
    renderLinks();
    renderAll();
  });

  function renderLogo() {
    $('#logo-preview').innerHTML = settings.logo ? `<img src="${esc(imgSrc(settings.logo))}" alt="">` : `<span>${t('none')}</span>`;
    $('#logo-remove').hidden = !settings.logo;
  }

  function renderPriceExample() {
    $('#price-example').textContent = `${formatPrice(2.5, settings)} · ${formatPrice(1250, settings)}`;
  }

  settingsForm.addEventListener('input', e => {
    const field = e.target;
    if (field.dataset.linkKind) checkLink(field);
    if (field.dataset.sched) {
      updateSchedule(field);
    } else if (field.dataset.link) {
      settings.links[Number(field.dataset.link)][field.dataset.key] = field.value;
    } else if (field.name) {
      settings[field.name] = field.name === 'priceDecimals' ? Number(field.value) : field.value;
    } else if (field.id === 'accent-on' || field.id === 'accent-color') {
      $('#accent-color').disabled = !$('#accent-on').checked;
      settings.accent = $('#accent-on').checked ? $('#accent-color').value : '';
    } else if (field.id === 'english-on') {
      settings.english = field.checked;
    }
    renderPriceExample();
    renderAll();
  });

  $('#logo-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      settings.logo = addPendingImage(await processImage(file, 600, true), 'logo');
      renderLogo();
      renderAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#logo-remove').addEventListener('click', () => {
    settings.logo = '';
    renderLogo();
    renderAll();
  });

  $('#disconnect').addEventListener('click', () => {
    if (isDirty() && !confirm(t('confirmDisconnect'))) return;
    writeStorage(TOKEN_KEY, null);
    location.reload();
  });

  /* ---------- save & publish ---------- */

  $('#discard').addEventListener('click', () => {
    if (!confirm(t('confirmDiscard'))) return;
    menu = JSON.parse(savedMenu);
    settings = JSON.parse(savedSettings);
    pendingImages.clear();
    fillSettingsForm();
    renderAll();
  });

  $('#publish').addEventListener('click', async () => {
    if (busy) return;
    if (!settings.name || !settings.name.trim()) {
      toast(t('needName'), 'error');
      return;
    }
    busy = true;
    const button = $('#publish');
    button.disabled = true;
    button.textContent = t('saving');
    try {
      // Rows the owner added but left completely empty aren't worth saving.
      settings.links = settings.links.filter(l => l.label.trim() || l.url.trim());
      renderLinks();
      const before = imageRefs(JSON.parse(savedMenu), JSON.parse(savedSettings));
      const after = imageRefs(menu, settings);
      const writes = [];
      for (const [path, blob] of pendingImages) if (after.has(path)) writes.push({ path, data: blob });
      if (JSON.stringify(menu) !== savedMenu) writes.push({ path: MENU_PATH, data: JSON.stringify(menu, null, 2) + '\n' });
      if (JSON.stringify(settings) !== savedSettings) writes.push({ path: SETTINGS_PATH, data: JSON.stringify(settings, null, 2) + '\n' });
      const deletes = [...before].filter(p => !after.has(p) && p.startsWith(IMAGE_DIR));

      if (writes.length || deletes.length) await store.publish({ writes, deletes }, 'Update menu from admin');

      pendingImages.clear();
      savedMenu = JSON.stringify(menu);
      savedSettings = JSON.stringify(settings);
      toast(t(store.kind === 'github' ? 'published' : 'savedLocal'), 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = t('publish');
      updateSavebar();
    }
  });

  window.addEventListener('beforeunload', e => {
    if (menu && isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  init().catch(err => {
    console.error(err);
    $('#screen-loading').innerHTML = `<div class="panel"><h1>${t('errorTitle')}</h1><p>${esc(err.message)}</p><button class="btn primary" onclick="location.reload()">${t('tryAgain')}</button></div>`;
  });
})();
