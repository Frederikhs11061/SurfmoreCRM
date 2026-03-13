'use client';
import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

// ─── Constants ──────────────────────────────────────────────────────────────
const CATEGORIES = [
  'Butik & Webshop', 'Skoler & klubber', 'Folkeskoler', 'Børnehaver', 'Efterskoler',
  'Gymnasium', 'Højskoler', 'Skateparks', 'Spejdergrupper', 'Kajakklubber',
  'Drager & Legetøj', 'Indkøbsforeninger', 'Havne', 'Naturskoler, centre & vejledere', 'Andet',
];
const COUNTRIES = ['Danmark', 'Norge', 'Sverige'];
const STATUS_OPTIONS = [
  { value: 'not_contacted', label: 'Ikke kontaktet', color: '#64748b' },
  { value: 'outreach_done', label: 'Outreach sendt', color: '#3b82f6' },
  { value: 'won', label: 'Solgt', color: '#22c55e' },
];
const DEFAULT_LEAD = {
  name: '', category: 'Butik & Webshop', country: 'Danmark',
  email: '', phone: '', city: '', website: '', status: 'not_contacted',
  notes: '', sale_info: '', contact_person: '', product: '',
};
const DEFAULT_OTR = { date: '', by: 'Jeppe', note: '', sale_info: '' };

// ─── Smart scraper search terms per category + country ────────────────────────
// Swedish email = "e-post", Norwegian = "e-post"/"epost". Use site:.se/.no/.dk for precision.
const SMART_SEARCH_TERMS = {
  'Havne': {
    'Danmark': [
      'gæstehavn "e-mail" OR "kontakt@"',
      'lystbådehavn kontakt "e-mail"',
      'marina sejlklub havnekontor "e-mail"',
      'liste gæstehavne kontaktoplysninger',
    ],
    'Sverige': [
      'gästhamn "e-post" OR "kontakt@"',
      'båthamn kontakt "e-post" OR "mailto"',
      'marina hamn "e-post" sverige',
      'lista gästhamnar kontakt e-post',
    ],
    'Norge': [
      'gjestehavn "e-post" OR "kontakt@"',
      'lystbåthavn kontakt "e-post"',
      'marina havn "e-post" norge',
      'liste gjestehavner kontakt',
    ],
  },
  'Kajakklubber': {
    'Danmark': [
      'kajakklub "e-mail" OR "kontakt@"',
      'kanoklub kontakt "e-mail" OR "mailto"',
      'kajakforening bestyrelse e-mail',
    ],
    'Sverige': [
      'kajakklubbar "e-post" OR "kontakt@"',
      'paddlingsklubb kontakt "e-post"',
      'kanotförbundet klubbar e-post',
    ],
    'Norge': [
      'kajakklubb "e-post" OR "kontakt@"',
      'padleklubb kontakt "e-post"',
      'norges padleforbund klubber epost',
    ],
  },
  'Skateparks': {
    'Danmark': [
      'skatepark "e-mail" OR "kontakt@"',
      'skatebane kontakt e-mail',
    ],
    'Sverige': [
      'skatepark "e-post" OR "kontakt@"',
      'skatehall kontakt e-post',
    ],
    'Norge': [
      'skatepark "e-post" OR "kontakt@"',
      'skateanlegg kontakt epost',
    ],
  },
  'Spejdergrupper': {
    'Danmark': [
      'spejdergruppe "e-mail" OR "kontakt@"',
      'FDF KFUM spejdere kontakt e-mail',
      'spejderkorps bestyrelse e-mail',
    ],
    'Sverige': [
      'scoutkår "e-post" OR "kontakt@"',
      'scoutgrupp kontakt e-post',
      'scoutförbundet kårer e-post',
    ],
    'Norge': [
      'speidergruppe "e-post" OR "kontakt@"',
      'norges speiderforbund gruppe epost',
    ],
  },
  'Butik & Webshop': {
    'Danmark': [
      'surfshop kiteshop "e-mail" OR "kontakt@"',
      'outdoor sport butik "e-mail" OR "mailto"',
      'windsurfing kitesurf forhandler e-mail',
    ],
    'Sverige': [
      'surfshop kiteshop "e-post" OR "kontakt@"',
      'outdoor sport butik "e-post" OR "mailto" sverige',
    ],
    'Norge': [
      'surfshop kiteshop "e-post" OR "kontakt@"',
      'outdoor sport butikk epost norge',
    ],
  },
  'Skoler & klubber': {
    'Danmark': [
      'surfskole kiteskole "e-mail" OR "kontakt@"',
      'vandsportsskole SUP wakeboard kontakt e-mail',
    ],
    'Sverige': [
      'surfskola kiteskola "e-post" OR "kontakt@"',
      'vattensportskola SUP kontakt e-post',
    ],
    'Norge': [
      'surfskole kiteskole "e-post" OR "kontakt@"',
      'vannsportskole SUP kontakt epost',
    ],
  },
  'Folkeskoler': {
    'Danmark': [
      'folkeskole "e-mail" OR "kontakt@"',
      'friskole privatskole kontakt e-mail',
    ],
    'Sverige': [
      'grundskola "e-post" OR "kontakt@"',
      'friskola kontakt e-post',
    ],
    'Norge': [
      'barneskole ungdomsskole "e-post" OR "kontakt@"',
    ],
  },
  'Børnehaver': {
    'Danmark': [
      'børnehave vuggestue "e-mail" OR "kontakt@"',
    ],
    'Sverige': [
      'förskola "e-post" OR "kontakt@"',
    ],
    'Norge': [
      'barnehage "e-post" OR "kontakt@"',
    ],
  },
  'Efterskoler': {
    'Danmark': [
      'efterskole sport friluft "e-mail" OR "kontakt@"',
    ],
    'Sverige': [
      'folkhögskola sport "e-post" OR "kontakt@"',
    ],
    'Norge': [
      'folkehøgskole sport "e-post" OR "kontakt@"',
    ],
  },
  'Gymnasium': {
    'Danmark': [
      'gymnasium HTX HHX STX "e-mail" OR "kontakt@"',
    ],
    'Sverige': [
      'gymnasium sport "e-post" OR "kontakt@"',
    ],
    'Norge': [
      'videregående skole "e-post" OR "kontakt@"',
    ],
  },
  'Højskoler': {
    'Danmark': [
      'højskole friluft "e-mail" OR "kontakt@"',
    ],
    'Sverige': [
      'folkhögskola "e-post" OR "kontakt@"',
    ],
    'Norge': [
      'folkehøgskole "e-post" OR "kontakt@"',
    ],
  },
  'Naturskoler, centre & vejledere': {
    'Danmark': [
      'naturskole naturvejleder "e-mail" OR "kontakt@"',
      'friluftscentrum outdoor center e-mail',
    ],
    'Sverige': [
      'naturskola friluftsgård "e-post" OR "kontakt@"',
    ],
    'Norge': [
      'naturskole friluftssenter "e-post" OR "kontakt@"',
    ],
  },
  'Drager & Legetøj': {
    'Danmark': [
      'dragebutik legetøj outdoor "e-mail" OR "kontakt@"',
    ],
    'Sverige': [
      'drakar leksaker outdoor "e-post" OR "kontakt@"',
    ],
    'Norge': [
      'drage leker outdoor "e-post" OR "kontakt@"',
    ],
  },
  'Indkøbsforeninger': {
    'Danmark': [
      'indkøbsforening "e-mail" OR "kontakt@"',
    ],
    'Sverige': [
      'inköpsförening "e-post" OR "kontakt@"',
    ],
    'Norge': [
      'innkjøpsforening "e-post" OR "kontakt@"',
    ],
  },
};

// DuckDuckGo region codes (kl param) — much more reliable than Google for scraping
const GOOGLE_DOMAIN = {
  'Danmark': 'google.dk',    // kept for backwards-compat if user pastes Google URL manually
  'Sverige': 'google.se',
  'Norge': 'google.no',
};
const DDG_LOCALE = {
  'Danmark': 'dk-da',
  'Sverige': 'se-sv',
  'Norge': 'no-no',
  'Finland': 'fi-fi',
  'Tyskland': 'de-de',
  'UK': 'uk-en',
  'USA': 'us-en',
  'Frankrig': 'fr-fr',
  'Holland': 'nl-nl',
  'Spanien': 'es-es',
  'Italien': 'it-it',
  'Polen': 'pl-pl',
  'Belgien': 'be-nl',
  'Schweiz': 'ch-de',
  'Østrig': 'at-de',
  'Australien': 'au-en',
  'Canada': 'ca-en',
};

// ─── CSV Parsing helpers ─────────────────────────────────────────────────────

// Detects whether the file uses ; or , as separator by counting occurrences in the first lines
function detectSeparator(txt) {
  const lines = txt.split('\n').filter(l => l.trim()).slice(0, 5);
  let semi = 0, comma = 0;
  for (const l of lines) {
    semi += (l.match(/;/g) || []).length;
    comma += (l.match(/,/g) || []).length;
  }
  return semi > comma ? ';' : ',';
}

function parseCSVFull(text, sep = ',') {
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

function isHeader(p) { const l = p.map(x => (x || '').toLowerCase().trim()); return l.some(x => x === 'klubber' || x === 'navn' || x === 'name' || x === 'mail' || x === 'email' || x === 'land' || x === 'kategori' || x === 'underkategori'); }
function findEmail(p) { return p.findIndex(x => /^[^\s@,]+@[^\s@,]+\.[^\s@,]{2,}$/.test(x.replace(/\s/g, ''))); }

// Detect if a field is a sale/revenue field ("Købt X stk", "Solgt X stk", "Bestilt X stk")
function isSaleField(s) { return s && /købt|solgt|bestilt|leveret|faktura/i.test(s); }

// Normalize date string to YYYY-MM-DD (required by Supabase DATE column)
function normDateForDB(s) {
  if (!s) return null;
  // Already ISO: "2025-11-27"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // European DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  // Short year: DD.MM.YY
  const m2 = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2})$/);
  if (m2) return `20${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`;
  return null;
}

// Extract outreach entries from a text field
function parseOtrField(raw, isSale = false) {
  if (!raw || !raw.trim()) return [];
  const dm = raw.match(/(\d{1,2}[\.\/-]\d{1,2}[\.\/-]?\d{2,4})/);
  const bm = raw.match(/^([A-Za-z\xC6\xE6\xD8\xF8\xC5\xE5\/]+)[\s\-–]+/);
  const rawDate = dm ? dm[1] : '';
  return [{
    date: normDateForDB(rawDate) || null,
    by: bm ? bm[1].trim() : 'Jeppe',
    note: raw.trim(),
    sale_info: isSale ? raw.trim() : ''
  }];
}

// Map Shopify/sheet type to CRM category
function mapCategory(type, defaultCat) {
  if (!type) return defaultCat;
  const t = type.toLowerCase();
  if (t.includes('vinterbade') || t.includes('badeklub') || t.includes('badelaug')) return 'Skoler & klubber';
  if (t.includes('kajak')) return 'Kajakklubber';
  if (t.includes('surf') || t.includes('wake') || t.includes('vandski') || t.includes('kite') || t.includes('sup') || t.includes('wind')) return 'Skoler & klubber';
  if (t.includes('sejl')) return 'Skoler & klubber';
  if (t.includes('ski') || t.includes('skiklub')) return 'Skoler & klubber';
  if (t.includes('spejder')) return 'Spejdergrupper';
  if (t.includes('skole') || t.includes('gymnasium') || t.includes('efterskole')) return 'Folkeskoler';
  if (t.includes('butik') || t.includes('webshop') || t.includes('shop')) return 'Butik & Webshop';
  return defaultCat;
}

// Format ISO date "2025-09-23" → "23/09/2025" for display
function fmtDate(s) {
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s; // return as-is if not ISO format
}

// Underkategori: hvis underkategori findes → "Kategori (Underkategori)", ellers kun "Kategori"
function buildCategoryDisplay(kategori, underkategori, defaultCat) {
  const cat = (kategori || '').trim() || defaultCat;
  const sub = (underkategori || '').trim();
  return sub ? `${cat} (${sub})` : cat;
}

function splitCategory(cat) {
  const m = (cat || '').match(/^(.*)\s+\(([^)]*)\)\s*$/);
  if (!m) return { base: cat || '', sub: '' };
  return { base: m[1], sub: m[2] };
}

// Parse notes stored as JSON string in leads.notes
function parseLeadNotes(raw) {
  if (!raw) return [];
  try {
    const val = JSON.parse(raw);
    if (Array.isArray(val)) return val;
  } catch (e) {
    // fallback below
  }
  // Legacy plain-text notes
  return [{ id: 'legacy', title: 'Note', text: String(raw), created_at: null }];
}

// Render template body/subject with {{tokens}} for a given lead
function renderTemplate(str, lead) {
  if (!str) return '';
  if (!lead) return str;
  const notesArr = parseLeadNotes(lead.notes);
  const lastNote = notesArr.length ? notesArr[notesArr.length - 1] : null;
  const company = { name: 'Surfmore' };
  const user = { name: 'Jeppe', email: 'info@surfmore.dk' };
  return str.replace(/\{\{\s*([^}]+)\s*\}\}/g, (m, inner) => {
    try {
      const [pathPart, ...rest] = inner.split('|').map(s => s.trim());
      let fallback = '';
      const defPart = rest.find(p => p.startsWith('default'));
      if (defPart) {
        const m2 = defPart.match(/default\s*:\s*\"([^\"]*)\"/);
        if (m2) fallback = m2[1];
      }
      const path = pathPart.toLowerCase();
      let val = '';
      switch (path) {
        case 'lead.name': val = lead.name; break;
        case 'lead.category': val = lead.category; break;
        case 'lead.country': val = lead.country; break;
        case 'lead.email': val = lead.email; break;
        case 'lead.city': val = lead.city; break;
        case 'lead.phone': val = lead.phone; break;
        case 'lead.contact_person': val = lead.contact_person; break;
        case 'lead.notes_last': val = lastNote?.text || ''; break;
        case 'user.name': val = user.name; break;
        case 'user.email': val = user.email; break;
        case 'company.name': val = company.name; break;
        default: val = '';
      }
      val = (val || '').toString();
      if (!val && fallback) return fallback;
      return val || '';
    } catch (e) {
      return m;
    }
  });
}

// Build column index map from header row (case-insensitive)
// All columns named "B2B Outreach" (with or without number) are collected in otrCols[]
function buildColMap(headerRow) {
  const map = { otrCols: [] };
  const lower = (headerRow || []).map(h => (h || '').toLowerCase().trim());
  lower.forEach((h, i) => {
    if (h.includes('navn') || h === 'name') map.navn = i;
    else if (h.includes('underkategori') || h.includes('subcategory')) map.underkategori = i;
    else if (h.includes('kategori')) map.kategori = i;
    else if (h.includes('land') || h === 'country') map.land = i;
    else if (h.includes('mail') || h === 'email') map.mail = i;
    else if (h.includes('telefon') || h === 'phone') map.telefon = i;
    else if (h === 'by' || h.includes('city')) map.by = i;
    else if (h.includes('website') || h.includes('webside') || h.includes('hjemmeside')) map.website = i;
    else if (h.includes('outreach')) map.otrCols.push(i);
    else if (h.includes('salg') || h.includes('udbytte') || h.includes('sale')) map.salg = i;
    else if (h.includes('kontaktperson') || h.includes('contact')) map.kontaktperson = i;
    else if (h.includes('produkt') || h === 'product') map.produkt = i;
    else if (h === 'noter' || h === 'note' || h === 'notes') map.notes = i;
  });
  return map;
}

function getVal(p, colMap, key) { const i = colMap[key]; return i != null && p[i] !== undefined ? (p[i] || '').trim() : ''; }

function parseLineWithMap(p, colMap, defaultCat, defaultCountry) {
  const knownC = ['Danmark', 'Sverige', 'Norge'];
  const name = getVal(p, colMap, 'navn');
  const kategori = getVal(p, colMap, 'kategori');
  const underkategori = getVal(p, colMap, 'underkategori');
  const land = getVal(p, colMap, 'land');
  const email = getVal(p, colMap, 'mail').replace(/\s/g, '');
  const phone = getVal(p, colMap, 'telefon');
  const city = getVal(p, colMap, 'by');
  const website = getVal(p, colMap, 'website');
  const kontaktperson = getVal(p, colMap, 'kontaktperson');
  const produkt = getVal(p, colMap, 'produkt');
  const salgRaw = getVal(p, colMap, 'salg');
  const noteRaw = getVal(p, colMap, 'notes');

  // Only B2B Outreach columns create outreach entries — one per non-empty cell, no exceptions
  const otrVals = (colMap.otrCols || []).map(i => (p[i] || '').trim()).filter(Boolean);
  const outreaches = [];
  for (const f of otrVals) { outreaches.push(...parseOtrField(f, false)); }

  // Sale info: from Salg/Udbytte column; fallback to first otr value that looks like a sale
  const saleField = salgRaw || otrVals.find(x => isSaleField(x)) || '';

  let status = 'not_contacted';
  if (saleField) status = 'won';
  else if (outreaches.length > 0) status = 'outreach_done';

  const sale_info = saleField;
  const category = buildCategoryDisplay(kategori, underkategori, defaultCat);
  // Normalize known country names to proper case; otherwise use the raw value from the sheet
  const ctry = knownC.find(c => land.toLowerCase() === c.toLowerCase()) || land || defaultCountry || '';

  let notes = '';
  if (noteRaw) {
    const now = new Date().toISOString();
    const note = {
      id: 'imp_' + now + '_' + Math.random().toString(36).slice(2, 8),
      title: 'Import note',
      text: noteRaw,
      created_at: now,
    };
    notes = JSON.stringify([note]);
  }

  if (!name && !email) return null;
  return {
    name, category, country: ctry, email, phone, city, website, status,
    _outreaches: outreaches, notes, sale_info, contact_person: kontaktperson, product: produkt,
  };
}

function parseLineLegacy(line, cat, country) {
  const p = line;
  if (!Array.isArray(p) || p.length === 0 || (p.length === 1 && !p[0])) return null;
  if (isHeader(p)) return null;
  if (!p[0] && !p[3]) return null;

  const knownC = ['Danmark', 'Sverige', 'Norge'];
  const col3isEmail = p[3] && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((p[3] || '').replace(/\s/g, ''));
  if (col3isEmail && p.length >= 5) {
    // Old structured format: Navn | Type | Land | Mail | Otr... | Udbytte | Otr...
    const name = p[0] || '';
    const type = p[1] || '';
    const ctry = knownC.find(c => (p[2] || '').toLowerCase().startsWith(c.toLowerCase())) || country;
    const email = (p[3] || '').replace(/\s/g, '');
    const resolvedCat = mapCategory(type, cat);

    const otrFields = [p[4], p[5], p[7]].filter(x => x && x.trim() && !isSaleField(x));
    const saleField = [p[4], p[5], p[6], p[7]].find(x => isSaleField(x)) || '';

    const outreaches = [];
    for (const f of otrFields) { outreaches.push(...parseOtrField(f, false)); }
    if (saleField) { outreaches.push(...parseOtrField(saleField, true)); }

    const hasSale = !!saleField;
    const has15pct = [p[4], p[5], p[6], p[7]].some(x => x && x.includes('15%'));
    let status = 'not_contacted';
    if (hasSale) status = 'won';
    else if (has15pct) status = 'outreach_done';
    else if (outreaches.length > 0) status = 'outreach_done';

    const sale_info = saleField || (has15pct ? '15% medlemsrabat aftalt' : '');

    if (!name && !email) return null;
    return { name, category: resolvedCat, country: ctry, email, phone: '', city: '', status, _outreaches: outreaches, notes: type ? 'Type: ' + type : '', sale_info, contact_person: '', product: '' };
  }

  const ei = findEmail(p);
  let name = '', ctry = country, email = '', oRaw = '', note = '';
  if (ei >= 0) {
    email = p[ei].replace(/\s/g, '');
    name = p[0] || '';
    ctry = knownC.find(c => (p[2] || '').toLowerCase().startsWith(c.toLowerCase())) || country;
    oRaw = p[ei + 1] || '';
    note = p[ei + 2] || '';
  } else { name = p[0] || ''; }

  const saleRaw = [oRaw, note, ...p].find(x => isSaleField(x)) || '';
  const outreaches = oRaw ? parseOtrField(oRaw, isSaleField(oRaw)) : [];
  const hasSale = !!saleRaw;
  const status = hasSale ? 'won' : outreaches.length > 0 ? 'outreach_done' : 'not_contacted';
  if (!name && !email) return null;
  return { name, category: cat, country: ctry, email, phone: '', city: '', status, _outreaches: outreaches, notes: note, sale_info: saleRaw, contact_person: '', product: '' };
}

// ─── Mini chart components ───────────────────────────────────────────────────
function MiniLineChart({ data }) {
  if (!data || data.length < 2) return <div style={{ color: '#4b5563', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>Ikke nok data endnu</div>;
  const W = 400, H = 120, PAD = 20;
  const vals = data.map(d => d.revenue);
  const mx = Math.max(...vals) || 1, mn = Math.min(...vals);
  const px = (v, i) => ({ x: PAD + (i / (data.length - 1)) * (W - PAD * 2), y: H - PAD - ((v - mn) / (mx - mn || 1)) * (H - PAD * 2) });
  const pts = data.map((d, i) => px(d.revenue, i));
  const path = 'M' + pts.map(p => p.x + ',' + p.y).join('L');
  const area = path + 'L' + pts[pts.length - 1].x + ',' + (H - PAD) + 'L' + pts[0].x + ',' + (H - PAD) + 'Z';
  return (
    <svg width="100%" viewBox={'0 0 ' + W + ' ' + H} style={{ overflow: 'visible' }}>
      <defs><linearGradient id="gr" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.35" />
        <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
      </linearGradient></defs>
      <path d={area} fill="url(#gr)" />
      <path d={path} fill="none" stroke="#0ea5e9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3.5} fill="#0ea5e9" stroke="#0a0f1e" strokeWidth={2} />
          <text x={p.x} y={H + 2} textAnchor="middle" fontSize={9} fill="#4b5563">{data[i].label}</text>
        </g>
      ))}
    </svg>
  );
}
function HBarChart({ data }) {
  if (!data || data.length === 0) return null;
  const mx = Math.max(...data.map(d => d.revenue)) || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {data.slice(0, 8).map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 100, fontSize: 11, color: '#6b7280', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
          <div style={{ flex: 1, background: '#0d1420', borderRadius: 4, height: 16, overflow: 'hidden' }}>
            <div style={{ width: ((d.revenue / mx) * 100) + '%', height: '100%', background: 'linear-gradient(90deg,#6366f1,#0ea5e9)', borderRadius: 4, minWidth: 4 }} />
          </div>
          <div style={{ width: 75, fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap' }}>{d.revenue.toLocaleString('da-DK')} kr</div>
        </div>
      ))}
    </div>
  );
}

function groupByMonth(orders) {
  const map = {};
  for (const o of orders) {
    if (o.financial_status !== 'paid' && o.financial_status !== 'partially_paid') continue;
    const d = new Date(o.created_at);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const label = d.toLocaleString('da-DK', { month: 'short' });
    if (!map[key]) map[key] = { key, label, revenue: 0, orders: 0 };
    map[key].revenue += parseFloat(o.total_price || 0);
    map[key].orders++;
  }
  return Object.values(map).sort((a, b) => a.key.localeCompare(b.key)).slice(-10);
}
function groupByProduct(orders) {
  const map = {};
  for (const o of orders) {
    if (o.financial_status !== 'paid' && o.financial_status !== 'partially_paid') continue;
    for (const item of (o.line_items || [])) {
      const name = item.title || 'Ukendt';
      if (!map[name]) map[name] = { name, qty: 0, revenue: 0 };
      map[name].qty += item.quantity || 0;
      map[name].revenue += parseFloat(item.price || 0) * (item.quantity || 0);
    }
  }
  return Object.values(map).sort((a, b) => b.revenue - a.revenue);
}

function StatusBadge({ value }) {
  const s = STATUS_OPTIONS.find(o => o.value === value) || STATUS_OPTIONS[0];
  return <span style={{ background: s.color + '22', color: s.color, border: `1px solid ${s.color}44`, borderRadius: 6, padding: '2px 10px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{s.label}</span>;
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function CRMApp() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('dashboard');
  const [sel, setSel] = useState(null);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [newUserModal, setNewUserModal] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserError, setNewUserError] = useState('');
  const [newUserLoading, setNewUserLoading] = useState(false);
  const [newUserSuccess, setNewUserSuccess] = useState('');
  const [templates, setTemplates] = useState([]);
  const [tplLoading, setTplLoading] = useState(false);
  const [editTpl, setEditTpl] = useState(null);
  const [tplCats, setTplCats] = useState(new Set());
  const [tplPreviewLeadId, setTplPreviewLeadId] = useState(null);
  const [detailTplId, setDetailTplId] = useState('');
  const [editLead, setEditLead] = useState(null);
  const [scrapeUrls, setScrapeUrls] = useState('');
  const [scrapeCountry, setScrapeCountry] = useState('Danmark');
  const [scrapeCategory, setScrapeCategory] = useState('');
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [scrapeStartedAt, setScrapeStartedAt] = useState(null);
  const [scrapeElapsed, setScrapeElapsed] = useState(0);
  const [scrapeErrors, setScrapeErrors] = useState([]);
  const [scrapeNamesRaw, setScrapeNamesRaw] = useState('');
  const [scrapeSmartKeywords, setScrapeSmartKeywords] = useState('');
  const [scrapeCustomCategory, setScrapeCustomCategory] = useState('');
  const [scrapeCustomCountry, setScrapeCustomCountry] = useState('');
  const [scrapeClearField, setScrapeClearField] = useState('city');
  const [scrapeProgress, setScrapeProgress] = useState({ done: 0, total: 0, current: '' });
  const scrapeAbortRef = useRef(false);

  // Campaign modal state
  const [campaignModal, setCampaignModal] = useState(null); // null | { tpl }
  const [campaignCats, setCampaignCats] = useState(new Set());
  const [campaignCatOpen, setCampaignCatOpen] = useState(false);
  const [campaignCatSearch, setCampaignCatSearch] = useState('');
  const [campaignCatHierOpen, setCampaignCatHierOpen] = useState(new Set());
  const [campaignCountry, setCampaignCountry] = useState('Alle');
  const [campaignStatus, setCampaignStatus] = useState('not_contacted');

  useEffect(() => {
    if (!scrapeLoading || !scrapeStartedAt) return;
    const id = setInterval(() => {
      setScrapeElapsed(Math.floor((Date.now() - scrapeStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [scrapeLoading, scrapeStartedAt]);
  const [scrapeRows, setScrapeRows] = useState([]);
  const scrapeNameLinesRaw = (scrapeNamesRaw || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const isLikelyNameLine = (line) => {
    if (!line) return false;
    const lower = line.toLowerCase();
    if (lower.includes('@') || lower.includes('http') || lower.includes('www.')) return false;
    if (/(telefon|tlf|mail|e-mail|adresse|postnr|postcode|by)\s*:?/i.test(lower)) return false;
    const digits = (line.match(/\d/g) || []).length;
    const letters = (line.match(/[A-Za-zÆØÅæøå]/g) || []).length;
    if (digits && digits >= letters) return false;
    return true;
  };
  const filteredNameLines = scrapeNameLinesRaw.filter(isLikelyNameLine);
  const scrapeNameCounts = {};
  filteredNameLines.forEach(n => {
    scrapeNameCounts[n] = (scrapeNameCounts[n] || 0) + 1;
  });
  const scrapeNameDupes = Object.keys(scrapeNameCounts).filter(n => scrapeNameCounts[n] > 1);
  const scrapeNameLines = [];
  const scrapeNameSeen = new Set();
  filteredNameLines.forEach(n => {
    if (scrapeNameSeen.has(n)) return;
    scrapeNameSeen.add(n);
    scrapeNameLines.push(n);
  });
  const [search, setSearch] = useState('');
  const [fCats, setFCats] = useState(new Set());
  const [fStatus, setFStatus] = useState('Alle');
  const [fCountry, setFCountry] = useState('Alle');
  const [fMissingEmail, setFMissingEmail] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [catSearch, setCatSearch] = useState('');
  const [catHierOpen, setCatHierOpen] = useState(new Set());
  const [tplCatOpen, setTplCatOpen] = useState(false);
  const [tplCatSearch, setTplCatSearch] = useState('');
  const [settingsRename, setSettingsRename] = useState({});
  const [newOtr, setNewOtr] = useState({ ...DEFAULT_OTR });
  const [editOtrId, setEditOtrId] = useState(null);
  const [editOtr, setEditOtr] = useState(null);
  const [iText, setIText] = useState('');
  const [iPrev, setIPrev] = useState([]);
  const [bulk, setBulk] = useState(false);
  const [bulkSel, setBulkSel] = useState(new Set());
  const [bulkSt, setBulkSt] = useState('outreach_done');
  const [bulkDate, setBulkDate] = useState('');
  const [bulkBy, setBulkBy] = useState('Jeppe');
  const [bulkNote, setBulkNote] = useState('');
  const [bulkSale, setBulkSale] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [tplCatCustom, setTplCatCustom] = useState('');
  const [shopDomain, setShopDomain] = useState('');
  const [shopToken, setShopToken] = useState('');
  const [shopOrders, setShopOrders] = useState([]);
  const [shopLoading, setShopLoading] = useState(false);
  const [shopError, setShopError] = useState('');
  const [shopOK, setShopOK] = useState(false);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();
  const excelRef = useRef();
  const dragSelRef = useRef({ active: false, mode: true, startIdx: -1, originalSel: null });
  const [lastImportIds, setLastImportIds] = useState([]);
  const [deleteAllStep, setDeleteAllStep] = useState(0);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState('');
  const [dupModal, setDupModal] = useState(null);
  const [previewTpl, setPreviewTpl] = useState(null);

  // ── Auth session ────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setUser(data.session?.user || null);
      } finally {
        if (mounted) setAuthLoading(false);
      }
    };
    init();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Set outreach "by" to logged-in user's email
  useEffect(() => {
    if (user?.email) setNewOtr(o => ({ ...o, by: user.email }));
  }, [user]);

  // ── Drag-select: stop on mouseup anywhere ───────────────────────────────
  useEffect(() => {
    const up = () => { dragSelRef.current.active = false; };
    document.addEventListener('mouseup', up);
    return () => document.removeEventListener('mouseup', up);
  }, []);

  // ── Load from Supabase ──────────────────────────────────────────────────
  useEffect(() => {
    loadLeads();
    loadTemplates();
  }, []);

  const loadLeads = async () => {
    setLoading(true);
    try {
      // Fetch ALL leads i batches af 1000 (Supabase har 1000-row limit pr. query)
      let leadsData = [];
      let lFrom = 0;
      const LBatch = 1000;
      while (true) {
        const { data: lBatch, error: lError } = await supabase
          .from('leads')
          .select('*')
          .order('created_at', { ascending: false })
          .range(lFrom, lFrom + LBatch - 1);
        if (lError) throw lError;
        leadsData = leadsData.concat(lBatch || []);
        if ((lBatch || []).length < LBatch) break;
        lFrom += LBatch;
      }

      // Fetch ALL outreaches i batches af 1000 (Supabase default limit)
      let outreachData = [];
      let oFrom = 0;
      const OBatch = 1000;
      while (true) {
        const { data: oBatch, error: oError } = await supabase
          .from('outreaches').select('*').order('date', { ascending: true }).range(oFrom, oFrom + OBatch - 1);
        if (oError) throw oError;
        outreachData = outreachData.concat(oBatch || []);
        if ((oBatch || []).length < OBatch) break;
        oFrom += OBatch;
      }

      // Merge outreaches into leads
      const oByLead = {};
      for (const o of (outreachData || [])) {
        if (!oByLead[o.lead_id]) oByLead[o.lead_id] = [];
        oByLead[o.lead_id].push(o);
      }
      const merged = (leadsData || []).map(l => ({ ...l, outreaches: oByLead[l.id] || [] }));
      setLeads(merged);
    } catch (e) {
      msg('Fejl ved indlæsning: ' + e.message, 'err');
    }
    setLoading(false);
  };

  const loadTemplates = async () => {
    setTplLoading(true);
    try {
      const { data, error } = await supabase
        .from('email_templates')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      setTemplates(data || []);
    } catch (e) {
      msg('Fejl ved indlæsning af templates: ' + e.message, 'err');
    }
    setTplLoading(false);
  };

  const msg = (m, t = 'ok') => { setToast({ m, t }); setTimeout(() => setToast(null), 3000); };

  const paid = shopOrders.filter(o => o.financial_status === 'paid' || o.financial_status === 'partially_paid');
  const totalRev = paid.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
  const monthly = groupByMonth(shopOrders);
  const products = groupByProduct(shopOrders);
  const thisMo = new Date().toISOString().slice(0, 7);
  const lastMo = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 7);
  const revThis = monthly.find(m => m.key === thisMo)?.revenue || 0;
  const revLast = monthly.find(m => m.key === lastMo)?.revenue || 0;
  const growth = revLast > 0 ? ((revThis - revLast) / revLast * 100) : 0;

  const stats = {
    total: leads.length,
    won: leads.filter(l => l.status === 'won').length,
    out: leads.filter(l => l.status === 'outreach_done').length,
    nc: leads.filter(l => l.status === 'not_contacted').length,
  };

  const notesList = sel ? parseLeadNotes(sel.notes) : [];

  const runP = txt => {
    if (!txt.trim()) return [];
    const sep = detectSeparator(txt);
    const rows = parseCSVFull(txt.trim(), sep);
    const headerIdx = rows.findIndex(r => isHeader(r));
    const colMap = headerIdx >= 0 ? buildColMap(rows[headerIdx]) : { otrCols: [] };
    // Brug header-format hvis vi kan finde enten navn, mail, land eller kategori i headeren
    const useHeaderFormat =
      headerIdx >= 0 &&
      (colMap.navn != null || colMap.mail != null || colMap.land != null || colMap.kategori != null);
    const dataRows = headerIdx >= 0 ? rows.filter((_, i) => i !== headerIdx) : rows;
    return dataRows.map(row =>
      useHeaderFormat ? parseLineWithMap(row, colMap, '', '') : parseLineLegacy(row, '', '')
    ).filter(Boolean);
  };

  // Dynamic unique categories from loaded leads (sorted)
  const allCats = [...new Set(leads.map(l => l.category).filter(Boolean))].sort();

  // Dynamic unique countries from loaded leads
  const allCountries = [...new Set(leads.map(l => l.country).filter(Boolean))].sort();

  // Build category hierarchy: { parentName, subs: [fullCatName] }
  // If parent parsed as empty string, use the subcategory name as a standalone entry
  const catHierarchy = (() => {
    const parents = {};
    for (const cat of allCats) {
      const m = cat.match(/^(.+?)\s*\((.+)\)$/);
      const parent = m ? m[1].trim() : cat;
      if (!parent) {
        // Empty parent → treat the sub as a standalone entry
        const key = m ? m[2].trim() : cat;
        if (!parents[key]) parents[key] = { name: key, subs: [] };
      } else {
        if (!parents[parent]) parents[parent] = { name: parent, subs: [] };
        if (m) parents[parent].subs.push(cat);
      }
    }
    return Object.values(parents).sort((a, b) => a.name.localeCompare(b.name));
  })();

  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc'); // 'asc' | 'desc'

  const filtered = leads.filter(l => {
    if (fCats.size > 0 && !fCats.has(l.category)) return false;
    if (fStatus !== 'Alle' && l.status !== fStatus) return false;
    if (fCountry !== 'Alle' && l.country !== fCountry) return false;
    if (fMissingEmail && l.email) return false;
    if (search) { const q = search.toLowerCase(); if (!l.name.toLowerCase().includes(q) && !(l.email || '').toLowerCase().includes(q)) return false; }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const getVal = (lead) => {
      switch (sortKey) {
        case 'name': return (lead.name || '').toLowerCase();
        case 'category': return (lead.category || '').toLowerCase();
        case 'email': return (lead.email || '').toLowerCase();
        case 'country': return (lead.country || '').toLowerCase();
        case 'status': return (lead.status || '').toLowerCase();
        case 'outreach': return (lead.outreaches || []).length;
        case 'sale': return (lead.sale_info || '').toLowerCase();
        case 'created_at':
        default: return lead.created_at || '';
      }
    };
    const va = getVal(a);
    const vb = getVal(b);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });

  const resetFiltersAndSort = () => {
    setSearch('');
    setFCats(new Set());
    setFStatus('Alle');
    setFCountry('Alle');
    setFMissingEmail(false);
    setCatOpen(false);
    setCatSearch('');
    setCatHierOpen(new Set());
    setSortKey('created_at');
    setSortDir('desc');
  };

  const copyEmailsBulk = async () => {
    if (bulkSel.size === 0) return msg('Vælg leads i bulk først', 'err');
    try {
      const list = leads.filter(l => bulkSel.has(l.id) && l.email && /\S+@\S+\.\S+/.test(l.email));
      if (!list.length) return msg('Ingen gyldige emails blandt de valgte leads', 'err');
      const text = list.map(l => l.email.trim()).join(', ');
      await navigator.clipboard.writeText(text);
      msg(list.length + ' emails kopieret til udklipsholderen');
    } catch (e) {
      msg('Kunne ikke kopiere emails: ' + (e.message || ''), 'err');
    }
  };

  // ─── Email Campaign helpers ───────────────────────────────────────────────────
  const getCampaignLeads = () => {
    const bulkIds = campaignModal?.bulkIds;
    return leads.filter(l => {
      if (!l.email || !/\S+@\S+\.\S+/.test(l.email)) return false;
      if (bulkIds) return bulkIds.includes(l.id); // bulk selection overrides filters
      if (campaignCats.size > 0 && !campaignCats.has(l.category)) return false;
      if (campaignCountry !== 'Alle' && l.country !== campaignCountry) return false;
      if (campaignStatus !== 'Alle' && l.status !== campaignStatus) return false;
      return true;
    });
  };

  // opts: { useCurrentFilters: bool, bulkIds: Set|null }
  const openCampaign = (tpl, opts = {}) => {
    const { useCurrentFilters = false, bulkIds = null } = opts;
    setCampaignCatOpen(false);
    setCampaignCatSearch('');
    setCampaignCatHierOpen(new Set());
    if (bulkIds && bulkIds.size > 0) {
      // Use the exact selected leads, ignore filters
      setCampaignCats(new Set());
      setCampaignCountry('Alle');
      setCampaignStatus('Alle');
      setCampaignModal({ tpl, bulkIds: [...bulkIds] });
    } else if (useCurrentFilters) {
      // Mirror the leads view's active filters
      setCampaignCats(new Set(fCats));
      setCampaignCountry(fCountry);
      setCampaignStatus(fStatus);
      setCampaignModal({ tpl });
    } else {
      // Default: pre-fill from template category_tags
      const preFill = new Set();
      for (const tag of (tpl?.category_tags || [])) {
        const parent = tag.match(/^(.+?)\s*\(/) ? tag.match(/^(.+?)\s*\(/)[1].trim() : tag;
        allCats.filter(c => c === tag || c.startsWith(parent + ' (') || c === parent).forEach(c => preFill.add(c));
      }
      setCampaignCats(preFill);
      setCampaignCountry('Alle');
      setCampaignStatus('not_contacted');
      setCampaignModal({ tpl });
    }
  };

  const campaignOpenGmail = async () => {
    if (!campaignModal) return;
    const { tpl } = campaignModal;
    const recipients = getCampaignLeads();
    const bccList = recipients.map(l => l.email.trim()).join(', ');
    const url = `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(tpl.subject || '')}&body=${encodeURIComponent(tpl.body || '')}`;
    try { await navigator.clipboard.writeText(bccList); } catch { /* ignore */ }
    window.open(url, '_blank');
    msg(`Gmail åbnet · ${recipients.length} BCC-emails kopieret – indsæt i BCC-feltet`);
  };

  const campaignOpenMailto = () => {
    if (!campaignModal) return;
    const { tpl } = campaignModal;
    const recipients = getCampaignLeads();
    // mailto: BCC is limited to ~2000 chars – use first 60 recipients
    const bccChunk = recipients.slice(0, 60).map(l => l.email.trim()).join(',');
    const href = `mailto:?bcc=${encodeURIComponent(bccChunk)}&subject=${encodeURIComponent(tpl.subject || '')}&body=${encodeURIComponent(tpl.body || '')}`;
    window.location.href = href;
    if (recipients.length > 60) {
      const allBcc = recipients.map(l => l.email.trim()).join(', ');
      navigator.clipboard.writeText(allBcc).catch(() => {});
      msg(`Åbner mailprogram med første 60. Alle ${recipients.length} emails kopieret til udklipsholderen – tilføj i BCC.`);
    } else {
      msg(`Åbner mailprogram med ${recipients.length} modtagere`);
    }
  };

  const campaignCopyBCC = async () => {
    if (!campaignModal) return;
    const recipients = getCampaignLeads();
    const text = recipients.map(l => l.email.trim()).join(', ');
    try {
      await navigator.clipboard.writeText(text);
      msg(`${recipients.length} BCC-emails kopieret til udklipsholderen`);
    } catch (e) { msg('Kunne ikke kopiere: ' + e.message, 'err'); }
  };

  const campaignMarkSent = async () => {
    if (!campaignModal) return;
    const recipients = getCampaignLeads();
    if (!recipients.length) return msg('Ingen leads valgt', 'err');
    if (!confirm(`Markér ${recipients.length} leads som "Outreach sendt"?`)) return;
    setSaving(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const CHUNK = 50;
      const ids = recipients.map(l => l.id);
      for (let i = 0; i < ids.length; i += CHUNK) {
        await supabase.from('leads').update({ status: 'outreach_done' }).in('id', ids.slice(i, i + CHUNK));
      }
      const rows = ids.map(id => ({ lead_id: id, date: today, by: 'Jeppe', note: `Email kampagne: ${campaignModal.tpl.name}`, sale_info: '' }));
      const OCHUNK = 100;
      for (let i = 0; i < rows.length; i += OCHUNK) {
        await supabase.from('outreaches').insert(rows.slice(i, i + OCHUNK));
      }
      await loadLeads();
      msg(`${recipients.length} leads opdateret til "Outreach sendt"`);
      setCampaignModal(null);
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
    setSaving(false);
  };

  const openTemplateMail = (lead) => {
    if (!lead) return;
    const tpl = templates.find(t => t.id === detailTplId);
    if (!tpl) return msg('Vælg en mail template først', 'err');
    if (!lead.email) return msg('Lead mangler email', 'err');
    const subject = renderTemplate(tpl.subject, lead) || '';
    const body = renderTemplate(tpl.body, lead) || '';
    if (typeof window === 'undefined') return;
    const mailto = `mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
  };

  const copyTemplateMail = async (lead) => {
    if (!lead) return;
    const tpl = templates.find(t => t.id === detailTplId);
    if (!tpl) return msg('Vælg en mail template først', 'err');
    try {
      const subject = renderTemplate(tpl.subject, lead) || '';
      const body = renderTemplate(tpl.body, lead) || '';
      const text = `Emne: ${subject}\n\n${body}`;
      await navigator.clipboard.writeText(text);
      msg('Mailtekst kopieret');
    } catch (e) {
      msg('Kunne ikke kopiere mailtekst: ' + (e.message || ''), 'err');
    }
  };

  // Core sequential scraper – processes one URL at a time, shows live progress, never times out
  const runScrapeUrls = async (urlList, country, category) => {
    if (!urlList.length) return msg('Indsæt mindst én URL', 'err');
    setScrapeLoading(true);
    setScrapeStartedAt(Date.now());
    setScrapeElapsed(0);
    setScrapeErrors([]);
    setScrapeRows([]);
    scrapeAbortRef.current = false;
    setScrapeProgress({ done: 0, total: urlList.length, current: '' });

    const allRows = [];
    const allErrors = [];

    for (let i = 0; i < urlList.length; i++) {
      if (scrapeAbortRef.current) break;
      const url = urlList[i];
      setScrapeProgress({ done: i, total: urlList.length, current: url });
      try {
        const res = await fetch('/api/scrape-emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: [url], country, category }),
        });
        let data;
        if (!res.ok) {
          allErrors.push({ url, reason: 'HTTP ' + res.status });
        } else {
          try { data = await res.json(); } catch { data = { leads: [], errors: [{ url, reason: 'invalid_json' }] }; }
          for (const r of (data.leads || [])) {
            if (!allRows.some(x => x.email && x.email === r.email)) {
              allRows.push({ ...r, _editCat: r.category || category || '' });
            }
          }
          allErrors.push(...(data.errors || []));
        }
      } catch (e) {
        allErrors.push({ url, reason: e.message || 'network_error' });
      }
      // Show partial results live
      setScrapeRows([...allRows]);
      setScrapeErrors([...allErrors]);
    }

    setScrapeProgress({ done: urlList.length, total: urlList.length, current: '' });
    msg(allRows.length + ' leads fundet');
    setScrapeLoading(false);
  };

  const runScrape = () => {
    const urls = (scrapeUrls || '').split(/\r?\n/).map(u => u.trim()).filter(Boolean);
    const effectiveCountry = scrapeCustomCountry.trim() || scrapeCountry;
    const effectiveCategory = scrapeCustomCategory.trim() || scrapeCategory;
    runScrapeUrls(urls, effectiveCountry, effectiveCategory);
  };

  const runNamesSearch = async () => {
    if (!scrapeNameLines.length) return msg('Ingen navne at søge på', 'err');
    const effectiveCountry = scrapeCustomCountry.trim() || scrapeCountry;
    const effectiveCategory = scrapeCustomCategory.trim() || scrapeCategory;
    setScrapeLoading(true);
    setScrapeStartedAt(Date.now());
    setScrapeElapsed(0);
    setScrapeErrors([]);
    setScrapeRows([]);
    scrapeAbortRef.current = false;
    const BATCH = 18; // 18 names per API call → 3 rounds of 6 parallel server-side
    const allRows = [];
    const allErrors = [];
    const total = scrapeNameLines.length;
    for (let bi = 0; bi < total; bi += BATCH) {
      if (scrapeAbortRef.current) break;
      const batch = scrapeNameLines.slice(bi, bi + BATCH);
      setScrapeProgress({ done: bi, total, current: batch[0] });
      try {
        const res = await fetch('/api/scrape-emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ names: batch, country: effectiveCountry, category: effectiveCategory }),
        });
        if (res.ok) {
          let data; try { data = await res.json(); } catch { data = { leads: [], errors: [] }; }
          for (const r of (data.leads || [])) {
            if (!allRows.some(x => x.email && x.email === r.email)) allRows.push({ ...r, _editCat: r.category || effectiveCategory || '' });
          }
          allErrors.push(...(data.errors || []));
        }
      } catch (e) { allErrors.push({ url: 'navne-batch', reason: e.message || 'network_error' }); }
      setScrapeRows([...allRows]);
      setScrapeErrors([...allErrors]);
    }
    setScrapeProgress({ done: total, total, current: '' });
    msg(allRows.length + ' leads fundet');
    setScrapeLoading(false);
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setNewUserError('');
    setNewUserSuccess('');
    setNewUserLoading(true);
    try {
      const res = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newUserEmail.trim(), password: newUserPassword, name: newUserName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setNewUserError(data.error || 'Ukendt fejl'); }
      else {
        setNewUserSuccess('Bruger oprettet! ' + newUserEmail.trim() + ' kan nu logge ind.');
        setNewUserEmail('');
        setNewUserPassword('');
        setNewUserName('');
      }
    } catch (e) { setNewUserError(e.message || 'Ukendt fejl'); }
    setNewUserLoading(false);
  };

  const cancelScrape = () => {
    scrapeAbortRef.current = true;
    setScrapeLoading(false);
    msg('Scraping stoppet – resultater er gemt');
  };

  const generateSmartUrls = (autoRun = false) => {
    const effectiveCountry = scrapeCustomCountry.trim() || scrapeCountry;
    const effectiveCategory = scrapeCustomCategory.trim() || scrapeCategory;
    const locale = DDG_LOCALE[effectiveCountry] || 'wt-wt';
    let terms;
    if (scrapeSmartKeywords.trim()) {
      terms = scrapeSmartKeywords.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    } else if (effectiveCategory && SMART_SEARCH_TERMS[effectiveCategory]?.[effectiveCountry]) {
      terms = SMART_SEARCH_TERMS[effectiveCategory][effectiveCountry];
    } else {
      const emailKw = ['Danmark', 'Norge', 'Sverige', 'Finland'].includes(effectiveCountry) ? '"e-post" OR "kontakt@"' : '"email" OR "contact@"';
      terms = [
        `${effectiveCategory || 'kontakt'} ${emailKw} ${effectiveCountry}`,
        `${effectiveCategory} kontakt ${effectiveCountry}`,
      ].filter(t => t.trim());
    }
    const urls = terms.map(t => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(t)}&kl=${locale}`);
    setScrapeUrls(urls.join('\n'));
    msg(urls.length + ' søge-URLs genereret (DuckDuckGo)');
    if (autoRun) {
      setTimeout(() => runScrapeUrls(urls, effectiveCountry, effectiveCategory), 80);
    }
  };

  const updateScrapeRow = (idx, field, value) => {
    setScrapeRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const deleteScrapeRow = (idx) => {
    setScrapeRows(prev => prev.filter((_, i) => i !== idx));
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: authEmail.trim(),
        password: authPassword,
      });
      if (error) throw error;
      msg('Logget ind');
    } catch (e) {
      setAuthError(e.message || 'Login fejlede');
      msg('Login fejlede: ' + e.message, 'err');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
    } catch (e) {
      msg('Kunne ikke logge ud: ' + e.message, 'err');
    }
  };

  const openNewTemplate = () => {
    setEditTpl({
      id: null,
      name: '',
      type: 'cold_outreach',
      subject: '',
      body: '',
      language: 'da',
      from_email: '',
      active: true,
      category_tags: [],
    });
    setTplCats(new Set());
  };

  const openEditTemplate = (tpl) => {
    setEditTpl(tpl);
    setTplCats(new Set(tpl.category_tags || []));
  };

  const saveTemplate = async () => {
    if (!editTpl || !editTpl.name.trim()) return msg('Navn er påkrævet', 'err');
    if (!editTpl.subject.trim()) return msg('Subject er påkrævet', 'err');
    setSaving(true);
    try {
      const payload = {
        name: editTpl.name.trim(),
        type: editTpl.type || 'cold_outreach',
        subject: editTpl.subject,
        body: editTpl.body,
        language: editTpl.language || 'da',
        from_email: editTpl.from_email || null,
        active: editTpl.active !== false,
        category_tags: [...tplCats],
      };
      if (editTpl.id) {
        const { data, error } = await supabase.from('email_templates').update(payload).eq('id', editTpl.id).select().single();
        if (error) throw error;
        setTemplates(templates.map(t => t.id === editTpl.id ? data : t));
        setEditTpl(data);
        msg('Template opdateret');
      } else {
        const { data, error } = await supabase.from('email_templates').insert(payload).select().single();
        if (error) throw error;
        setTemplates([data, ...templates]);
        setEditTpl(data);
        msg('Template oprettet');
      }
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
    setSaving(false);
  };

  const deleteTemplate = async (tpl) => {
    if (!tpl?.id) return;
    if (!confirm(`Slet template "${tpl.name}"?`)) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('email_templates').delete().eq('id', tpl.id);
      if (error) throw error;
      setTemplates(templates.filter(t => t.id !== tpl.id));
      if (editTpl && editTpl.id === tpl.id) setEditTpl(null);
      msg('Template slettet');
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
    setSaving(false);
  };

  const openAdd = () => { setEditLead({ ...DEFAULT_LEAD }); setView('add'); };
  const openEdit = l => { setEditLead({ ...l }); setView('add'); };

  const sendScrapeToImport = () => {
    if (!scrapeRows.length) return msg('Ingen scraped leads at sende', 'err');
    const header = ['Navn', 'Kategori', 'Underkategori', 'Land', 'Mail', 'Telefon', 'By', 'Website', 'B2B Outreach 1', 'Salg/Udbytte', 'Kontaktperson'];
    const lines = [header.join(',')];
    scrapeRows.forEach(r => {
      lines.push([
        r.name || '',
        r._editCat || r.category || scrapeCategory || '',
        r.underkategori || '',
        r.country || scrapeCountry || '',
        r.email || '',
        r.phone || '',
        r.city || '',
        r.website || '',
        '', // outreach tom
        '', // salg tom
        r.contact_person || '',
      ].map(v => `"${(v || '').replace(/"/g, '""')}"`).join(','));
    });
    const csv = lines.join('\n');
    setIText(csv);
    setIPrev(runP(csv));
    setView('import');
    msg(scrapeRows.length + ' scraped leads sendt til import');
  };

  const copyScrapeTable = async () => {
    if (!scrapeRows.length) return msg('Ingen scraped leads at kopiere', 'err');
    try {
      const header = ['Navn', 'Kategori', 'Underkategori', 'Land', 'Mail', 'Telefon', 'By', 'Website', 'B2B Outreach 1', 'Salg/Udbytte', 'Kontaktperson'];
      const lines = [header.join('\t')];
      scrapeRows.forEach(r => {
        lines.push([
          r.name || '',
          r._editCat || r.category || scrapeCategory || '',
          r.underkategori || '',
          r.country || scrapeCountry || '',
          r.email || '',
          r.phone || '',
          r.city || '',
          r.website || '',
          '',
          '',
          r.contact_person || '',
        ].join('\t'));
      });
      const text = lines.join('\n');
      await navigator.clipboard.writeText(text);
      msg(scrapeRows.length + ' rækker kopieret til udklipsholderen');
    } catch (e) {
      msg('Kunne ikke kopiere tabel: ' + (e.message || ''), 'err');
    }
  };

  const clearScrape = () => {
    setScrapeRows([]);
    setScrapeUrls('');
    msg('Scraperesultat ryddet');
  };

  const saveLead = async () => {
    if (!editLead.name.trim()) return msg('Navn er påkrævet', 'err');
    setSaving(true);
    try {
      const isExisting = leads.find(l => l.id === editLead.id);
      const payload = {
        name: editLead.name, category: editLead.category, country: editLead.country,
        email: editLead.email, phone: editLead.phone, city: editLead.city, website: editLead.website,
        status: editLead.status, notes: editLead.notes, sale_info: editLead.sale_info,
        contact_person: editLead.contact_person, product: editLead.product,
      };
      if (isExisting) {
        const { error } = await supabase.from('leads').update(payload).eq('id', editLead.id);
        if (error) throw error;
        setLeads(leads.map(l => l.id === editLead.id ? { ...l, ...payload } : l));
        msg('Opdateret');
      } else {
        const { data, error } = await supabase.from('leads').insert(payload).select().single();
        if (error) throw error;
        setLeads([{ ...data, outreaches: [] }, ...leads]);
        msg('Tilføjet');
      }
      setView('list'); setEditLead(null);
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
    setSaving(false);
  };

  const delLead = async id => {
    if (!confirm('Slet dette lead?')) return;
    try {
      await supabase.from('outreaches').delete().eq('lead_id', id);
      const { error } = await supabase.from('leads').delete().eq('id', id);
      if (error) throw error;
      setLeads(leads.filter(l => l.id !== id));
      setView('list'); msg('Slettet');
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
  };

  const addOtr = async lead => {
    if (!newOtr.date) return msg('Vælg dato', 'err');
    let status = lead.status;
    if (newOtr.sale_info?.trim()) status = 'won';
    else if (lead.status === 'not_contacted') status = 'outreach_done';
    try {
      const { data, error } = await supabase.from('outreaches').insert({
        lead_id: lead.id, date: newOtr.date, by: newOtr.by, note: newOtr.note, sale_info: newOtr.sale_info || ''
      }).select().single();
      if (error) throw error;
      // Update lead status if changed
      if (status !== lead.status) {
        const saleInfo = newOtr.sale_info?.trim() ? newOtr.sale_info : lead.sale_info;
        await supabase.from('leads').update({ status, sale_info: saleInfo }).eq('id', lead.id);
        const updated = { ...lead, status, sale_info: saleInfo, outreaches: [...(lead.outreaches || []), data] };
        setLeads(leads.map(l => l.id === lead.id ? updated : l));
        setSel(updated);
      } else {
        const updated = { ...lead, outreaches: [...(lead.outreaches || []), data] };
        setLeads(leads.map(l => l.id === lead.id ? updated : l));
        setSel(updated);
      }
      setNewOtr({ ...DEFAULT_OTR }); msg('Outreach tilføjet');
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
  };

  const saveEditOtr = async lead => {
    try {
      const { error } = await supabase.from('outreaches').update({
        date: editOtr.date, by: editOtr.by, note: editOtr.note, sale_info: editOtr.sale_info || ''
      }).eq('id', editOtrId);
      if (error) throw error;
      const updated = { ...lead, outreaches: lead.outreaches.map(o => o.id === editOtrId ? { ...o, ...editOtr } : o) };
      setLeads(leads.map(l => l.id === lead.id ? updated : l));
      setSel(updated); setEditOtrId(null); setEditOtr(null); msg('Opdateret');
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
  };

  const clearSale = async lead => {
    if (!lead) return;
    if (!lead.sale_info && lead.status !== 'won') return;
    if (!confirm('Fjern salg fra dette lead?')) return;
    setSaving(true);
    try {
      let newStatus = lead.status;
      if (lead.status === 'won') {
        newStatus = (lead.outreaches && lead.outreaches.length > 0) ? 'outreach_done' : 'not_contacted';
      }
      // Clear sale on lead and all related outreaches
      const { error } = await supabase.from('leads').update({ sale_info: '', status: newStatus }).eq('id', lead.id);
      if (error) throw error;
      await supabase.from('outreaches').update({ sale_info: '' }).eq('lead_id', lead.id);
      const updatedOtrs = (lead.outreaches || []).map(o => ({ ...o, sale_info: '' }));
      const updated = { ...lead, sale_info: '', status: newStatus, outreaches: updatedOtrs };
      setLeads(leads.map(l => l.id === lead.id ? updated : l));
      setSel(updated);
      msg('Salg fjernet');
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
    setSaving(false);
  };

  const addDetailNote = async lead => {
    if (!lead) return;
    if (!noteTitle.trim() && !noteBody.trim()) return msg('Skriv mindst titel eller tekst', 'err');
    setSaving(true);
    try {
      const existing = parseLeadNotes(lead.notes);
      const now = new Date().toISOString();
      const note = {
        id: 'n_' + now + '_' + Math.random().toString(36).slice(2, 8),
        title: noteTitle.trim() || 'Note',
        text: noteBody.trim(),
        created_at: now,
      };
      const next = [...existing, note];
      const raw = JSON.stringify(next);
      const { error } = await supabase.from('leads').update({ notes: raw }).eq('id', lead.id);
      if (error) throw error;
      const updated = { ...lead, notes: raw };
      setLeads(leads.map(l => l.id === lead.id ? updated : l));
      setSel(updated);
      setNoteTitle(''); setNoteBody('');
      msg('Note tilføjet');
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
    setSaving(false);
  };

  const deleteDetailNote = async (lead, noteId) => {
    if (!lead) return;
    const existing = parseLeadNotes(lead.notes);
    const next = existing.filter(n => n.id !== noteId);
    if (existing.length === next.length) return;
    if (!confirm('Slet denne note?')) return;
    setSaving(true);
    try {
      const raw = next.length ? JSON.stringify(next) : null;
      const { error } = await supabase.from('leads').update({ notes: raw }).eq('id', lead.id);
      if (error) throw error;
      const updated = { ...lead, notes: raw };
      setLeads(leads.map(l => l.id === lead.id ? updated : l));
      setSel(updated);
      msg('Note slettet');
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
    setSaving(false);
  };

  const delOtr = async (lead, id) => {
    try {
      const { error } = await supabase.from('outreaches').delete().eq('id', id);
      if (error) throw error;
      const updated = { ...lead, outreaches: lead.outreaches.filter(o => o.id !== id) };
      setLeads(leads.map(l => l.id === lead.id ? updated : l));
      setSel(updated);
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
  };

  const updSt = async (lead, status) => {
    try {
      const { error } = await supabase.from('leads').update({ status }).eq('id', lead.id);
      if (error) throw error;
      const updated = { ...lead, status };
      setLeads(leads.map(l => l.id === lead.id ? updated : l));
      setSel(updated); msg('Status opdateret');
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
  };

  const applyBulk = async () => {
    if (bulkSel.size === 0) return msg('Vælg leads', 'err');
    setSaving(true);
    try {
      const ids = [...bulkSel];
      // If sale is filled, force status to 'won'
      const effectiveStatus = bulkSale.trim() ? 'won' : bulkSt;
      const updatePayload = { status: effectiveStatus };
      if (bulkSale.trim()) updatePayload.sale_info = bulkSale.trim();
      const CHUNK = 50;
      for (let i = 0; i < ids.length; i += CHUNK) {
        await supabase.from('leads').update(updatePayload).in('id', ids.slice(i, i + CHUNK));
      }
      if (bulkDate || bulkNote.trim() || bulkSale.trim()) {
        const today = new Date().toISOString().split('T')[0];
        const rows = ids.map(id => ({ lead_id: id, date: bulkDate || today, by: bulkBy, note: bulkNote, sale_info: bulkSale.trim() || '' }));
        await supabase.from('outreaches').insert(rows);
      }
      await loadLeads();
      msg(bulkSel.size + ' leads opdateret');
      setBulkSel(new Set()); setBulk(false); setBulkSale('');
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
    setSaving(false);
  };

  const bulkDelete = async () => {
    if (bulkSel.size === 0) return msg('Vælg leads', 'err');
    if (!confirm(`Slet ${bulkSel.size} leads permanent? Dette kan ikke fortrydes.`)) return;
    setSaving(true);
    try {
      const ids = [...bulkSel];
      // Batch in chunks of 50 to avoid PostgREST URL length limits
      const CHUNK = 50;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const batch = ids.slice(i, i + CHUNK);
        await supabase.from('outreaches').delete().in('lead_id', batch);
        const { error } = await supabase.from('leads').delete().in('id', batch);
        if (error) throw error;
      }
      setLeads(leads.filter(l => !bulkSel.has(l.id)));
      msg(ids.length + ' leads slettet');
      setBulkSel(new Set()); setBulk(false);
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
    setSaving(false);
  };

  const deleteAllLeads = async () => {
    setSaving(true);
    try {
      await supabase.from('outreaches').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('leads').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      setLeads([]); msg('Alle leads slettet');
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
    setSaving(false);
    setDeleteAllStep(0);
    setDeleteAllConfirmText('');
  };

  const exportBackupCSV = () => {
    if (!leads.length) {
      msg('Ingen leads at eksportere', 'err');
      return;
    }
    const maxOtr = Math.max(0, ...leads.map(l => (l.outreaches || []).length));
    const headers = [
      'Navn',
      'Kategori',
      'Underkategori',
      'Land',
      'Mail',
      'Kontaktperson',
      'Telefon',
      'By',
      'Website',
      'Status',
      'Noter',
      'Salg/Udbytte',
    ];
    for (let i = 1; i <= maxOtr; i++) {
      headers.push(`B2B Outreach ${i}`);
    }
    const esc = v => {
      const s = (v ?? '').toString().replace(/"/g, '""');
      return `"${s}"`;
    };
    const rows = leads.map(l => {
      const { base, sub } = splitCategory(l.category || '');
      const notesArr = parseLeadNotes(l.notes);
      const notesStr = notesArr
        .map(n => {
          const t = n.title ? `${n.title}: ` : '';
          return (t + (n.text || '')).trim();
        })
        .filter(Boolean)
        .join(' || ');
      const otrStrings = (l.outreaches || []).map(o => {
        const d = o.date ? fmtDate(o.date) : '';
        const parts = [];
        if (o.by) parts.push(o.by);
        if (d) parts.push(d);
        if (o.note) parts.push(o.note);
        return parts.join(', ');
      });
      const baseCols = [
        esc(l.name || ''),
        esc(base || l.category || ''),
        esc(sub || ''),
        esc(l.country || ''),
        esc(l.email || ''),
        esc(l.contact_person || ''),
        esc(l.phone || ''),
        esc(l.city || ''),
        esc(l.website || ''),
        esc(l.status || ''),
        esc(notesStr),
        esc(l.sale_info || ''),
      ];
      const otrCols = [];
      for (let i = 0; i < maxOtr; i++) {
        otrCols.push(esc(otrStrings[i] || ''));
      }
      return baseCols.concat(otrCols).join(';');
    });
    const csv = [headers.map(h => esc(h)).join(';'), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `surfmore_crm_backup_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    msg('Backup eksporteret som CSV');
  };

  const exportBackupCSVByCategory = () => {
    if (!leads.length) {
      msg('Ingen leads at eksportere', 'err');
      return;
    }
    const byCat = {};
    for (const l of leads) {
      const { base } = splitCategory(l.category || '');
      const key = base || l.category || 'Ukendt kategori';
      if (!byCat[key]) byCat[key] = [];
      byCat[key].push(l);
    }
    const esc = v => {
      const s = (v ?? '').toString().replace(/"/g, '""');
      return `"${s}"`;
    };
    Object.entries(byCat).forEach(([catName, group]) => {
      const maxOtr = Math.max(0, ...group.map(l => (l.outreaches || []).length));
      const headers = [
        'Navn',
        'Kategori',
        'Underkategori',
        'Land',
        'Mail',
        'Kontaktperson',
        'Telefon',
        'By',
        'Website',
        'Status',
        'Noter',
        'Salg/Udbytte',
      ];
      for (let i = 1; i <= maxOtr; i++) {
        headers.push(`B2B Outreach ${i}`);
      }
      const rows = group.map(l => {
        const { base, sub } = splitCategory(l.category || '');
        const notesArr = parseLeadNotes(l.notes);
        const notesStr = notesArr
          .map(n => {
            const t = n.title ? `${n.title}: ` : '';
            return (t + (n.text || '')).trim();
          })
          .filter(Boolean)
          .join(' || ');
        const otrStrings = (l.outreaches || []).map(o => {
          const d = o.date ? fmtDate(o.date) : '';
          const parts = [];
          if (o.by) parts.push(o.by);
          if (d) parts.push(d);
          if (o.note) parts.push(o.note);
          return parts.join(', ');
        });
        const baseCols = [
          esc(l.name || ''),
          esc(base || l.category || ''),
          esc(sub || ''),
          esc(l.country || ''),
          esc(l.email || ''),
          esc(l.contact_person || ''),
          esc(l.phone || ''),
          esc(l.city || ''),
          esc(l.website || ''),
          esc(l.status || ''),
          esc(notesStr),
          esc(l.sale_info || ''),
        ];
        const otrCols = [];
        for (let i = 0; i < maxOtr; i++) {
          otrCols.push(esc(otrStrings[i] || ''));
        }
        return baseCols.concat(otrCols).join(';');
      });
      const csv = [headers.map(h => esc(h)).join(';'), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeCat = catName.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      a.download = `surfmore_crm_${safeCat}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
    msg('Backup eksporteret pr. kategori (flere filer)');
  };

  const exportBackupXLSX = () => {
    if (!leads.length) {
      msg('Ingen leads at eksportere', 'err');
      return;
    }
    const wb = XLSX.utils.book_new();

    const buildSheetData = (groupLeads) => {
      const maxOtr = Math.max(0, ...groupLeads.map(l => (l.outreaches || []).length));
      const headers = [
        'Navn',
        'Kategori',
        'Underkategori',
        'Land',
        'Mail',
        'Kontaktperson',
        'Telefon',
        'By',
        'Website',
        'Status',
        'Noter',
        'Salg/Udbytte',
      ];
      for (let i = 1; i <= maxOtr; i++) {
        headers.push(`B2B Outreach ${i}`);
      }
      const rows = groupLeads.map(l => {
        const { base, sub } = splitCategory(l.category || '');
        const notesArr = parseLeadNotes(l.notes);
        const notesStr = notesArr
          .map(n => {
            const t = n.title ? `${n.title}: ` : '';
            return (t + (n.text || '')).trim();
          })
          .filter(Boolean)
          .join(' || ');
        const otrStrings = (l.outreaches || []).map(o => {
          const d = o.date ? fmtDate(o.date) : '';
          const parts = [];
          if (o.by) parts.push(o.by);
          if (d) parts.push(d);
          if (o.note) parts.push(o.note);
          return parts.join(', ');
        });
        const row = [
          l.name || '',
          base || l.category || '',
          sub || '',
          l.country || '',
          l.email || '',
          l.contact_person || '',
          l.phone || '',
          l.city || '',
          l.website || '',
          l.status || '',
          notesStr,
          l.sale_info || '',
        ];
        for (let i = 0; i < maxOtr; i++) {
          row.push(otrStrings[i] || '');
        }
        return row;
      });
      return [headers, ...rows];
    };

    // Ark 1: alle leads
    const allData = buildSheetData(leads);
    const wsAll = XLSX.utils.aoa_to_sheet(allData);
    XLSX.utils.book_append_sheet(wb, wsAll, 'Alle leads');

    // Én fane pr. hovedkategori
    const byCat = {};
    for (const l of leads) {
      const { base } = splitCategory(l.category || '');
      const key = base || l.category || 'Ukendt kategori';
      if (!byCat[key]) byCat[key] = [];
      byCat[key].push(l);
    }
    Object.entries(byCat).forEach(([catName, group]) => {
      const data = buildSheetData(group);
      const ws = XLSX.utils.aoa_to_sheet(data);
      const safeName = catName.slice(0, 28); // Excel sheet name limit 31 incl. suffix
      XLSX.utils.book_append_sheet(wb, ws, safeName);
    });

    XLSX.writeFile(wb, `surfmore_crm_backup_${new Date().toISOString().slice(0, 10)}.xlsx`);
    msg('Backup eksporteret som Excel med faner');
  };

  const renameCategory = async (oldCat, newCat) => {
    if (!newCat.trim() || oldCat === newCat) return;
    try {
      const { error } = await supabase.from('leads').update({ category: newCat }).eq('category', oldCat);
      if (error) throw error;
      setLeads(leads.map(l => l.category === oldCat ? { ...l, category: newCat } : l));
      msg('Kategori omdøbt');
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
  };

  const deleteCategoryLeads = async (cat) => {
    if (!confirm(`Slet alle leads i kategorien "${cat}"?`)) return;
    const ids = leads.filter(l => l.category === cat).map(l => l.id);
    if (!ids.length) return;
    try {
      await supabase.from('outreaches').delete().in('lead_id', ids);
      const { error } = await supabase.from('leads').delete().eq('category', cat);
      if (error) throw error;
      setLeads(leads.filter(l => l.category !== cat)); msg('Kategori slettet');
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
  };

  const importLeads = async (leadsToImport) => {
    const list = leadsToImport || iPrev;
    if (!list.length) return;
    setSaving(true);
    try {
      let skipped = 0;
      const importedIds = [];
      for (const lead of list) {
        const { _outreaches, ...leadData } = lead;
        const { data, error } = await supabase.from('leads').insert(leadData).select().single();
        if (error) { console.warn('Lead insert fejl:', leadData.name, error.message); skipped++; continue; }
        importedIds.push(data.id);
        if (_outreaches && _outreaches.length > 0) {
          const rows = _outreaches.map(o => ({ lead_id: data.id, by: o.by || user?.email || 'Ukendt', note: o.note || '', date: o.date || null, sale_info: o.sale_info || '' }));
          const { error: oErr } = await supabase.from('outreaches').insert(rows);
          if (oErr) console.warn('Outreach insert fejl for', data.id, oErr.message);
        }
      }
      if (skipped > 0) msg(`${list.length - skipped} leads importeret (${skipped} sprunget over)`, 'ok');
      else msg(list.length + ' leads importeret');
      setLastImportIds(importedIds);
      setDupModal(null);
      await loadLeads();
      setIText(''); setIPrev([]);
      // Stay on import page so user can undo
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
    setSaving(false);
  };

  const enrichLeads = async () => {
    setSaving(true);
    try {
      const toEnrich = dupModal.duplicates.filter(d => Object.keys(d._newFields).length > 0);
      for (const d of toEnrich) {
        const { error } = await supabase.from('leads').update(d._newFields).eq('id', d._existing.id);
        if (error) console.warn('Enrich fejl:', d.name, error.message);
      }
      if (toEnrich.length > 0) msg(`${toEnrich.length} leads opdateret med nye felter`);
      if (dupModal.nonDuplicates.length > 0) {
        await importLeads(dupModal.nonDuplicates);
      } else {
        setDupModal(null);
        await loadLeads();
        setIText(''); setIPrev([]);
      }
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
    setSaving(false);
  };

  const undoImport = async () => {
    if (!lastImportIds.length) return;
    if (!confirm(`Fortryd import? ${lastImportIds.length} leads vil blive slettet permanent.`)) return;
    setSaving(true);
    try {
      const CHUNK = 50;
      for (let i = 0; i < lastImportIds.length; i += CHUNK) {
        const batch = lastImportIds.slice(i, i + CHUNK);
        await supabase.from('outreaches').delete().in('lead_id', batch);
        await supabase.from('leads').delete().in('id', batch);
      }
      setLeads(prev => prev.filter(l => !lastImportIds.includes(l.id)));
      setLastImportIds([]);
      msg('Import fortrudt');
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
    setSaving(false);
  };

  const ENRICH_FIELDS = ['category', 'country', 'phone', 'city', 'website', 'contact_person'];
  const ENRICH_LABELS = { category: 'kategori', country: 'land', phone: 'telefon', city: 'by', website: 'website', contact_person: 'kontakt' };

  const checkAndImport = async () => {
    if (!iPrev.length) return;
    const emailMap = new Map();
    const nameMap = new Map();
    for (const l of leads) {
      if (l.email) emailMap.set(l.email.toLowerCase().trim(), l);
      nameMap.set(l.name.toLowerCase().trim(), l);
    }
    const duplicates = [];
    const nonDuplicates = [];
    for (const l of iPrev) {
      const emailMatch = l.email && emailMap.has(l.email.toLowerCase().trim());
      const nameMatch = !l.email && nameMap.has((l.name || '').toLowerCase().trim());
      if (emailMatch || nameMatch) {
        const existing = emailMatch ? emailMap.get(l.email.toLowerCase().trim()) : nameMap.get((l.name || '').toLowerCase().trim());
        const newFields = {};
        for (const f of ENRICH_FIELDS) {
          if (l[f] && !existing[f]) newFields[f] = l[f];
        }
        duplicates.push({ ...l, _matchedBy: emailMatch ? 'email' : 'navn', _existing: existing, _newFields: newFields });
      } else {
        nonDuplicates.push(l);
      }
    }
    const enrichable = duplicates.filter(d => Object.keys(d._newFields).length > 0);
    if (duplicates.length === 0) {
      await importLeads(iPrev);
    } else {
      setDupModal({ duplicates, nonDuplicates, enrichable });
    }
  };

  const connectShopify = async () => {
    if (!shopDomain.trim() || !shopToken.trim()) return msg('Udfyld URL og token', 'err');
    setShopLoading(true); setShopError('');
    try {
      const url = 'https://' + shopDomain.trim() + '/admin/api/2024-01/orders.json?limit=250&status=any&fields=id,created_at,total_price,financial_status,line_items';
      const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': shopToken.trim() } });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' - ' + r.statusText);
      const d = await r.json(); const orders = d.orders || [];
      setShopOrders(orders); setShopOK(true);
      msg('Tilsluttet - ' + orders.length + ' ordrer hentet'); setView('dashboard');
    } catch (e) { setShopError(e.message); }
    setShopLoading(false);
  };
  const refreshShop = async () => {
    setShopLoading(true);
    try {
      const url = 'https://' + shopDomain + '/admin/api/2024-01/orders.json?limit=250&status=any&fields=id,created_at,total_price,financial_status,line_items';
      const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': shopToken } });
      const d = await r.json(); setShopOrders(d.orders || []);
      msg('Shopify opdateret');
    } catch (e) { msg('Fejl: ' + e.message, 'err'); }
    setShopLoading(false);
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0f1e', color: '#e2e8f0', flexDirection: 'column', gap: 12 }}>
      <div style={{ width: 36, height: 36, border: '3px solid #1f2937', borderTop: '3px solid #0ea5e9', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ color: '#4b5563', fontSize: 13 }}>Indlæser leads fra Supabase...</div>
    </div>
  );

  const CC = {
    card: { background: 'linear-gradient(180deg, #111827 0%, #0d1420 100%)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, boxShadow: '0 4px 20px rgba(0,0,0,0.3)' },
    inner: { background: '#0a0f1e', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 10 },
  };
  const NAV_SECTIONS = [
    {
      label: 'Oversigt',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
      ]
    },
    {
      label: 'Leads',
      items: [
        { id: 'list', label: 'Alle leads', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
        { id: 'scraper', label: 'Lead Scraper', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> },
        { id: 'import', label: 'Importér', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> },
      ]
    },
    {
      label: 'Outreach',
      items: [
        { id: 'templates', label: 'Mail templates', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> },
        { id: 'activity', label: 'Aktivitet', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
      ]
    },
    {
      label: 'System',
      items: [
        { id: 'shopify_settings', label: 'Shopify', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 2 3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg> },
        { id: 'settings', label: 'Indstillinger', icon: <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
      ]
    },
  ];
  const NAV = NAV_SECTIONS.flatMap(s => s.items);

  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#020617', color: '#e5e7eb', fontFamily: 'system-ui,sans-serif', flexDirection: 'column', gap: 12 }}>
        <div style={{ width: 36, height: 36, border: '3px solid #1f2937', borderTop: '3px solid #0ea5e9', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ color: '#4b5563', fontSize: 13 }}>Tjekker login...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif', padding: 24, position: 'relative', overflow: 'hidden', background: '#0f1729' }}>
        <style>{`
          *{box-sizing:border-box}
          input,button{font-family:inherit}
          @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
          @keyframes pulse-ring{0%{transform:scale(0.95);opacity:0.7}100%{transform:scale(1.15);opacity:0}}
          .login-input{width:100%;height:48px;background:rgba(255,255,255,0.07);border:1.5px solid rgba(255,255,255,0.1);border-radius:12px;color:#f1f5f9;padding:0 16px;font-size:14px;outline:none;transition:all 0.2s}
          .login-input:focus{border-color:#38bdf8;background:rgba(56,189,248,0.08);box-shadow:0 0 0 3px rgba(56,189,248,0.12)}
          .login-input::placeholder{color:#475569}
          .login-btn{width:100%;height:50px;border:none;border-radius:12px;background:linear-gradient(135deg,#0ea5e9,#4f46e5);color:#fff;font-size:15px;font-weight:700;cursor:pointer;transition:all 0.2s;letter-spacing:0.3px;box-shadow:0 8px 24px rgba(14,165,233,0.35)}
          .login-btn:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 12px 32px rgba(14,165,233,0.5)}
          .login-btn:disabled{opacity:0.5;cursor:not-allowed}
          .login-card{width:100%;max-width:420px;background:rgba(11,17,32,0.85);backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.08);border-radius:28px;padding:40px 36px;box-shadow:0 32px 80px rgba(0,0,0,0.6)}
        `}</style>

        {/* Background blobs */}
        <div style={{ position:'absolute', width:500, height:500, borderRadius:'50%', background:'radial-gradient(circle,rgba(79,70,229,0.25),transparent 70%)', top:-100, left:-100, pointerEvents:'none' }} />
        <div style={{ position:'absolute', width:400, height:400, borderRadius:'50%', background:'radial-gradient(circle,rgba(14,165,233,0.2),transparent 70%)', bottom:-80, right:-80, pointerEvents:'none' }} />

        <div className="login-card">
          {/* Logo */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', marginBottom:32 }}>
            <div style={{ position:'relative', marginBottom:12 }}>
              <div style={{ position:'absolute', inset:-4, borderRadius:'50%', background:'linear-gradient(135deg,#0ea5e9,#4f46e5)', animation:'pulse-ring 2s ease-out infinite', opacity:0 }} />
              <div style={{ width:60, height:60, borderRadius:18, background:'linear-gradient(135deg,#0ea5e9,#4f46e5)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:28, boxShadow:'0 8px 24px rgba(14,165,233,0.4)', animation:'float 4s ease-in-out infinite' }}>
                🌊
              </div>
            </div>
            <div style={{ fontSize:24, fontWeight:800, color:'#f1f5f9', letterSpacing:0.5 }}>Surfmore CRM</div>
            <div style={{ fontSize:13, color:'#475569', marginTop:4 }}>Log ind på din konto</div>
          </div>

          {authError && (
            <div style={{ background:'rgba(185,28,28,0.15)', border:'1px solid rgba(185,28,28,0.4)', borderRadius:10, padding:'10px 14px', fontSize:13, color:'#fca5a5', marginBottom:16, textAlign:'center' }}>
              {authError}
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div>
              <label style={{ fontSize:12, fontWeight:600, color:'#94a3b8', display:'block', marginBottom:8, letterSpacing:0.3 }}>EMAIL</label>
              <input
                className="login-input"
                type="email"
                value={authEmail}
                onChange={e => setAuthEmail(e.target.value)}
                placeholder="din@surfmore.dk"
                autoComplete="email"
              />
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:600, color:'#94a3b8', display:'block', marginBottom:8, letterSpacing:0.3 }}>ADGANGSKODE</label>
              <input
                className="login-input"
                type="password"
                value={authPassword}
                onChange={e => setAuthPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
            <button type="submit" className="login-btn" disabled={authLoading || !authEmail || !authPassword} style={{ marginTop:6 }}>
              {authLoading ? 'Logger ind…' : 'Log ind'}
            </button>
          </form>

          <div style={{ marginTop:24, textAlign:'center' }}>
            <div style={{ height:1, background:'rgba(255,255,255,0.06)', marginBottom:16 }} />
            <div style={{ fontSize:12, color:'#334155' }}>Surfmore CRM · Kun til internt brug</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="crm-app-container" style={{ display: 'flex', minHeight: '100vh', background: '#040810', color: '#f8fafc', fontFamily: 'system-ui,sans-serif' }}>
      <style>{`
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}
        input,select,textarea{font-family:inherit}
        .btn{cursor:pointer;border:none;border-radius:8px;font-weight:600;font-size:13px;transition:all 0.2s cubic-bezier(0.4, 0, 0.2, 1);font-family:inherit;box-shadow:0 1px 2px rgba(0,0,0,0.1)}
        .btn-p{background:linear-gradient(135deg,#0ea5e9,#4f46e5);color:#fff;padding:8px 18px;box-shadow:0 4px 12px rgba(14,165,233,0.25)}.btn-p:hover{opacity:0.95;transform:translateY(-1px);box-shadow:0 6px 16px rgba(14,165,233,0.4)}
        .btn-g{background:#1e293b50;backdrop-filter:blur(4px);color:#cbd5e1;padding:8px 12px;border:1px solid rgba(255,255,255,0.1)}.btn-g:hover{background:#1e293b80;color:#fff;border-color:rgba(255,255,255,0.2)}
        .btn-d{background:#ef444415;color:#fca5a5;padding:5px 10px;border:1px solid #ef444430;box-shadow:none}
        .btn-v{background:#7c3aed20;color:#c4b5fd;padding:8px 14px;border:1px solid #7c3aed40;box-shadow:none}.btn-v:hover{background:#7c3aed30}
        .inp{background:#0b1120;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#f8fafc;padding:9px 12px;font-size:14px;width:100%;outline:none;transition:all 0.2s;box-shadow:inset 0 2px 4px rgba(0,0,0,0.2)}.inp:focus{border-color:#38bdf8;box-shadow:0 0 0 2px rgba(56,189,248,0.2), inset 0 2px 4px rgba(0,0,0,0.2)}
        .rh:hover{background:rgba(255,255,255,0.03) !important;cursor:pointer}
        .tag{background:#0ea5e915;color:#38bdf8;border:1px solid #0ea5e925;border-radius:6px;padding:3px 8px;font-size:11px;font-weight:600}
        label{font-size:12px;color:#94a3b8;display:block;margin-bottom:6px;font-weight:500}
        .sl{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:12px}
        .navbtn{display:flex;align-items:center;gap:9px;padding:8px 12px;border-radius:8px;cursor:pointer;border:none;background:none;color:#64748b;font-family:inherit;font-size:13px;font-weight:500;width:100%;transition:all 0.15s;text-align:left;line-height:1.3}
        .navbtn:hover{background:rgba(255,255,255,0.05);color:#cbd5e1}
        .navbtn.active{background:rgba(14,165,233,0.12);color:#38bdf8;font-weight:600}
        .nav-section-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#334155;padding:14px 12px 4px;display:block}
        .login-input{width:100%;height:48px;background:rgba(255,255,255,0.07);border:1.5px solid rgba(255,255,255,0.1);border-radius:12px;color:#f1f5f9;padding:0 16px;font-size:14px;outline:none;transition:all 0.2s;font-family:inherit}
        .login-input:focus{border-color:#38bdf8;background:rgba(56,189,248,0.08);box-shadow:0 0 0 3px rgba(56,189,248,0.12)}
        .login-input::placeholder{color:#475569}
        .login-btn{width:100%;height:50px;border:none;border-radius:12px;background:linear-gradient(135deg,#0ea5e9,#4f46e5);color:#fff;font-size:15px;font-weight:700;cursor:pointer;transition:all 0.2s;letter-spacing:0.3px;box-shadow:0 8px 24px rgba(14,165,233,0.35);font-family:inherit}
        .login-btn:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 12px 32px rgba(14,165,233,0.5)}
        .login-btn:disabled{opacity:0.5;cursor:not-allowed}

        /* ── MOBILE ──────────────────────────────────────────── */
        .mobile-topbar { display: none; }
        .mobile-overlay { display: none; }

        @media (max-width: 768px) {
          /* Top bar */
          .mobile-topbar {
            display: flex !important;
            position: fixed; top: 0; left: 0; right: 0; z-index: 7000;
            height: 52px; background: #0b1120;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            align-items: center; padding: 0 14px; gap: 12px;
          }
          .mobile-overlay {
            display: block !important;
            position: fixed; inset: 0; z-index: 7999;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(2px);
          }

          /* Sidebar: hidden drawer, slides in */
          .crm-app-container { flex-direction: row !important; }
          .crm-sidebar {
            position: fixed !important; top: 0 !important; left: 0 !important;
            bottom: 0 !important; z-index: 8000 !important;
            width: 260px !important; height: 100vh !important;
            flex-direction: column !important;
            transform: translateX(-100%);
            transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
            overflow-y: auto !important; overflow-x: hidden !important;
          }
          .crm-sidebar.mob-open { transform: translateX(0) !important; }
          .crm-sidebar-header { display: flex !important; }
          .crm-sidebar-bottom { display: flex !important; }
          .nav-section-label { display: block !important; }
          .crm-sidebar .navbtn { white-space: normal; width: 100%; }

          /* Content: full width, padded below topbar */
          .crm-content {
            padding-top: 52px !important;
            width: 100% !important; min-width: 0 !important;
          }

          /* Content padding */
          .crm-content > div { padding: 14px !important; }

          /* Tables: horizontal scroll */
          .table-wrapper, .scraper-tbl-wrap {
            overflow-x: auto !important; -webkit-overflow-scrolling: touch;
            width: 100% !important;
          }
          table { min-width: 560px !important; }

          /* Bulk actions: stack fields vertically */
          .bulk-fields-row {
            flex-direction: column !important;
            gap: 8px !important;
          }
          .bulk-fields-row > * { flex: none !important; width: 100% !important; }

          /* Filter bar: horizontal scroll */
          .leads-filter-bar {
            overflow-x: auto !important; -webkit-overflow-scrolling: touch;
            flex-wrap: nowrap !important; padding-bottom: 6px !important;
          }
          .leads-filter-bar > * { flex-shrink: 0 !important; }

          /* Dashboard grid: 2 col */
          .dash-stats-grid { grid-template-columns: 1fr 1fr !important; }

          /* Scraper grid: 1 col */
          .scraper-grid { grid-template-columns: 1fr !important; }

          /* Modals: full-screen slide up */
          .modal-inner {
            width: 100% !important; max-width: 100% !important;
            max-height: 95vh !important; border-radius: 20px 20px 0 0 !important;
            margin-top: auto !important; overflow-y: auto !important;
          }
          .modal-wrap {
            align-items: flex-end !important; padding: 0 !important;
          }

          /* Campaign modal */
          .campaign-modal-inner {
            width: 100% !important; max-width: 100% !important;
            border-radius: 20px 20px 0 0 !important; max-height: 95vh !important;
          }

          /* Lead detail panel */
          .lead-detail-panel {
            position: fixed !important; inset: 0 !important;
            z-index: 6000 !important; border-radius: 0 !important;
            border-left: none !important; border-top: 1px solid rgba(255,255,255,0.06) !important;
            width: 100% !important; max-width: 100% !important;
          }

          /* Hide less critical columns in leads table */
          .col-country, .col-outreach { display: none !important; }

          /* Reduce card padding */
          .crm-card-pad { padding: 14px !important; }
        }
      `}</style>

      {toast && <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, background: toast.t === 'err' ? '#ef4444' : '#22c55e', color: '#fff', padding: '10px 18px', borderRadius: 10, fontWeight: 700, fontSize: 13, boxShadow: '0 8px 30px rgba(0,0,0,0.6)', pointerEvents: 'none', border: '1px solid rgba(255,255,255,0.2)' }}>{toast.m}</div>}

      {/* Mobile top bar */}
      <div className="mobile-topbar">
        <button onClick={() => setMobileMenuOpen(true)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}>
          <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <div style={{ width: 26, height: 26, borderRadius: 6, background: 'linear-gradient(135deg,#0ea5e9,#4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>🌊</div>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>Surfmore CRM</span>
        </div>
        <span style={{ fontSize: 12, color: '#475569' }}>{NAV.find(n => n.id === view)?.label || ''}</span>
      </div>

      {/* Mobile sidebar overlay */}
      {mobileMenuOpen && <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)} />}

      {/* Sidebar */}
      <div className={'crm-sidebar' + (mobileMenuOpen ? ' mob-open' : '')} style={{ width: 220, background: '#0b1120', borderRight: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', padding: '0', position: 'sticky', top: 0, height: '100vh', flexShrink: 0, overflowY: 'auto' }}>
        {/* Logo */}
        <div className="crm-sidebar-header" style={{ padding: '20px 18px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#0ea5e9,#4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>🌊</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9', letterSpacing: 0.3 }}>Surfmore</div>
              <div style={{ fontSize: 10, color: '#475569', fontWeight: 500 }}>CRM Platform</div>
            </div>
          </div>
        </div>

        {/* Nav sections */}
        <div style={{ flex: 1, padding: '8px 10px', overflowY: 'auto' }}>
          {NAV_SECTIONS.map(section => (
            <div key={section.label}>
              <span className="nav-section-label">{section.label}</span>
              {section.items.map(n => (
                <button key={n.id} className={'navbtn' + (view === n.id ? ' active' : '')} onClick={() => { setBulk(false); setView(n.id); setMobileMenuOpen(false); }}>
                  <span style={{ opacity: view === n.id ? 1 : 0.7, flexShrink: 0 }}>{n.icon}</span>
                  {n.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* User profile + actions */}
        <div className="crm-sidebar-bottom" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Logged-in user */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#0ea5e9,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
              {(user?.email?.[0] || '?').toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email?.split('@')[0] || 'Bruger'}</div>
              <div style={{ fontSize: 10, color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email || ''}</div>
            </div>
          </div>
          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => { setNewUserModal(true); setNewUserError(''); setNewUserSuccess(''); }} style={{ flex: 1, background: 'rgba(14,165,233,0.1)', border: '1px solid rgba(14,165,233,0.2)', borderRadius: 7, color: '#38bdf8', fontSize: 11, fontWeight: 600, padding: '6px 4px', cursor: 'pointer', fontFamily: 'inherit' }}>+ Ny bruger</button>
            <button onClick={handleLogout} style={{ flex: 1, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 7, color: '#fca5a5', fontSize: 11, fontWeight: 600, padding: '6px 4px', cursor: 'pointer', fontFamily: 'inherit' }}>Log ud</button>
          </div>
        </div>
      </div>

      {/* New user modal */}
      {newUserModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,10,0.75)', backdropFilter: 'blur(6px)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={e => { if (e.target === e.currentTarget) { setNewUserModal(false); setNewUserError(''); setNewUserSuccess(''); } }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: 400 }}>
            {/* Glow blobs */}
            <div style={{ position: 'absolute', width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle,rgba(79,70,229,0.3),transparent 70%)', top: -60, left: -60, pointerEvents: 'none', zIndex: 0 }} />
            <div style={{ position: 'absolute', width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(14,165,233,0.25),transparent 70%)', bottom: -40, right: -40, pointerEvents: 'none', zIndex: 0 }} />
            <div style={{ position: 'relative', zIndex: 1, background: 'rgba(11,17,32,0.92)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 24, padding: '32px 30px', boxShadow: '0 32px 80px rgba(0,0,0,0.7)' }}>
              {/* Icon + title */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
                <div style={{ width: 52, height: 52, borderRadius: 16, background: 'linear-gradient(135deg,#0ea5e9,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 12, boxShadow: '0 8px 24px rgba(14,165,233,0.35)' }}>👤</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9', letterSpacing: 0.3 }}>Opret bruger</div>
                <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>Brugeren er aktiv med det samme</div>
              </div>
              {newUserError && (
                <div style={{ background: 'rgba(185,28,28,0.15)', border: '1px solid rgba(185,28,28,0.4)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#fca5a5', marginBottom: 16, textAlign: 'center' }}>{newUserError}</div>
              )}
              {newUserSuccess && (
                <div style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#86efac', marginBottom: 16, textAlign: 'center' }}>{newUserSuccess}</div>
              )}
              <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 8, letterSpacing: 0.3 }}>NAVN</label>
                  <input className="login-input" type="text" value={newUserName} onChange={e => setNewUserName(e.target.value)} placeholder="Jeppe Hansen" required />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 8, letterSpacing: 0.3 }}>EMAIL</label>
                  <input className="login-input" type="email" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} placeholder="bruger@surfmore.dk" required />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 8, letterSpacing: 0.3 }}>ADGANGSKODE</label>
                  <input className="login-input" type="password" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} placeholder="Minimum 6 tegn" required minLength={6} />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button type="button" onClick={() => { setNewUserModal(false); setNewUserError(''); setNewUserSuccess(''); setNewUserName(''); }} style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#94a3b8', fontSize: 14, fontWeight: 600, padding: '12px', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s' }}>Annuller</button>
                  <button type="submit" disabled={newUserLoading || !newUserEmail || !newUserPassword} className="login-btn" style={{ flex: 1 }}>{newUserLoading ? 'Opretter…' : 'Opret bruger'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <div className="crm-content" style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>

        {/* DASHBOARD */}
        {view === 'dashboard' && (() => {
          // Pipeline data
          const pipelineStages = [
            { key: 'not_contacted', label: 'Ikke kontaktet', color: '#64748b', count: stats.nc },
            { key: 'outreach_done', label: 'Outreach sendt', color: '#3b82f6', count: stats.out },
            { key: 'won', label: 'Solgt', color: '#22c55e', count: stats.won },
          ];
          const maxPipe = Math.max(...pipelineStages.map(s => s.count), 1);

          // Recent activity: batch imports (grouped by date, with category breakdown) + outreaches by category
          const importBatches = (() => {
            const groups = {};
            for (const l of leads) {
              const d = (l.created_at || '').slice(0, 10);
              if (!d) continue;
              if (!groups[d]) groups[d] = { date: d, count: 0, cats: {} };
              groups[d].count++;
              const { base } = splitCategory(l.category || 'Andet');
              groups[d].cats[base] = (groups[d].cats[base] || 0) + 1;
            }
            return Object.values(groups).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
          })();
          const outreachesByCategory = (() => {
            const groups = {};
            for (const l of leads) {
              for (const o of (l.outreaches || [])) {
                const { base, sub } = splitCategory(l.category || 'Andet');
                const key = l.category || 'Andet';
                if (!groups[key]) groups[key] = { category: key, base, sub, count: 0, lastDate: '' };
                groups[key].count++;
                if ((o.date || '') > groups[key].lastDate) groups[key].lastDate = o.date;
              }
            }
            return Object.values(groups).sort((a, b) => b.lastDate.localeCompare(a.lastDate)).slice(0, 8);
          })();

          // Follow-up: leads with outreach_done but oldest last outreach
          const needFollowUp = leads
            .filter(l => l.status === 'outreach_done')
            .map(l => {
              const lastOtr = (l.outreaches || []).filter(o => o.date).sort((a, b) => b.date.localeCompare(a.date))[0];
              return { ...l, lastOtrDate: lastOtr?.date || null };
            })
            .sort((a, b) => (a.lastOtrDate || '').localeCompare(b.lastOtrDate || ''))
            .slice(0, 5);

          const noEmail = leads.filter(l => !l.email).length;

          return (
            <div style={{ padding: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                  <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 3 }}>Dashboard</h1>
                  <div style={{ color: '#4b5563', fontSize: 13 }}>Overblik over leads og aktivitet</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {shopOK && <button className="btn btn-g" onClick={refreshShop} disabled={shopLoading} style={{ fontSize: 12 }}>{shopLoading ? 'Henter...' : 'Synk Shopify'}</button>}
                  <button className="btn btn-g" onClick={loadLeads} style={{ fontSize: 12 }}>↻ Opdater</button>
                  <button className="btn btn-p" onClick={openAdd}>+ Nyt lead</button>
                </div>
              </div>

              {/* Top KPI cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 14 }}>
                {[
                  { l: 'Totale leads', v: stats.total, c: '#6366f1', sub: 'i databasen', click: () => setView('list') },
                  { l: 'Ikke kontaktet', v: stats.nc, c: '#64748b', sub: 'klar til outreach', click: () => { setFStatus('not_contacted'); setView('list'); } },
                  { l: 'Outreach sendt', v: stats.out, c: '#3b82f6', sub: 'afventer salg', click: () => { setFStatus('outreach_done'); setView('list'); } },
                  { l: 'Solgt', v: stats.won, c: '#22c55e', sub: 'konverterede leads', click: () => { setFStatus('won'); setView('list'); } },
                ].map(s => (
                  <div key={s.l} style={{ ...CC.card, padding: '18px 20px', cursor: 'pointer' }} onClick={s.click}>
                    <div style={{ fontSize: 10, color: s.c, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{s.l}</div>
                    <div style={{ fontSize: 30, fontWeight: 700, color: s.c, marginBottom: 4 }}>{s.v}</div>
                    <div style={{ fontSize: 11, color: '#4b5563' }}>{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* Pipeline + Activity row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>

                {/* Pipeline funnel */}
                <div style={{ ...CC.card, padding: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', marginBottom: 16 }}>Pipeline</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {pipelineStages.map((s, i) => {
                      const pct = stats.total > 0 ? Math.round(s.count / stats.total * 100) : 0;
                      const conv = i > 0 && pipelineStages[i - 1].count > 0 ? Math.round(s.count / pipelineStages[i - 1].count * 100) : null;
                      return (
                        <div key={s.key}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                            <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 600 }}>{s.label}</span>
                            <span style={{ fontSize: 12, color: s.color, fontWeight: 700 }}>{s.count} <span style={{ color: '#4b5563', fontWeight: 400 }}>({pct}%)</span></span>
                          </div>
                          <div style={{ height: 8, background: '#1f2937', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: (s.count / maxPipe * 100) + '%', background: s.color, borderRadius: 4, transition: 'width 0.4s' }} />
                          </div>
                          {conv !== null && <div style={{ fontSize: 10, color: '#4b5563', marginTop: 3, textAlign: 'right' }}>↑ {conv}% konvertering fra forrige trin</div>}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #1f2937', display: 'flex', gap: 16 }}>
                    <div style={{ fontSize: 12, color: '#4b5563' }}>
                      Total outreaches: <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{leads.reduce((s, l) => s + (l.outreaches || []).length, 0)}</span>
                    </div>
                    {noEmail > 0 && (
                      <button
                        className="btn btn-g"
                        style={{ fontSize: 12, padding: '4px 10px', borderColor: '#ef444430', color: '#ef4444', background: '#111827' }}
                        onClick={() => { resetFiltersAndSort(); setFMissingEmail(true); setView('list'); }}
                      >
                        {noEmail} leads uden email →
                      </button>
                    )}
                  </div>
                </div>

                {/* Recent activity */}
                <div style={{ ...CC.card, padding: 20, display: 'flex', flexDirection: 'column', gap: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af' }}>Seneste aktivitet</div>
                    <button className="btn btn-g" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setView('activity')}>Se alle →</button>
                  </div>

                  {/* Batch imports with category breakdown */}
                  {importBatches.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 10, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Imports</div>
                      {importBatches.map((b, i) => {
                        const topCats = Object.entries(b.cats || {}).sort((x, y) => y[1] - x[1]).slice(0, 3);
                        return (
                          <div key={b.date} style={{ padding: '7px 0', borderBottom: i < importBatches.length - 1 ? '1px solid #0d1420' : 'none' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#6366f1', flexShrink: 0 }} />
                              <div style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{b.count} leads tilføjet</div>
                              <div style={{ fontSize: 11, color: '#4b5563', flexShrink: 0 }}>{fmtDate(b.date)}</div>
                            </div>
                            {topCats.length > 0 && (
                              <div style={{ paddingLeft: 17, marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
                                {topCats.map(([cat, cnt]) => (
                                  <span key={cat} style={{ fontSize: 10, color: '#4b5563' }}>{cat}: {cnt}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Outreaches grouped by category */}
                  {outreachesByCategory.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Outreaches pr. kategori</div>
                      {outreachesByCategory.map((g, i) => (
                        <div key={g.category} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0', borderBottom: i < outreachesByCategory.length - 1 ? '1px solid #0d1420' : 'none', cursor: 'pointer' }}
                          onClick={() => { setFCats(new Set([g.category])); setView('list'); }}>
                          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#3b82f6', marginTop: 4, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{g.base}{g.sub ? ` (${g.sub})` : ''}</div>
                            <div style={{ fontSize: 11, color: '#4b5563' }}>{g.count} outreach{g.count !== 1 ? 'es' : ''} sendt</div>
                          </div>
                          <div style={{ fontSize: 11, color: '#4b5563', flexShrink: 0 }}>{fmtDate(g.lastDate)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {importBatches.length === 0 && outreachesByCategory.length === 0 && <div style={{ color: '#4b5563', fontSize: 13 }}>Ingen aktivitet endnu</div>}
                </div>
              </div>

              {/* Follow-up + no-email row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>

                {/* Needs follow-up */}
                <div style={{ ...CC.card, padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af' }}>Opfølgning mangler</div>
                    <span style={{ fontSize: 11, color: '#4b5563' }}>ældste outreach først</span>
                  </div>
                  {needFollowUp.length === 0 && <div style={{ color: '#4b5563', fontSize: 13 }}>Ingen afventende leads</div>}
                  {needFollowUp.map((l, i) => (
                    <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < needFollowUp.length - 1 ? '1px solid #0d1420' : 'none', cursor: 'pointer' }}
                      onClick={() => { setSel(l); setView('detail'); }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                        <div style={{ fontSize: 11, color: '#4b5563' }}>{l.category}</div>
                      </div>
                      <div style={{ fontSize: 11, color: l.lastOtrDate ? '#f59e0b' : '#ef4444', flexShrink: 0 }}>{l.lastOtrDate ? fmtDate(l.lastOtrDate) : 'Ingen dato'}</div>
                    </div>
                  ))}
                  {needFollowUp.length > 0 && <button className="btn btn-g" style={{ fontSize: 11, marginTop: 10, width: '100%' }} onClick={() => { setFStatus('outreach_done'); setView('list'); }}>Se alle outreach leads →</button>}
                </div>

                {/* Shopify OR leads without email */}
                <div style={{ ...CC.card, padding: 20 }}>
                  {shopOK ? (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', marginBottom: 14 }}>Shopify overblik</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                        {[
                          { l: 'Total omsætning', v: totalRev.toLocaleString('da-DK', { maximumFractionDigits: 0 }) + ' kr', c: '#22c55e' },
                          { l: 'Betalte ordrer', v: paid.length, c: '#0ea5e9' },
                          { l: 'Denne måned', v: revThis.toLocaleString('da-DK', { maximumFractionDigits: 0 }) + ' kr', c: '#f59e0b' },
                          { l: 'Vækst vs. forrige', v: (growth > 0 ? '+' : '') + growth.toFixed(1) + '%', c: growth >= 0 ? '#22c55e' : '#ef4444' },
                        ].map(s => (
                          <div key={s.l} style={{ background: '#0d1420', borderRadius: 8, padding: '10px 12px' }}>
                            <div style={{ fontSize: 10, color: '#4b5563', marginBottom: 3 }}>{s.l}</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: s.c }}>{s.v}</div>
                          </div>
                        ))}
                      </div>
                      <MiniLineChart data={monthly} />
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', marginBottom: 10 }}>Hurtige genveje</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <button className="btn btn-g" style={{ textAlign: 'left', justifyContent: 'flex-start', fontSize: 12 }} onClick={openAdd}>+ Tilføj nyt lead manuelt</button>
                        <button className="btn btn-g" style={{ textAlign: 'left', justifyContent: 'flex-start', fontSize: 12 }} onClick={() => setView('import')}>↑ Importér leads fra CSV</button>
                        <button className="btn btn-g" style={{ textAlign: 'left', justifyContent: 'flex-start', fontSize: 12 }} onClick={() => setView('shopify_settings')}>⚡ Tilslut Shopify</button>
                        {noEmail > 0 && <button className="btn btn-g" style={{ textAlign: 'left', justifyContent: 'flex-start', fontSize: 12, color: '#ef4444', borderColor: '#ef444430' }} onClick={() => { resetFiltersAndSort(); setFMissingEmail(true); setView('list'); }}>{noEmail} leads mangler email →</button>}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {shopOK && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                  <div style={{ ...CC.card, padding: 20 }}><div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', marginBottom: 14 }}>Månedlig omsætning</div><MiniLineChart data={monthly} /></div>
                  <div style={{ ...CC.card, padding: 20 }}><div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', marginBottom: 14 }}>Top produkter</div><HBarChart data={products} /></div>
                </div>
              )}

              {/* Leads pr. kategori */}
              <div style={{ ...CC.card, padding: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', marginBottom: 14 }}>Leads pr. kategori</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {catHierarchy.map(parent => {
                    const total = leads.filter(l => l.category === parent.name || parent.subs.includes(l.category)).length;
                    const wonC = leads.filter(l => (l.category === parent.name || parent.subs.includes(l.category)) && l.status === 'won').length;
                    const outC = leads.filter(l => (l.category === parent.name || parent.subs.includes(l.category)) && l.status === 'outreach_done').length;
                    if (!total) return null;
                    return (
                      <div key={parent.name} style={{ ...CC.inner, padding: '12px 16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: parent.subs.length ? 10 : 0, cursor: 'pointer' }}
                          onClick={() => { setFCats(new Set([parent.name, ...parent.subs])); setView('list'); }}>
                          <span style={{ fontSize: 14, fontWeight: 700 }}>{parent.name}</span>
                          <span style={{ fontSize: 12, color: '#6b7280' }}>{total} leads · <span style={{ color: '#22c55e' }}>{wonC} solgt</span> · <span style={{ color: '#3b82f6' }}>{outC} outreach</span></span>
                        </div>
                        {parent.subs.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {parent.subs.map(sub => {
                              const subLabel = sub.replace(parent.name, '').replace(/^\s*\(|\)\s*$/g, '').trim();
                              const cnt = leads.filter(l => l.category === sub).length;
                              const won = leads.filter(l => l.category === sub && l.status === 'won').length;
                              if (!cnt) return null;
                              return (
                                <div key={sub} style={{ background: '#0a0f1e', border: '1px solid #1f2937', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontSize: 12 }}
                                  onClick={e => { e.stopPropagation(); setFCats(new Set([sub])); setView('list'); }}>
                                  <span style={{ color: '#9ca3af' }}>{subLabel}</span>
                                  <span style={{ color: '#4b5563', marginLeft: 6 }}>{cnt}</span>
                                  {won > 0 && <span style={{ color: '#22c55e', marginLeft: 4 }}>· {won} solgt</span>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

        {/* SHOPIFY */}
        {view === 'shopify_settings' && (
          <div style={{ padding: 28, maxWidth: 520 }}>
            <h2 style={{ fontWeight: 700, marginBottom: 6 }}>Shopify integration</h2>
            <div style={{ color: '#4b5563', fontSize: 13, marginBottom: 22 }}>Tilslut din butik for at se omsætning i dashboardet</div>
            <div style={{ ...CC.card, padding: 22, marginBottom: 14 }}>
              <div style={{ marginBottom: 12 }}><label>Butiks-URL (f.eks. min-butik.myshopify.com)</label><input className="inp" value={shopDomain} onChange={e => setShopDomain(e.target.value)} placeholder="surfmore.myshopify.com" /></div>
              <div style={{ marginBottom: 16 }}><label>Admin API Access Token</label><input className="inp" type="password" value={shopToken} onChange={e => setShopToken(e.target.value)} placeholder="shpat_xxxxxxxx" />
                <div style={{ fontSize: 11, color: '#4b5563', marginTop: 5 }}>Shopify Admin → Indstillinger → Apps → Udvikl apps → Admin API access token</div>
              </div>
              {shopError && <div style={{ background: '#ef444415', border: '1px solid #ef444430', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#ef4444', marginBottom: 12 }}>{shopError}</div>}
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-p" onClick={connectShopify} disabled={shopLoading}>{shopLoading ? 'Forbinder...' : 'Tilslut'}</button>
                {shopOK && <button className="btn btn-g" onClick={refreshShop}>Opdater data</button>}
              </div>
              {shopOK && <div style={{ fontSize: 12, color: '#22c55e', marginTop: 10 }}>✓ Tilsluttet · {shopOrders.length} ordrer hentet</div>}
            </div>
            <div style={{ ...CC.card, padding: 16, fontSize: 12, color: '#4b5563', lineHeight: 2 }}>
              <div style={{ fontWeight: 600, color: '#9ca3af', marginBottom: 6 }}>Sådan opretter du API-nøgle:</div>
              1. Indstillinger → Apps og salgskanaler<br />
              2. Udvikl apps → Opret en app<br />
              3. Admin API scopes: read_orders, read_products<br />
              4. Installér appen → kopiér Admin API access token
            </div>
          </div>
        )}

        {/* TEMPLATES */}
        {view === 'templates' && (
          <div style={{ padding: 28, maxWidth: 1100 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h2 style={{ fontWeight: 700, marginBottom: 4 }}>Mail templates</h2>
                <div style={{ fontSize: 13, color: '#4b5563' }}>Standard outbound-mails med tokens og kategorier · klik på en template for at se den</div>
              </div>
              <button className="btn btn-p" onClick={openNewTemplate}>+ Ny template</button>
            </div>

            {/* Template list */}
            <div style={{ ...CC.card, overflow: 'hidden', marginBottom: editTpl ? 20 : 0 }}>
              {(!templates || templates.length === 0) ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: '#4b5563', fontSize: 13 }}>
                  Ingen templates endnu. Klik &ldquo;Ny template&rdquo; for at oprette din første.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#080d18', borderBottom: '1px solid #1f2937' }}>
                      {['Navn', 'Type', 'Sprog', 'Emne', 'Kategorier', 'Status', 'Opdateret', ''].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#4b5563', fontWeight: 700 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((t, idx) => (
                      <tr key={t.id}
                        style={{ borderBottom: idx < templates.length - 1 ? '1px solid #0d1420' : 'none', cursor: 'pointer', transition: 'background 0.1s' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#ffffff05'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        onClick={() => setPreviewTpl(t)}
                      >
                        <td style={{ padding: '13px 14px', fontWeight: 700, fontSize: 13, color: '#e2e8f0' }}>{t.name}</td>
                        <td style={{ padding: '13px 14px' }}>
                          <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, background: '#1f2937', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                            {({ cold_outreach: 'Cold outreach', follow_up: 'Follow-up', re_engage: 'Re-engage', partner_intro: 'Partner intro', offer: 'Tilbud' })[t.type] || t.type}
                          </span>
                        </td>
                        <td style={{ padding: '13px 14px', color: '#6b7280', fontSize: 12 }}>{(t.language || 'da').toUpperCase()}</td>
                        <td style={{ padding: '13px 14px', color: '#9ca3af', fontSize: 13, maxWidth: 240 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject || <span style={{ color: '#374151' }}>—</span>}</div>
                        </td>
                        <td style={{ padding: '13px 14px', fontSize: 12, maxWidth: 200 }}>
                          {!(t.category_tags || []).length
                            ? <span style={{ color: '#4b5563', fontStyle: 'italic' }}>Global</span>
                            : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {(t.category_tags || []).slice(0, 2).map(tag => (
                                  <span key={tag} style={{ color: '#6b7280', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
                                ))}
                                {(t.category_tags || []).length > 2 && <span style={{ fontSize: 11, color: '#4b5563' }}>+{(t.category_tags || []).length - 2} flere</span>}
                              </div>
                            )}
                        </td>
                        <td style={{ padding: '13px 14px' }}>
                          <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, background: t.active ? '#14532d' : '#111827', color: t.active ? '#4ade80' : '#6b7280', border: '1px solid ' + (t.active ? '#16a34a55' : '#1f2937') }}>
                            {t.active ? 'Aktiv' : 'Arkiveret'}
                          </span>
                        </td>
                        <td style={{ padding: '13px 14px', color: '#4b5563', fontSize: 12, whiteSpace: 'nowrap' }}>{(t.updated_at || t.created_at || '').slice(0, 10)}</td>
                        <td style={{ padding: '13px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="btn" style={{ fontSize: 11, padding: '4px 10px', marginRight: 6, background: '#7c3aed', color: '#fff' }} onClick={e => { e.stopPropagation(); openCampaign(t); }}>✉ Send</button>
                          <button className="btn btn-g" style={{ fontSize: 11, padding: '4px 10px', marginRight: 6 }} onClick={e => { e.stopPropagation(); openEditTemplate(t); }}>Rediger</button>
                          <button className="btn btn-d" style={{ fontSize: 11, padding: '4px 8px' }} onClick={e => { e.stopPropagation(); deleteTemplate(t); }}>Slet</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Editor panel — shown below list when active */}
            {editTpl && (
              <div style={{ ...CC.card, padding: 26, border: '1px solid #1f293780' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>{editTpl.id ? `Rediger: ${editTpl.name}` : 'Ny template'}</div>
                  <button className="btn btn-g" style={{ fontSize: 12 }} onClick={() => setEditTpl(null)}>Luk editor</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'flex-start' }}>
                  {/* Left col */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div><label>Navn</label><input className="inp" value={editTpl.name} onChange={e => setEditTpl({ ...editTpl, name: e.target.value })} /></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <label>Type</label>
                        <select className="inp" value={editTpl.type} onChange={e => setEditTpl({ ...editTpl, type: e.target.value })}>
                          <option value="cold_outreach">Cold outreach</option>
                          <option value="follow_up">Follow-up</option>
                          <option value="re_engage">Re-engage</option>
                          <option value="partner_intro">Intro partner</option>
                          <option value="offer">Tilbud</option>
                        </select>
                      </div>
                      <div>
                        <label>Sprog</label>
                        <select className="inp" value={editTpl.language} onChange={e => setEditTpl({ ...editTpl, language: e.target.value })}>
                          <option value="da">Dansk</option>
                          <option value="en">Engelsk</option>
                        </select>
                      </div>
                    </div>
                    <div><label>Fra-email (valgfri)</label><input className="inp" value={editTpl.from_email || ''} onChange={e => setEditTpl({ ...editTpl, from_email: e.target.value })} placeholder="jeppe@surfmore.dk" /></div>
                    <div><label>Subject</label><input className="inp" value={editTpl.subject} onChange={e => setEditTpl({ ...editTpl, subject: e.target.value })} placeholder="Samarbejde med Surfmore?" /></div>
                    <div>
                      <label>Kategorier (valgfri)</label>
                      <div style={{ position: 'relative', marginBottom: 6 }}>
                        <button type="button" className="btn btn-g" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', fontSize: 13 }} onClick={() => setTplCatOpen(o => !o)}>
                          <span style={{ color: tplCats.size ? '#e5e7eb' : '#6b7280' }}>{tplCats.size ? `${tplCats.size} valgt` : 'Alle kategorier (global)'}</span>
                          <span style={{ fontSize: 10 }}>{tplCatOpen ? '▲' : '▼'}</span>
                        </button>
                        {tplCatOpen && (
                          <div style={{ position: 'absolute', zIndex: 300, top: 'calc(100% + 4px)', left: 0, right: 0, background: '#020617', border: '1px solid #1f2937', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.6)', maxHeight: 260, overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onMouseLeave={() => setTplCatOpen(false)}>
                            <div style={{ padding: '6px 8px', borderBottom: '1px solid #1f2937', display: 'flex', gap: 6, alignItems: 'center' }}>
                              <input className="inp" style={{ flex: 1, padding: '5px 8px', fontSize: 12 }} placeholder="Søg..." value={tplCatSearch} onChange={e => setTplCatSearch(e.target.value)} />
                              <button className="btn btn-g" style={{ fontSize: 11, padding: '3px 6px' }} onClick={() => { setTplCats(new Set()); setTplCatSearch(''); }}>Ryd</button>
                              <button className="btn btn-g" style={{ fontSize: 11, padding: '3px 6px' }} onClick={() => setTplCatOpen(false)}>Luk</button>
                            </div>
                            <div style={{ padding: '4px 0', overflowY: 'auto' }}>
                              {catHierarchy.filter(parent => { if (!tplCatSearch) return true; const q = tplCatSearch.toLowerCase(); if (parent.name.toLowerCase().includes(q)) return true; return parent.subs.some(s => s.toLowerCase().includes(q)); }).map(parent => {
                                const catsForParent = parent.subs.length ? parent.subs : [parent.name];
                                const allSelected = catsForParent.every(c => tplCats.has(c));
                                const someSelected = !allSelected && catsForParent.some(c => tplCats.has(c));
                                return (
                                  <div key={parent.name} style={{ borderBottom: '1px solid #020617' }}>
                                    <button type="button" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: someSelected || allSelected ? '#0ea5e910' : 'transparent', border: 'none', color: '#e5e7eb', fontSize: 13, cursor: 'pointer' }} onClick={() => { const n = new Set(tplCats); if (allSelected) { catsForParent.forEach(c => n.delete(c)); } else { catsForParent.forEach(c => n.add(c)); } setTplCats(n); }}>
                                      <span>{parent.name}</span>
                                      <span style={{ fontSize: 11, color: '#9ca3af' }}>{allSelected ? '✓' : someSelected ? '~' : ''}</span>
                                    </button>
                                    {parent.subs.length > 0 && (
                                      <div style={{ padding: '2px 4px 6px' }}>
                                        {parent.subs.map(sub => { const sel = tplCats.has(sub); const subLabel = sub.replace(parent.name, '').replace(/^\s*\(|\)\s*$/g, '').trim(); return (
                                          <button key={sub} type="button" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px', background: sel ? '#0ea5e908' : 'transparent', border: 'none', color: sel ? '#e5e7eb' : '#9ca3af', fontSize: 12, cursor: 'pointer' }} onClick={() => { const n = new Set(tplCats); sel ? n.delete(sub) : n.add(sub); setTplCats(n); }}>
                                            <span>{subLabel}</span>{sel && <span style={{ fontSize: 11 }}>✓</span>}
                                          </button>
                                        ); })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              {!allCats.length && <div style={{ padding: '8px 10px', fontSize: 11, color: '#4b5563' }}>Ingen kategorier endnu.</div>}
                            </div>
                            <div style={{ padding: '6px 8px', borderTop: '1px solid #1f2937', display: 'flex', gap: 6 }}>
                              <input className="inp" style={{ flex: 1, padding: '7px 9px', fontSize: 12, background: '#020617', borderColor: '#2563eb' }} placeholder="Egen label..." value={tplCatCustom} onChange={e => setTplCatCustom(e.target.value)} />
                              <button className="btn btn-p" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => { if (!tplCatCustom.trim()) return; const n = new Set(tplCats); n.add(tplCatCustom.trim()); setTplCats(n); setTplCatCustom(''); }}>Tilføj</button>
                            </div>
                          </div>
                        )}
                      </div>
                      {tplCats.size > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {[...tplCats].map(tag => (
                            <span key={tag} style={{ padding: '3px 8px', borderRadius: 99, background: '#020617', border: '1px solid #1f2937', fontSize: 11, color: '#e5e7eb', display: 'flex', alignItems: 'center', gap: 5 }}>
                              {tag}
                              <button style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }} onClick={() => { const n = new Set(tplCats); n.delete(tag); setTplCats(n); }}>✕</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={editTpl.active !== false} onChange={e => setEditTpl({ ...editTpl, active: e.target.checked })} />
                        <span style={{ fontSize: 12, color: '#9ca3af' }}>Aktiv</span>
                      </label>
                      <button className="btn btn-p" style={{ fontSize: 13, padding: '8px 20px' }} disabled={saving} onClick={saveTemplate}>{saving ? 'Gemmer...' : 'Gem template'}</button>
                    </div>
                  </div>
                  {/* Right col: body */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <label>Body (understøtter {'{{tokens}}'} )</label>
                      <textarea className="inp" rows={13} value={editTpl.body} onChange={e => setEditTpl({ ...editTpl, body: e.target.value })} style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} placeholder={'Hej {{lead.contact_person | default:"der"}}\n\nJeg kontakter dig fra Surfmore ...'} />
                    </div>
                    <div style={{ ...CC.inner, padding: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', marginBottom: 6 }}>Tilgængelige tokens — klik for at indsætte</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {['{{lead.name}}', '{{lead.category}}', '{{lead.country}}', '{{lead.contact_person | default:"der"}}', '{{user.name}}', '{{company.name}}', '{{lead.notes_last}}'].map(tk => (
                          <span key={tk} style={{ padding: '3px 8px', borderRadius: 6, background: '#020617', border: '1px solid #1f2937', color: '#9ca3af', fontSize: 11, cursor: 'pointer' }}
                            onClick={() => setEditTpl(prev => ({ ...prev, body: (prev.body || '') + tk }))}>{tk}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SETTINGS */}
        {view === 'settings' && (
          <div style={{ padding: 28, maxWidth: 680 }}>
            <h2 style={{ fontWeight: 700, marginBottom: 6 }}>Indstillinger</h2>
            <div style={{ color: '#4b5563', fontSize: 13, marginBottom: 24 }}>Administrer data, kategorier og lande</div>

            {/* Backup & eksport */}
            <div style={{ ...CC.card, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>Backup & eksport</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
                Eksporter alle leads inkl. outreaches til en fil, så du altid har en backup i Excel eller Google Sheets. God idé før du sletter større mængder data.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-g"
                  style={{ fontSize: 12 }}
                  disabled={leads.length === 0}
                  onClick={exportBackupCSV}
                >
                  CSV: én fil med alle leads
                </button>
                <button
                  className="btn btn-g"
                  style={{ fontSize: 12 }}
                  disabled={leads.length === 0}
                  onClick={exportBackupCSVByCategory}
                >
                  CSV: flere filer (én pr. kategori)
                </button>
                <button
                  className="btn btn-g"
                  style={{ fontSize: 12 }}
                  disabled={leads.length === 0}
                  onClick={exportBackupXLSX}
                >
                  Excel (.xlsx): ark pr. kategori
                </button>
              </div>
            </div>

            {/* Danger zone */}
            <div style={{ ...CC.card, padding: 20, marginBottom: 16, border: '1px solid #ef444430' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#ef4444', marginBottom: 12 }}>Farezonen</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>Sletter permanent alle {leads.length} leads og tilhørende outreaches. Kan ikke fortrydes.</div>
              <button className="btn btn-d" disabled={saving || leads.length === 0} onClick={() => setDeleteAllStep(1)}>{saving ? 'Sletter...' : 'Slet alle ' + leads.length + ' leads'}</button>
            </div>

            {/* Kategori management */}
            <div style={{ ...CC.card, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>Kategorier</div>
              <div style={{ fontSize: 12, color: '#4b5563', marginBottom: 14 }}>{allCats.length} kategorier · klik på en kategori for at omdøbe eller slette den</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {allCats.map(cat => {
                  const cnt = leads.filter(l => l.category === cat).length;
                  const isEditing = settingsRename[cat] !== undefined;
                  return (
                    <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#0d1420', borderRadius: 8, border: '1px solid #1a2332' }}>
                      {isEditing ? (
                        <>
                          <input className="inp" style={{ flex: 1, padding: '4px 8px', fontSize: 13 }} value={settingsRename[cat]} onChange={e => setSettingsRename(r => ({ ...r, [cat]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') { renameCategory(cat, settingsRename[cat]); setSettingsRename(r => { const n = { ...r }; delete n[cat]; return n; }); } if (e.key === 'Escape') setSettingsRename(r => { const n = { ...r }; delete n[cat]; return n; }); }} />
                          <button className="btn btn-p" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => { renameCategory(cat, settingsRename[cat]); setSettingsRename(r => { const n = { ...r }; delete n[cat]; return n; }); }}>Gem</button>
                          <button className="btn btn-g" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => setSettingsRename(r => { const n = { ...r }; delete n[cat]; return n; })}>Annuller</button>
                        </>
                      ) : (
                        <>
                          <span style={{ flex: 1, fontSize: 13 }}>{cat}</span>
                          <span style={{ fontSize: 11, color: '#4b5563' }}>{cnt} leads</span>
                          <button className="btn btn-g" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setSettingsRename(r => ({ ...r, [cat]: cat }))}>Omdøb</button>
                          <button className="btn btn-d" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => deleteCategoryLeads(cat)}>Slet</button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Lande */}
            <div style={{ ...CC.card, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>Lande i databasen</div>
              <div style={{ fontSize: 12, color: '#4b5563', marginBottom: 14 }}>Lande opdages automatisk ved import</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {allCountries.map(c => (
                  <div key={c} style={{ background: '#0d1420', border: '1px solid #1a2332', borderRadius: 7, padding: '6px 14px', fontSize: 13 }}>
                    {c} · <span style={{ color: '#4b5563' }}>{leads.filter(l => l.country === c).length} leads</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* IMPORT */}
        {view === 'import' && (
          <div style={{ padding: 28, maxWidth: 760 }}>
            <h2 style={{ fontWeight: 700, marginBottom: 20 }}>Importér leads</h2>
            <div style={{ ...CC.card, padding: 22 }}>
              <div style={{ background: '#080d18', border: '1px solid #1a2332', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#4b5563', fontFamily: 'monospace' }}>
                Format: Navn · Kategori · Underkategori · Land · Mail · Kontaktperson · Telefon · By · B2B Outreach (gentages pr. outreach) · Noter (valgfri) · Salg/Udbytte
              </div>
              <div style={{ marginBottom: 12 }}>
                <label>Upload fil (CSV / TSV / TXT)</label>
                <input type="file" accept=".csv,.tsv,.txt" ref={fileRef} onChange={e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => { setIText(ev.target.result); setIPrev(runP(ev.target.result)); }; r.readAsText(f, 'UTF-8'); }} style={{ display: 'none' }} />
                <button className="btn btn-g" style={{ marginTop: 6 }} onClick={() => fileRef.current.click()}>Vælg fil</button>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label>Upload Excel (XLSX) med flere faner</label>
                <input
                  type="file"
                  accept=".xlsx,.xlsm"
                  ref={excelRef}
                  onChange={e => {
                    const f = e.target.files[0];
                    if (!f) return;
                    const r = new FileReader();
                    r.onload = ev => {
                      try {
                        const data = new Uint8Array(ev.target.result);
                        const wb = XLSX.read(data, { type: 'array' });
                        let allLeads = [];
                        wb.SheetNames.forEach(name => {
                          const ws = wb.Sheets[name];
                          if (!ws) return;
                          const csv = XLSX.utils.sheet_to_csv(ws, { FS: ';' });
                          const leadsFromSheet = runP(csv);
                          allLeads = allLeads.concat(leadsFromSheet);
                        });
                        setIText('');
                        setIPrev(allLeads);
                        msg('Excel import læst: ' + allLeads.length + ' leads');
                      } catch (err) {
                        console.error(err);
                        msg('Kunne ikke læse Excel-fil', 'err');
                      }
                    };
                    r.readAsArrayBuffer(f);
                  }}
                  style={{ display: 'none' }}
                />
                <button className="btn btn-g" style={{ marginTop: 6 }} onClick={() => excelRef.current.click()}>Vælg Excel-fil</button>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label>Eller indsæt data direkte</label>
                <textarea className="inp" rows={6} value={iText} onChange={e => { setIText(e.target.value); setIPrev(runP(e.target.value)); }} style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} placeholder="Navn,Kategori,Underkategori,Land,Mail,Kontaktperson,Telefon,By,B2B Outreach 1,B2B Outreach 2,B2B Outreach 3,Noter,Salg/Udbytte" />
              </div>
              {iPrev.length > 0 && (
                <div>
                  <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 10, display: 'flex', gap: 16 }}>
                    <span>Preview: <strong style={{ color: '#e2e8f0' }}>{iPrev.length}</strong> leads</span>
                    <span style={{ color: '#22c55e' }}>Solgt: {iPrev.filter(l => l.status === 'won').length}</span>
                    <span style={{ color: '#f59e0b' }}>Outreach: {iPrev.filter(l => l._outreaches?.length > 0).length}</span>
                    <span style={{ color: '#ef4444' }}>Ingen email: {iPrev.filter(l => !l.email).length}</span>
                  </div>
                  <div className="table-wrapper" style={{ maxHeight: 240, overflow: 'auto', marginBottom: 14, border: '1px solid #1f2937', borderRadius: 8 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead><tr style={{ background: '#080d18', position: 'sticky', top: 0 }}>
                        {['Navn', 'Email', 'By', 'Status', 'Outreach', 'Salg'].map(h => <th key={h} style={{ padding: '7px 10px', textAlign: 'left', color: '#4b5563', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', borderBottom: '1px solid #1f2937' }}>{h}</th>)}
                      </tr></thead>
                      <tbody>{iPrev.map((l, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #0d1420', background: i % 2 ? '#ffffff03' : 'transparent' }}>
                          <td style={{ padding: '5px 10px', fontWeight: 600, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</td>
                          <td style={{ padding: '5px 10px', color: l.email ? '#38bdf8' : '#ef4444', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.email || 'mangler'}</td>
                          <td style={{ padding: '5px 10px', color: '#4b5563' }}>{l.city || '—'}</td>
                          <td style={{ padding: '5px 10px' }}><StatusBadge value={l.status} /></td>
                          <td style={{ padding: '5px 10px', color: '#f59e0b' }}>{l._outreaches?.length > 0 ? l._outreaches.length + 'x' : '—'}</td>
                          <td style={{ padding: '5px 10px', color: l.sale_info ? '#22c55e' : '#4b5563', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.sale_info || l.product || '—'}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button className="btn btn-p" disabled={saving} onClick={checkAndImport}>{saving ? 'Importerer...' : 'Importér ' + iPrev.length + ' leads → Supabase'}</button>
                  </div>
                </div>
              )}
            </div>
            <div style={{ marginTop: 18, ...CC.card, padding: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>Hjælp til import</div>
              <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>1. Minimum felter i din leadliste</div>
                  <div>For at et lead giver mening anbefales mindst: <strong>Navn</strong>, <strong>Kategori</strong> og <strong>Land</strong>. Resten kan udfyldes i CRM’et bagefter.</div>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>2. Anbefalede ekstra felter</div>
                  <div><strong>Mail</strong> (primær B2B‑email) er stærkt anbefalet. Du kan også tilføje <strong>Underkategori</strong> (til segmentering inden for brede kategorier), <strong>Kontaktperson</strong>, <strong>Telefon</strong>, <strong>By</strong>, <strong>Website</strong> og <strong>Noter</strong>. Noter importeres som første note på leadet.</div>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>3. B2B Outreach og Salg</div>
                  <div>Du kan valgfrit udfylde én eller flere <strong>B2B Outreach</strong>-kolonner og <strong>Salg/Udbytte</strong> i dit ark, hvis du allerede har historik. Det er dog ofte nemmere at sætte outreach og salg på direkte i CRM’et – enten per lead eller via bulk‑funktionen.</div>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>4. Ekstra funktioner i CRM’et</div>
                  <ul style={{ paddingLeft: 16, margin: 0 }}>
                    <li style={{ marginBottom: 2 }}><strong>Shopify‑integration (beta)</strong>: kan kobles på din shop via Admin API Access Token.</li>
                    <li style={{ marginBottom: 2 }}><strong>Lead Scraper (beta)</strong>: kan hente leads fra websites, men kræver ekstern scraper‑opsætning.</li>
                    <li><strong>Mail templates</strong>: opret mailskabeloner per kategori/underkategori, så du hurtigt kan kopiere tekster ind i dit mailsystem.</li>
                  </ul>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, ...CC.card, padding: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>Tip til Sheets‑skabelonen</div>
              <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, color: '#9ca3af' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid #374151' }}>SECTION</th>
                      <th style={{ textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid #374151' }}>INSTRUKTION</th>
                      <th style={{ textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid #374151' }}>EKSEMPEL</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Skabelon</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Kolonner bør altid bør være med i første række (se skabelonfanen)</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Navn · Kategori · Land · By · Websites · Mail · Kontaktperson · Telefon · B2B Outreach · Noter · Salg/Udbytte</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Skabelon</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Felter der SKAL udfyldes før import</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Navn, Kategori, Land</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Skabelon</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Andre felter kan (mail/bulk) udfyldes før import hvis man vil</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Mail, Websites, Outreach, Noter osv.</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Stavefejl og konsistens</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Brug altid samme stavemåde i data</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Klubber (ikke Kluber / Klubber / Klub)</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Stavefejl og konsistens</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Vigtigt især for disse felter</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Kategori, Underkategori, Land, By</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Stavefejl og konsistens</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Stavefejl skaber nye kategorier i systemet</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Klubber og Kluber bliver to forskellige kategorier</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>B2B Outreach</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Format i kolonnerne B2B Outreach 1/2/3/4</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Initialer, dato, tekst</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>B2B Outreach</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Eksempel outreach</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>JT, 04/03/2026, Første mail med katalog</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>B2B Outreach</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Eksempel outreach</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>JT, 10/03/2026, Ringet op – ingen svar</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>B2B Outreach</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Eksempel outreach</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>FH, 15/03/2026, Sendt tilbud på 50 ponchoer</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>B2B Outreach</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Minimum format hvis man vil gøre det simpelt</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Blot dato: 04/03/2026</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Salg/Udbytte</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Hvis der er solgt noget før import</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Skriv i kolonnen Salg/Udbytte</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Salg/Udbytte</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Anbefalet format</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Dato, antal, produkt</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Salg/Udbytte</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Eksempel</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>05/03/2026, 20 stk, Badeponchoer</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Noter</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Kan udfyldes før import hvis der er vigtig info</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Har aftalt at de kigger på kataloget til Q4</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Noter</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Ved import bliver noten gemt som</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Import note på leadet</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Kontaktperson</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Hvis en specifik person skal kontaktes</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Henrik Obel</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Kontaktperson</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Alternativt kan man skrive navn + direkte mail</td>
                      <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>Henrik Jensen – henrik@firma.dk</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ADD/EDIT */}
        {view === 'add' && editLead && (
          <div style={{ padding: 28, maxWidth: 640 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 18 }}>
              <button className="btn btn-g" onClick={() => { setView('list'); setEditLead(null); }}>Tilbage</button>
              <h2 style={{ fontWeight: 700 }}>{leads.find(l => l.id === editLead.id) ? 'Rediger lead' : 'Nyt lead'}</h2>
            </div>
            <div style={{ ...CC.card, padding: 22 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[['Navn *', 'name', 'text'], ['Email', 'email', 'email'], ['Telefon', 'phone', 'text'], ['By', 'city', 'text'], ['Website', 'website', 'text']].map(([lb, k, t]) => (
                  <div key={k}><label>{lb}</label><input className="inp" type={t} value={editLead[k] || ''} onChange={e => setEditLead({ ...editLead, [k]: e.target.value })} /></div>
                ))}
                <div><label>Kategori</label><input className="inp" value={editLead.category || ''} onChange={e => setEditLead({ ...editLead, category: e.target.value })} list="cat-list" /><datalist id="cat-list">{allCats.map(c => <option key={c} value={c} />)}</datalist></div>
                {(() => {
                  const { sub } = splitCategory(editLead.category || '');
                  return (
                    <div>
                      <label>Underkategori (valgfri)</label>
                      <input
                        className="inp"
                        value={sub}
                        onChange={e => {
                          const { base } = splitCategory(editLead.category || '');
                          const subVal = e.target.value.trim();
                          const nextCat = subVal ? `${base} (${subVal})` : base;
                          setEditLead({ ...editLead, category: nextCat });
                        }}
                        placeholder="fx Sport & Outdoor, Kajakklub"
                      />
                    </div>
                  );
                })()}
                <div><label>Land</label><input className="inp" value={editLead.country || ''} onChange={e => setEditLead({ ...editLead, country: e.target.value })} list="country-list" /><datalist id="country-list">{[...new Set([...COUNTRIES, ...allCountries])].sort().map(c => <option key={c} value={c} />)}</datalist></div>
                <div><label>Status</label><select className="inp" value={editLead.status} onChange={e => setEditLead({ ...editLead, status: e.target.value })}>{STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
                <div><label>Kontaktperson</label><input className="inp" value={editLead.contact_person || ''} onChange={e => setEditLead({ ...editLead, contact_person: e.target.value })} /></div>
              </div>
              <div style={{ marginTop: 12 }}><label>Salg info</label><input className="inp" value={editLead.sale_info || ''} onChange={e => setEditLead({ ...editLead, sale_info: e.target.value })} /></div>
              <div style={{ marginTop: 12 }}><label>Noter</label><textarea className="inp" rows={3} value={editLead.notes || ''} onChange={e => setEditLead({ ...editLead, notes: e.target.value })} style={{ resize: 'vertical' }} /></div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button className="btn btn-p" disabled={saving} onClick={saveLead}>{saving ? 'Gemmer...' : 'Gem'}</button>
                <button className="btn btn-g" onClick={() => { setView('list'); setEditLead(null); }}>Annuller</button>
              </div>
            </div>
          </div>
        )}

        {/* DETAIL */}
        {view === 'detail' && sel && (
          <div style={{ padding: 28, maxWidth: 640 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 18 }}>
              <button className="btn btn-g" onClick={() => setView('list')}>Tilbage</button>
              <h2 style={{ fontWeight: 700, flex: 1 }}>{sel.name}</h2>
              <button className="btn btn-g" onClick={() => openEdit(sel)}>Rediger</button>
              <button className="btn btn-d" onClick={() => delLead(sel.id)}>Slet</button>
            </div>
            {!sel.email && (
              <div style={{ background: '#ef444415', border: '1px solid #ef444430', borderRadius: 10, padding: '12px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#ef4444' }}>Ingen email på dette lead</span>
                <button className="btn btn-p" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => openEdit(sel)}>Tilføj email</button>
              </div>
            )}
            <div style={{ ...CC.card, padding: 20, marginBottom: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1.6fr)', gap: 18 }}>
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    {[['Email', sel.email], ['Telefon', sel.phone], ['By', sel.city], ['Land', sel.country], ['Kategori', sel.category], ['Kontaktperson', sel.contact_person], ['Website', sel.website]].map(([lb, v]) => (
                      <div key={lb}>
                        <div style={{ fontSize: 11, color: '#4b5563', marginBottom: 2 }}>{lb}</div>
                        <div
                          style={{
                            fontSize: 14,
                            color: lb === 'Email' && !v ? '#ef4444' : undefined,
                            whiteSpace: 'normal',
                            wordBreak: 'break-word',
                          }}
                        >
                          {lb === 'Website' && v
                            ? (
                              <a
                                href={v.startsWith('http') ? v : `https://${v}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: '#38bdf8', wordBreak: 'break-all' }}
                              >
                                {v}
                              </a>
                            )
                            : (v || '—')}
                        </div>
                      </div>
                    ))}
                  </div>
                  {sel.sale_info && (
                    <div style={{ background: '#14532d15', border: '1px solid #14532d30', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#4ade80', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <span>Salg: {sel.sale_info}</span>
                      <button className="btn btn-g" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => clearSale(sel)}>Fjern salg</button>
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#4b5563', marginBottom: 6 }}>Noter</div>
                  <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid #1f2937', borderRadius: 8, marginBottom: 8, background: '#080d18' }}>
                    {notesList.length === 0 && <div style={{ fontSize: 12, color: '#4b5563', padding: '8px 10px' }}>Ingen noter endnu</div>}
                    {notesList.map(n => (
                      <div key={n.id} style={{ padding: '8px 10px', borderBottom: '1px solid #020617', display: 'flex', gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#e5e7eb', marginBottom: 2, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{n.title || 'Note'}</div>
                          {n.created_at && <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>{fmtDate((n.created_at || '').slice(0, 10))}</div>}
                          {n.text && <div style={{ fontSize: 12, color: '#9ca3af', whiteSpace: 'pre-line' }}>{n.text}</div>}
                        </div>
                        <button className="btn btn-d" style={{ fontSize: 10, padding: '3px 6px', alignSelf: 'flex-start' }} onClick={() => deleteDetailNote(sel, n.id)}>×</button>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#4b5563', marginBottom: 4 }}>Tilføj note</div>
                  <input className="inp" style={{ marginBottom: 6, fontSize: 13 }} placeholder="Titel (f.eks. Telefonnotat)" value={noteTitle} onChange={e => setNoteTitle(e.target.value)} />
                  <textarea className="inp" rows={3} value={noteBody} onChange={e => setNoteBody(e.target.value)} style={{ resize: 'vertical', fontSize: 13 }} placeholder="Skriv ekstra info om leadet her" />
                  <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end' }}>
                    <button className="btn btn-p" style={{ fontSize: 11, padding: '5px 12px' }} disabled={saving} onClick={() => addDetailNote(sel)}>{saving ? 'Gemmer...' : 'Gem note'}</button>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ ...CC.card, padding: 18, marginBottom: 12 }}>
              <div className="sl">Status</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {STATUS_OPTIONS.map(s => (
                  <button key={s.value} onClick={() => updSt(sel, s.value)} style={{ cursor: 'pointer', border: '1px solid ' + (sel.status === s.value ? s.color : '#1f2937'), background: sel.status === s.value ? s.color + '22' : 'transparent', color: sel.status === s.value ? s.color : '#4b5563', borderRadius: 7, padding: '6px 13px', fontSize: 12, fontWeight: 600 }}>{s.label}</button>
                ))}
              </div>
            </div>
            <div style={{ ...CC.card, padding: 20 }}>
              <div className="sl">Outreach log ({(sel.outreaches || []).length})</div>
              {!(sel.outreaches || []).length && <div style={{ color: '#4b5563', fontSize: 13, marginBottom: 14 }}>Ingen outreach endnu</div>}
              {(sel.outreaches || []).map(o => (
                <div key={o.id} style={{ borderBottom: '1px solid #0d1420', paddingBottom: 10, marginBottom: 10 }}>
                  {editOtrId === o.id ? (
                    <div style={{ background: '#080d18', borderRadius: 8, padding: 12 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                        <div><label>Dato</label><input className="inp" type="date" value={editOtr.date} onChange={e => setEditOtr({ ...editOtr, date: e.target.value })} /></div>
                        <div><label>Af</label><input className="inp" value={editOtr.by} onChange={e => setEditOtr({ ...editOtr, by: e.target.value })} /></div>
                      </div>
                      <div style={{ marginBottom: 8 }}><label>Outreach besked</label><input className="inp" value={editOtr.note || ''} onChange={e => setEditOtr({ ...editOtr, note: e.target.value })} /></div>
                      <div style={{ marginBottom: 10 }}><label>Salg</label><input className="inp" value={editOtr.sale_info || ''} onChange={e => setEditOtr({ ...editOtr, sale_info: e.target.value })} placeholder="f.eks. Solgt 15 stk" /></div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-p" style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => saveEditOtr(sel)}>Gem</button>
                        <button className="btn btn-g" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => { setEditOtrId(null); setEditOtr(null); }}>Annuller</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{o.by}</span>
                          <span style={{ fontSize: 12, color: '#4b5563' }}>· {fmtDate(o.date)}</span>
                          {o.sale_info && <span style={{ fontSize: 11, color: '#4ade80', background: '#14532d15', border: '1px solid #14532d30', borderRadius: 4, padding: '1px 6px' }}>Salg</span>}
                        </div>
                        {o.note && <div style={{ fontSize: 12, color: '#6b7280' }}>{o.note}</div>}
                        {o.sale_info && <div style={{ fontSize: 12, color: '#4ade80', marginTop: 2 }}>{o.sale_info}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button className="btn btn-g" style={{ padding: '3px 9px', fontSize: 11 }} onClick={() => { setEditOtrId(o.id); setEditOtr({ ...o }); }}>Rediger</button>
                        <button className="btn btn-d" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => delOtr(sel, o.id)}>×</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div style={{ paddingTop: 14, borderTop: '1px solid #0d1420' }}>
                <div className="sl">Tilføj outreach</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div><label>Dato *</label><input className="inp" type="date" value={newOtr.date} onChange={e => setNewOtr({ ...newOtr, date: e.target.value })} /></div>
                  <div><label>Af</label><input className="inp" value={newOtr.by} onChange={e => setNewOtr({ ...newOtr, by: e.target.value })} /></div>
                </div>
                <div style={{ marginBottom: 8 }}><label>Outreach besked</label><input className="inp" value={newOtr.note} onChange={e => setNewOtr({ ...newOtr, note: e.target.value })} placeholder="f.eks. Email sendt med katalog" /></div>
                <div style={{ marginBottom: 12 }}><label>Salg (sætter status til Solgt automatisk)</label><input className="inp" value={newOtr.sale_info} onChange={e => setNewOtr({ ...newOtr, sale_info: e.target.value })} placeholder="f.eks. Solgt 20 stk vandkikkerter" style={{ borderColor: newOtr.sale_info ? '#22c55e55' : '' }} /></div>
                <button className="btn btn-p" onClick={() => addOtr(sel)}>Tilføj outreach</button>
              </div>
            </div>
          </div>
        )}

        {/* LIST */}
        {view === 'list' && (
          <div style={{ padding: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h2 style={{ fontWeight: 700 }}>Leads</h2>
              <div style={{ display: 'flex', gap: 8 }}>
                {!bulk && <button className="btn btn-v" onClick={() => { setBulk(true); setBulkSel(new Set()); }}>Bulk rediger</button>}
                {bulk && <button className="btn btn-g" onClick={() => { setBulk(false); setBulkSel(new Set()); }}>Afslut bulk</button>}
                <button className="btn btn-p" onClick={openAdd}>+ Nyt lead</button>
              </div>
            </div>

            {bulk && (
              <div style={{ background: 'linear-gradient(135deg,#1e1b4b,#0f172a)', border: '1px solid rgba(124,58,237,0.25)', borderRadius: 14, padding: '12px 16px', marginBottom: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Row 1: selection controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, background: 'rgba(124,58,237,0.15)', padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(124,58,237,0.25)', whiteSpace: 'nowrap' }}>
                    {bulkSel.size} valgt
                  </span>
                  <button className="btn btn-g" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setBulkSel(new Set(filtered.map(l => l.id)))}>Vælg alle ({filtered.length})</button>
                  <button className="btn btn-g" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setBulkSel(new Set())}>Fravælg alle</button>
                  <div style={{ flex: 1 }} />
                  <button className="btn btn-d" style={{ padding: '4px 12px', fontSize: 12 }} disabled={saving || bulkSel.size === 0} onClick={bulkDelete}>Slet ({bulkSel.size})</button>
                </div>
                {/* Row 2: fields inline (no labels) */}
                <div className="bulk-fields-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select className="inp" style={{ height: 34, fontSize: 13, flex: '0 0 150px' }} value={bulkSale.trim() ? 'won' : bulkSt} onChange={e => setBulkSt(e.target.value)} disabled={!!bulkSale.trim()}>
                    {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <input className="inp" type="date" style={{ height: 34, fontSize: 13, flex: '0 0 140px' }} value={bulkDate} onChange={e => setBulkDate(e.target.value)} />
                  <input className="inp" style={{ height: 34, fontSize: 13, flex: '0 0 80px' }} value={bulkBy} onChange={e => setBulkBy(e.target.value)} placeholder="Af" />
                  <input className="inp" style={{ height: 34, fontSize: 13, flex: 1 }} value={bulkNote} onChange={e => setBulkNote(e.target.value)} placeholder="Outreach besked" />
                  <input className="inp" style={{ height: 34, fontSize: 13, flex: 1 }} value={bulkSale} onChange={e => setBulkSale(e.target.value)} placeholder="Salg (→ sætter Solgt)" />
                  <button className="btn" style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: '#fff', padding: '0 18px', height: 34, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', flex: 'none', boxShadow: '0 4px 12px rgba(124,58,237,0.4)' }} disabled={saving || bulkSel.size === 0} onClick={applyBulk}>
                    {saving ? 'Gemmer…' : `Anvend på ${bulkSel.size}`}
                  </button>
                </div>
              </div>
            )}

            <div className="leads-filter-bar" style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="inp" style={{ maxWidth: 200 }} placeholder="Søg..." value={search} onChange={e => setSearch(e.target.value)} />

              {/* Hierarkisk kategori mega-menu */}
              <div style={{ position: 'relative' }}>
                <button className="btn btn-g" style={{ whiteSpace: 'nowrap', minWidth: 170, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
                  onClick={() => { setCatOpen(o => !o); setCatSearch(''); }}>
                  <span>{fCats.size === 0 ? 'Alle kategorier' : `${fCats.size} valgt`}</span>
                  <span style={{ fontSize: 10 }}>{catOpen ? '▲' : '▼'}</span>
                </button>
                {catOpen && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 200, background: '#111827', border: '1px solid #1f2937', borderRadius: 10, minWidth: 280, maxHeight: 440, display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
                    <div style={{ padding: '8px 10px', borderBottom: '1px solid #1f2937', display: 'flex', gap: 6, flexShrink: 0 }}>
                      <input className="inp" style={{ flex: 1, padding: '5px 9px', fontSize: 12 }} placeholder="Søg kategori..." value={catSearch} onChange={e => setCatSearch(e.target.value)} autoFocus />
                      <button className="btn btn-g" style={{ fontSize: 11, padding: '3px 8px', whiteSpace: 'nowrap' }} onClick={() => { setFCats(new Set()); setCatSearch(''); }}>Ryd</button>
                    </div>
                    <div style={{ overflowY: 'auto', padding: '4px 0' }}>
                      {catHierarchy.filter(p => !catSearch || p.name.toLowerCase().includes(catSearch.toLowerCase()) || p.subs.some(s => s.toLowerCase().includes(catSearch.toLowerCase()))).map(parent => {
                        const parentSelected = fCats.has(parent.name);
                        const subSel = parent.subs.filter(s => fCats.has(s)).length;
                        const allSubSel = parent.subs.length > 0 && parent.subs.every(s => fCats.has(s));
                        const hierExpanded = catHierOpen.has(parent.name);
                        const toggleParent = () => {
                          const n = new Set(fCats);
                          if (parent.subs.length === 0) { parentSelected ? n.delete(parent.name) : n.add(parent.name); }
                          else { if (allSubSel) { parent.subs.forEach(s => n.delete(s)); n.delete(parent.name); } else { parent.subs.forEach(s => n.add(s)); n.add(parent.name); } }
                          setFCats(n);
                        };
                        const isSel = parent.subs.length === 0 ? parentSelected : (subSel > 0 || parentSelected);
                        return (
                          <div key={parent.name}>
                            <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', cursor: 'pointer', background: isSel ? '#0ea5e910' : 'transparent', gap: 6 }}
                              onClick={parent.subs.length === 0 ? toggleParent : () => { const n = new Set(catHierOpen); n.has(parent.name) ? n.delete(parent.name) : n.add(parent.name); setCatHierOpen(n); }}>
                              <div style={{ width: 14, height: 14, borderRadius: 3, border: '1px solid ' + (isSel ? '#0ea5e9' : '#374151'), background: isSel ? '#0ea5e9' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                onClick={e => { e.stopPropagation(); toggleParent(); }}>
                                {isSel && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
                              </div>
                              <span style={{ fontSize: 13, fontWeight: 600, flex: 1, color: isSel ? '#e2e8f0' : '#9ca3af' }}>{parent.name}</span>
                              {parent.subs.length > 0 && <span style={{ fontSize: 10, color: '#4b5563' }}>{subSel > 0 ? `${subSel}/${parent.subs.length}` : ''} {hierExpanded ? '▲' : '▼'}</span>}
                            </div>
                            {parent.subs.length > 0 && hierExpanded && parent.subs.map(sub => {
                              const subLabel = sub.replace(parent.name, '').replace(/^\s*\(|\)\s*$/g, '').trim();
                              const sel = fCats.has(sub);
                              return (
                                <div key={sub} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px 5px 32px', cursor: 'pointer', background: sel ? '#0ea5e908' : 'transparent' }}
                                  onClick={() => { const n = new Set(fCats); sel ? n.delete(sub) : n.add(sub); setFCats(n); }}>
                                  <div style={{ width: 12, height: 12, borderRadius: 2, border: '1px solid ' + (sel ? '#0ea5e9' : '#374151'), background: sel ? '#0ea5e9' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {sel && <span style={{ color: '#fff', fontSize: 9, lineHeight: 1 }}>✓</span>}
                                  </div>
                                  <span style={{ fontSize: 12, color: sel ? '#e2e8f0' : '#6b7280' }}>{subLabel}</span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <select className="inp" style={{ maxWidth: 155 }} value={fStatus} onChange={e => setFStatus(e.target.value)}><option value="Alle">Alle statusser</option>{STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
              <select className="inp" style={{ maxWidth: 140 }} value={fCountry} onChange={e => setFCountry(e.target.value)}>
                <option value="Alle">Alle lande</option>
                {[...new Set([...COUNTRIES, ...allCountries])].sort().map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button className="btn btn-g" style={{ fontSize: 12, padding: '7px 14px', marginLeft: 'auto' }} disabled={bulkSel.size === 0} onClick={copyEmailsBulk}>
                Kopier emails ({bulkSel.size})
              </button>
              <button className="btn" style={{ fontSize: 12, padding: '7px 14px', background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: '#fff', fontWeight: 600, boxShadow: '0 4px 12px rgba(124,58,237,0.35)' }} onClick={() => {
                const firstTpl = templates.find(t => t.active) || templates[0] || null;
                const noFilters = fCats.size === 0 && fStatus === 'Alle' && fCountry === 'Alle' && bulkSel.size === 0;
                openCampaign(firstTpl, {
                  bulkIds: bulkSel.size > 0 ? bulkSel : null,
                  useCurrentFilters: !noFilters && bulkSel.size === 0,
                });
              }}>
                ✉ Send kampagne
              </button>
              <button className="btn btn-v" style={{ fontSize: 12, padding: '7px 16px' }} onClick={resetFiltersAndSort}>Nulstil filtre</button>
              <span style={{ fontSize: 13, color: '#4b5563' }}>{filtered.length} leads</span>
            </div>

            <div style={{ ...CC.card }}>
             <div className="table-wrapper" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 600 }}>
                <thead><tr style={{ borderBottom: '1px solid #1f2937' }}>
                  {bulk && <th style={{ padding: '10px 8px 10px 14px', width: 36 }}></th>}
                  {[
                    { label: 'Navn', key: 'name' },
                    { label: 'Kategori', key: 'category' },
                    { label: 'Email', key: 'email' },
                    { label: 'Land', key: 'country' },
                    { label: 'Status', key: 'status' },
                    { label: 'Outreach', key: 'outreach' },
                    { label: 'Salg', key: 'sale' },
                  ].map(col => {
                    const isActive = sortKey === col.key;
                    const arrow = isActive ? (sortDir === 'asc' ? '▲' : '▼') : '↕';
                    return (
                      <th
                        key={col.key}
                        className={col.key === 'country' ? 'col-country' : col.key === 'outreach' ? 'col-outreach' : ''}
                        style={{ padding: '10px 14px', textAlign: 'left', color: isActive ? '#e5e7eb' : '#4b5563', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap', cursor: 'pointer' }}
                        onClick={() => {
                          if (sortKey === col.key) {
                            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortKey(col.key);
                            setSortDir(col.key === 'outreach' ? 'desc' : 'asc');
                          }
                        }}
                      >
                        <span>{col.label}</span>
                        <span style={{ marginLeft: 4, fontSize: 10, color: isActive ? '#e5e7eb' : '#6b7280' }}>{arrow}</span>
                      </th>
                    );
                  })}
                </tr></thead>
                <tbody>
                  {!sorted.length && <tr><td colSpan={bulk ? 8 : 7} style={{ padding: 32, textAlign: 'center', color: '#4b5563' }}>Ingen leads fundet. <button className="btn btn-g" onClick={openAdd} style={{ marginLeft: 8 }}>+ Tilføj</button></td></tr>}
                  {sorted.map((lead, leadIdx) => (
                    <tr key={lead.id} className={bulk ? '' : 'rh'} style={{ borderBottom: '1px solid #0d1420', background: bulkSel.has(lead.id) ? '#7c3aed10' : 'transparent', cursor: bulk ? 'default' : 'pointer', userSelect: bulk ? 'none' : 'auto' }}
                      onClick={() => { if (!bulk) { setSel(lead); setView('detail'); } }}
                      onMouseEnter={() => {
                        if (!bulk || !dragSelRef.current.active) return;
                        const { startIdx, mode, originalSel } = dragSelRef.current;
                        const from = Math.min(startIdx, leadIdx);
                        const to = Math.max(startIdx, leadIdx);
                        const n = new Set(originalSel);
                        for (let i = from; i <= to; i++) { mode ? n.add(sorted[i].id) : n.delete(sorted[i].id); }
                        setBulkSel(n);
                      }}>
                      {bulk && <td style={{ padding: '10px 8px 10px 14px' }}
                        onMouseDown={e => {
                          e.preventDefault();
                          const isSelected = bulkSel.has(lead.id);
                          dragSelRef.current = { active: true, mode: !isSelected, startIdx: leadIdx, originalSel: new Set(bulkSel) };
                          const n = new Set(bulkSel);
                          isSelected ? n.delete(lead.id) : n.add(lead.id);
                          setBulkSel(n);
                        }}
                        onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={bulkSel.has(lead.id)} readOnly style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#7c3aed', pointerEvents: 'none' }} />
                      </td>}
                      <td style={{ padding: '10px 14px', fontWeight: 600, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.name}</td>
                      <td style={{ padding: '10px 14px' }}><span className="tag">{lead.category}</span></td>
                      <td style={{ padding: '10px 14px', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.email ? <span style={{ color: '#4b5563' }}>{lead.email}</span> : <span style={{ color: '#ef4444', fontSize: 11, fontWeight: 600 }}>+ Tilføj email</span>}</td>
                      <td className="col-country" style={{ padding: '10px 14px', color: '#4b5563', whiteSpace: 'nowrap' }}>{lead.country || '—'}</td>
                      <td style={{ padding: '10px 14px' }}><StatusBadge value={lead.status} /></td>
                      <td className="col-outreach" style={{ padding: '10px 14px', color: '#6b7280' }}>{(lead.outreaches || []).length ? <span style={{ fontSize: 12, lineHeight: 1.6 }}>{lead.outreaches.length}x{lead.outreaches.map(o => o.date).filter(Boolean).map(d => <span key={d} style={{ display: 'block', fontSize: 11, color: '#4b5563' }}>{fmtDate(d)}</span>)}</span> : <span style={{ color: '#1f2937' }}>—</span>}</td>
                      <td style={{ padding: '10px 14px' }}>{lead.sale_info ? <span style={{ color: '#4ade80', fontSize: 12, fontWeight: 600 }}>{lead.sale_info.slice(0, 32)}</span> : <span style={{ color: '#1f2937' }}>—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
             </div>{/* /table-wrapper */}
            </div>
          </div>
        )}

        {/* SCRAPER */}
        {view === 'scraper' && (
          <div style={{ padding: '20px 16px' }}>
            <style>{`
              @media(max-width:700px){
                .scraper-grid{grid-template-columns:1fr!important}
                .scraper-actions{flex-wrap:wrap!important;gap:6px!important}
                .scraper-tbl-wrap{overflow-x:auto}
              }
              .scrape-row-del{opacity:0;transition:opacity 0.15s}
              tr:hover .scrape-row-del{opacity:1}
              .scrape-cat-sel{background:#0d1420;border:1px solid #1f2937;color:#e5e7eb;border-radius:6px;padding:2px 6px;font-size:11px;cursor:pointer;width:100%}
              .scrape-cat-sel:focus{outline:2px solid #0ea5e9}
            `}</style>

            {/* Header */}
            <div style={{ marginBottom: 18 }}>
              <h2 style={{ fontWeight: 800, fontSize: 20, marginBottom: 4, letterSpacing: 0.3 }}>🔍 Lead Scraper</h2>
              <div style={{ fontSize: 13, color: '#6b7280' }}>Indsæt én eller flere URL'er (eller et Google-søgelink) – vi crawler alle undersider og henter emails, tlf, by og kategori automatisk.</div>
            </div>

            {/* Navn-søgning */}
            <div style={{ ...CC.card, padding: 16, marginBottom: 16, border: '1px solid #3b2d6b' }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#a78bfa', letterSpacing: 0.3 }}>📋 Navn-søgning – indsæt navne og find emails automatisk</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <textarea
                    className="inp"
                    style={{ width: '100%', height: 100, resize: 'vertical', fontSize: 12, fontFamily: 'monospace' }}
                    value={scrapeNamesRaw}
                    onChange={e => setScrapeNamesRaw(e.target.value)}
                    placeholder={'Marstal Havn\nKøge Marina\nVordingborg Lystbådehavn'}
                    disabled={scrapeLoading}
                  />
                  {scrapeNameLines.length > 0 && (
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                      {scrapeNameLines.length} navn{scrapeNameLines.length !== 1 ? 'e' : ''}
                      {scrapeNameDupes.length > 0 && <span style={{ color: '#ef4444', marginLeft: 8 }}>{scrapeNameDupes.length} duplikat{scrapeNameDupes.length !== 1 ? 'er' : ''} ignoreret</span>}
                      {scrapeNameLines.length > 200 && <span style={{ color: '#f59e0b', marginLeft: 8 }}>⚠️ Lang liste – del op i bidder af maks 200 for hurtigere resultater</span>}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 2 }}>
                  <div>
                    <label style={{ fontSize: 11, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Land</label>
                    <select className="inp" style={{ height: 36, minWidth: 130 }} value={scrapeCustomCountry || scrapeCountry} onChange={e => { setScrapeCountry(e.target.value); setScrapeCustomCountry(''); }} disabled={scrapeLoading}>
                      {Object.keys(DDG_LOCALE).map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <button
                    className="btn btn-p"
                    style={{ height: 38, fontWeight: 700, whiteSpace: 'nowrap' }}
                    onClick={runNamesSearch}
                    disabled={scrapeLoading || !scrapeNameLines.length}
                  >
                    {scrapeLoading ? '⏳ Søger...' : '🔍 Søg navne'}
                  </button>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#4b5563', marginTop: 6 }}>Ét navn per linje. Vi søger DuckDuckGo for hvert navn og henter email, tlf og website automatisk. Land bruges til at præcisere søgningen.</div>
            </div>

            {/* Smart søgning */}
            <div style={{ ...CC.card, padding: 16, marginBottom: 16, border: '1px solid #1e3a5f' }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: '#38bdf8', letterSpacing: 0.3 }}>🔎 Smart søgning – søg automatisk efter leads</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <label style={{ fontSize: 11, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Kategori</label>
                  <select className="inp" value={scrapeCustomCategory || scrapeCategory} onChange={e => {
                    const v = e.target.value;
                    if (v === '__custom__') { setScrapeCustomCategory(''); } else { setScrapeCategory(v); setScrapeCustomCategory(''); }
                  }} style={{ height: 38, minWidth: 180 }}>
                    <option value="">– Vælg kategori –</option>
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    <option value="__custom__">+ Ny kategori...</option>
                  </select>
                </div>
                {(scrapeCustomCategory !== null) && (
                  <div>
                    <label style={{ fontSize: 11, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Ny kategori navn</label>
                    <input className="inp" style={{ height: 38, minWidth: 160 }} value={scrapeCustomCategory} onChange={e => setScrapeCustomCategory(e.target.value)} placeholder="f.eks. Vinterbadelaug" disabled={scrapeLoading} />
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 11, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Land</label>
                  <select
                    className="inp"
                    style={{ height: 38, minWidth: 140 }}
                    value={scrapeCustomCountry || scrapeCountry}
                    onChange={e => { setScrapeCountry(e.target.value); setScrapeCustomCountry(''); }}
                    disabled={scrapeLoading}
                  >
                    {Object.keys(DDG_LOCALE).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={{ fontSize: 11, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Tilpassede søgeord <span style={{ color: '#4b5563' }}>(valgfrit – kommasepareret)</span></label>
                  <input className="inp" style={{ height: 38, width: '100%' }} value={scrapeSmartKeywords} onChange={e => setScrapeSmartKeywords(e.target.value)} placeholder='f.eks. gästhamnar "e-post" site:se, hamnar e-post kontakt' disabled={scrapeLoading} />
                </div>
                <button className="btn" style={{ height: 38, background: '#0ea5e9', color: '#fff', fontWeight: 700, whiteSpace: 'nowrap' }} onClick={() => generateSmartUrls(false)} disabled={scrapeLoading}>
                  Generer URLs
                </button>
                <button className="btn btn-p" style={{ height: 38, fontWeight: 700, whiteSpace: 'nowrap' }} onClick={() => generateSmartUrls(true)} disabled={scrapeLoading || (!(scrapeCustomCategory || scrapeCategory) && !scrapeSmartKeywords.trim())}>
                  {scrapeLoading ? '⏳ Scraper...' : '🚀 Søg & scrape alt'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#4b5563', marginTop: 8 }}>
                Genererer Google-søgninger med præcise e-post/email-søgtermer for det valgte land. Du kan redigere URL'erne nedenfor inden scraping.
              </div>
            </div>

            {/* Input + config grid */}
            <div className="scraper-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,340px)', gap: 16, marginBottom: 16 }}>

              {/* URL input */}
              <div style={{ ...CC.card, padding: 18 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: '#e2e8f0', letterSpacing: 0.3 }}>URL'er at scrape</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>Én URL pr. linje. Fungerer med normale websites OG Google-søge-URLs (google.dk/search?q=…)</div>
                <textarea
                  className="inp"
                  rows={7}
                  value={scrapeUrls}
                  onChange={e => setScrapeUrls(e.target.value)}
                  placeholder={'https://eksempel.dk\nhttps://www.google.dk/search?q=kajakklubbe+dk\nhttps://havneguide.dk/havne'}
                  style={{ fontFamily: 'monospace', fontSize: 12, resize: 'vertical', lineHeight: 1.6 }}
                  disabled={scrapeLoading}
                />

                {scrapeLoading && (
                  <div style={{ marginTop: 12, background: '#0d1420', borderRadius: 10, padding: '12px 16px', border: '1px solid #1a2332' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <div style={{ width: 20, height: 20, border: '2.5px solid #1f2937', borderTop: '2.5px solid #0ea5e9', borderRadius: '50%', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
                        {scrapeProgress.done + 1}/{scrapeProgress.total} behandlet · {scrapeRows.length} leads fundet · {scrapeElapsed}s
                      </span>
                      <button className="btn btn-d" style={{ fontSize: 11, padding: '3px 10px', marginLeft: 'auto' }} onClick={cancelScrape}>Stop</button>
                    </div>
                    {/* Progress bar */}
                    <div style={{ height: 4, background: '#1f2937', borderRadius: 2, marginBottom: 8, overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: '#0ea5e9', borderRadius: 2, transition: 'width 0.4s', width: `${scrapeProgress.total > 0 ? Math.round((scrapeProgress.done / scrapeProgress.total) * 100) : 0}%` }} />
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {scrapeProgress.current ? `Behandler: ${scrapeProgress.current}` : 'Forbereder...'}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-p"
                    onClick={runScrape}
                    disabled={scrapeLoading}
                    style={{ height: 40, fontSize: 14, paddingLeft: 20, paddingRight: 20, fontWeight: 700 }}
                  >
                    {scrapeLoading ? `⏳ ${scrapeProgress.done}/${scrapeProgress.total} URLs…` : '🚀 Start scraping'}
                  </button>
                  {!!scrapeRows.length && !scrapeLoading && (
                    <button className="btn btn-g" onClick={clearScrape} style={{ height: 40 }}>Ryd</button>
                  )}
                </div>
              </div>

              {/* Config */}
              <div style={{ ...CC.card, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0', letterSpacing: 0.3 }}>Indstillinger</div>

                <div>
                  <label style={{ fontSize: 11, color: '#9ca3af', display: 'block', marginBottom: 5 }}>Land (standard)</label>
                  <select
                    className="inp"
                    value={scrapeCountry}
                    onChange={e => setScrapeCountry(e.target.value)}
                    style={{ height: 38 }}
                  >
                    {COUNTRIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: 11, color: '#9ca3af', display: 'block', marginBottom: 5 }}>Standardkategori (overskriver auto-detect)</label>
                  <select
                    className="inp"
                    value={scrapeCategory}
                    onChange={e => setScrapeCategory(e.target.value)}
                    style={{ height: 38 }}
                  >
                    <option value="">– Auto-detect kategori –</option>
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>

                <div style={{ background: '#080d18', borderRadius: 8, padding: '10px 12px', fontSize: 11, color: '#6b7280', lineHeight: 1.7, border: '1px solid #1a2332' }}>
                  <div style={{ fontWeight: 600, color: '#9ca3af', marginBottom: 4 }}>Hvad scrapes?</div>
                  <div>✔ Emails på alle undersider</div>
                  <div>✔ Kontakt- og om-os-sider</div>
                  <div>✔ Eksterne links (f.eks. membre-websiter)</div>
                  <div>✔ Telefonnr. og by</div>
                  <div>✔ Google søgeresultater (side 1-3)</div>
                  <div>✔ Auto-kategori fra sidens indhold</div>
                </div>

                {!!scrapeErrors.length && (
                  <div style={{ background: '#b91c1c18', border: '1px solid #b91c1c44', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#fca5a5' }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{scrapeErrors.length} URL(er) fejlede</div>
                    {scrapeErrors.slice(0, 3).map((e, i) => (
                      <div key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.75 }}>{e.url?.split('/')[2]} – {e.reason}</div>
                    ))}
                    {scrapeErrors.length > 3 && <div style={{ opacity: 0.5 }}>…og {scrapeErrors.length - 3} mere</div>}
                  </div>
                )}
              </div>
            </div>

            {/* Results table */}
            <div style={{ ...CC.card, overflow: 'hidden' }}>
              {/* Table action bar */}
              <div className="scraper-actions" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid #1f2937', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0' }}>
                    {scrapeRows.length > 0 ? `${scrapeRows.length} leads fundet` : 'Resultater'}
                  </span>
                  {scrapeRows.length > 0 && (
                    <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>Rediger kategori direkte i tabellen</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <select
                    className="inp"
                    value={scrapeClearField}
                    onChange={e => setScrapeClearField(e.target.value)}
                    disabled={!scrapeRows.length}
                    style={{ height: 36, fontSize: 12, minWidth: 110 }}
                  >
                    <option value="name">Navn</option>
                    <option value="email">Email</option>
                    <option value="phone">Tlf.</option>
                    <option value="city">By</option>
                    <option value="website">Website</option>
                    <option value="contact_person">Kontaktperson</option>
                  </select>
                  <button
                    className="btn btn-d"
                    onClick={() => setScrapeRows(prev => prev.map(r => ({ ...r, [scrapeClearField]: '' })))}
                    disabled={!scrapeRows.length}
                    style={{ height: 36, fontSize: 12, whiteSpace: 'nowrap' }}
                  >
                    Ryd felt
                  </button>
                </div>
                <button className="btn btn-g" onClick={copyScrapeTable} disabled={!scrapeRows.length} style={{ height: 36, fontSize: 12 }}>📋 Kopier (TSV)</button>
                <button className="btn btn-p" onClick={sendScrapeToImport} disabled={!scrapeRows.length} style={{ height: 36, fontSize: 12, fontWeight: 700 }}>➡ Send {scrapeRows.length || 0} til import</button>
              </div>

              {/* Sheet-like table */}
              <div className="scraper-tbl-wrap table-wrapper" style={{ overflowX: 'auto', maxHeight: 480, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
                  <thead>
                    <tr style={{ background: '#020617', position: 'sticky', top: 0, zIndex: 1 }}>
                      {['Navn', 'Kategori', 'Email', 'Tlf.', 'By', 'Website', 'Kontaktperson', ''].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, color: '#4b5563', borderBottom: '2px solid #1a2332', whiteSpace: 'nowrap', fontWeight: 700 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {!scrapeRows.length && (
                      <tr>
                        <td colSpan={8} style={{ padding: '40px 20px', textAlign: 'center' }}>
                          <div style={{ fontSize: 32, marginBottom: 12 }}>🔎</div>
                          <div style={{ fontSize: 14, color: '#4b5563', marginBottom: 6 }}>Ingen leads endnu</div>
                          <div style={{ fontSize: 12, color: '#374151' }}>Indsæt en URL eller et Google-søgelink og tryk "Start scraping"</div>
                        </td>
                      </tr>
                    )}
                    {scrapeRows.map((r, i) => (
                      <tr
                        key={r.sourceUrl + ':' + r.email + ':' + i}
                        style={{ borderBottom: '1px solid #0f1929', background: i % 2 === 0 ? 'transparent' : '#080d18', transition: 'background 0.1s' }}
                      >
                        {/* Navn */}
                        <td style={{ padding: '7px 10px', fontWeight: 600, maxWidth: 180, minWidth: 100 }}>
                          <input
                            value={r.name || ''}
                            placeholder="—"
                            onChange={e => updateScrapeRow(i, 'name', e.target.value)}
                            style={{
                              width: '100%', background: 'transparent', border: '1px solid transparent',
                              borderRadius: 3, color: '#e2e8f0', padding: '3px 5px', fontSize: 12,
                              outline: 'none', fontFamily: 'inherit', fontWeight: 600
                            }}
                            onFocus={e => e.currentTarget.style.borderColor = '#3b82f6'}
                            onBlur={e => e.currentTarget.style.borderColor = 'transparent'}
                          />
                        </td>
                        {/* Kategori – inline editable dropdown */}
                        <td style={{ padding: '5px 8px', minWidth: 150 }}>
                          <select
                            className="scrape-cat-sel"
                            value={r._editCat || ''}
                            onChange={e => updateScrapeRow(i, '_editCat', e.target.value)}
                          >
                            <option value="">– Vælg –</option>
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        {/* Email */}
                        <td style={{ padding: '7px 10px', minWidth: 160 }}>
                          <input
                            value={r.email || ''}
                            placeholder="—"
                            onChange={e => updateScrapeRow(i, 'email', e.target.value)}
                            style={{
                              width: '100%', background: 'transparent', border: '1px solid transparent',
                              borderRadius: 3, color: '#38bdf8', padding: '3px 5px', fontSize: 12,
                              outline: 'none', fontFamily: 'monospace'
                            }}
                            onFocus={e => e.currentTarget.style.borderColor = '#3b82f6'}
                            onBlur={e => e.currentTarget.style.borderColor = 'transparent'}
                          />
                        </td>
                        {/* Tlf */}
                        <td style={{ padding: '7px 10px', color: '#9ca3af', whiteSpace: 'nowrap', minWidth: 90 }}>
                          <input
                            value={r.phone || ''}
                            placeholder="—"
                            onChange={e => updateScrapeRow(i, 'phone', e.target.value)}
                            style={{
                              width: '100%', background: 'transparent', border: '1px solid transparent',
                              borderRadius: 3, color: '#e2e8f0', padding: '3px 5px', fontSize: 12,
                              outline: 'none', fontFamily: 'inherit'
                            }}
                            onFocus={e => e.currentTarget.style.borderColor = '#3b82f6'}
                            onBlur={e => e.currentTarget.style.borderColor = 'transparent'}
                          />
                        </td>
                        {/* By */}
                        <td style={{ padding: '7px 10px', color: '#9ca3af', minWidth: 80 }}>
                          <input
                            value={r.city || ''}
                            placeholder="—"
                            onChange={e => updateScrapeRow(i, 'city', e.target.value)}
                            style={{
                              width: '100%', background: 'transparent', border: '1px solid transparent',
                              borderRadius: 3, color: '#e2e8f0', padding: '3px 5px', fontSize: 12,
                              outline: 'none', fontFamily: 'inherit'
                            }}
                            onFocus={e => e.currentTarget.style.borderColor = '#3b82f6'}
                            onBlur={e => e.currentTarget.style.borderColor = 'transparent'}
                          />
                        </td>
                        {/* Website */}
                        <td style={{ padding: '7px 10px', minWidth: 110 }}>
                          {r.website
                            ? <a href={r.website} target="_blank" rel="noopener" style={{ color: '#6366f1', fontSize: 11, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: 130 }} title={r.website}>{r.website.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}</a>
                            : <span style={{ color: '#374151' }}>—</span>}
                        </td>
                        {/* Kontaktperson */}
                        <td style={{ padding: '7px 10px', color: '#9ca3af', minWidth: 100 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.contact_person}>{r.contact_person || <span style={{ color: '#374151' }}>—</span>}</div>
                        </td>
                        {/* Delete */}
                        <td style={{ padding: '7px 8px', textAlign: 'center' }}>
                          <button
                            className="scrape-row-del"
                            onClick={() => deleteScrapeRow(i)}
                            title="Fjern"
                            style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}
                          >✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ACTIVITY */}
        {view === 'activity' && (() => {
          const allActivity = [
            ...leads.flatMap(l => (l.outreaches || []).map(o => ({
              type: 'outreach',
              date: o.date || l.created_at?.slice(0, 10) || '',
              title: l.name,
              sub: o.note || 'Outreach sendt',
              by: o.by || '',
              sale: o.sale_info || '',
              leadId: l.id,
              id: o.id,
            }))),
            ...(() => {
              const groups = {};
              for (const l of leads) {
                const d = (l.created_at || '').slice(0, 10);
                if (!d) continue;
                if (!groups[d]) groups[d] = { date: d, count: 0 };
                groups[d].count++;
              }
              return Object.values(groups).map(b => ({
                type: 'import',
                date: b.date,
                title: b.count + ' leads importeret',
                sub: '',
                by: '',
                id: 'imp-' + b.date,
              }));
            })(),
          ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

          return (
            <div style={{ padding: 28, maxWidth: 720 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <button className="btn btn-g" style={{ fontSize: 12 }} onClick={() => setView('dashboard')}>← Tilbage</button>
                <h2 style={{ fontWeight: 700, margin: 0 }}>Al aktivitet</h2>
                <span style={{ fontSize: 12, color: '#4b5563' }}>{allActivity.length} hændelser</span>
              </div>
              <div style={{ ...CC.card, padding: 0, overflow: 'hidden' }}>
                {allActivity.length === 0 && <div style={{ padding: 24, color: '#4b5563', fontSize: 13 }}>Ingen aktivitet endnu</div>}
                {allActivity.map((a, i) => (
                  <div key={a.id || i}
                    style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 18px', borderBottom: i < allActivity.length - 1 ? '1px solid #0d1420' : 'none', cursor: a.type === 'outreach' ? 'pointer' : 'default' }}
                    onClick={() => { if (a.type === 'outreach') { const l = leads.find(x => x.id === a.leadId); if (l) { setSel(l); setView('detail'); } } }}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: a.type === 'outreach' ? (a.sale ? '#22c55e' : '#3b82f6') : '#6366f1', marginTop: 5, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</div>
                      {a.sub && <div style={{ fontSize: 12, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.sub}</div>}
                      {a.sale && <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>Salg: {a.sale}</div>}
                      {a.by && <div style={{ fontSize: 11, color: '#4b5563', marginTop: 2 }}>af {a.by}</div>}
                    </div>
                    <div style={{ fontSize: 11, color: '#4b5563', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtDate(a.date)}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

      </div>

      {/* MODAL: Import fortrudt / success banner */}
      {lastImportIds.length > 0 && view === 'import' && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#0d1420', border: '1px solid #22c55e44', borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, zIndex: 1000, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: '#e2e8f0' }}><strong style={{ color: '#22c55e' }}>{lastImportIds.length} leads</strong> importeret</span>
          <button className="btn btn-d" style={{ fontSize: 12, padding: '5px 14px' }} disabled={saving} onClick={undoImport}>Fortryd</button>
          <button className="btn btn-g" style={{ fontSize: 12, padding: '5px 14px' }} onClick={() => { setLastImportIds([]); setView('list'); }}>Gå til leads →</button>
          <button style={{ background: 'transparent', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: 16, lineHeight: 1 }} onClick={() => setLastImportIds([])}>✕</button>
        </div>
      )}

      {/* MODAL: Slet alle leads – trin 1 */}
      {deleteAllStep === 1 && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div style={{ ...CC.card, padding: 28, maxWidth: 440, width: '90%', border: '1px solid #ef444455' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#ef4444', marginBottom: 10 }}>Er du sikker?</div>
            <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 20, lineHeight: 1.6 }}>
              Du er ved at slette <strong style={{ color: '#e2e8f0' }}>alle {leads.length} leads</strong> og al tilhørende data permanent. Dette kan ikke fortrydes.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-g" onClick={() => setDeleteAllStep(0)}>Annuller</button>
              <button className="btn btn-d" onClick={() => setDeleteAllStep(2)}>Fortsæt →</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Slet alle leads – trin 2 */}
      {deleteAllStep === 2 && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div style={{ ...CC.card, padding: 28, maxWidth: 460, width: '90%', border: '2px solid #ef4444' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#ef4444', marginBottom: 6 }}>Er du HELT sikker?</div>
            <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 16, lineHeight: 1.6 }}>
              Alle <strong style={{ color: '#ef4444' }}>{leads.length} leads</strong> vil blive slettet fra hele databasen inkl. outreaches, noter og al tilhørende data. Dette kan ikke fortrydes.
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Skriv <strong style={{ color: '#e2e8f0' }}>SLET ALLE</strong> for at bekræfte:</div>
            <input
              className="inp"
              value={deleteAllConfirmText}
              onChange={e => setDeleteAllConfirmText(e.target.value)}
              placeholder="SLET ALLE"
              style={{ marginBottom: 16, borderColor: deleteAllConfirmText === 'SLET ALLE' ? '#ef4444' : '' }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-g" onClick={() => { setDeleteAllStep(0); setDeleteAllConfirmText(''); }}>Annuller</button>
              <button className="btn btn-d" disabled={deleteAllConfirmText !== 'SLET ALLE' || saving} onClick={deleteAllLeads}>
                {saving ? 'Sletter...' : 'Slet alle ' + leads.length + ' leads permanent'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Email Campaign ────────────────────────────────────────────── */}
      {campaignModal && (() => {
        const { tpl } = campaignModal;
        const recipients = getCampaignLeads();
        // reuse the same catHierarchy from main leads view
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2100, padding: 20 }}
            onClick={e => { if (e.target === e.currentTarget) setCampaignModal(null); }}>
            <div style={{ background: '#111827', borderRadius: 16, width: '100%', maxWidth: 860, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,0.9)', border: '1px solid #1f2937', overflow: 'hidden' }}>

              {/* Header */}
              <div style={{ padding: '16px 22px', background: '#080d18', borderBottom: '1px solid #1f2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: '#e2e8f0', whiteSpace: 'nowrap' }}>✉ Send email kampagne</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: '#4b5563', whiteSpace: 'nowrap' }}>Template:</span>
                    <select
                      style={{ background: '#111827', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 8, color: tpl ? '#a78bfa' : '#6b7280', fontSize: 13, fontWeight: 600, padding: '5px 10px', outline: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                      value={tpl?.id || '__none__'}
                      onChange={e => {
                        const newTpl = e.target.value === '__none__' ? null : templates.find(t => t.id === e.target.value);
                        setCampaignModal(prev => ({ ...prev, tpl: newTpl }));
                      }}
                    >
                      <option value="__none__">Intet template</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                </div>
                <button className="btn btn-g" style={{ fontSize: 12 }} onClick={() => setCampaignModal(null)}>Luk</button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
                {/* Template preview */}
                <div style={{ padding: '14px 22px', borderBottom: '1px solid #1f2937', background: '#0a0f1a' }}>
                  <div style={{ fontSize: 11, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Email indhold</div>
                  {tpl ? <>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>Emne: {tpl.subject || <span style={{ color: '#374151' }}>—</span>}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'hidden' }}>
                      {(tpl.body || '').slice(0, 350)}{(tpl.body || '').length > 350 ? '…' : ''}
                    </div>
                  </> : <div style={{ fontSize: 13, color: '#374151', fontStyle: 'italic' }}>Intet template valgt — du skriver selv indhold i dit mailprogram.</div>}
                </div>
                {/* Bulk selection indicator */}
                {campaignModal?.bulkIds && (
                  <div style={{ padding: '8px 22px', background: 'rgba(124,58,237,0.08)', borderBottom: '1px solid #1f2937', fontSize: 12, color: '#a78bfa' }}>
                    ✓ Sender til de {campaignModal.bulkIds.length} valgte leads — filtrene nedenfor er deaktiverede
                  </div>
                )}

                {/* Filters */}
                <div style={{ padding: '14px 22px', borderBottom: '1px solid #1f2937' }}>
                  <div style={{ fontSize: 11, color: '#4b5563', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Filtrer modtagere</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>

                    {/* ── Hierarkisk kategori dropdown (same as leads view) ── */}
                    <div>
                      <label style={{ fontSize: 11, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Kategori</label>
                      <div style={{ position: 'relative' }}>
                        <button className="btn btn-g" style={{ height: 36, minWidth: 190, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '0 10px' }}
                          onClick={() => { setCampaignCatOpen(o => !o); setCampaignCatSearch(''); }}>
                          <span style={{ fontSize: 13 }}>{campaignCats.size === 0 ? 'Alle kategorier' : `${campaignCats.size} valgt`}</span>
                          <span style={{ fontSize: 10 }}>{campaignCatOpen ? '▲' : '▼'}</span>
                        </button>
                        {campaignCatOpen && (
                          <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 400, background: '#111827', border: '1px solid #1f2937', borderRadius: 10, minWidth: 280, maxHeight: 380, display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.7)' }}>
                            <div style={{ padding: '8px 10px', borderBottom: '1px solid #1f2937', display: 'flex', gap: 6, flexShrink: 0 }}>
                              <input className="inp" style={{ flex: 1, padding: '5px 9px', fontSize: 12 }} placeholder="Søg kategori..." value={campaignCatSearch} onChange={e => setCampaignCatSearch(e.target.value)} autoFocus />
                              <button className="btn btn-g" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => { setCampaignCats(new Set()); setCampaignCatSearch(''); }}>Ryd</button>
                              <button className="btn btn-g" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setCampaignCatOpen(false)}>Luk</button>
                            </div>
                            <div style={{ overflowY: 'auto', padding: '4px 0' }}>
                              {catHierarchy.filter(p => !campaignCatSearch || p.name.toLowerCase().includes(campaignCatSearch.toLowerCase()) || p.subs.some(s => s.toLowerCase().includes(campaignCatSearch.toLowerCase()))).map(parent => {
                                const subSel = parent.subs.filter(s => campaignCats.has(s)).length;
                                const allSubSel = parent.subs.length > 0 && parent.subs.every(s => campaignCats.has(s));
                                const parentSel = campaignCats.has(parent.name);
                                const isSel = parent.subs.length === 0 ? parentSel : (subSel > 0 || parentSel);
                                const hierExp = campaignCatHierOpen.has(parent.name);
                                const toggleParent = () => {
                                  const n = new Set(campaignCats);
                                  if (parent.subs.length === 0) { parentSel ? n.delete(parent.name) : n.add(parent.name); }
                                  else { if (allSubSel) { parent.subs.forEach(s => n.delete(s)); n.delete(parent.name); } else { parent.subs.forEach(s => n.add(s)); n.add(parent.name); } }
                                  setCampaignCats(n);
                                };
                                return (
                                  <div key={parent.name}>
                                    <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', cursor: 'pointer', background: isSel ? '#0ea5e910' : 'transparent', gap: 6 }}
                                      onClick={parent.subs.length === 0 ? toggleParent : () => { const n = new Set(campaignCatHierOpen); n.has(parent.name) ? n.delete(parent.name) : n.add(parent.name); setCampaignCatHierOpen(n); }}>
                                      <div style={{ width: 14, height: 14, borderRadius: 3, border: '1px solid ' + (isSel ? '#0ea5e9' : '#374151'), background: isSel ? '#0ea5e9' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                        onClick={e => { e.stopPropagation(); toggleParent(); }}>
                                        {isSel && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
                                      </div>
                                      <span style={{ fontSize: 13, fontWeight: 600, flex: 1, color: isSel ? '#e2e8f0' : '#9ca3af' }}>{parent.name}</span>
                                      {parent.subs.length > 0 && <span style={{ fontSize: 10, color: '#4b5563' }}>{subSel > 0 ? `${subSel}/${parent.subs.length}` : ''} {hierExp ? '▲' : '▼'}</span>}
                                    </div>
                                    {parent.subs.length > 0 && hierExp && parent.subs.map(sub => {
                                      const subLabel = sub.replace(parent.name, '').replace(/^\s*\(|\)\s*$/g, '').trim();
                                      const sel = campaignCats.has(sub);
                                      return (
                                        <div key={sub} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px 5px 32px', cursor: 'pointer', background: sel ? '#0ea5e908' : 'transparent' }}
                                          onClick={() => { const n = new Set(campaignCats); sel ? n.delete(sub) : n.add(sub); setCampaignCats(n); }}>
                                          <div style={{ width: 12, height: 12, borderRadius: 2, border: '1px solid ' + (sel ? '#0ea5e9' : '#374151'), background: sel ? '#0ea5e9' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            {sel && <span style={{ color: '#fff', fontSize: 9, lineHeight: 1 }}>✓</span>}
                                          </div>
                                          <span style={{ fontSize: 12, color: sel ? '#e2e8f0' : '#6b7280' }}>{subLabel}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ── Land: alle lande fra leads + fri tekst ── */}
                    <div>
                      <label style={{ fontSize: 11, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Land</label>
                      <select className="inp" style={{ height: 36, minWidth: 150 }} value={campaignCountry} onChange={e => setCampaignCountry(e.target.value)}>
                        <option value="Alle">Alle lande</option>
                        {[...new Set([...COUNTRIES, ...allCountries])].sort().map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>

                    <div>
                      <label style={{ fontSize: 11, color: '#9ca3af', display: 'block', marginBottom: 4 }}>Status</label>
                      <select className="inp" style={{ height: 36, minWidth: 170 }} value={campaignStatus} onChange={e => setCampaignStatus(e.target.value)}>
                        <option value="Alle">Alle statusser</option>
                        {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                    <div style={{ fontSize: 13, color: '#9ca3af', paddingBottom: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 22, color: recipients.length > 0 ? '#a78bfa' : '#374151' }}>{recipients.length}</span> modtagere
                    </div>
                  </div>
                </div>

                {/* Recipients preview */}
                <div style={{ padding: '10px 22px 14px', borderBottom: '1px solid #1f2937', maxHeight: 160, overflowY: 'auto' }}>
                  {recipients.length === 0 ? (
                    <div style={{ fontSize: 13, color: '#374151', fontStyle: 'italic' }}>Ingen leads matcher filteret, eller de mangler email.</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {recipients.slice(0, 80).map(l => (
                        <span key={l.id} style={{ fontSize: 11, padding: '2px 8px', background: '#1f2937', borderRadius: 99, color: '#9ca3af', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.name}>
                          {l.email}
                        </span>
                      ))}
                      {recipients.length > 80 && <span style={{ fontSize: 11, color: '#4b5563', alignSelf: 'center' }}>…+{recipients.length - 80} mere</span>}
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div style={{ padding: '16px 22px' }}>
                  <div style={{ fontSize: 11, color: '#4b5563', marginBottom: 12 }}>
                    Vælg hvordan du vil sende. BCC-listen kopieres automatisk til udklipsholderen.
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      className="btn"
                      style={{ background: '#1a73e8', color: '#fff', fontWeight: 700, padding: '10px 18px', fontSize: 13 }}
                      disabled={recipients.length === 0}
                      onClick={campaignOpenGmail}
                    >
                      Åbn i Gmail
                      <span style={{ fontSize: 10, opacity: 0.7, display: 'block', fontWeight: 400 }}>+ BCC kopieres automatisk</span>
                    </button>
                    <button
                      className="btn btn-g"
                      style={{ fontWeight: 600, padding: '10px 18px', fontSize: 13 }}
                      disabled={recipients.length === 0}
                      onClick={campaignOpenMailto}
                    >
                      Åbn i mailprogram
                      <span style={{ fontSize: 10, opacity: 0.6, display: 'block', fontWeight: 400 }}>Outlook, Apple Mail mv.</span>
                    </button>
                    <button
                      className="btn btn-g"
                      style={{ padding: '10px 14px', fontSize: 12 }}
                      disabled={recipients.length === 0}
                      onClick={campaignCopyBCC}
                    >
                      Kopier BCC-liste
                    </button>
                    <div style={{ flex: 1 }} />
                    <button
                      className="btn"
                      style={{ background: '#14532d', color: '#4ade80', border: '1px solid #16a34a55', padding: '10px 16px', fontSize: 12 }}
                      disabled={recipients.length === 0 || saving}
                      onClick={campaignMarkSent}
                    >
                      {saving ? 'Gemmer...' : `✓ Markér ${recipients.length} som "Outreach sendt"`}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL: Template preview — email-style popup */}
      {previewTpl && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 20 }}>
          <div style={{ background: '#111827', borderRadius: 14, width: '100%', maxWidth: 700, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,0.8)', border: '1px solid #1f2937' }}>
            {/* Email client chrome */}
            <div style={{ padding: '14px 20px', background: '#080d18', borderBottom: '1px solid #1f2937', borderRadius: '14px 14px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#e2e8f0' }}>{previewTpl.name}</div>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: previewTpl.active ? '#14532d' : '#111827', color: previewTpl.active ? '#4ade80' : '#6b7280', border: '1px solid ' + (previewTpl.active ? '#16a34a55' : '#1f2937') }}>
                  {previewTpl.active ? 'Aktiv' : 'Arkiveret'}
                </span>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: '#1f2937', color: '#6b7280' }}>
                  {({ cold_outreach: 'Cold outreach', follow_up: 'Follow-up', re_engage: 'Re-engage', partner_intro: 'Partner intro', offer: 'Tilbud' })[previewTpl.type] || previewTpl.type}
                </span>
              </div>
              <button style={{ background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '2px 6px' }} onClick={() => setPreviewTpl(null)}>✕</button>
            </div>
            {/* Email headers (From / To / Subject) */}
            <div style={{ padding: '14px 22px', background: '#0d1420', borderBottom: '1px solid #0d1420' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr', rowGap: 6, columnGap: 12, fontSize: 13 }}>
                <span style={{ color: '#4b5563', fontWeight: 600, paddingTop: 1 }}>Fra:</span>
                <span style={{ color: '#9ca3af' }}>{previewTpl.from_email || <span style={{ fontStyle: 'italic' }}>ikke udfyldt</span>}</span>
                <span style={{ color: '#4b5563', fontWeight: 600, paddingTop: 1 }}>Til:</span>
                <span style={{ color: '#6b7280', fontStyle: 'italic' }}>{'{{lead.email}}'}</span>
                <span style={{ color: '#4b5563', fontWeight: 600, paddingTop: 1 }}>Emne:</span>
                <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{previewTpl.subject || <span style={{ color: '#4b5563', fontWeight: 400, fontStyle: 'italic' }}>intet emne</span>}</span>
                {(previewTpl.category_tags || []).length > 0 && <>
                  <span style={{ color: '#4b5563', fontWeight: 600, paddingTop: 1 }}>Kat.:</span>
                  <span style={{ color: '#6b7280', fontSize: 12 }}>{(previewTpl.category_tags || []).join(', ')}</span>
                </>}
              </div>
            </div>
            {/* Email body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px', background: '#0a0f1e' }}>
              <div style={{ fontSize: 14, lineHeight: 1.85, whiteSpace: 'pre-wrap', color: '#d1d5db', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', maxWidth: 600 }}>
                {previewTpl.body || <span style={{ color: '#374151', fontStyle: 'italic' }}>Ingen body endnu</span>}
              </div>
            </div>
            {/* Action footer */}
            <div style={{ padding: '12px 20px', background: '#080d18', borderTop: '1px solid #1f2937', borderRadius: '0 0 14px 14px', display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn btn-g" style={{ fontSize: 12 }} onClick={() => { navigator.clipboard?.writeText(previewTpl.body || ''); msg('Body kopieret'); }}>Kopiér body</button>
              <button className="btn btn-g" style={{ fontSize: 12 }} onClick={() => { navigator.clipboard?.writeText(previewTpl.subject || ''); msg('Emne kopieret'); }}>Kopiér emne</button>
              <button className="btn btn-p" style={{ fontSize: 12 }} onClick={() => { const t = previewTpl; setPreviewTpl(null); openEditTemplate(t); }}>Rediger</button>
              <button className="btn btn-g" style={{ fontSize: 12, marginLeft: 'auto' }} onClick={() => setPreviewTpl(null)}>Luk</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Dubletter ved import */}
      {dupModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 16 }}>
          <div style={{ ...CC.card, padding: 24, maxWidth: 640, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f59e0b', marginBottom: 4 }}>
              {dupModal.duplicates.length} dublet{dupModal.duplicates.length !== 1 ? 'ter' : ''} fundet
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>
              Disse leads findes allerede i databasen (matchet på {dupModal.duplicates.some(d => d._matchedBy === 'email') ? 'email' : 'navn'}).
              {dupModal.nonDuplicates.length > 0 && ` ${dupModal.nonDuplicates.length} nye leads er klar til import.`}
              {dupModal.enrichable?.length > 0 && <span style={{ color: '#4ade80' }}> {dupModal.enrichable.length} eksisterende har nye felter der kan tilføjes.</span>}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16, border: '1px solid #1f2937', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#080d18', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '7px 10px', textAlign: 'left', color: '#4b5563', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', borderBottom: '1px solid #1f2937' }}>Nyt (fra fil)</th>
                    <th style={{ padding: '7px 10px', textAlign: 'left', color: '#4b5563', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', borderBottom: '1px solid #1f2937' }}>Eksisterende (i DB)</th>
                    <th style={{ padding: '7px 10px', textAlign: 'left', color: '#4b5563', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', borderBottom: '1px solid #1f2937' }}>Match</th>
                  </tr>
                </thead>
                <tbody>
                  {dupModal.duplicates.map((d, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #0d1420', background: i % 2 ? '#ffffff03' : 'transparent' }}>
                      <td style={{ padding: '6px 10px', fontWeight: 600, color: '#e2e8f0' }}>{d.name}<br /><span style={{ color: '#38bdf8', fontWeight: 400 }}>{d.email || '—'}</span></td>
                      <td style={{ padding: '6px 10px', color: '#9ca3af' }}>{d._existing?.name}<br /><span style={{ color: '#38bdf8' }}>{d._existing?.email || '—'}</span></td>
                      <td style={{ padding: '6px 10px', fontSize: 11 }}>
                        <span style={{ color: '#f59e0b' }}>{d._matchedBy}</span>
                        {Object.keys(d._newFields || {}).length > 0 && (
                          <span style={{ display: 'block', color: '#4ade80', marginTop: 2 }}>+ {Object.keys(d._newFields).map(f => ENRICH_LABELS[f] || f).join(', ')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button className="btn btn-g" onClick={() => setDupModal(null)}>Annuller</button>
              {dupModal.nonDuplicates.length > 0 && (
                <button className="btn btn-p" onClick={() => importLeads(dupModal.nonDuplicates)}>
                  Tilføj kun nye ({dupModal.nonDuplicates.length})
                </button>
              )}
              {dupModal.enrichable?.length > 0 && (
                <button className="btn btn-g" style={{ borderColor: '#4ade8044', color: '#4ade80' }} onClick={enrichLeads}>
                  Tilføj nye felter ({dupModal.enrichable.length})
                </button>
              )}
              <button className="btn btn-g" style={{ borderColor: '#f59e0b44', color: '#f59e0b' }} onClick={() => importLeads([...dupModal.nonDuplicates, ...dupModal.duplicates])}>
                Tilføj alle alligevel ({dupModal.nonDuplicates.length + dupModal.duplicates.length})
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
