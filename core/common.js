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

  return { LANGS, TAGS, translator, localized, plural, savedLang, saveLang, esc, formatPrice, getJSON };
})();
