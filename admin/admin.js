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

  function addPendingImage(blob, baseName) {
    const ext = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }[blob.type] || 'jpg';
    const path = `${IMAGE_DIR}${slug(baseName)}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    pendingImages.set(path, blob);
    previewUrls.set(path, URL.createObjectURL(blob));
    return path;
  }

  function imageRefs(m, s) {
    const refs = new Set();
    (m.categories || []).forEach(c => {
      if (c.image) refs.add(c.image);
      (c.items || []).forEach(i => i.image && refs.add(i.image));
    });
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
      if (!$('#tab-qr').hidden) renderQr();
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
    ImageEditor.init(t);
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
    settings.featured = !!settings.featured;
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
    ['menu', 'settings', 'qr', 'help'].forEach(id => { $(`#tab-${id}`).hidden = tab.dataset.tab !== id; });
    if (tab.dataset.tab === 'qr') renderQr();
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
    editingCat.image = editingCat.draft.image || '';
    renderCatPhoto();
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
    d.image = editingCat.image;
    d.descriptionEn = $('#s-desc-en').value.trim();
    if (editingCat.isNew) menu.categories.push(d);
    $('#cat-dialog').close();
    renderAll();
  });

  function renderCatPhoto() {
    $('#s-photo').innerHTML = editingCat.image ? `<img src="${esc(imgSrc(editingCat.image))}" alt="">` : `<span>${t('none')}</span>`;
    $('#s-photo-remove').hidden = !editingCat.image;
  }

  $('#s-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      // Section photos show as square tiles.
      const blob = await ImageEditor.crop(file, { aspect: 1, guide: false, size: 1000 });
      if (!blob) return;
      editingCat.image = addPendingImage(blob, $('#s-name').value || 'section');
      renderCatPhoto();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#s-photo-remove').addEventListener('click', () => {
    editingCat.image = '';
    renderCatPhoto();
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
      // 4:3 like the cards and the opened item; the list shows its middle square.
      const blob = await ImageEditor.crop(file, { aspect: 4 / 3, guide: true, size: 1200 });
      if (!blob) return;
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
    $('#featured-on').checked = !!settings.featured;
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
    } else if (field.id === 'featured-on') {
      settings.featured = field.checked;
    }
    renderPriceExample();
    renderAll();
  });

  $('#logo-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const blob = await ImageEditor.logo(file, { menuBg: menuColors().bg, qrInk: qrColors().ink });
      if (!blob) return;
      settings.logo = addPendingImage(blob, 'logo');
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

  /* ---------- QR code (qrcode-generator, loaded on first use) ---------- */

  const QR_KEY = 'dm-qr';
  const QR_STYLES = { square: 'qrSquare', rounded: 'qrRounded', dots: 'qrDots' };
  let qrReady = null;
  // font: '' = the menu's own font, a pairing id from core/fonts.json, or 'system'.
  const qrPrefs = { style: 'rounded', card: false, colors: 'menu', font: '', logo: true, name: false, captionOn: true, caption: '', ...readStorage(QR_KEY) };
  if (qrPrefs.style === 'frame') Object.assign(qrPrefs, { style: 'rounded', card: true });   // older saved choice

  function loadQrLibrary() {
    if (!qrReady) {
      qrReady = new Promise((resolve, reject) => {
        const js = document.createElement('script');
        js.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
        js.onload = () => resolve(window.qrcode);
        js.onerror = () => { qrReady = null; js.remove(); reject(new Error(t('qrFailed'))); };
        document.head.appendChild(js);
      });
    }
    return qrReady;
  }

  // Contrast between two #rrggbb colours (WCAG formula).
  function contrast(a, b) {
    const lum = hex => {
      const h = hex.replace('#', '');
      const full = h.length === 3 ? [...h].map(c => c + c).join('') : h.slice(0, 6);
      const [r, g, bl] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255)
        .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }

  // Colours from the menu: the brand colour or the design's colour scheme. The QR dots always get
  // a colour dark enough to scan reliably on white; otherwise near-black.
  // The menu's background and main colour, from its design's colour scheme.
  function menuColors() {
    const theme = themes.find(th => th.id === settings.theme) || {};
    const palette = (theme.palettes || []).find(p => p.id === (settings.palette || 'original')) || (theme.palettes || [])[0];
    const swatch = palette ? palette.swatch : [];
    const hex = c => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c);
    return { bg: hex(swatch[0]) ? swatch[0] : '#ffffff', swatch: swatch.filter(hex), accent: hex(settings.accent) ? settings.accent : '' };
  }

  function qrColors() {
    const { swatch, accent } = menuColors();
    const candidates = [accent, swatch[1], swatch[0]].filter(Boolean);
    if (qrPrefs.colors === 'black' || !candidates.length) return { ink: '#111111', frame: '#111111', frameText: '#ffffff' };
    const ink = candidates.find(c => contrast(c, '#ffffff') >= 4.5) || '#1a1a1a';
    const frame = candidates[0];
    return { ink, frame, frameText: contrast(frame, '#ffffff') >= 3 ? '#ffffff' : '#1a1a1a' };
  }

  // Centres of the alignment squares per QR version (from the QR standard), up to version 10.
  const ALIGNMENT = {
    2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
    ctx.fill();
  }

  // Which modules belong to the three corner squares, and to the small alignment squares (5×5),
  // which stay solid in the dots style or scanners lose them.
  function qrRegions(n) {
    const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    const align = [];
    const pos = ALIGNMENT[(n - 17) / 4] || [];
    for (const r of pos) for (const c of pos) if (!finder(r, c)) align.push([r - 2, c - 2]);
    const inAlign = (r, c) => align.some(([ar, ac]) => r >= ar && r < ar + 5 && c >= ac && c < ac + 5);
    return { finder, inAlign };
  }

  // Draws the QR modules into a square of `size` px at (x, y), including the white quiet zone.
  function drawQr(ctx, qr, x, y, size, style, ink) {
    const n = qr.getModuleCount();
    // Whole-pixel squares (4 modules of quiet zone on each side): crisp edges scan and print best.
    const cell = Math.floor(size / (n + 8));
    const ox = x + Math.round((size - cell * n) / 2), oy = y + Math.round((size - cell * n) / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = ink;
    const { finder, inAlign } = qrRegions(n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c) || finder(r, c)) continue;
        if (style === 'dots' && inAlign(r, c)) {
          ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
          continue;
        }
        const px = ox + c * cell, py = oy + r * cell;
        if (style === 'dots') {
          ctx.beginPath();
          ctx.arc(px + cell / 2, py + cell / 2, cell * 0.43, 0, Math.PI * 2);
          ctx.fill();
        } else if (style === 'rounded') {
          // Rounded outside, joined to dark neighbours (thin gaps between squares confuse scanners).
          roundRect(ctx, px, py, cell, cell, cell * 0.4);
          if (c + 1 < n && qr.isDark(r, c + 1) && !finder(r, c + 1)) ctx.fillRect(px + cell / 2, py, cell, cell);
          if (r + 1 < n && qr.isDark(r + 1, c) && !finder(r + 1, c)) ctx.fillRect(px, py + cell / 2, cell, cell);
        } else {
          ctx.fillRect(px, py, cell, cell);
        }
      }
    }
    // The three corner squares, drawn whole so they stay crisp (scanners look for them first).
    const radius = style === 'square' ? 0 : cell * 1.6;
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      const px = ox + c * cell, py = oy + r * cell;
      ctx.fillStyle = ink;
      roundRect(ctx, px, py, cell * 7, cell * 7, radius);
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, px + cell, py + cell, cell * 5, cell * 5, radius * 0.7);
      ctx.fillStyle = ink;
      roundRect(ctx, px + cell * 2, py + cell * 2, cell * 3, cell * 3, radius * 0.5);
    }
  }

  /* Vector version of the code for a laser engraver or a print shop: black, in the chosen style,
     50 mm including the quiet zone, with the logo in the middle when it's on. Shapes never overlap
     (engraving software can read overlaps as holes): squares and rounded squares are traced into
     outlines, dots are separate circles. */
  let lastQr = null;

  // Outlines around the "on" cells, each a list of corners; dark is on the right of every edge,
  // so outer edges run clockwise and holes the other way.
  function traceCells(isOn, n) {
    const out = new Map();
    const add = (x1, y1, x2, y2) => {
      const key = `${x1},${y1}`;
      if (!out.has(key)) out.set(key, []);
      out.get(key).push([x2, y2]);
    };
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!isOn(r, c)) continue;
        if (!isOn(r - 1, c)) add(c, r, c + 1, r);
        if (!isOn(r, c + 1)) add(c + 1, r, c + 1, r + 1);
        if (!isOn(r + 1, c)) add(c + 1, r + 1, c, r + 1);
        if (!isOn(r, c - 1)) add(c, r + 1, c, r);
      }
    }
    const loops = [];
    for (const [start, edges] of out) {
      while (edges.length) {
        const [sx, sy] = start.split(',').map(Number);
        const pts = [[sx, sy]];
        let x = sx, y = sy, dir = null;
        do {
          const next = out.get(`${x},${y}`);
          // Two cells touching only at a corner: turn right, so each keeps its own outline.
          let i = 0;
          if (dir && next.length > 1) {
            const j = next.findIndex(([nx, ny]) => nx - x === -dir[1] && ny - y === dir[0]);
            if (j >= 0) i = j;
          }
          const [nx, ny] = next.splice(i, 1)[0];
          dir = [nx - x, ny - y];
          x = nx;
          y = ny;
          pts.push([x, y]);
        } while (x !== sx || y !== sy);
        // Keep only the corners (where the direction changes).
        const k = pts.length - 1;
        const corners = [];
        for (let i = 0; i < k; i++) {
          const [px, py] = pts[(i - 1 + k) % k], [cx, cy] = pts[i], [qx, qy] = pts[i + 1];
          const din = [cx - px, cy - py], dout = [qx - cx, qy - cy];
          if (din[0] !== dout[0] || din[1] !== dout[1]) corners.push({ x: cx, y: cy, din, dout });
        }
        loops.push(corners);
      }
    }
    return loops;
  }

  // One outline as SVG path data, outward corners rounded by `radius` (inward ones stay sharp).
  function outlinePath(corners, radius, shift) {
    const f = v => +(v + shift).toFixed(3);
    const parts = corners.map(({ x, y, din, dout }) => {
      const r = din[0] * dout[1] - din[1] * dout[0] > 0 ? radius : 0;
      return { a: [x - din[0] * r, y - din[1] * r], b: [x + dout[0] * r, y + dout[1] * r], r };
    });
    let d = `M${f(parts[0].b[0])} ${f(parts[0].b[1])}`;
    for (let i = 1; i <= parts.length; i++) {
      const p = parts[i % parts.length];
      d += `L${f(p.a[0])} ${f(p.a[1])}`;
      if (p.r) d += `A${p.r} ${p.r} 0 0 1 ${f(p.b[0])} ${f(p.b[1])}`;
    }
    return `${d}Z`;
  }

  function roundRectPath(x, y, size, r) {
    if (!r) return `M${x} ${y}h${size}v${size}h${-size}Z`;
    const s = size - 2 * r;
    return `M${x + r} ${y}h${s}a${r} ${r} 0 0 1 ${r} ${r}v${s}a${r} ${r} 0 0 1 ${-r} ${r}h${-s}a${r} ${r} 0 0 1 ${-r} ${-r}v${-s}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
  }

  function qrSvg({ qr, style, logo }) {
    const n = qr.getModuleCount(), Q = 4, size = n + Q * 2;
    const { finder, inAlign } = qrRegions(n);
    // The modules under the logo are left out, as the logo covers them on the picture too.
    const box = size * 0.22, bx = (size - box) / 2;
    const underLogo = (r, c) => logo && c + Q < bx + box && c + Q + 1 > bx && r + Q < bx + box && r + Q + 1 > bx;
    const dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c) && !finder(r, c) && !underLogo(r, c);

    const traced = style === 'dots' ? (r, c) => dark(r, c) && inAlign(r, c) : dark;
    const paths = traceCells(traced, n).map(loop => outlinePath(loop, style === 'rounded' ? 0.4 : 0, Q));
    const R = style === 'square' ? 0 : 1.6;
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      paths.push(roundRectPath(c + Q, r + Q, 7, R), roundRectPath(c + Q + 1, r + Q + 1, 5, R * 0.7),
        roundRectPath(c + Q + 2, r + Q + 2, 3, R * 0.5));
    }
    const dots = [];
    if (style === 'dots') {
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (dark(r, c) && !inAlign(r, c)) dots.push(`<circle cx="${c + Q + 0.5}" cy="${r + Q + 0.5}" r="0.43"/>`);
        }
      }
    }
    let image = '';
    if (logo) {
      const scale = Math.min(600 / logo.width, 600 / logo.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(logo.width * scale);
      canvas.height = Math.round(logo.height * scale);
      canvas.getContext('2d').drawImage(logo, 0, 0, canvas.width, canvas.height);
      const inner = box * 0.8, ix = +(bx + (box - inner) / 2).toFixed(3);
      image = `<image id="logo" x="${ix}" y="${ix}" width="${+inner.toFixed(3)}" height="${+inner.toFixed(3)}" preserveAspectRatio="xMidYMid meet" xlink:href="${canvas.toDataURL('image/png')}"/>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="50mm" height="50mm" viewBox="0 0 ${size} ${size}">
<path fill="#000000" fill-rule="evenodd" d="${paths.join('')}"/>
${dots.length ? `<g fill="#000000">${dots.join('')}</g>\n` : ''}${image}</svg>
`;
  }

  /* Fonts for the QR text: the menu's own by default (its font choice, or the design's), or any
     pairing from core/fonts.json. Loaded from Google Fonts before drawing. */
  const SYSTEM_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  let qrFontList = null;
  const themeCss = {};
  const loadedCss = {};

  async function qrFontOptions() {
    if (!qrFontList) qrFontList = await getJSON(new URL('core/fonts.json', ROOT)).catch(() => []);
    return qrFontList;
  }

  // The weight to draw with: 700 if the font has it, else its closest one (many display fonts have only 400).
  function fontWeight(css, family) {
    const m = css && css.match(new RegExp(`family=${family.replace(/ /g, '\\+')}(?::([^&]*))?(?:&|$)`));
    if (!m) return 700;
    if (!m[1]) return 400;
    const weights = [];
    for (const part of m[1].slice(m[1].indexOf('@') + 1).split(';')) {
      const [a, b] = part.split(',').pop().split('..').map(Number);
      if (b ? a <= 700 && b >= 700 : a === 700) return 700;
      weights.push(a, b || a);
    }
    return weights.sort((x, y) => Math.abs(x - 700) - Math.abs(y - 700))[0] || 400;
  }

  // { label, family, weight, css } for a choice ('' = the menu's font).
  async function qrFontFor(choice) {
    const fonts = await qrFontOptions();
    const system = { label: t('qrFontSystem'), family: SYSTEM_FONT, weight: 700 };
    const named = (name, css) => ({ label: name, family: `'${name}', ${SYSTEM_FONT}`, weight: fontWeight(css, name), css });
    if (choice === 'system') return system;
    const pick = fonts.find(f => f.id === (choice || settings.font));
    if (pick) {
      const name = (pick.head.match(/'([^']+)'/) || [])[1];
      return name ? named(name, pick.css) : system;
    }
    // The design's own font: its display font, else its heading font, else its body font.
    if (!(settings.theme in themeCss)) {
      themeCss[settings.theme] = await fetch(new URL(`themes/${settings.theme}/theme.css`, ROOT))
        .then(r => (r.ok ? r.text() : '')).catch(() => '');
    }
    const text = themeCss[settings.theme];
    const css = (text.match(/@import url\('([^']+)'\)/) || [])[1];
    for (const v of ['display', 'head', 'body']) {
      const name = (text.match(new RegExp(`--font-${v}:\\s*'([^']+)'`)) || [])[1];
      if (name) return named(name, css);
    }
    return system;
  }

  function loadFont(font, sample) {
    if (!font.css) return Promise.resolve();
    if (!loadedCss[font.css]) {
      loadedCss[font.css] = new Promise(resolve => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = font.css;
        link.onload = link.onerror = resolve;
        document.head.appendChild(link);
      });
    }
    // Wait for the letters we draw (at most 4 s; then the canvas uses the fallback font).
    return Promise.race([
      loadedCss[font.css].then(() => document.fonts.load(`${font.weight} 64px ${font.family}`, sample)).catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 4000)),
    ]);
  }

  // A see-through logo that is almost all white (made for a dark menu) would vanish on white.
  const lightLogos = new WeakMap();
  function lightLogo(img) {
    if (!lightLogos.has(img)) lightLogos.set(img, ImageEditor.isLightLogo(img));
    return lightLogos.get(img);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // Wraps text into lines that fit the width (for long café names).
  function fitLines(ctx, text, maxWidth) {
    const words = text.split(/\s+/);
    const out = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (ctx.measureText(next).width > maxWidth && line) { out.push(line); line = w; } else line = next;
    }
    if (line) out.push(line);
    return out.slice(0, 2);
  }

  let qrRendering = 0;
  async function renderQr() {
    const run = ++qrRendering;
    const url = ROOT.href;
    $('#qr-url').textContent = t('qrUrl', { url });
    $('#qr-local').hidden = store.kind !== 'local';
    $('#qr-styles').innerHTML = Object.entries(QR_STYLES).map(([id, key]) =>
      `<button type="button" data-qr-style="${id}" class="${id === qrPrefs.style ? 'active' : ''}" aria-pressed="${id === qrPrefs.style}">${t(key)}</button>`).join('');
    $('#qr-card').checked = qrPrefs.card;
    $('#qr-colors').innerHTML = [['menu', 'qrColorsMenu'], ['black', 'qrColorsBlack']].map(([id, key]) =>
      `<button type="button" data-qr-colors="${id}" class="${id === qrPrefs.colors ? 'active' : ''}" aria-pressed="${id === qrPrefs.colors}">${t(key)}</button>`).join('');
    $('#qr-logo').checked = qrPrefs.logo && !!settings.logo;
    $('#qr-logo').disabled = !settings.logo;
    $('#qr-nologo').hidden = !!settings.logo;
    $('#qr-name').checked = qrPrefs.name;
    $('#qr-caption-on').checked = qrPrefs.captionOn;
    $('#qr-caption').hidden = !qrPrefs.captionOn;
    $('#qr-caption').value = qrPrefs.caption || t('qrCaptionDefault');

    const fonts = await qrFontOptions();
    const menuFont = await qrFontFor('');
    if (run !== qrRendering) return;
    const fontIds = ['', ...fonts.map(f => f.id), 'system'];
    if (!fontIds.includes(qrPrefs.font)) qrPrefs.font = '';
    $('#qr-font').innerHTML = fontIds.map(id => {
      const label = id === '' ? t('qrFontMenu', { name: menuFont.label })
        : id === 'system' ? t('qrFontSystem') : localized(fonts.find(f => f.id === id), 'name', lang);
      return `<option value="${esc(id)}"${id === qrPrefs.font ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');

    const name = qrPrefs.name ? (settings.name || '').trim() : '';
    const caption = qrPrefs.captionOn ? $('#qr-caption').value.trim() : '';
    const textFont = qrPrefs.font ? await qrFontFor(qrPrefs.font) : menuFont;
    let make;
    try { make = await loadQrLibrary(); } catch (err) { return toast(err.message, 'error'); }
    const [logo] = await Promise.all([
      qrPrefs.logo && settings.logo ? loadImage(imgSrc(settings.logo)).catch(() => null) : null,
      name || caption ? loadFont(textFont, name + caption) : null,
    ]);
    if (run !== qrRendering) return;   // a newer redraw has started

    const qr = make(0, 'H');            // highest error correction: still scans with a logo on top
    qr.addData(url);
    qr.make();
    lastQr = { qr, style: qrPrefs.style, logo };

    const { ink, frame, frameText } = qrColors();
    const style = qrPrefs.style;
    // Table card: coloured bands on top (name) and bottom (caption) with the code on plain white
    // between them, so the colour never sits right next to the code (scanners need clean edges).
    const card = qrPrefs.card;
    const W = 1000, pad = card ? 40 : 30, qrSize = W - pad * 2;
    const n = qr.getModuleCount();
    const cell = Math.floor(qrSize / (n + 8));
    const margin = Math.round((qrSize - cell * n) / 2);    // white quiet zone around the code
    const font = px => `${textFont.weight} ${px}px ${textFont.family}`;
    const NAME = 64, NAME_LINE = 78, CAPTION = 80;

    const canvas = $('#qr-canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = font(NAME);
    const nameLines = name ? fitLines(ctx, name, W - 120) : [];
    const nameHeight = nameLines.length ? (nameLines.length - 1) * NAME_LINE + NAME : 0;

    // Without the card the text sits 2 modules below the code, halfway into the white margin; with the
    // card it sits in the bands and the margin stays white in full.
    let qrTop, height, nameTop, captionBase;
    if (card) {
      const head = nameLines.length ? 44 + nameHeight + 30 : 40;
      const foot = caption ? Math.round(CAPTION * 1.7) : 40;
      qrTop = head;
      height = head + qrSize + foot;
      nameTop = 44;
      captionBase = head + qrSize + foot / 2 + CAPTION * 0.34;
    } else {
      const gap = cell * 2;
      qrTop = nameLines.length ? pad + nameHeight + gap - margin : pad;
      captionBase = qrTop + margin + cell * n + gap + CAPTION * 0.74;
      height = Math.max(qrTop + qrSize, caption ? captionBase + CAPTION * 0.26 + pad : 0);
      nameTop = pad;
    }
    canvas.width = W;
    canvas.height = Math.round(height);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (card) {
      ctx.fillStyle = frame;
      roundRect(ctx, 0, 0, canvas.width, canvas.height, 56);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(12, qrTop, W - 24, qrSize);
    }
    drawQr(ctx, qr, pad, qrTop, qrSize, style, ink);

    // Logo on a white rounded square in the middle (about a fifth of the code's width).
    if (logo) {
      const box = qrSize * 0.22, bx = pad + (qrSize - box) / 2, by = qrTop + (qrSize - box) / 2;
      ctx.fillStyle = lightLogo(logo) ? ink : '#ffffff';
      roundRect(ctx, bx, by, box, box, box * 0.2);
      const inner = box * 0.8, scale = Math.min(inner / logo.width, inner / logo.height);
      const lw = logo.width * scale, lh = logo.height * scale;
      ctx.drawImage(logo, bx + (box - lw) / 2, by + (box - lh) / 2, lw, lh);
    }

    // Text last, so the white square of the code never covers it.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = card ? frameText : ink;
    ctx.font = font(NAME);
    nameLines.forEach((line, i) => ctx.fillText(line, W / 2, nameTop + NAME * 0.8 + i * NAME_LINE));
    if (caption) {
      ctx.font = font(CAPTION);
      ctx.fillText(caption, W / 2, captionBase, W - 100);
    }
  }

  function saveQrPrefs() { writeStorage(QR_KEY, qrPrefs); renderQr(); }

  $('#tab-qr').addEventListener('click', e => {
    const s = e.target.closest('[data-qr-style]');
    const c = e.target.closest('[data-qr-colors]');
    if (s) { qrPrefs.style = s.dataset.qrStyle; saveQrPrefs(); }
    if (c) { qrPrefs.colors = c.dataset.qrColors; saveQrPrefs(); }
    const step = e.target.closest('#qr-font-prev, #qr-font-next');
    if (step) {
      const ids = [...$('#qr-font').options].map(o => o.value);
      const d = step.id === 'qr-font-next' ? 1 : -1;
      qrPrefs.font = ids[(ids.indexOf(qrPrefs.font) + d + ids.length) % ids.length];
      saveQrPrefs();
    }
  });
  $('#tab-qr').addEventListener('change', e => {
    const id = e.target.id;
    if (id === 'qr-logo') qrPrefs.logo = e.target.checked;
    else if (id === 'qr-name') qrPrefs.name = e.target.checked;
    else if (id === 'qr-caption-on') qrPrefs.captionOn = e.target.checked;
    else if (id === 'qr-card') qrPrefs.card = e.target.checked;
    else if (id === 'qr-font') qrPrefs.font = e.target.value;
    else return;
    saveQrPrefs();
  });
  $('#qr-caption').addEventListener('input', e => { qrPrefs.caption = e.target.value; writeStorage(QR_KEY, qrPrefs); renderQr(); });

  function saveBlob(blob, ext) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qr-${slug(settings.name || 'meni')}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  $('#qr-download').addEventListener('click', () => $('#qr-canvas').toBlob(blob => saveBlob(blob, 'png'), 'image/png'));
  $('#qr-download-svg').addEventListener('click', () => {
    if (lastQr) saveBlob(new Blob([qrSvg(lastQr)], { type: 'image/svg+xml' }), 'svg');
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
