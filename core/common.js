/* Shared helpers for the public menu and the admin page. */
window.DM = (function () {
  'use strict';

  // Serbian is the main language; English is the optional second one.
  const LANGS = ['sr', 'en'];

  // Dietary / highlight tags an item can have. Keys are stored in menu.json.
  const TAGS = {
    'popular':     { icon: '★',  sr: 'Popularno',     en: 'Popular' },
    'new':         { icon: '✦',  sr: 'Novo',          en: 'New' },
    'vegetarian':  { icon: '🌱', sr: 'Vegetarijansko', en: 'Vegetarian' },
    'vegan':       { icon: '🌿', sr: 'Veganski',      en: 'Vegan' },
    'gluten-free': { icon: 'GF', sr: 'Bez glutena',   en: 'Gluten-free' },
    'spicy':       { icon: '🌶️', sr: 'Ljuto',         en: 'Spicy' },
  };

  // Returns a translate function for a { sr: {...}, en: {...} } table.
  // "{name}" placeholders are filled from vars; missing English falls back to Serbian.
  function translator(strings, getLang) {
    return (key, vars) => {
      const text = strings[getLang()]?.[key] ?? strings.sr[key] ?? key;
      return vars ? text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : text;
    };
  }

  // English text is stored next to the Serbian one as "<field>En" (name / nameEn).
  function localized(obj, field, lang) {
    if (lang === 'en' && obj[field + 'En']) return obj[field + 'En'];
    return obj[field] || '';
  }

  // Serbian has three plural forms: 1 stavka, 2 stavke, 5 stavki (11–14 always the last).
  function plural(n, lang, forms) {
    if (lang === 'en') return n === 1 ? forms.en[0] : forms.en[1];
    const d = n % 10, dd = n % 100;
    if (d === 1 && dd !== 11) return forms.sr[0];
    if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return forms.sr[1];
    return forms.sr[2];
  }

  // Social profiles can be typed as a full link, "instagram.com/name", "@name" or just "name".
  const SOCIAL = {
    instagram: { label: 'Instagram', base: 'https://instagram.com/' },
    facebook:  { label: 'Facebook',  base: 'https://facebook.com/' },
    tiktok:    { label: 'TikTok',    base: 'https://www.tiktok.com/@' },
  };

  // Turns what the owner typed into a safe https link, or '' if it can't be one.
  function linkUrl(value, kind) {
    const v = String(value || '').trim();
    if (!v) return '';
    let url;
    if (/^https?:\/\//i.test(v)) url = v;
    else if (/^[^\s/@]+\.[^\s]+$/.test(v)) url = 'https://' + v;          // instagram.com/name, www.cafe.rs
    else if (SOCIAL[kind] && /^@?[\w.-]+$/.test(v)) url = SOCIAL[kind].base + v.replace(/^@/, '');
    else return '';
    try { return /^https?:$/.test(new URL(url).protocol) ? url : ''; } catch { return ''; }
  }

  // For social profiles: a clean link without tracking junk (?igsh=…) plus the @handle to show.
  // Returns null when the text can't be a link.
  function socialProfile(value, kind) {
    const url = linkUrl(value, kind);
    if (!url) return null;
    const u = new URL(url);
    const keepId = /profile\.php$/i.test(u.pathname) && u.searchParams.get('id');   // facebook.com/profile.php?id=…
    u.search = keepId ? `?id=${encodeURIComponent(keepId)}` : '';
    u.hash = '';
    const first = decodeURIComponent(u.pathname.split('/').filter(Boolean)[0] || '').replace(/^@/, '');
    const isProfile = first && !keepId && !/^(p|reel|reels|share|watch|video|groups|stories|explore)$/i.test(first);
    return { url: u.href.replace(/\/$/, ''), handle: isProfile ? first : '' };
  }

  // Small line icons (24×24, drawn in the text colour) for the links on the menu.
  const ICON_PATHS = {
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6" fill="currentColor"/>',
    facebook: '<circle cx="12" cy="12" r="9"/><path d="M15 8h-1.5A2.5 2.5 0 0 0 11 10.5V21M8.5 13h6"/>',
    tiktok: '<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.4 2.7 2.3 4.6 5 4.8"/>',
    website: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9M12 3C9.5 5.6 8.3 8.6 8.3 12s1.2 6.4 3.7 9"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;

  // Opening hours are stored as rows: { from: 0, to: 4, open: '08:00', close: '22:00', closed: false },
  // days 0 = Monday … 6 = Sunday. The text is written in the reader's language.
  const DAYS = {
    sr: { names: ['Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub', 'Ned'], closed: 'Ne radi' },
    en: { names: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], closed: 'Closed' },
  };
  function scheduleLines(schedule, lang) {
    const d = DAYS[lang] || DAYS.sr;
    return (schedule || []).map(r => {
      const days = r.from === r.to ? d.names[r.from] : `${d.names[r.from]}–${d.names[r.to]}`;
      return { days, times: r.closed ? d.closed : `${r.open}–${r.close}` };
    });
  }

  function savedLang(key) {
    try { const v = localStorage.getItem(key); return LANGS.includes(v) ? v : null; } catch { return null; }
  }

  function saveLang(key, lang) {
    try { localStorage.setItem(key, lang); } catch { /* private mode */ }
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function formatPrice(value, settings) {
    if (value === '' || value == null || isNaN(value)) return '';
    const s = settings || {};
    const decimals = Number.isInteger(s.priceDecimals) ? s.priceDecimals : 2;
    const comma = s.decimalSeparator === ',';
    const [int, frac] = Number(value).toFixed(decimals).split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, comma ? '.' : ',');
    const num = frac ? grouped + (comma ? ',' : '.') + frac : grouped;
    const cur = s.currency || '';
    if (!cur) return num;
    if (s.currencyPosition === 'before') return /^[A-Za-z]/.test(cur) ? cur + ' ' + num : cur + num;
    return num + ' ' + cur;
  }

  async function getJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
    return res.json();
  }

  return {
    LANGS, TAGS, SOCIAL, DAYS, translator, localized, plural, linkUrl, socialProfile, icon, scheduleLines,
    savedLang, saveLang, esc, formatPrice, getJSON,
  };
})();
