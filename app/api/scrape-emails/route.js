import { NextResponse } from 'next/server';

// Very lightweight HTML helpers (no DOM)
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : '';
}

function extractH1(html) {
  const m = html.match(/<h1[^>]*>([^<]*)<\/h1>/i);
  return m ? m[1].replace(/&nbsp;/g, ' ').trim() : '';
}

function isGenericLabel(str) {
  if (!str) return false;
  return /medlemsliste|member list|kontakt|contact|email|e-mail|liste over medlemmer/i.test(str);
}

function buildName(html, url) {
  const h1 = extractH1(html);
  if (h1 && !/forside|home/i.test(h1) && !isGenericLabel(h1)) return h1;
  let title = extractTitle(html);
  if (!title) return url.hostname;
  // Split on common separators to strip taglines
  const parts = title.split(/[\|\-–·»]/);
  if (parts.length > 1) {
    title = parts[0].trim();
  }
  if (!title || isGenericLabel(title)) title = url.hostname;
  return title;
}

function extractLinks(html, baseHost) {
  const links = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) && links.length < 10) {
    try {
      const href = m[1];
      const url = new URL(href, baseHost);
      if (url.hostname !== baseHost.hostname) continue;
      if (/kontakt|contact|om-os|about/i.test(url.pathname)) {
        links.push(url.toString());
      }
    } catch {
      // ignore invalid urls
    }
  }
  return [...new Set(links)];
}

function scoreName(candidate) {
  if (!candidate) return 0;
  let s = 0;
  const len = candidate.length;
  if (len >= 3 && len <= 80) s += 1;
  if (/\b[A-ZÆØÅ]/.test(candidate)) s += 1;
  const words = candidate.split(/\s+/);
  if (words.length >= 1 && words.length <= 6) s += 1;
  if (!/[.@:]/.test(candidate)) s += 1;
  return s;
}

function extractContacts(html, fallbackNameRaw) {
  const safeFallback = isGenericLabel(fallbackNameRaw) ? '' : (fallbackNameRaw || '');
  const contactsMap = new Map();
  const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  let m;
  while ((m = emailRe.exec(html))) {
    const email = m[0].toLowerCase();
    if (email.startsWith('noreply') || email.startsWith('no-reply')) continue;

    const idx = m.index;
    const windowStart = Math.max(0, idx - 800);
    const windowEnd = Math.min(html.length, idx + 200);
    const snippet = html.slice(windowStart, windowEnd);

    // Find tekst tæt på email, som kan være navn
    let bestName = '';
    let bestScore = 0;
    const textRe = />([^<>]{2,120})</g;
    let tm;
    while ((tm = textRe.exec(snippet))) {
      const candidate = tm[1]
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!candidate) continue;
      if (candidate.length < 2) continue;
      if (/@/.test(candidate)) continue;
      if (isGenericLabel(candidate)) continue;
      const score = scoreName(candidate);
      if (score > bestScore) {
        bestScore = score;
        bestName = candidate;
      }
    }
    const name = bestName || safeFallback;

    // Telefon
    let phone = '';
    let pm = snippet.match(/(?:tlf\.?|telefon|phone|mobil)[^0-9+]{0,15}(\+?\d[\d\s\-\/]{6,})/i);
    if (pm) {
      phone = pm[1].trim();
    } else {
      pm = snippet.match(/(\+?\d[\d\s\-\/]{6,})/);
      if (pm) phone = pm[1].trim();
    }

    // By (fx "8000 Aarhus C")
    let city = '';
    const cm = snippet.match(/(\d{4}\s+[A-ZÆØÅ][A-Za-zÆØÅæøå\s\-]{2,})/);
    if (cm) city = cm[1].trim();

    // Kontaktperson / ejer
    let contact_person = '';
    const om = snippet.match(/(?:kontaktperson|ejer|formand|contact person)[:\s]*([^<\n\r]{3,80})/i);
    if (om) contact_person = om[1].trim();

    const existing = contactsMap.get(email) || {};
    contactsMap.set(email, {
      email,
      name: name || existing.name || safeFallback || '',
      phone: existing.phone || phone,
      city: existing.city || city,
      contact_person: existing.contact_person || contact_person,
    });
  }
  return [...contactsMap.values()];
}

function normaliseUrl(value) {
  let v = (value || '').trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  return v;
}

function extractExternalSites(html, baseUrl) {
  const base = new URL(baseUrl);
  const sites = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
  let m;
  while ((m = re.exec(html)) && sites.length < 500) {
    const href = m[1];
    let text = m[2]
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    try {
      const url = new URL(href, base);
      if (url.hostname === base.hostname) continue; // skip interne links
      if (!url.protocol.startsWith('http')) continue;
      sites.push({ url: url.toString(), text });
    } catch {
      // ignore invalid
    }
  }
  // dedup på url
  const seen = new Set();
  return sites.filter(s => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

export async function POST(req) {
  const { urls = [], country = '', category = '' } = await req.json();
  const out = [];
  const errors = [];

  for (const raw of urls) {
    let url;
    try {
      const norm = normaliseUrl(raw);
      if (!norm) continue;
      url = new URL(norm);
    } catch {
      continue;
    }
    try {
      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': 'SurfmoreCRM/1.0 (+https://surfmore.dk)' },
      });
      if (!res.ok) {
        errors.push({ url: url.toString(), reason: 'http_' + res.status });
        continue;
      }
      const html = await res.text();

      // 1) Emails + kontakt-info direkte på siden + kontakt-undersider
      {
        const title = buildName(html, url);
        let contacts = extractContacts(html, title);

        const contactLinks = extractLinks(html, url);
        for (const cUrl of contactLinks.slice(0, 3)) {
          try {
            const r = await fetch(cUrl, {
              headers: { 'User-Agent': 'SurfmoreCRM/1.0 (+https://surfmore.dk)' },
            });
            if (!r.ok) continue;
            const subHtml = await r.text();
            contacts = contacts.concat(extractContacts(subHtml, title));
          } catch {
            // ignore
          }
        }

        // dedup på email
        let byEmail = new Map();
        for (const c of contacts) {
          const prev = byEmail.get(c.email) || {};
          byEmail.set(c.email, {
            email: c.email,
            name: c.name || prev.name || title,
            phone: c.phone || prev.phone || '',
            city: c.city || prev.city || '',
            contact_person: c.contact_person || prev.contact_person || '',
          });
        }

        // fallback: hvis vi stadig ingen kontakter har, tag rene emails direkte
        if (!byEmail.size) {
          const fallbackContacts = extractContacts(html, title);
          for (const c of fallbackContacts) {
            const prev = byEmail.get(c.email) || {};
            byEmail.set(c.email, {
              email: c.email,
              name: c.name || prev.name || title,
              phone: c.phone || prev.phone || '',
              city: c.city || prev.city || '',
              contact_person: c.contact_person || prev.contact_person || '',
            });
          }
        }

        for (const c of byEmail.values()) {
          out.push({
            sourceUrl: url.toString(),
            name: c.name || title,
            category: category || '',
            underkategori: '',
            country: country || '',
            email: c.email,
            phone: c.phone || '',
            city: c.city || '',
            outreach: '',
            sale: '',
            contact_person: c.contact_person || '',
          });
        }
      }

      // 2) Eksterne sites nævnt på siden (typisk selve virksomhedernes websites)
      const externalSites = extractExternalSites(html, url.toString());
      for (const site of externalSites) {
        try {
          const r = await fetch(site.url, {
            headers: { 'User-Agent': 'SurfmoreCRM/1.0 (+https://surfmore.dk)' },
          });
          if (!r.ok) {
            errors.push({ url: site.url, reason: 'http_' + r.status });
            continue;
          }
          const extHtml = await r.text();

          const extUrl = new URL(site.url);
          const extTitle = buildName(extHtml, extUrl);
          const baseName = site.text || extTitle;

          let contacts = extractContacts(extHtml, baseName);

          const contactLinks2 = extractLinks(extHtml, extUrl);
          for (const cUrl of contactLinks2.slice(0, 2)) {
            try {
              const r2 = await fetch(cUrl, {
                headers: { 'User-Agent': 'SurfmoreCRM/1.0 (+https://surfmore.dk)' },
              });
              if (!r2.ok) continue;
              const subHtml = await r2.text();
              contacts = contacts.concat(extractContacts(subHtml, baseName));
            } catch {
              // ignore
            }
          }

          const byEmail = new Map();
          for (const c of contacts) {
            const prev = byEmail.get(c.email) || {};
            byEmail.set(c.email, {
              email: c.email,
              name: c.name || prev.name || baseName,
              phone: c.phone || prev.phone || '',
              city: c.city || prev.city || '',
              contact_person: c.contact_person || prev.contact_person || '',
            });
          }

          for (const c of byEmail.values()) {
            out.push({
              sourceUrl: site.url,
              name: c.name || baseName,
              category: category || '',
              underkategori: '',
              country: country || '',
              email: c.email,
              phone: c.phone || '',
              city: c.city || '',
              outreach: '',
              sale: '',
              contact_person: c.contact_person || '',
            });
          }
        } catch {
          // ignore bad external link
        }
      }
    } catch {
      errors.push({ url: url ? url.toString() : String(raw || ''), reason: 'unexpected_error' });
    }
  }

  return NextResponse.json({ leads: out, errors });
}

