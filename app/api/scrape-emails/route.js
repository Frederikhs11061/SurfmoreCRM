import { NextResponse } from 'next/server';

export const maxDuration = 60; // Vercel Pro: allow up to 60s execution

// ─── Helpers ─────────────────────────────────────────────────────────────────

function decodeHtmlEntities(str) {
  return (str || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '');
}

function stripTags(html) {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripTags(m[1]).trim() : '';
}

function extractH1(html) {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? stripTags(m[1]).trim() : '';
}

// ─── Robust name extraction: get the business/org name from the page ─────────
// Priority: <meta og:title> → <meta og:site_name> → h1 (if it looks like a name) → <title> (cleaned)
function extractPageName(html, url) {
  // 1) Open Graph site_name (most reliable for the org name)
  const ogSiteName = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i);
  if (ogSiteName) {
    const n = stripTags(ogSiteName[1]).trim();
    if (n.length >= 2 && n.length <= 80 && !isGenericName(n)) return n;
  }

  // 2) Open Graph title
  const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  if (ogTitle) {
    let n = stripTags(ogTitle[1]).trim();
    // Remove taglines after separators
    n = n.split(/[\|–—·»\-]/)[0].trim();
    if (n.length >= 2 && n.length <= 80 && !isGenericName(n)) return n;
  }

  // 3) H1 (if not generic)
  const h1 = extractH1(html);
  if (h1 && h1.length >= 2 && h1.length <= 60 && !isGenericName(h1) && !h1.includes('@')) return h1;

  // 4) <title> tag (clean up taglines)
  let title = extractTitle(html);
  if (title) {
    const parts = title.split(/[\|–—·»]/);
    title = parts[0].trim();
    // If the first part is generic, try the second
    if (isGenericName(title) && parts.length > 1) title = parts[1].trim();
    if (title && title.length >= 2 && title.length <= 80 && !isGenericName(title)) return title;
  }

  // 5) Fallback to most meaningful part of hostname
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const parts = host.split('.');
    // Skip 2-letter country-code subdomains (ar., au., de., etc.) and generic TLDs
    const tlds = new Set(['com', 'net', 'org', 'dk', 'se', 'no', 'fi', 'de', 'fr', 'uk', 'io', 'fitness', 'co', 'be', 'nl', 'at', 'ch', 'es', 'it', 'pl', 'pt', 'br', 'ar', 'ca', 'au', 'nz', 'ru', 'cz', 'sk', 'hu', 'ro', 'bg', 'hr', 'si', 'rs', 'lt', 'lv', 'ee', 'is', 'me', 'info', 'biz']);
    const meaningful = parts.filter(p => p.length > 2 && !tlds.has(p));
    return meaningful[0] || parts[0];
  } catch {
    return '';
  }
}

function isGenericName(s) {
  if (!s) return true;
  const t = s.trim();
  const lower = t.toLowerCase();
  // HTTP error status lines ("403 Forbidden", "404 Not Found", "500 Internal Server Error" …)
  if (/^\d{3}\b/.test(t)) return true;
  // Anti-bot / CDN interstitial pages
  if (/^(just a moment|attention required|cloudflare|ddos-guard|access denied|checking your browser|enable javascript|error|page not found|site not found|domain for sale)$/i.test(lower)) return true;
  // Marketing taglines / SEO titles that are sentences, not org names
  // e.g. "Find the perfect gym near you", "Encuentra tu gimnasio perfecto", "Finde das perfekte Fitnessstudio"
  if (/^(find|finde|encuentra|encontre|trouvez|löydä|find the|find your|find a|find dit|find din|find de|find det)\b/i.test(lower)) return true;
  if (/\b(near you|nærmeste|in your area|i dit område|i nærheden|perfekte|perfect gym|best gym|bedste gym|in unserem|con mejores|en bogot|in berlin)\b/i.test(lower)) return true;
  // Single generic words
  return /^(kontakt|contact|forside|home|om os|about|menu|navigation|header|footer|cookie|søg|search|login|links|oversigt|medlemsliste|bestyrelsen|bestyrelse|læs mere|start|velkommen|welcome|email|e-mail|telefon|adresse|nyhedsbrev|newsletter|blog|nyheder|privacy|log ind|tilmeld|website|hjemmeside|back|next|previous|vis mere|show more|load more)$/i.test(lower)
    || lower.length < 2;
}

// ─── Email validation ─────────────────────────────────────────────────────────
// Very strict: must be a real, clean email. No URL-encoded chars, no technical/system emails.
function isValidLeadEmail(email) {
  if (!email) return false;

  // Must not contain URL-encoded characters (%20, %40 etc.)
  if (/%[0-9a-fA-F]{2}/.test(email)) return false;

  // Must not start with spaces or have spaces
  if (/\s/.test(email)) return false;

  // Basic format check
  if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email)) return false;

  // Reject system/noreply emails
  const local = email.split('@')[0].toLowerCase();
  if (/^(noreply|no-reply|donotreply|postmaster|mailer-daemon|bounce|abuse|root|admin|webmaster|hostmaster|support|test|example|spam|null|void)$/.test(local)) return false;

  // Reject emails from known technical domains
  const domain = email.split('@')[1].toLowerCase();
  if (/wixpress\.com|sentry\.|rollbar\.|bugsnag\.|datadog\.|newrelic\.|cloudflare\.|amazonaws\.|googleapis\.com|github\.com|githubusercontent\.com|facebook\.com|twitter\.com|example\.com|localhost/i.test(domain)) return false;

  // Domain must have a reasonable TLD
  const tld = domain.split('.').pop();
  if (tld.length < 2 || tld.length > 10) return false;

  return true;
}

// Should we treat this email as a "functional" email (bestyrelse@, regnskab@, some@) ?
// Functional emails from the SAME domain as the source page are usually not separate leads,
// they are all just department emails for one organization.
function isFunctionalEmail(email) {
  const local = email.split('@')[0].toLowerCase();
  return /^(bestyrelse|regnskab|branchedag|kommunikation|some|info|kontakt|salg|support|booking|mail|kontor|administration|sekretariat|forening|henvendelse|reception|post|faktura|marked|marketing|hr|drift|it|web|social|medier|event|kursus|pr|presse|nyhed|nyhedsbrev|newsletter)$/.test(local);
}

// ─── Auto category detection ─────────────────────────────────────────────────
const CAT_RULES = [
  { pattern: /yoga|yogastudio|yogaskole|vinyasa|ashtanga|hatha|yin\s*yoga|power\s*yoga|hot\s*yoga/i, cat: 'Yoga & Pilates' },
  { pattern: /pilates|pilatesstudio/i, cat: 'Yoga & Pilates' },
  { pattern: /surf|kitesurfing|windsurfing|wakeboard|vandski|kiteboarding/i, cat: 'Skoler & Klubber' },
  { pattern: /sup\b|paddleboard|stand.up.paddle/i, cat: 'Skoler & Klubber' },
  { pattern: /kajak|kano|padling|kayak|kajakklub/i, cat: 'Kajakklubber' },
  { pattern: /spejder|scout|spejdergruppe/i, cat: 'Spejdergrupper' },
  { pattern: /folkeskole|grundskole|primary.school|friskole|privatskole/i, cat: 'Folkeskoler' },
  { pattern: /børnehave|dagtilbud|daycare|vuggestue|\bsfo\b|daginstitution/i, cat: 'Børnehaver' },
  { pattern: /efterskole/i, cat: 'Efterskoler' },
  { pattern: /gymnasium|\bhtx\b|\bhhx\b|\bstx\b|gymnasial/i, cat: 'Gymnasium' },
  { pattern: /højskole|folkehøjskole/i, cat: 'Højskoler' },
  { pattern: /naturskole|naturcenter|naturstyrelsen|friluftsliv|naturvejleder/i, cat: 'Naturskoler & Naturcentre' },
  { pattern: /skatepark|skateboard|skating/i, cat: 'Skateparks' },
  { pattern: /\bhavn\b|marina|sejlklub|sejlsport|lystbådehavn/i, cat: 'Havne' },
  { pattern: /webshop|webbutik|nettbutik|e-handel|onlinebutik/i, cat: 'Butik & Webshop' },
  { pattern: /butik|forhandler|retailer/i, cat: 'Butik & Webshop' },
  { pattern: /drage|legetøj|dragebutik/i, cat: 'Drager & Legetøj' },
  { pattern: /indkøbsforening|indkøbsfællesskab/i, cat: 'Indkøbsforeninger' },
  { pattern: /vinterbade|badeklub|badelaug|vinterbadning|havbad/i, cat: 'Skoler & Klubber' },
  { pattern: /fitness|crossfit|træningscenter|motionscenter|fitnesscenter/i, cat: 'Fitness & Træning' },
  { pattern: /dans|danseskole|ballet/i, cat: 'Danseskoler' },
  { pattern: /svømme|svømmeklub|svømning|swimming/i, cat: 'Svømmeklubber' },
  { pattern: /rideklub|rideskole|hestesport|ridning/i, cat: 'Rideklubber' },
  { pattern: /golf|golfklub/i, cat: 'Golfklubber' },
  { pattern: /tennis|tennisklub/i, cat: 'Tennisklubber' },
  { pattern: /dykning|dykkerklub|scuba|snorkel/i, cat: 'Dykkerklubber' },
  { pattern: /camping|campingplads/i, cat: 'Campingpladser' },
  { pattern: /hotel|vandrehjem|hostel|overnatning/i, cat: 'Overnatning' },
  { pattern: /museum|udstilling|galleri/i, cat: 'Museer & Kultur' },
  { pattern: /fodbold|fodboldklub|boldklub/i, cat: 'Fodboldklubber' },
  { pattern: /håndbold|håndboldklub/i, cat: 'Håndboldklubber' },
  { pattern: /klub\b|forening\b|idræt|sport/i, cat: 'Skoler & Klubber' },
  { pattern: /skole\b|uddannelse|kursus/i, cat: 'Skoler & Klubber' },
];

function detectCategory(textContent) {
  const text = (textContent || '').slice(0, 8000).toLowerCase();
  for (const rule of CAT_RULES) {
    if (rule.pattern.test(text)) return rule.cat;
  }
  return 'Andet';
}

// Sub-category detection for broad categories
const SUB_RULES = {
  'Skoler & Klubber': [
    { pattern: /kajak|kayak|kano|padling/, sub: 'Kajakklub' },
    { pattern: /surf|kitesurf|windsurf|wakeboard|vandski/, sub: 'Surfklub' },
    { pattern: /sup\b|paddleboard|stand.up/, sub: 'SUP' },
    { pattern: /vinterbad|badeklub|badelaug|havbad/, sub: 'Vinterbadelaug' },
    { pattern: /sejl|sailing|sejlklub/, sub: 'Sejlklub' },
    { pattern: /spejder|scout/, sub: 'Spejdergruppe' },
    { pattern: /yoga|pilates/, sub: 'Yoga & Wellness' },
    { pattern: /fitness|crossfit|træning/, sub: 'Fitness' },
    { pattern: /svømme|swimming/, sub: 'Svømmeklub' },
    { pattern: /dans|ballet/, sub: 'Danseskole' },
    { pattern: /rideklub|rideskole|hest/, sub: 'Rideklub' },
    { pattern: /golf/, sub: 'Golfklub' },
    { pattern: /fodbold/, sub: 'Fodboldklub' },
    { pattern: /håndbold/, sub: 'Håndboldklub' },
    { pattern: /tennis/, sub: 'Tennisklub' },
    { pattern: /dykning|dykker|scuba/, sub: 'Dykkerklub' },
  ],
  'Butik & Webshop': [
    { pattern: /surf|kite|wind|wake|vandski/, sub: 'Surf & Vandspot' },
    { pattern: /outdoor|friluft|hike|vandre/, sub: 'Outdoor' },
    { pattern: /sport|fitness|træning/, sub: 'Sport' },
    { pattern: /legetøj|toy/, sub: 'Legetøj' },
    { pattern: /drage|kite/, sub: 'Drager & Kites' },
  ],
};

function detectSubcategory(textContent, mainCategory) {
  const rules = SUB_RULES[mainCategory];
  if (!rules) return '';
  const text = (textContent || '').slice(0, 6000).toLowerCase();
  for (const rule of rules) {
    if (rule.pattern.test(text)) return rule.sub;
  }
  return '';
}

// ─── Link extraction ──────────────────────────────────────────────────────────

function extractLinks(html, baseUrl, options = {}) {
  const {
    sameHostOnly = true,
    maxLinks = 50,
    externalOnly = false,
  } = options;

  const base = new URL(baseUrl);
  const result = [];
  const seen = new Set();
  const re = /<a\s+[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = re.exec(html)) && result.length < maxLinks) {
    const href = m[1].trim();
    const text = stripTags(m[2]).trim();
    try {
      const url = new URL(href, base);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      const isSame = url.hostname === base.hostname;
      if (sameHostOnly && !isSame) continue;
      if (externalOnly && isSame) continue;
      const key = url.origin + url.pathname;
      if (seen.has(key)) continue;
      if (/\.(pdf|jpg|jpeg|png|gif|svg|css|js|woff|ico|xml|zip|mp3|mp4|avi)$/i.test(url.pathname)) continue;
      // Skip social media and well-known non-lead sites
      if (/facebook\.com|instagram\.com|twitter\.com|linkedin\.com|youtube\.com|google\.|maps\.google|tiktok\.com|pinterest\.com|wikipedia\./i.test(url.hostname)) continue;
      seen.add(key);
      result.push({ url: url.toString(), text });
    } catch { /* ignore */ }
  }

  return result;
}

// ─── Google search result extraction ─────────────────────────────────────────

function extractGoogleResults(html) {
  const urls = [];
  const seen = new Set();

  // Pattern: /url?q=https://... links (Google wraps results this way)
  const re1 = /\/url\?q=(https?:\/\/[^&"]+)/gi;
  let m;
  while ((m = re1.exec(html))) {
    try {
      const url = decodeURIComponent(m[1]);
      const parsed = new URL(url);
      if (/google\.|youtube\.|wikipedia\.|facebook\.|instagram\.|twitter\.|linkedin\./i.test(parsed.hostname)) continue;
      const key = parsed.origin + parsed.pathname;
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push(parsed.toString());
    } catch { /* ignore */ }
  }

  // Fallback: direct href links
  if (urls.length < 3) {
    const re2 = /href="(https?:\/\/[^"]+)"/gi;
    while ((m = re2.exec(html)) && urls.length < 30) {
      try {
        const parsed = new URL(m[1]);
        if (/google\.|youtube\.|wikipedia\.|facebook\.|instagram\.|twitter\.|linkedin\./i.test(parsed.hostname)) continue;
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
  return /google\.[a-z.]+\/search/i.test(url);
}

// ─── Extract emails from HTML with strict validation ──────────────────────────

function extractEmailsFromHtml(html) {
  const emails = new Set();
  // First decode any URL-encoded content in the HTML
  let decoded = html;
  try {
    // Decode common HTML entities and URL-encoded parts
    decoded = decoded.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
    decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
  } catch { /* ignore */ }

  const re = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;
  let m;
  while ((m = re.exec(decoded))) {
    let email = m[0].toLowerCase().trim();
    // Clean up: remove trailing dots or dashes
    email = email.replace(/[.\-]+$/, '');
    if (isValidLeadEmail(email)) {
      emails.add(email);
    }
  }

  // Also try mailto: links which are the most reliable source
  const mailtoRe = /mailto:([^"'?&\s]+)/gi;
  while ((m = mailtoRe.exec(html))) {
    let email = decodeURIComponent(m[1]).toLowerCase().trim();
    email = email.replace(/[.\-]+$/, '');
    if (isValidLeadEmail(email)) {
      emails.add(email);
    }
  }

  // Cloudflare email protection: <a class="__cf_email__" data-cfemail="...">[email protected]</a>
  const cfRe = /data-cfemail="([0-9a-fA-F]+)"/gi;
  while ((m = cfRe.exec(html))) {
    const encoded = m[1];
    try {
      if (encoded && encoded.length > 2) {
        const key = parseInt(encoded.substr(0, 2), 16);
        let email = '';
        for (let i = 2; i < encoded.length; i += 2) {
          const charCode = parseInt(encoded.substr(i, 2), 16) ^ key;
          email += String.fromCharCode(charCode);
        }
        email = email.toLowerCase().trim().replace(/[.\-]+$/, '');
        if (isValidLeadEmail(email)) {
          emails.add(email);
        }
      }
    } catch {
      // ignore malformed cfemail
    }
  }

  // JSON-LD structured data (most reliable source)
  const jsonLdRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = jsonLdRe.exec(html))) {
    try {
      const obj = JSON.parse(m[1]);
      const flatten = (o) => {
        if (!o) return;
        if (typeof o === 'string' && isValidLeadEmail(o)) emails.add(o.toLowerCase());
        if (typeof o === 'object') Object.values(o).forEach(flatten);
      };
      flatten(obj);
    } catch { /* ignore */ }
  }

  return [...emails];
}

// ─── Phone extraction (no +45 prefix) ─────────────────────────────────────────

function extractPhone(html) {
  const text = stripTags(html);
  const patterns = [
    /(?:tlf\.?|telefon|phone|mobil|tel\.?)\s*:?\s*\+?45\s*([\d\s\-]{8,})/i,
    /(?:tlf\.?|telefon|phone|mobil|tel\.?)\s*:?\s*([\d\s\-]{8,14})/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      let digits = m[1].replace(/\D/g, '');
      // Remove leading 45 country code if present
      if (digits.length === 10 && digits.startsWith('45')) digits = digits.slice(2);
      if (digits.length === 8) {
        return digits.slice(0, 2) + ' ' + digits.slice(2, 4) + ' ' + digits.slice(4, 6) + ' ' + digits.slice(6);
      }
    }
  }

  // Try to find a standalone 8-digit phone number near "tlf" or "telefon"
  const m2 = text.match(/(?:tlf|telefon|phone|mobil|ring|tel)[^0-9]{0,20}(\d{2}\s?\d{2}\s?\d{2}\s?\d{2})/i);
  if (m2) {
    const digits = m2[1].replace(/\D/g, '');
    if (digits.length === 8) {
      return digits.slice(0, 2) + ' ' + digits.slice(2, 4) + ' ' + digits.slice(4, 6) + ' ' + digits.slice(6);
    }
  }

  return '';
}

// ─── City extraction ──────────────────────────────────────────────────────────

// Words that should never appear as a city name (non-Danish, SEO text, etc.)
const NON_CITY_WORDS = /^(gimnasios|fitnessstudios|gymnasios|studios|salles|kuntosalia|palestre|studios|fitnesscenters|sportscholen|siłownie|fitnesscentrum|sportcentra|sandgate|rd|str|road|ave|blvd|gimnasio|fitness|gym|sport|club|rue|spo)/i;

function extractCity(html) {
  const text = stripTags(html);
  // Danish postal codes are 1000-9999 (first digit 1-9)
  const re = /\b([1-9]\d{3})\s+([A-ZÆØÅ][A-Za-zÆØÅæøå\-]{2,20}(?:\s+[A-ZÆØÅ][A-Za-zÆØÅæøå\-]{2,20})?)\b/g;
  let m;
  while ((m = re.exec(text))) {
    const city = m[2].trim();
    if (!NON_CITY_WORDS.test(city) && city.length <= 30) {
      return (m[1] + ' ' + city).replace(/\s+/g, ' ');
    }
  }
  return '';
}

// ─── Safe fetch with timeout ──────────────────────────────────────────────────

async function safeFetch(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store', // Prevent Next.js from caching or failing on static generation
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'da,en-US;q=0.9,en;q=0.8',
        'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      },
      redirect: 'follow',
    });
    clearTimeout(timer);

    // Cloudflare sometimes gives 403 or 503 for bots. We at least try to read the text if we can,
    // but if it's solidly not OK and not cloudflare challenge, we abort.
    if (!res.ok && res.status !== 403 && res.status !== 503) {
      return null;
    }

    // Some sites (like webshoplisten) might not return strict text/html on error pages
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml')) {
      return null;
    }
    return await res.text();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ─── Scrape ONE organization/business page ────────────────────────────────────
// Given a page URL, extract the BEST contact email for that organization.
// Strategy:
//   - The NAME is the page/site name (from og:site_name, title, h1)
//   - Check front page + contact pages for emails
//   - Group all emails from same domain → pick the best one (prefer info@, kontakt@, or the first mailto: link)
//   - ONE lead per organization, not one per email found!

// Extract contact_person from JSON-LD or meta tags
function extractContactPerson(html) {
  // JSON-LD Person or employee
  const jre = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = jre.exec(html))) {
    try {
      const obj = JSON.parse(m[1]);
      const names = [];
      const scan = (o) => {
        if (!o || typeof o !== 'object') return;
        if ((o['@type'] === 'Person' || o['@type'] === 'employee') && o.name) names.push(o.name);
        Object.values(o).forEach(scan);
      };
      scan(obj);
      if (names.length) return names[0];
    } catch { /* ignore */ }
  }
  return '';
}

async function scrapeOneSite(siteUrl) {
  const html = await safeFetch(siteUrl);
  if (!html) return null;

  const url = new URL(siteUrl);
  let name = extractPageName(html, siteUrl);
  if (!name || isGenericName(name)) name = '';

  const textContent = name + ' ' + stripTags(html).slice(0, 6000);
  const category = detectCategory(textContent);
  const subcategory = detectSubcategory(textContent, category);

  // Collect emails from front page
  let allEmails = extractEmailsFromHtml(html);

  let combinedContactHtml = '';

  // Only fetch contact pages if we haven't found good emails on the front page
  const siteDomainEarly = url.hostname.replace(/^www\./, '');
  const hasGoodEmails = allEmails.some(e => e.endsWith('@' + siteDomainEarly));

  if (!hasGoodEmails) {
    // Find contact/about pages — parallel fetch
    const contactLinks = extractLinks(html, siteUrl, { sameHostOnly: true, maxLinks: 40 })
      .filter(l => /kontakt|contact|om-os|om\b|about|reach|connect|find-os|findos|hvem-er|team|ansatte|medarbejdere|impressum/i.test(l.url))
      .slice(0, 5);

    // Also try common contact page paths if not found via links
    const commonPaths = ['/kontakt', '/contact', '/om-os', '/about', '/kontaktoplysninger'];
    const existingPaths = new Set(contactLinks.map(l => new URL(l.url).pathname));
    for (const p of commonPaths) {
      if (!existingPaths.has(p)) {
        contactLinks.push({ url: url.origin + p, text: '' });
      }
    }

    // Parallel fetch all contact pages
    const contactHtmls = await Promise.allSettled(
      contactLinks.map(link => safeFetch(link.url, 7000))
    );
    for (const result of contactHtmls) {
      if (result.status === 'fulfilled' && result.value) {
        combinedContactHtml += result.value;
        extractEmailsFromHtml(result.value).forEach(e => allEmails.push(e));
      }
    }
  }

  allEmails = [...new Set(allEmails)];

  const siteDomain = siteDomainEarly;
  const ownDomainEmails = allEmails.filter(e => e.endsWith('@' + siteDomain));
  const externalEmails = allEmails.filter(e => !e.endsWith('@' + siteDomain));

  let bestEmail = '';
  if (ownDomainEmails.length > 0) {
    const preferred = ownDomainEmails.find(e => /^(info|kontakt|mail|kontor|hej|hello|post|salg)@/i.test(e));
    bestEmail = preferred || ownDomainEmails.find(e => !isFunctionalEmail(e)) || ownDomainEmails[0];
  } else if (externalEmails.length > 0) {
    bestEmail = externalEmails[0];
  }

  // Return even without email if we have name + website (useful for manual follow-up)
  if (!bestEmail && !name) return null;

  const allHtml = html + combinedContactHtml;
  const phone = extractPhone(allHtml);
  const city = extractCity(allHtml);
  const contact_person = extractContactPerson(allHtml);

  return {
    name,
    email: bestEmail,
    phone,
    city,
    category,
    subcategory,
    website: url.origin,
    sourceUrl: siteUrl,
    contact_person,
  };
}

// ─── Scrape a LISTING/DIRECTORY page ──────────────────────────────────────────
// When the user gives us a page that LISTS many organizations (e.g. a directory),
// we find external links on that page and scrape each one as a separate org.

async function scrapeDirectoryPage(pageUrl, overrideCategory, country) {
  const results = [];
  const errors = [];

  const html = await safeFetch(pageUrl);
  if (!html) {
    errors.push({ url: pageUrl, reason: 'could_not_fetch' });
    return { results, errors };
  }

  const pageUrl_ = new URL(pageUrl);
  const pageName = extractPageName(html, pageUrl);
  const pageText = pageName + ' ' + stripTags(html).slice(0, 6000);
  const pageCategory = overrideCategory || detectCategory(pageText);

  // ─── SPECIAL HANDLING: Webshoplisten.dk ───
  // Webshoplisten has dedicated pages for shops (like /lirum-larum-leg/) containing all lead info,
  // and category pages (like /baby-boern-og-teenager/) linking to those shop pages.
  if (pageUrl_.hostname.includes('webshoplisten.dk')) {
    const allLinks = extractLinks(html, pageUrl, { sameHostOnly: true });

    // Webshops are usually 1 level deep: /shop-name/
    const shopLinks = allLinks.filter(l => {
      const parts = l.url.split('/').filter(Boolean);
      return parts.length >= 3 && parts[1] === 'webshoplisten.dk' &&
        !['kategorier', 'om-os', 'kontakt', 'blog', 'project_category'].includes(parts[2]);
    });

    const isCategoryPage = shopLinks.length > 5 && !extractEmailsFromHtml(html).some(e => e !== 'kontakt@webshoplisten.dk');

    if (isCategoryPage) {
      // Return the shop links to be queued in POST
      const uniqueShopUrls = Array.from(new Set(shopLinks.map(l => l.url)));
      return { results, errors, childLinks: uniqueShopUrls };
    } else if (extractEmailsFromHtml(html).some(e => e !== 'kontakt@webshoplisten.dk')) {
      // It's a specific shop profile page! (e.g. /lirum-larum-leg/)
      let nameObj = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      let shopName = nameObj ? nameObj[1].trim() : pageName;

      let website = '';
      const wMatch = html.match(/URL<\/div>[\s\S]{0,120}?(https?:\/\/[a-zA-Z0-9.\-]+)/i);
      if (wMatch) website = wMatch[1];
      else {
        const extLinks = extractLinks(html, pageUrl, { externalOnly: true, maxLinks: 10 });
        const leadUrl = extLinks.find(l => !/facebook|twitter|instagram|linkedin|youtube|google/i.test(l.url));
        if (leadUrl) website = leadUrl.url;
      }

      const allEmails = extractEmailsFromHtml(html).filter(e => e !== 'kontakt@webshoplisten.dk');
      const email = allEmails.length > 0 ? allEmails[0] : '';
      const phone = extractPhone(html);

      let city = '';
      const addrMatch = html.match(/Adresse<\/div>[\s\S]*?<div[^>]*>([^<]+)<\/div>/i);
      if (addrMatch) {
        const cm = addrMatch[1].match(/(?:^|\s)(\d{4})\s+([A-Za-zÆØÅæøå\s]+)/);
        if (cm) city = cm[1] + ' ' + cm[2].trim();
      } else {
        city = extractCity(html);
      }

      if (email) {
        results.push({
          name: shopName,
          email,
          phone,
          city,
          category: overrideCategory || detectCategory(shopName) || 'Butik & Webshop',
          website,
          sourceUrl: pageUrl,
          contact_person: '',
          country: country || 'Danmark'
        });
      }
      return { results, errors };
    }
  }
  // ─── END SPECIAL HANDLING ───

  // Check: does THIS page itself have a lead email? (it might be a single org)
  const pageEmails = extractEmailsFromHtml(html);
  const pageDomain = pageUrl_.hostname.replace(/^www\./, '');
  const relevantPageEmails = pageEmails.filter(e => {
    if (!isValidLeadEmail(e)) return false;
    return true;
  });

  // Find external links (= potential member/org websites)
  const externalLinks = extractLinks(html, pageUrl, {
    externalOnly: true,
    sameHostOnly: false,
    maxLinks: 200,
  }).slice(0, 60);

  // Find internal detail links (subpages that might link to individual orgs)
  const internalLinks = extractLinks(html, pageUrl, {
    sameHostOnly: true,
    maxLinks: 80,
  }).filter(l => {
    const path = new URL(l.url).pathname;
    // Skip only clearly generic/utility pages – keep kontakt/om-os, da de ofte er lead-sider
    if (/^\/$|cookie|privacy|login|pay|cart|checkout|terms|betingelser|policy/i.test(path)) return false;
    return path.length > 1;
  }).slice(0, 60);

  // Determine if this is a directory page or a single-org page
  const isDirectory = externalLinks.length >= 3 || internalLinks.length >= 5;

  if (!isDirectory) {
    // Single org page → scrape this page directly
    const lead = await scrapeOneSite(pageUrl);
    if (lead) {
      lead.category = overrideCategory || lead.category;
      lead.country = country || '';
      lead.website = ''; // it IS the source URL, don't duplicate
      results.push(lead);
    }
    return { results, errors };
  }

  // ── Directory page, but with mange direkte emails i selve listen ──
  const directLeadEmails = relevantPageEmails.filter(e => !e.endsWith('@' + pageDomain));
  if (directLeadEmails.length > 0) {
    for (const email of directLeadEmails) {
      if (results.some(r => r.email === email)) continue;
      results.push({
        name: '', // vi gætter ikke navn her
        email,
        phone: '',
        city: '',
        category: overrideCategory || pageCategory,
        website: '',
        sourceUrl: pageUrl,
        contact_person: '',
        country: country || '',
      });
    }
  }

  // ── Directory mode: scrape external links in parallel batches ──
  const BATCH = 6;
  for (let i = 0; i < externalLinks.length; i += BATCH) {
    const batch = externalLinks.slice(i, i + BATCH);
    const batchResults = await Promise.allSettled(batch.map(link => scrapeOneSite(link.url)));
    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value) {
        const lead = result.value;
        lead.category = overrideCategory || lead.category || pageCategory;
        lead.country = country || '';
        if (!results.some(r => r.email && r.email === lead.email)) results.push(lead);
      }
    }
  }

  // ── Also check internal detail pages for org info or external links (parallel) ──
  const internalBatch = internalLinks.slice(0, 30);
  const internalHtmls = await Promise.allSettled(
    internalBatch.map(link => safeFetch(link.url, 7000).then(h => ({ html: h, link })))
  );

  const externalFromSubs = [];
  for (const res of internalHtmls) {
    if (res.status !== 'fulfilled' || !res.value?.html) continue;
    const { html: subHtml, link } = res.value;

    const subName = extractPageName(subHtml, link.url);
    const subEmails = extractEmailsFromHtml(subHtml);
    const leadEmails = subEmails.filter(e => !e.endsWith('@' + pageDomain));

    if (leadEmails.length > 0) {
      const bestEmail = leadEmails.find(e => /^(info|kontakt|mail|kontor|hej|hello|salg|post)@/i.test(e))
        || leadEmails.find(e => !isFunctionalEmail(e))
        || leadEmails[0];
      if (bestEmail && !results.some(r => r.email === bestEmail)) {
        let name = subName; if (!name || isGenericName(name)) name = '';
        const subText = name + ' ' + stripTags(subHtml).slice(0, 3000);
        const cat = overrideCategory || detectCategory(subText) || pageCategory;
        results.push({
          name,
          email: bestEmail,
          phone: extractPhone(subHtml),
          city: extractCity(subHtml),
          category: cat,
          subcategory: detectSubcategory(subText, cat),
          website: '',
          sourceUrl: link.url,
          contact_person: extractContactPerson(subHtml),
          country: country || '',
        });
      }
    }

    // Collect external links from subpages for second-level scraping
    // Pass the subpage name as candidateName so we can use it as fallback on the external site
    const subExts = extractLinks(subHtml, link.url, { externalOnly: true, sameHostOnly: false, maxLinks: 5 }).slice(0, 3);
    const candidateName = (subName && !isGenericName(subName))
      ? subName
      : (link.text && !isGenericName(link.text) ? link.text : '');
    for (const ext of subExts) {
      if (!results.some(r => r.website === new URL(ext.url).origin) && !externalFromSubs.some(e => e.url === ext.url)) {
        externalFromSubs.push({ ...ext, candidateName });
      }
    }
  }

  // Scrape 2nd-level external links in parallel
  if (externalFromSubs.length > 0) {
    const subExtBatch = externalFromSubs.slice(0, 30);
    const subExtResults = await Promise.allSettled(subExtBatch.map(ext => scrapeOneSite(ext.url)));
    for (let idx = 0; idx < subExtResults.length; idx++) {
      const r = subExtResults[idx];
      if (r.status === 'fulfilled' && r.value && !results.some(x => x.email && x.email === r.value.email)) {
        const lead = r.value;
        const ext = subExtBatch[idx];
        // Use candidateName (from the internal subpage) as the best fallback, then link text
        const fallbackName = ext.candidateName || (ext.text && !isGenericName(ext.text) ? ext.text : '');
        if (fallbackName && (!lead.name || isGenericName(lead.name))) lead.name = fallbackName;
        lead.category = overrideCategory || lead.category || pageCategory;
        lead.country = country || '';
        results.push(lead);
      }
    }
  }

  // If still no results, try the page itself as a single org
  if (results.length === 0) {
    const lead = await scrapeOneSite(pageUrl);
    if (lead) {
      lead.category = overrideCategory || lead.category;
      lead.country = country || '';
      lead.website = '';
      results.push(lead);
    }
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
      if (isGoogleSearchUrl(norm)) {
        // ── Google Search URL ──
        let searchHtml = await safeFetch(norm, 15000);
        if (!searchHtml) { allErrors.push({ url: norm, reason: 'could_not_fetch_search' }); continue; }

        const resultUrls = extractGoogleResults(searchHtml);

        // Try page 2 and 3
        const nextPages = extractLinks(searchHtml, norm, { sameHostOnly: true, maxLinks: 10 })
          .filter(l => /[?&]start=\d+/i.test(l.url)).slice(0, 2);

        for (const np of nextPages) {
          const nHtml = await safeFetch(np.url, 12000);
          if (nHtml) {
            extractGoogleResults(nHtml).forEach(u => {
              if (!resultUrls.includes(u)) resultUrls.push(u);
            });
          }
        }

        // Scrape each Google result
        for (const resultUrl of resultUrls.slice(0, 25)) {
          try {
            const { results, errors, childLinks } = await scrapeDirectoryPage(resultUrl, category, country);

            // Queue child links if present
            if (childLinks && childLinks.length > 0) {
              for (const childUrl of childLinks.slice(0, 40)) {
                try {
                  const { results: cResults } = await scrapeDirectoryPage(childUrl, category, country);
                  for (const r of cResults) {
                    if (!allResults.some(x => x.email === r.email)) allResults.push(r);
                  }
                } catch { /* ignore child errors */ }
              }
            }

            for (const r of results) {
              if (!allResults.some(x => x.email === r.email)) allResults.push(r);
            }
            allErrors.push(...errors.slice(0, 2));
          } catch { /* ignore */ }
        }
      } else {
        // ── Regular URL ──
        const { results, errors, childLinks } = await scrapeDirectoryPage(norm, category, country);

        // Queue child links if present (e.g. from a Webshoplisten directory)
        if (childLinks && childLinks.length > 0) {
          for (const childUrl of childLinks.slice(0, 80)) {
            try {
              const { results: cResults } = await scrapeDirectoryPage(childUrl, category, country);
              for (const r of cResults) {
                if (!allResults.some(x => x.email === r.email)) allResults.push(r);
              }
            } catch { /* ignore child errors */ }
          }
        }

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
