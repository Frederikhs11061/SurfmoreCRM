import { NextResponse } from 'next/server';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : '';
}

function extractH1(html) {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

function isGenericLabel(str) {
  if (!str) return false;
  return /^(kontakt|contact|email|e-mail|liste|members|links|oversigt|forside|home|menu|navigation|footer|header|søg|search)$/i.test(str.trim());
}

function buildName(html, url) {
  const h1 = extractH1(html);
  if (h1 && h1.length >= 2 && h1.length <= 80 && !/forside|home/i.test(h1) && !isGenericLabel(h1) && !h1.includes('@')) return h1;
  let title = extractTitle(html);
  if (!title) return url.hostname.replace(/^www\./, '');
  const parts = title.split(/[\|\-–·»]/);
  if (parts.length > 1) title = parts[0].trim();
  if (!title || isGenericLabel(title)) title = url.hostname.replace(/^www\./, '');
  return title;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
}

// ─── Auto category detection ─────────────────────────────────────────────────
// Returns a broad category string based on keywords found in the page text/title
const CAT_RULES = [
  { pattern: /surf|kitesurfing|windsurfing|wakeboard|vandski|sup\b|paddleboard/i, cat: 'Skoler & klubber' },
  { pattern: /kajak|kano|padling|kayak/i, cat: 'Kajakklubber' },
  { pattern: /spejder|scout/i, cat: 'Spejdergrupper' },
  { pattern: /folkeskole|grundskole|primary school/i, cat: 'Folkeskoler' },
  { pattern: /børnehave|dagtilbud|daycare|vuggestue|sfo\b/i, cat: 'Børnehaver' },
  { pattern: /efterskole/i, cat: 'Efterskoler' },
  { pattern: /gymnasium|htx|hhx|stx|gymnasial/i, cat: 'Gymnasium' },
  { pattern: /højskole|folkehøjskole/i, cat: 'Højskoler' },
  { pattern: /naturskole|naturcenter|naturstyrelsen|bæredygtighed|friluftsliv/i, cat: 'Naturskoler & Naturcentre' },
  { pattern: /skatepark|skateboard/i, cat: 'Skateparks' },
  { pattern: /havn\b|marina|sejlklub|sejlsport/i, cat: 'Havne' },
  { pattern: /webshop|webbutik|nettbutik|e-handel/i, cat: 'Butik & Webshop' },
  { pattern: /butik|forhandler|shop\b|retailer/i, cat: 'Butik & Webshop' },
  { pattern: /drage|legetøj|kite\b/i, cat: 'Drager & Legetøj' },
  { pattern: /indkøbsforening|indkøbsfællesskab/i, cat: 'Indkøbsforeninger' },
  { pattern: /skole\b|club\b|klub\b|forening\b|association|organisation/i, cat: 'Skoler & klubber' },
];

function detectCategory(html, title) {
  const text = (title + ' ' + stripTags(html)).slice(0, 5000);
  for (const rule of CAT_RULES) {
    if (rule.pattern.test(text)) return rule.cat;
  }
  return '';
}

// ─── Link extraction ──────────────────────────────────────────────────────────

function extractLinks(html, baseUrl, options = {}) {
  const {
    sameHostOnly = true,
    maxLinks = 50,
    priorityPatterns = [],
    skipPatterns = [],
    externalOnly = false,
  } = options;

  const base = new URL(baseUrl);
  const result = [];
  const seen = new Set();
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = re.exec(html)) && result.length < maxLinks) {
    const href = m[1].trim();
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    try {
      const url = new URL(href, base);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      if (url.hash && url.pathname === base.pathname) continue;
      const isSame = url.hostname === base.hostname;
      if (sameHostOnly && !isSame) continue;
      if (externalOnly && isSame) continue;
      const key = url.origin + url.pathname;
      if (seen.has(key)) continue;
      // skip obvious non-content paths
      if (/\.(pdf|jpg|jpeg|png|gif|svg|css|js|woff|ico|xml|zip)$/i.test(url.pathname)) continue;
      if (skipPatterns.some(p => p.test(url.pathname + url.search))) continue;
      seen.add(key);
      result.push({ url: url.toString(), text });
    } catch {
      // ignore invalid
    }
  }

  // Sort by priority patterns first
  if (priorityPatterns.length) {
    result.sort((a, b) => {
      const aP = priorityPatterns.some(p => p.test(a.url)) ? 0 : 1;
      const bP = priorityPatterns.some(p => p.test(b.url)) ? 0 : 1;
      return aP - bP;
    });
  }

  return result;
}

// ─── Google search result extraction ─────────────────────────────────────────

function extractGoogleResults(html) {
  // Google result links appear as /url?q=... or direct href to external sites
  const urls = [];
  const seen = new Set();

  // Pattern 1: /url?q=https://... links
  const re1 = /\/url\?q=(https?:\/\/[^&"]+)/gi;
  let m;
  while ((m = re1.exec(html))) {
    try {
      const url = decodeURIComponent(m[1]);
      const parsed = new URL(url);
      if (parsed.hostname.includes('google.') || parsed.hostname.includes('youtube.') || parsed.hostname.includes('wikipedia.')) continue;
      const key = parsed.origin + parsed.pathname;
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push(parsed.toString());
    } catch { /* ignore */ }
  }

  // Pattern 2: Direct href links that are clearly not Google-internal
  if (urls.length < 3) {
    const re2 = /href="(https?:\/\/(?!(?:www\.)?google\.[a-z]+)[^"]+)"/gi;
    while ((m = re2.exec(html)) && urls.length < 30) {
      try {
        const url = m[1];
        const parsed = new URL(url);
        if (parsed.hostname.includes('google.') || parsed.hostname.includes('youtube.') || parsed.hostname.includes('wikipedia.') || parsed.hostname.includes('facebook.') || parsed.hostname.includes('instagram.')) continue;
        const key = parsed.origin + parsed.pathname;
        if (seen.has(key)) continue;
        seen.add(key);
        urls.push(parsed.toString());
      } catch { /* ignore */ }
    }
  }

  return urls;
}

function isGoogleSearchUrl(url) {
  return /google\.[a-z]+\/search/i.test(url) ||
    /google\.[a-z]+\/\?/i.test(url) ||
    /google\.[a-z]+\/\#/i.test(url);
}

// ─── Score a name candidate ───────────────────────────────────────────────────

function scoreName(candidate) {
  if (!candidate || candidate.length < 2) return 0;
  let s = 0;
  const len = candidate.length;
  if (len >= 3 && len <= 80) s += 2;
  if (/\b[A-ZÆØÅ]/.test(candidate)) s += 2;
  const words = candidate.split(/\s+/);
  if (words.length >= 1 && words.length <= 8) s += 1;
  if (!/[.@:]/.test(candidate)) s += 2;
  if (/[A-Za-zÆØÅæøå]{3}/.test(candidate)) s += 1;
  const digits = (candidate.match(/\d/g) || []).length;
  if (digits > 0 && digits >= candidate.replace(/\s/g, '').length / 2) s -= 3;
  // penalize generic labels
  if (isGenericLabel(candidate)) s -= 5;
  return s;
}

// ─── Extract contacts from HTML ───────────────────────────────────────────────

function extractContacts(html, fallbackName, sourceUrl) {
  const safeFallback = (isGenericLabel(fallbackName) ? '' : (fallbackName || '')).slice(0, 100);
  const contactsMap = new Map();
  const emailRe = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;
  const plainText = stripTags(html);
  let m;

  while ((m = emailRe.exec(html))) {
    const email = m[0].toLowerCase().trim();
    
    // Filter obviously bad emails
    if (/^(noreply|no-reply|donotreply|example|test@|info@example|user@example)/i.test(email)) continue;
    if (/\.(png|jpg|gif|svg|js|css|woff)$/i.test(email)) continue;
    const domain = email.split('@')[1] || '';
    if (/wixpress\.com|sentry\.|rollbar\.|bugsnag\.|datadog\.|newrelic\.|cloudflare\.|amazonaws\.|githubusercontent\.com/i.test(domain)) continue;
    if (domain.split('.').some(p => p.length > 30)) continue;

    const idx = m.index;
    const windowStart = Math.max(0, idx - 1200);
    const windowEnd = Math.min(html.length, idx + 400);
    const snippet = html.slice(windowStart, windowEnd);

    // Extract best name from surrounding HTML text nodes
    let bestName = '';
    let bestScore = -99;
    const textRe = />([^<>]{2,120})</g;
    let tm;
    while ((tm = textRe.exec(snippet))) {
      const candidate = tm[1].replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/gi, '').replace(/\s+/g, ' ').trim();
      if (!candidate || candidate.includes('@') || candidate.includes('http')) continue;
      const score = scoreName(candidate);
      if (score > bestScore) {
        bestScore = score;
        bestName = candidate;
      }
    }
    const name = (bestName && bestScore >= 3) ? bestName : safeFallback;

    // Phone: look for Danish format in surrounding text
    let phone = '';
    const phonePatterns = [
      /(?:tlf\.?|telefon|phone|mobil|tel\.?)\s*:?\s*(\+?[\d][\d\s\-\/]{6,14})/i,
      /\b(\+45[\s\-]?\d{2}[\s\-]?\d{2}[\s\-]?\d{2}[\s\-]?\d{2})\b/,
      /\b([\d]{2}[\s\-]?[\d]{2}[\s\-]?[\d]{2}[\s\-]?[\d]{2})\b/,
    ];
    for (const pat of phonePatterns) {
      const pm = snippet.match(pat);
      if (pm) {
        const raw = pm[1].trim();
        const digits = raw.replace(/\D/g, '');
        if (/^(45)?\d{8}$/.test(digits)) {
          if (digits.length === 10 && digits.startsWith('45')) {
            phone = '+45 ' + digits.slice(2, 4) + ' ' + digits.slice(4, 6) + ' ' + digits.slice(6, 8) + ' ' + digits.slice(8);
          } else if (digits.length === 8) {
            phone = digits.slice(0,2) + ' ' + digits.slice(2,4) + ' ' + digits.slice(4,6) + ' ' + digits.slice(6);
          }
          break;
        }
      }
    }

    // City: match Danish postal code + city (e.g. "8000 Aarhus C")
    let city = '';
    const cm = snippet.match(/\b(\d{4})\s+([A-ZÆØÅ][A-Za-zÆØÅæøå\s\-]{2,25})/);
    if (cm) city = cm[0].trim().replace(/\s+/g, ' ');

    // Contact person
    let contact_person = '';
    const cpm = snippet.match(/(?:kontaktperson|ejer|formand|daglig leder|leder|direktør|contact person)[:\s]*([^<\n\r]{3,80})/i);
    if (cpm) contact_person = cpm[1].replace(/<[^>]+>/g, '').trim().split('\n')[0].trim();

    // Website from source
    let website = '';
    try {
      if (sourceUrl) {
        const su = new URL(sourceUrl);
        website = su.origin;
      }
    } catch { /* ignore */ }

    const existing = contactsMap.get(email) || {};
    contactsMap.set(email, {
      email,
      name: name || existing.name || safeFallback || '',
      phone: existing.phone || phone,
      city: existing.city || city,
      contact_person: existing.contact_person || contact_person,
      website: existing.website || website,
    });
  }

  return [...contactsMap.values()];
}

// ─── Safe fetch with timeout ──────────────────────────────────────────────────

async function safeFetch(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SurfmoreCRM/2.0; +https://surfmore.dk)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'da,en;q=0.8',
      },
    });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ─── Scrape a single site (up to 3 levels deep) ──────────────────────────────

async function scrapeSite(startUrl, category, country) {
  const results = [];
  const errors = [];

  let html, url;
  try {
    url = new URL(startUrl);
    const res = await safeFetch(url.toString());
    if (!res.ok) { errors.push({ url: url.toString(), reason: 'http_' + res.status }); return { results, errors }; }
    html = await res.text();
  } catch (e) {
    errors.push({ url: startUrl, reason: e.name === 'AbortError' ? 'timeout' : (e.message || 'fetch_error') });
    return { results, errors };
  }

  const siteName = buildName(html, url);
  const autoCategory = category || detectCategory(html, siteName);
  const websiteOrigin = url.origin;

  // Helper to add contacts from HTML + source URL
  const addContacts = (contacts, sourceUrl, overrideName) => {
    const dedupKey = (c) => c.email;
    for (const c of contacts) {
      if (results.some(r => r.email === c.email)) continue;
      results.push({
        sourceUrl,
        name: overrideName || c.name || siteName,
        category: autoCategory,
        country: country || '',
        email: c.email,
        phone: c.phone || '',
        city: c.city || '',
        website: c.website || websiteOrigin,
        contact_person: c.contact_person || '',
      });
    }
  };

  // 1) Contacts directly on front page
  const frontContacts = extractContacts(html, siteName, url.toString());
  addContacts(frontContacts, url.toString());

  // 2) Priority contact/about sub-pages on same domain
  const contactSubLinks = extractLinks(html, url.toString(), {
    sameHostOnly: true,
    maxLinks: 60,
    priorityPatterns: [/kontakt|contact|om-os|om\b|about|reach/i],
    skipPatterns: [/login|sign-in|cookie|privacy|pay|checkout|cart|blog|news|nyheder/i],
  })
    .filter(l => /kontakt|contact|om-os|om\b|about|reach/i.test(l.url))
    .slice(0, 5);

  for (const link of contactSubLinks) {
    try {
      const r = await safeFetch(link.url);
      if (!r.ok) continue;
      const subHtml = await r.text();
      const subContacts = extractContacts(subHtml, siteName, link.url);
      addContacts(subContacts, link.url);
    } catch { /* ignore */ }
  }

  // 3) All other internal subpages (for detail-list pages like directory sites)
  const internalLinks = extractLinks(html, url.toString(), {
    sameHostOnly: true,
    maxLinks: 80,
    skipPatterns: [/login|sign-in|cookie|privacy|pay|checkout|cart|#/i],
  }).slice(0, 40);

  for (const link of internalLinks) {
    // only crawl if we haven't been here
    if (results.some(r => r.sourceUrl === link.url)) continue;
    try {
      const r = await safeFetch(link.url, 8000);
      if (!r.ok) continue;
      const subHtml = await r.text();
      const subUrl = new URL(link.url);
      const subName = buildName(subHtml, subUrl);
      const subContacts = extractContacts(subHtml, subName, link.url);

      // For each found subpage contact, also check external links on this subpage
      if (subContacts.length > 0) {
        addContacts(subContacts, link.url, link.text || undefined);
      } else {
        // No contacts on subpage → follow external links (e.g. member own website)
        const extLinks = extractLinks(subHtml, link.url, {
          externalOnly: true,
          sameHostOnly: false,
          maxLinks: 10,
          skipPatterns: [/facebook|instagram|twitter|linkedin|youtube|google|maps/i],
        }).slice(0, 3);

        for (const ext of extLinks) {
          try {
            const re = await safeFetch(ext.url, 8000);
            if (!re.ok) continue;
            const extHtml = await re.text();
            const extUrl = new URL(ext.url);
            const extName = buildName(extHtml, extUrl);
            const baseName = link.text || ext.text || extName;
            const extContacts = extractContacts(extHtml, baseName, ext.url);

            // Also check contact page on external site
            if (extContacts.length === 0) {
              const extContactLinks = extractLinks(extHtml, ext.url, {
                sameHostOnly: true,
                maxLinks: 20,
                priorityPatterns: [/kontakt|contact|om-os|om\b|about/i],
                skipPatterns: [],
              }).filter(l => /kontakt|contact|om-os|om\b|about/i.test(l.url)).slice(0, 2);

              for (const ecl of extContactLinks) {
                try {
                  const rEc = await safeFetch(ecl.url, 7000);
                  if (!rEc.ok) continue;
                  const eclHtml = await rEc.text();
                  const eclContacts = extractContacts(eclHtml, baseName, ext.url);
                  addContacts(eclContacts, ext.url, baseName || undefined);
                } catch { /* ignore */ }
              }
            } else {
              addContacts(extContacts, ext.url, baseName || undefined);
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }

  // 4) External links directly on the front page (e.g. member directory)
  const extOnFront = extractLinks(html, url.toString(), {
    externalOnly: true,
    sameHostOnly: false,
    maxLinks: 200,
    skipPatterns: [/facebook|instagram|twitter|linkedin|youtube|google|maps|wikipedia/i],
  }).slice(0, 60);

  for (const site of extOnFront) {
    if (results.some(r => r.website && r.website.startsWith(new URL(site.url).origin))) continue;
    try {
      const r = await safeFetch(site.url, 9000);
      if (!r.ok) continue;
      const extHtml = await r.text();
      const extUrl = new URL(site.url);
      const extName = buildName(extHtml, extUrl);
      const baseName = site.text || extName;
      const extCat = category || detectCategory(extHtml, baseName);
      let extContacts = extractContacts(extHtml, baseName, site.url);

      // Contact subpage on external site
      if (extContacts.length === 0) {
        const cLinks = extractLinks(extHtml, site.url, {
          sameHostOnly: true,
          maxLinks: 20,
          priorityPatterns: [/kontakt|contact|om-os|about/i],
          skipPatterns: [],
        }).filter(l => /kontakt|contact|om-os|about/i.test(l.url)).slice(0, 2);

        for (const cl of cLinks) {
          try {
            const rC = await safeFetch(cl.url, 7000);
            if (!rC.ok) continue;
            const cHtml = await rC.text();
            extContacts = extContacts.concat(extractContacts(cHtml, baseName, site.url));
          } catch { /* ignore */ }
        }
      }

      for (const c of extContacts) {
        if (results.some(r => r.email === c.email)) continue;
        results.push({
          sourceUrl: site.url,
          name: c.name || baseName,
          category: extCat || autoCategory,
          country: country || '',
          email: c.email,
          phone: c.phone || '',
          city: c.city || '',
          website: c.website || new URL(site.url).origin,
          contact_person: c.contact_person || '',
        });
      }
    } catch { /* ignore */ }
  }

  return { results, errors };
}

// ─── Normalise URL ────────────────────────────────────────────────────────────

function normaliseUrl(value) {
  let v = (value || '').trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  return v;
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req) {
  const { urls = [], country = '', category = '' } = await req.json();
  const allResults = [];
  const allErrors = [];

  for (const raw of urls) {
    const norm = normaliseUrl(raw);
    if (!norm) continue;

    try {
      const parsedUrl = new URL(norm);

      if (isGoogleSearchUrl(norm)) {
        // ── Handle Google Search URL ──
        let searchHtml;
        try {
          const res = await safeFetch(norm, 15000);
          if (!res.ok) { allErrors.push({ url: norm, reason: 'http_' + res.status }); continue; }
          searchHtml = await res.text();
        } catch (e) {
          allErrors.push({ url: norm, reason: e.name === 'AbortError' ? 'timeout' : (e.message || 'error') });
          continue;
        }

        const resultUrls = extractGoogleResults(searchHtml);

        // Also try next pages (page 2 and 3)
        const nextPageLinks = extractLinks(searchHtml, norm, {
          sameHostOnly: true,
          maxLinks: 10,
          skipPatterns: [],
        }).filter(l => /[?&]start=\d+/i.test(l.url)).slice(0, 2);

        for (const nextPage of nextPageLinks) {
          try {
            const rN = await safeFetch(nextPage.url, 12000);
            if (rN.ok) {
              const nHtml = await rN.text();
              const moreUrls = extractGoogleResults(nHtml);
              for (const u of moreUrls) {
                if (!resultUrls.includes(u)) resultUrls.push(u);
              }
            }
          } catch { /* ignore */ }
        }

        // Scrape each result
        for (const resultUrl of resultUrls.slice(0, 30)) {
          try {
            const { results, errors } = await scrapeSite(resultUrl, category, country);
            for (const r of results) {
              if (!allResults.some(x => x.email === r.email)) allResults.push(r);
            }
            allErrors.push(...errors.slice(0, 2));
          } catch { /* ignore */ }
        }
      } else {
        // ── Handle regular URL ──
        const { results, errors } = await scrapeSite(norm, category, country);
        for (const r of results) {
          if (!allResults.some(x => x.email === r.email)) allResults.push(r);
        }
        allErrors.push(...errors);
      }
    } catch (e) {
      allErrors.push({ url: norm, reason: e.message || 'unexpected_error' });
    }
  }

  return NextResponse.json({ leads: allResults, errors: allErrors });
}
