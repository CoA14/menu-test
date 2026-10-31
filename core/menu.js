/* Public menu: loads the content files and the chosen theme, then renders the page.
   Every theme uses this same markup; themes only change styling and a few layout flags. */
(async function () {
  'use strict';
  const { LANGS, TAGS, SOCIAL, translator, localized, linkUrl, savedLang, saveLang, esc, formatPrice, getJSON } = window.DM;
  const app = document.getElementById('app');
  const root = document.documentElement;
  const LANG_KEY = 'dm-lang';

  const STRINGS = {
    sr: {
      title: 'Meni',
      loadError: 'Nažalost, meni trenutno ne može da se učita. Pokušajte ponovo za trenutak.',
      empty: 'Meni je u pripremi.<br>Navratite uskoro!',
      sections: 'Kategorije menija',
      details: 'Detalji',
      close: 'Zatvori',
      soldOut: 'Rasprodato',
      hours: 'Radno vreme',
      address: 'Adresa',
      phone: 'Telefon',
      wifi: 'Wi-Fi',
      password: 'Lozinka:',
      followUs: 'Pratite nas',
      links: 'Linkovi',
      website: 'Web sajt',
      switchLang: 'Prebaci na engleski',
    },
    en: {
      title: 'Menu',
      loadError: 'Sorry, the menu could not be loaded. Please try again in a moment.',
      empty: 'Our menu is being prepared.<br>Please check back soon!',
      sections: 'Menu sections',
      details: 'Item details',
      close: 'Close',
      soldOut: 'Sold out',
      hours: 'Opening hours',
      address: 'Address',
      phone: 'Phone',
      wifi: 'Wi-Fi',
      password: 'Password:',
      followUs: 'Follow us',
      links: 'Links',
      website: 'Website',
      switchLang: 'Switch to Serbian',
    },
  };

  // ?lang=en in the address wins, then the guest's last choice, then Serbian.
  const requestedLang = new URLSearchParams(location.search).get('lang');
  let lang = LANGS.includes(requestedLang) ? requestedLang : savedLang(LANG_KEY) || 'sr';
  const t = translator(STRINGS, () => lang);
  const L = (obj, field) => localized(obj, field, lang);

  function loadCss(href) {
    return new Promise(resolve => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = link.onerror = resolve;
      document.head.appendChild(link);
    });
  }

  // ?demo=pizzeria shows a sample menu from demo/ (used by the design gallery only).
  const demo = (new URLSearchParams(location.search).get('demo') || '').replace(/[^a-z-]/g, '');
  const contentDir = demo ? `demo/${demo}/` : 'content/';

  let settings, menu, theme, themeId;
  try {
    [settings, menu] = await Promise.all([getJSON(`${contentDir}settings.json`), getJSON(`${contentDir}menu.json`)]);
    const requested = new URLSearchParams(location.search).get('theme');
    themeId = String(requested || settings.theme || 'classic').replace(/[^a-z0-9-]/gi, '');
    theme = await getJSON(`themes/${themeId}/theme.json`).catch(() => ({}));
    await loadCss(`themes/${themeId}/theme.css`);
  } catch (err) {
    app.innerHTML = `<p class="dm-error">${t('loadError')}</p>`;
    document.body.classList.remove('dm-loading');
    console.error(err);
    return;
  }

  const bilingual = settings.english !== false;
  if (!bilingual) lang = 'sr';

  root.dataset.theme = themeId;
  root.dataset.layout = theme.layout || 'list';
  root.dataset.nav = theme.nav || 'scroll';
  if (settings.accent) root.style.setProperty('--accent', settings.accent);
  if (theme.themeColor) document.querySelector('meta[name="theme-color"]').content = theme.themeColor;

  const categories = (menu.categories || []).filter(c => (c.items || []).length);
  const itemById = new Map();
  categories.forEach(c => c.items.forEach(i => itemById.set(i.id, i)));
  const tabs = root.dataset.nav === 'tabs';

  /* ---------- markup ---------- */

  function tagsHtml(tags) {
    const known = (tags || []).filter(tag => TAGS[tag]);
    if (!known.length) return '';
    return `<ul class="tags">${known.map(tag =>
      `<li class="tag tag-${tag}"><span class="tag-icon" aria-hidden="true">${TAGS[tag].icon}</span>${TAGS[tag][lang]}</li>`
    ).join('')}</ul>`;
  }

  function itemHtml(item) {
    const soldOut = item.available === false;
    const price = formatPrice(item.price, settings);
    const desc = L(item, 'description');
    return `
      <article class="item${item.image ? ' has-img' : ''}${soldOut ? ' soldout' : ''}" data-id="${esc(item.id)}" tabindex="0" role="button" aria-label="${esc(L(item, 'name'))}">
        ${item.image ? `<img class="item-img" src="${esc(item.image)}" alt="" loading="lazy">` : ''}
        <div class="item-body">
          <div class="item-head">
            <h3 class="item-name">${esc(L(item, 'name'))}</h3>
            <span class="leader" aria-hidden="true"></span>
            ${price ? `<span class="item-price">${esc(price)}</span>` : ''}
          </div>
          ${desc ? `<p class="item-desc">${esc(desc)}</p>` : ''}
          <div class="item-meta">
            ${item.size ? `<span class="item-size">${esc(sizeText(item.size))}</span>` : ''}
            ${soldOut ? `<span class="soldout-badge">${t('soldOut')}</span>` : ''}
            ${tagsHtml(item.tags)}
          </div>
        </div>
      </article>`;
  }

  function infoHtml() {
    const s = settings;
    const hours = L(s, 'hours');
    const note = L(s, 'note');
    const rows = [];
    if (hours) rows.push([t('hours'), esc(hours).replace(/\n/g, '<br>')]);
    if (s.address) rows.push([t('address'), `<a href="https://maps.google.com/?q=${encodeURIComponent(s.address)}" target="_blank" rel="noopener">${esc(s.address)}</a>`]);
    if (s.phone) rows.push([t('phone'), `<a href="tel:${esc(s.phone.replace(/[^\d+]/g, ''))}">${esc(s.phone)}</a>`]);
    if (s.wifiName) rows.push([t('wifi'), `${esc(s.wifiName)}${s.wifiPassword ? `<br><span class="muted">${t('password')}</span> ${esc(s.wifiPassword)}` : ''}`]);
    // Only links that were filled in (and make a valid address) are shown.
    const linkList = list => `<span class="info-links">${list.map(([label, url]) =>
      `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`).join('')}</span>`;
    const socials = Object.keys(SOCIAL).map(k => [SOCIAL[k].label, linkUrl(s[k], k)]).filter(([, url]) => url);
    if (socials.length) rows.push([t('followUs'), linkList(socials)]);
    const others = [[t('website'), linkUrl(s.website)], ...(s.links || []).map(l => [l.label || l.url, linkUrl(l.url)])]
      .filter(([label, url]) => label && url);
    if (others.length) rows.push([t('links'), linkList(others)]);
    if (!rows.length && !note) return '';
    return `
      <footer class="info">
        <div class="wrap">
          ${rows.length ? `<dl class="info-grid">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
          ${note ? `<p class="info-note">${esc(note)}</p>` : ''}
        </div>
      </footer>`;
  }

  // One button showing both languages; a tap flips to the other one.
  function langSwitchHtml() {
    if (!bilingual) return '';
    const next = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];
    return `
      <button type="button" class="lang-switch" data-lang="${next}" aria-label="${t('switchLang')}">
        ${LANGS.map(l => `<span class="lang-btn${l === lang ? ' active' : ''}" lang="${l}">${l.toUpperCase()}</span>`).join('')}
      </button>`;
  }

  // Sizes are typed in Serbian ("6 kom"); English shows "6 pcs".
  const sizeText = size => (lang === 'en' ? size.replace(/\bkom\b/, 'pcs') : size);

  /* ---------- page ---------- */

  let observer = null;
  let chips = [], sections = [];

  // Builds the whole page in the current language. In tabs mode, activeCat keeps the open tab.
  function render(activeCat) {
    root.lang = lang;
    document.title = settings.name ? `${settings.name} · ${t('title')}` : t('title');
    const active = activeCat || (categories[0] && categories[0].id);
    const tagline = L(settings, 'tagline');
    const navTag = tabs ? 'button' : 'a';

    app.innerHTML = `
      <header class="hero">
        ${langSwitchHtml()}
        <div class="wrap">
          ${settings.logo ? `<img class="hero-logo" src="${esc(settings.logo)}" alt="">` : ''}
          <h1 class="hero-name">${esc(settings.name || t('title'))}</h1>
          ${tagline ? `<p class="hero-tagline">${esc(tagline)}</p>` : ''}
        </div>
      </header>
      ${categories.length ? `
        <nav class="catnav" aria-label="${t('sections')}">
          <div class="catnav-inner">
            ${categories.map(c => `<${navTag} class="chip${c.id === active ? ' active' : ''}" data-cat="${esc(c.id)}"${navTag === 'a' ? ` href="#cat-${esc(c.id)}"` : ' type="button"'}>${esc(L(c, 'name'))}</${navTag}>`).join('')}
          </div>
        </nav>
        <main class="menu">
          ${categories.map(c => `
            <section class="cat${c.id === active ? ' active' : ''}" id="cat-${esc(c.id)}" data-cat="${esc(c.id)}">
              <div class="wrap">
                <header class="cat-head">
                  <h2 class="cat-name">${esc(L(c, 'name'))}</h2>
                  ${L(c, 'description') ? `<p class="cat-desc">${esc(L(c, 'description'))}</p>` : ''}
                </header>
                <div class="items">${c.items.map(itemHtml).join('')}</div>
              </div>
            </section>`).join('')}
        </main>` : `
        <main class="menu menu-empty"><div class="wrap"><p>${t('empty')}</p></div></main>`}
      ${infoHtml()}
      <dialog class="sheet" aria-label="${t('details')}"></dialog>`;

    chips = [...app.querySelectorAll('.chip')];
    sections = [...app.querySelectorAll('.cat')];

    // Highlight the chip of the section currently in the middle of the screen.
    if (observer) observer.disconnect();
    if (!tabs && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) setActive(e.target.dataset.cat); });
      }, { rootMargin: '-35% 0px -60% 0px' });
      sections.forEach(s => observer.observe(s));
    }
  }

  function setActive(id) {
    chips.forEach(ch => {
      const on = ch.dataset.cat === id;
      ch.classList.toggle('active', on);
      if (on) ch.parentElement.scrollTo({ left: ch.offsetLeft - 16, behavior: 'smooth' });
    });
  }

  function openTab(id) {
    sections.forEach(s => s.classList.toggle('active', s.dataset.cat === id));
    setActive(id);
    const nav = app.querySelector('.catnav');
    if (nav.getBoundingClientRect().top <= 0) window.scrollTo({ top: nav.offsetTop, behavior: 'smooth' });
  }

  function switchLang(next) {
    if (next === lang) return;
    lang = next;
    saveLang(LANG_KEY, lang);
    if (new URLSearchParams(location.search).has('lang')) {
      const url = new URL(location.href);
      url.searchParams.delete('lang');
      history.replaceState(null, '', url);
    }
    const y = window.scrollY;
    render(app.querySelector('.chip.active')?.dataset.cat);
    window.scrollTo(0, y);
  }

  /* ---------- item details sheet ---------- */

  function openItem(id) {
    const sheet = app.querySelector('.sheet');
    const item = itemById.get(id);
    if (!item || typeof sheet.showModal !== 'function') return;
    const price = formatPrice(item.price, settings);
    const desc = L(item, 'description');
    sheet.innerHTML = `
      <div class="sheet-card">
        <button class="sheet-close" type="button" aria-label="${t('close')}">×</button>
        ${item.image ? `<img class="sheet-img" src="${esc(item.image)}" alt="">` : ''}
        <div class="sheet-body">
          <h3 class="sheet-name">${esc(L(item, 'name'))}</h3>
          <div class="sheet-sub">
            ${price ? `<span class="item-price">${esc(price)}</span>` : ''}
            ${item.size ? `<span class="item-size">${esc(sizeText(item.size))}</span>` : ''}
            ${item.available === false ? `<span class="soldout-badge">${t('soldOut')}</span>` : ''}
          </div>
          ${desc ? `<p class="sheet-desc">${esc(desc)}</p>` : ''}
          ${tagsHtml(item.tags)}
        </div>
      </div>`;
    sheet.showModal();
  }

  // One set of listeners for everything, since render() replaces the page's markup.
  app.addEventListener('click', e => {
    const sheet = e.target.closest('.sheet');
    if (sheet) {
      if (e.target === sheet || e.target.closest('.sheet-close')) sheet.close();
      return;
    }
    const langBtn = e.target.closest('.lang-switch');
    if (langBtn) return switchLang(langBtn.dataset.lang);
    const chip = e.target.closest('.chip');
    if (chip && tabs) return openTab(chip.dataset.cat);
    const item = e.target.closest('.item');
    if (item) openItem(item.dataset.id);
  });
  app.addEventListener('keydown', e => {
    const item = e.target.closest('.item');
    if (item && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openItem(item.dataset.id); }
  });

  render();
  document.body.classList.remove('dm-loading');

  // The page is built after load, so jump to a #section link by hand.
  const target = location.hash && app.querySelector(`[id="${CSS.escape(location.hash.slice(1))}"]`);
  if (target) {
    if (tabs) openTab(target.dataset.cat);
    else target.scrollIntoView();
  }
})();
