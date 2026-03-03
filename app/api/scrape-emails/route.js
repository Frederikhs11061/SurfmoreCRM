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

function buildName(html, url) {
  const h1 = extractH1(html);
  if (h1 && !/forside|home/i.test(h1)) return h1;
  let title = extractTitle(html);
  if (!title) return url.hostname;
  // Split on common separators to strip taglines
  const parts = title.split(/[\|\-–·»]/);
  if (parts.length > 1) {
    title = parts[0].trim();
  }
  if (!title) title = url.hostname;
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

function extractEmails(html) {
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const set = new Set();
  let m;
  while ((m = re.exec(html))) {
    const email = m[0].toLowerCase();
    if (email.startsWith('noreply') || email.startsWith('no-reply')) continue;
    set.add(email);
  }
  return [...set];
}

function normaliseUrl(value) {
  let v = (value || '').trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  return v;
}

export async function POST(req) {
  const { urls = [], country = '', category = '' } = await req.json();
  const out = [];

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
        // Skip sites we can't reach (4xx/5xx)
        continue;
      }
      const html = await res.text();
      const title = buildName(html, url);
      let emails = extractEmails(html);

      // Also look on a few likely subpages
      const contactLinks = extractLinks(html, url);
      for (const cUrl of contactLinks.slice(0, 3)) {
        try {
          const r = await fetch(cUrl, {
            headers: { 'User-Agent': 'SurfmoreCRM/1.0 (+https://surfmore.dk)' },
          });
          if (!r.ok) continue;
          const subHtml = await r.text();
          emails = [...new Set([...emails, ...extractEmails(subHtml)])];
        } catch {
          // ignore errors on subpages
        }
      }

      if (!emails.length) continue;

      for (const email of emails) {
        out.push({
          sourceUrl: url.toString(),
          name: title,
          category: category || '',
          underkategori: '',
          country: country || '',
          email,
          phone: '',
          city: '',
          outreach: '',
          sale: '',
          contact_person: '',
        });
      }
    } catch {
      // ignore this url on error
    }
  }

  return NextResponse.json({ leads: out });
}

