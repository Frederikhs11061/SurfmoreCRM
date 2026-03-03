'use client';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

// ─── Constants ──────────────────────────────────────────────────────────────
const CATEGORIES = [
  'Butik & Webshop','Skoler & klubber','Folkeskoler','Børnehaver','Efterskoler',
  'Gymnasium','Højskoler','Skateparks','Spejdergrupper','Kajakklubber',
  'Drager & Legetøj','Indkøbsforeninger','Havne','Naturskoler, centre & vejledere','Andet',
];
const COUNTRIES = ['Danmark','Norge','Sverige'];
const STATUS_OPTIONS = [
  { value:'not_contacted', label:'Ikke kontaktet', color:'#64748b' },
  { value:'outreach_done', label:'Outreach sendt',  color:'#3b82f6' },
  { value:'won',           label:'Solgt',            color:'#22c55e' },
];
const DEFAULT_LEAD = {
  name:'',category:'Butik & Webshop',country:'Danmark',
  email:'',phone:'',city:'',status:'not_contacted',
  notes:'',sale_info:'',contact_person:'',product:'',
};
const DEFAULT_OTR = { date:'',by:'Jeppe',note:'',sale_info:'' };

// ─── CSV Parsing helpers ─────────────────────────────────────────────────────

// Detects whether the file uses ; or , as separator by counting occurrences in the first lines
function detectSeparator(txt) {
  const lines = txt.split('\n').filter(l => l.trim()).slice(0, 5);
  let semi = 0, comma = 0;
  for (const l of lines) {
    semi  += (l.match(/;/g)  || []).length;
    comma += (l.match(/,/g)  || []).length;
  }
  return semi > comma ? ';' : ',';
}

function parseCSVFull(text, sep=',') {
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i+1] === '"') { cell += '"'; i++; }
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

function isHeader(p){const l=p.map(x=>(x||'').toLowerCase().trim());return l.some(x=>x==='klubber'||x==='navn'||x==='name'||x==='mail'||x==='email'||x==='land'||x==='kategori'||x==='underkategori');}
function findEmail(p){return p.findIndex(x=>/^[^\s@,]+@[^\s@,]+\.[^\s@,]{2,}$/.test(x.replace(/\s/g,'')));}

// Detect if a field is a sale/revenue field ("Købt X stk", "Solgt X stk", "Bestilt X stk")
function isSaleField(s){ return s && /købt|solgt|bestilt|leveret|faktura/i.test(s); }

// Normalize date string to YYYY-MM-DD (required by Supabase DATE column)
function normDateForDB(s) {
  if (!s) return null;
  // Already ISO: "2025-11-27"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // European DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  // Short year: DD.MM.YY
  const m2 = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2})$/);
  if (m2) return `20${m2[3]}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}`;
  return null;
}

// Extract outreach entries from a text field
function parseOtrField(raw, isSale=false) {
  if(!raw||!raw.trim()) return [];
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
  if(!type) return defaultCat;
  const t = type.toLowerCase();
  if(t.includes('vinterbade') || t.includes('badeklub') || t.includes('badelaug')) return 'Skoler & klubber';
  if(t.includes('kajak')) return 'Kajakklubber';
  if(t.includes('surf') || t.includes('wake') || t.includes('vandski') || t.includes('kite') || t.includes('sup') || t.includes('wind')) return 'Skoler & klubber';
  if(t.includes('sejl')) return 'Skoler & klubber';
  if(t.includes('ski') || t.includes('skiklub')) return 'Skoler & klubber';
  if(t.includes('spejder')) return 'Spejdergrupper';
  if(t.includes('skole') || t.includes('gymnasium') || t.includes('efterskole')) return 'Folkeskoler';
  if(t.includes('butik') || t.includes('webshop') || t.includes('shop')) return 'Butik & Webshop';
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

// Parse notes stored as JSON string in leads.notes
function parseLeadNotes(raw) {
  if (!raw) return [];
  try {
    const val = JSON.parse(raw);
    if (Array.isArray(val)) return val;
  } catch(e) {
    // fallback below
  }
  // Legacy plain-text notes
  return [{ id:'legacy', title:'Note', text:String(raw), created_at:null }];
}

// Render template body/subject with {{tokens}} for a given lead
function renderTemplate(str, lead) {
  if (!str) return '';
  if (!lead) return str;
  const notesArr = parseLeadNotes(lead.notes);
  const lastNote = notesArr.length ? notesArr[notesArr.length-1] : null;
  const company = { name:'Surfmore' };
  const user = { name:'Jeppe', email:'info@surfmore.dk' };
  return str.replace(/\{\{\s*([^}]+)\s*\}\}/g,(m,inner)=>{
    try{
      const [pathPart,...rest] = inner.split('|').map(s=>s.trim());
      let fallback = '';
      const defPart = rest.find(p=>p.startsWith('default'));
      if(defPart){
        const m2 = defPart.match(/default\s*:\s*\"([^\"]*)\"/);
        if(m2) fallback = m2[1];
      }
      const path = pathPart.toLowerCase();
      let val = '';
      switch(path){
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
      if(!val && fallback) return fallback;
      return val || '';
    }catch(e){
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
    else if (h.includes('outreach')) map.otrCols.push(i);
    else if (h.includes('salg') || h.includes('udbytte') || h.includes('sale')) map.salg = i;
    else if (h.includes('kontaktperson') || h.includes('contact')) map.kontaktperson = i;
    else if (h.includes('produkt') || h === 'product') map.produkt = i;
  });
  return map;
}

function getVal(p, colMap, key) { const i = colMap[key]; return i != null && p[i] !== undefined ? (p[i] || '').trim() : ''; }

function parseLineWithMap(p, colMap, defaultCat, defaultCountry) {
  const knownC = ['Danmark','Sverige','Norge'];
  const name = getVal(p, colMap, 'navn');
  const kategori = getVal(p, colMap, 'kategori');
  const underkategori = getVal(p, colMap, 'underkategori');
  const land = getVal(p, colMap, 'land');
  const email = getVal(p, colMap, 'mail').replace(/\s/g,'');
  const phone = getVal(p, colMap, 'telefon');
  const city = getVal(p, colMap, 'by');
  const kontaktperson = getVal(p, colMap, 'kontaktperson');
  const produkt = getVal(p, colMap, 'produkt');
  const salgRaw = getVal(p, colMap, 'salg');

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

  if (!name && !email) return null;
  return {
    name, category, country: ctry, email, phone, city, status,
    _outreaches: outreaches, notes: '', sale_info, contact_person: kontaktperson, product: produkt,
  };
}

function parseLineLegacy(line, cat, country) {
  const p = line;
  if(!Array.isArray(p) || p.length === 0 || (p.length === 1 && !p[0])) return null;
  if(isHeader(p)) return null;
  if(!p[0] && !p[3]) return null;

  const knownC = ['Danmark','Sverige','Norge'];
  const col3isEmail = p[3] && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((p[3]||'').replace(/\s/g,''));
  if (col3isEmail && p.length >= 5) {
    // Old structured format: Navn | Type | Land | Mail | Otr... | Udbytte | Otr...
    const name = p[0] || '';
    const type = p[1] || '';
    const ctry = knownC.find(c => (p[2]||'').toLowerCase().startsWith(c.toLowerCase())) || country;
    const email = (p[3]||'').replace(/\s/g,'');
    const resolvedCat = mapCategory(type, cat);

    const otrFields = [p[4], p[5], p[7]].filter(x => x && x.trim() && !isSaleField(x));
    const saleField = [p[4], p[5], p[6], p[7]].find(x => isSaleField(x)) || '';

    const outreaches = [];
    for (const f of otrFields) { outreaches.push(...parseOtrField(f, false)); }
    if (saleField) { outreaches.push(...parseOtrField(saleField, true)); }

    const hasSale = !!saleField;
    const has15pct = [p[4],p[5],p[6],p[7]].some(x => x && x.includes('15%'));
    let status = 'not_contacted';
    if (hasSale) status = 'won';
    else if (has15pct) status = 'outreach_done';
    else if (outreaches.length > 0) status = 'outreach_done';

    const sale_info = saleField || (has15pct ? '15% medlemsrabat aftalt' : '');

    if (!name && !email) return null;
    return { name, category: resolvedCat, country: ctry, email, phone:'', city:'', status, _outreaches: outreaches, notes: type ? 'Type: '+type : '', sale_info, contact_person:'', product:'' };
  }

  const ei = findEmail(p);
  let name='',ctry=country,email='',oRaw='',note='';
  if(ei>=0){
    email=p[ei].replace(/\s/g,'');
    name=p[0]||'';
    ctry=knownC.find(c=>(p[2]||'').toLowerCase().startsWith(c.toLowerCase()))||country;
    oRaw=p[ei+1]||'';
    note=p[ei+2]||'';
  } else { name=p[0]||''; }

  const saleRaw = [oRaw, note, ...p].find(x => isSaleField(x)) || '';
  const outreaches = oRaw ? parseOtrField(oRaw, isSaleField(oRaw)) : [];
  const hasSale = !!saleRaw;
  const status = hasSale ? 'won' : outreaches.length > 0 ? 'outreach_done' : 'not_contacted';
  if(!name&&!email) return null;
  return{name,category:cat,country:ctry,email,phone:'',city:'',status,_outreaches:outreaches,notes:note,sale_info:saleRaw,contact_person:'',product:''};
}

// ─── Mini chart components ───────────────────────────────────────────────────
function MiniLineChart({data}){
  if(!data||data.length<2)return<div style={{color:'#4b5563',fontSize:13,padding:'40px 0',textAlign:'center'}}>Ikke nok data endnu</div>;
  const W=400,H=120,PAD=20;
  const vals=data.map(d=>d.revenue);
  const mx=Math.max(...vals)||1,mn=Math.min(...vals);
  const px=(v,i)=>({x:PAD+(i/(data.length-1))*(W-PAD*2),y:H-PAD-((v-mn)/(mx-mn||1))*(H-PAD*2)});
  const pts=data.map((d,i)=>px(d.revenue,i));
  const path='M'+pts.map(p=>p.x+','+p.y).join('L');
  const area=path+'L'+pts[pts.length-1].x+','+(H-PAD)+'L'+pts[0].x+','+(H-PAD)+'Z';
  return(
    <svg width="100%" viewBox={'0 0 '+W+' '+H} style={{overflow:'visible'}}>
      <defs><linearGradient id="gr" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.35"/>
        <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0"/>
      </linearGradient></defs>
      <path d={area} fill="url(#gr)"/>
      <path d={path} fill="none" stroke="#0ea5e9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      {pts.map((p,i)=>(
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3.5} fill="#0ea5e9" stroke="#0a0f1e" strokeWidth={2}/>
          <text x={p.x} y={H+2} textAnchor="middle" fontSize={9} fill="#4b5563">{data[i].label}</text>
        </g>
      ))}
    </svg>
  );
}
function HBarChart({data}){
  if(!data||data.length===0)return null;
  const mx=Math.max(...data.map(d=>d.revenue))||1;
  return(
    <div style={{display:'flex',flexDirection:'column',gap:7}}>
      {data.slice(0,8).map((d,i)=>(
        <div key={i} style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:100,fontSize:11,color:'#6b7280',textAlign:'right',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.name}</div>
          <div style={{flex:1,background:'#0d1420',borderRadius:4,height:16,overflow:'hidden'}}>
            <div style={{width:((d.revenue/mx)*100)+'%',height:'100%',background:'linear-gradient(90deg,#6366f1,#0ea5e9)',borderRadius:4,minWidth:4}}/>
          </div>
          <div style={{width:75,fontSize:11,color:'#9ca3af',whiteSpace:'nowrap'}}>{d.revenue.toLocaleString('da-DK')} kr</div>
        </div>
      ))}
    </div>
  );
}

function groupByMonth(orders){
  const map={};
  for(const o of orders){
    if(o.financial_status!=='paid'&&o.financial_status!=='partially_paid')continue;
    const d=new Date(o.created_at);
    const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    const label=d.toLocaleString('da-DK',{month:'short'});
    if(!map[key])map[key]={key,label,revenue:0,orders:0};
    map[key].revenue+=parseFloat(o.total_price||0);
    map[key].orders++;
  }
  return Object.values(map).sort((a,b)=>a.key.localeCompare(b.key)).slice(-10);
}
function groupByProduct(orders){
  const map={};
  for(const o of orders){
    if(o.financial_status!=='paid'&&o.financial_status!=='partially_paid')continue;
    for(const item of(o.line_items||[])){
      const name=item.title||'Ukendt';
      if(!map[name])map[name]={name,qty:0,revenue:0};
      map[name].qty+=item.quantity||0;
      map[name].revenue+=parseFloat(item.price||0)*(item.quantity||0);
    }
  }
  return Object.values(map).sort((a,b)=>b.revenue-a.revenue);
}

function StatusBadge({value}){
  const s=STATUS_OPTIONS.find(o=>o.value===value)||STATUS_OPTIONS[0];
  return <span style={{background:s.color+'22',color:s.color,border:`1px solid ${s.color}44`,borderRadius:6,padding:'2px 10px',fontSize:12,fontWeight:600,whiteSpace:'nowrap'}}>{s.label}</span>;
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
  const [scrapeRows, setScrapeRows] = useState([]);
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
  const [newOtr, setNewOtr] = useState({...DEFAULT_OTR});
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

  // ── Auth session ────────────────────────────────────────────────────────
  useEffect(()=>{
    let mounted = true;
    const init = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if(!mounted) return;
        setUser(data.session?.user || null);
      } finally {
        if(mounted) setAuthLoading(false);
      }
    };
    init();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session)=>{
      setUser(session?.user || null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  },[]);

  // ── Load from Supabase ──────────────────────────────────────────────────
  useEffect(()=>{
    loadLeads();
    loadTemplates();
  },[]);

  const loadLeads = async () => {
    setLoading(true);
    try {
      const { data: leadsData, error: leadsError } = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });
      if (leadsError) throw leadsError;

      // Fetch ALL outreaches in batches of 1000 (Supabase default limit)
      let outreachData = [];
      let oFrom = 0;
      const OBatch = 1000;
      while(true){
        const { data: oBatch, error: oError } = await supabase
          .from('outreaches').select('*').order('date',{ascending:true}).range(oFrom, oFrom+OBatch-1);
        if(oError) throw oError;
        outreachData = outreachData.concat(oBatch||[]);
        if((oBatch||[]).length < OBatch) break;
        oFrom += OBatch;
      }

      // Merge outreaches into leads
      const oByLead = {};
      for (const o of (outreachData||[])) {
        if (!oByLead[o.lead_id]) oByLead[o.lead_id] = [];
        oByLead[o.lead_id].push(o);
      }
      const merged = (leadsData||[]).map(l => ({...l, outreaches: oByLead[l.id]||[]}));
      setLeads(merged);
    } catch(e) {
      msg('Fejl ved indlæsning: '+e.message, 'err');
    }
    setLoading(false);
  };

  const loadTemplates = async () => {
    setTplLoading(true);
    try {
      const { data, error } = await supabase
        .from('email_templates')
        .select('*')
        .order('updated_at',{ascending:false});
      if(error) throw error;
      setTemplates(data||[]);
    } catch(e) {
      msg('Fejl ved indlæsning af templates: '+e.message,'err');
    }
    setTplLoading(false);
  };

  const msg = (m, t='ok') => { setToast({m,t}); setTimeout(()=>setToast(null), 3000); };

  const paid=shopOrders.filter(o=>o.financial_status==='paid'||o.financial_status==='partially_paid');
  const totalRev=paid.reduce((s,o)=>s+parseFloat(o.total_price||0),0);
  const monthly=groupByMonth(shopOrders);
  const products=groupByProduct(shopOrders);
  const thisMo=new Date().toISOString().slice(0,7);
  const lastMo=new Date(new Date().setMonth(new Date().getMonth()-1)).toISOString().slice(0,7);
  const revThis=monthly.find(m=>m.key===thisMo)?.revenue||0;
  const revLast=monthly.find(m=>m.key===lastMo)?.revenue||0;
  const growth=revLast>0?((revThis-revLast)/revLast*100):0;

  const stats={
    total:leads.length,
    won:leads.filter(l=>l.status==='won').length,
    out:leads.filter(l=>l.status==='outreach_done').length,
    nc:leads.filter(l=>l.status==='not_contacted').length,
  };

  const notesList = sel ? parseLeadNotes(sel.notes) : [];

  const runP = txt => {
    if(!txt.trim()) return [];
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
    return Object.values(parents).sort((a,b)=>a.name.localeCompare(b.name));
  })();

  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc'); // 'asc' | 'desc'

  const filtered = leads.filter(l=>{
    if(fCats.size > 0 && !fCats.has(l.category)) return false;
    if(fStatus!=='Alle'&&l.status!==fStatus)return false;
    if(fCountry!=='Alle'&&l.country!==fCountry)return false;
    if(fMissingEmail && l.email) return false;
    if(search){const q=search.toLowerCase();if(!l.name.toLowerCase().includes(q)&&!(l.email||'').toLowerCase().includes(q))return false;}
    return true;
  });

  const sorted = [...filtered].sort((a,b)=>{
    const dir = sortDir === 'asc' ? 1 : -1;
    const getVal = (lead) => {
      switch(sortKey){
        case 'name': return (lead.name||'').toLowerCase();
        case 'category': return (lead.category||'').toLowerCase();
        case 'email': return (lead.email||'').toLowerCase();
        case 'country': return (lead.country||'').toLowerCase();
        case 'status': return (lead.status||'').toLowerCase();
        case 'outreach': return (lead.outreaches||[]).length;
        case 'sale': return (lead.sale_info||'').toLowerCase();
        case 'created_at':
        default: return lead.created_at || '';
      }
    };
    const va = getVal(a);
    const vb = getVal(b);
    if(typeof va === 'number' && typeof vb === 'number') return (va-vb)*dir;
    if(va<vb) return -1*dir;
    if(va>vb) return 1*dir;
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
    if(bulkSel.size===0) return msg('Vælg leads i bulk først','err');
    try{
      const list = leads.filter(l=>bulkSel.has(l.id) && l.email && /\S+@\S+\.\S+/.test(l.email));
      if(!list.length) return msg('Ingen gyldige emails blandt de valgte leads','err');
      const text = list.map(l=>l.email.trim()).join(', ');
      await navigator.clipboard.writeText(text);
      msg(list.length+' emails kopieret til udklipsholderen');
    }catch(e){
      msg('Kunne ikke kopiere emails: '+(e.message||''),'err');
    }
  };

  const openTemplateMail = (lead) => {
    if(!lead) return;
    const tpl = templates.find(t=>t.id===detailTplId);
    if(!tpl) return msg('Vælg en mail template først','err');
    if(!lead.email) return msg('Lead mangler email','err');
    const subject = renderTemplate(tpl.subject, lead) || '';
    const body = renderTemplate(tpl.body, lead) || '';
    if(typeof window === 'undefined') return;
    const mailto = `mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
  };

  const copyTemplateMail = async (lead) => {
    if(!lead) return;
    const tpl = templates.find(t=>t.id===detailTplId);
    if(!tpl) return msg('Vælg en mail template først','err');
    try{
      const subject = renderTemplate(tpl.subject, lead) || '';
      const body = renderTemplate(tpl.body, lead) || '';
      const text = `Emne: ${subject}\n\n${body}`;
      await navigator.clipboard.writeText(text);
      msg('Mailtekst kopieret');
    }catch(e){
      msg('Kunne ikke kopiere mailtekst: '+(e.message||''),'err');
    }
  };

  const runScrape = async () => {
    const urls = (scrapeUrls||'').split(/\r?\n/).map(u=>u.trim()).filter(Boolean);
    if(!urls.length) return msg('Indsæt mindst én URL','err');
    setScrapeLoading(true);
    setScrapeRows([]);
    try{
      const res = await fetch('/api/scrape-emails',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({urls,country:scrapeCountry,category:scrapeCategory}),
      });
      if(!res.ok) throw new Error('HTTP '+res.status);
      const data = await res.json();
      setScrapeRows(data.leads||[]);
      msg((data.leads||[]).length+' leads fundet');
    }catch(e){
      msg('Fejl ved scraping: '+(e.message||''),'err');
    }
    setScrapeLoading(false);
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
    } catch(e) {
      setAuthError(e.message || 'Login fejlede');
      msg('Login fejlede: '+e.message,'err');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
    } catch(e) {
      msg('Kunne ikke logge ud: '+e.message,'err');
    }
  };

  const openNewTemplate = () => {
    setEditTpl({
      id:null,
      name:'',
      type:'cold_outreach',
      subject:'',
      body:'',
      language:'da',
      from_email:'',
      active:true,
      category_tags:[],
    });
    setTplCats(new Set());
  };

  const openEditTemplate = (tpl) => {
    setEditTpl(tpl);
    setTplCats(new Set(tpl.category_tags||[]));
  };

  const saveTemplate = async () => {
    if(!editTpl || !editTpl.name.trim()) return msg('Navn er påkrævet','err');
    if(!editTpl.subject.trim()) return msg('Subject er påkrævet','err');
    setSaving(true);
    try{
      const payload = {
        name:editTpl.name.trim(),
        type:editTpl.type||'cold_outreach',
        subject:editTpl.subject,
        body:editTpl.body,
        language:editTpl.language||'da',
        from_email:editTpl.from_email||null,
        active:editTpl.active!==false,
        category_tags:[...tplCats],
      };
      if(editTpl.id){
        const { data,error } = await supabase.from('email_templates').update(payload).eq('id',editTpl.id).select().single();
        if(error) throw error;
        setTemplates(templates.map(t=>t.id===editTpl.id?data:t));
        setEditTpl(data);
        msg('Template opdateret');
      }else{
        const { data,error } = await supabase.from('email_templates').insert(payload).select().single();
        if(error) throw error;
        setTemplates([data,...templates]);
        setEditTpl(data);
        msg('Template oprettet');
      }
    }catch(e){ msg('Fejl: '+e.message,'err'); }
    setSaving(false);
  };

  const deleteTemplate = async (tpl) => {
    if(!tpl?.id) return;
    if(!confirm(`Slet template "${tpl.name}"?`)) return;
    setSaving(true);
    try{
      const { error } = await supabase.from('email_templates').delete().eq('id',tpl.id);
      if(error) throw error;
      setTemplates(templates.filter(t=>t.id!==tpl.id));
      if(editTpl && editTpl.id===tpl.id) setEditTpl(null);
      msg('Template slettet');
    }catch(e){ msg('Fejl: '+e.message,'err'); }
    setSaving(false);
  };

  const openAdd = () => { setEditLead({...DEFAULT_LEAD}); setView('add'); };
  const openEdit = l => { setEditLead({...l}); setView('add'); };

  const sendScrapeToImport = () => {
    if(!scrapeRows.length) return msg('Ingen scraped leads at sende','err');
    const header = ['Navn','Kategori','Underkategori','Land','Mail','Telefon','By','B2B Outreach 1','Salg/Udbytte','Kontaktperson'];
    const lines = [header.join(',')];
    scrapeRows.forEach(r=>{
      lines.push([
        r.name||'',
        r.category||'',
        r.underkategori||'',
        r.country||'',
        r.email||'',
        r.phone||'',
        r.city||'',
        '', // outreach tom
        '', // salg tom
        r.contact_person||'',
      ].map(v=>`"${(v||'').replace(/"/g,'""')}"`).join(','));
    });
    const csv = lines.join('\n');
    setIText(csv);
    setIPrev(runP(csv));
    setView('import');
    msg(scrapeRows.length+' scraped leads sendt til import');
  };

  const saveLead = async () => {
    if(!editLead.name.trim()) return msg('Navn er påkrævet','err');
    setSaving(true);
    try {
      const isExisting = leads.find(l=>l.id===editLead.id);
      const payload = {
        name: editLead.name, category: editLead.category, country: editLead.country,
        email: editLead.email, phone: editLead.phone, city: editLead.city,
        status: editLead.status, notes: editLead.notes, sale_info: editLead.sale_info,
        contact_person: editLead.contact_person, product: editLead.product,
      };
      if(isExisting){
        const {error} = await supabase.from('leads').update(payload).eq('id',editLead.id);
        if(error) throw error;
        setLeads(leads.map(l=>l.id===editLead.id?{...l,...payload}:l));
        msg('Opdateret');
      } else {
        const {data,error} = await supabase.from('leads').insert(payload).select().single();
        if(error) throw error;
        setLeads([{...data,outreaches:[]},...leads]);
        msg('Tilføjet');
      }
      setView('list'); setEditLead(null);
    } catch(e) { msg('Fejl: '+e.message,'err'); }
    setSaving(false);
  };

  const delLead = async id => {
    if(!confirm('Slet dette lead?')) return;
    try {
      await supabase.from('outreaches').delete().eq('lead_id', id);
      const {error} = await supabase.from('leads').delete().eq('id', id);
      if(error) throw error;
      setLeads(leads.filter(l=>l.id!==id));
      setView('list'); msg('Slettet');
    } catch(e) { msg('Fejl: '+e.message,'err'); }
  };

  const addOtr = async lead => {
    if(!newOtr.date) return msg('Vælg dato','err');
    let status=lead.status;
    if(newOtr.sale_info?.trim()) status='won';
    else if(lead.status==='not_contacted') status='outreach_done';
    try {
      const {data,error} = await supabase.from('outreaches').insert({
        lead_id:lead.id, date:newOtr.date, by:newOtr.by, note:newOtr.note, sale_info:newOtr.sale_info||''
      }).select().single();
      if(error) throw error;
      // Update lead status if changed
      if(status!==lead.status) {
        const saleInfo = newOtr.sale_info?.trim()?newOtr.sale_info:lead.sale_info;
        await supabase.from('leads').update({status, sale_info:saleInfo}).eq('id',lead.id);
        const updated={...lead,status,sale_info:saleInfo,outreaches:[...(lead.outreaches||[]),data]};
        setLeads(leads.map(l=>l.id===lead.id?updated:l));
        setSel(updated);
      } else {
        const updated={...lead,outreaches:[...(lead.outreaches||[]),data]};
        setLeads(leads.map(l=>l.id===lead.id?updated:l));
        setSel(updated);
      }
      setNewOtr({...DEFAULT_OTR}); msg('Outreach tilføjet');
    } catch(e) { msg('Fejl: '+e.message,'err'); }
  };

  const saveEditOtr = async lead => {
    try {
      const {error} = await supabase.from('outreaches').update({
        date:editOtr.date, by:editOtr.by, note:editOtr.note, sale_info:editOtr.sale_info||''
      }).eq('id',editOtrId);
      if(error) throw error;
      const updated={...lead,outreaches:lead.outreaches.map(o=>o.id===editOtrId?{...o,...editOtr}:o)};
      setLeads(leads.map(l=>l.id===lead.id?updated:l));
      setSel(updated); setEditOtrId(null); setEditOtr(null); msg('Opdateret');
    } catch(e) { msg('Fejl: '+e.message,'err'); }
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
      const { error } = await supabase.from('leads').update({ sale_info:'', status:newStatus }).eq('id', lead.id);
      if (error) throw error;
      await supabase.from('outreaches').update({ sale_info:'' }).eq('lead_id', lead.id);
      const updatedOtrs = (lead.outreaches || []).map(o => ({ ...o, sale_info:'' }));
      const updated = { ...lead, sale_info:'', status:newStatus, outreaches: updatedOtrs };
      setLeads(leads.map(l => l.id === lead.id ? updated : l));
      setSel(updated);
      msg('Salg fjernet');
    } catch(e) { msg('Fejl: '+e.message,'err'); }
    setSaving(false);
  };

  const addDetailNote = async lead => {
    if (!lead) return;
    if (!noteTitle.trim() && !noteBody.trim()) return msg('Skriv mindst titel eller tekst','err');
    setSaving(true);
    try {
      const existing = parseLeadNotes(lead.notes);
      const now = new Date().toISOString();
      const note = {
        id: 'n_'+now+'_'+Math.random().toString(36).slice(2,8),
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
    } catch(e) { msg('Fejl: '+e.message,'err'); }
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
    } catch(e) { msg('Fejl: '+e.message,'err'); }
    setSaving(false);
  };

  const delOtr = async (lead,id) => {
    try {
      const {error} = await supabase.from('outreaches').delete().eq('id',id);
      if(error) throw error;
      const updated={...lead,outreaches:lead.outreaches.filter(o=>o.id!==id)};
      setLeads(leads.map(l=>l.id===lead.id?updated:l));
      setSel(updated);
    } catch(e) { msg('Fejl: '+e.message,'err'); }
  };

  const updSt = async (lead,status) => {
    try {
      const {error} = await supabase.from('leads').update({status}).eq('id',lead.id);
      if(error) throw error;
      const updated={...lead,status};
      setLeads(leads.map(l=>l.id===lead.id?updated:l));
      setSel(updated); msg('Status opdateret');
    } catch(e) { msg('Fejl: '+e.message,'err'); }
  };

  const applyBulk = async () => {
    if(bulkSel.size===0) return msg('Vælg leads','err');
    setSaving(true);
    try {
      const ids=[...bulkSel];
      // If sale is filled, force status to 'won'
      const effectiveStatus = bulkSale.trim() ? 'won' : bulkSt;
      const updatePayload = {status:effectiveStatus};
      if(bulkSale.trim()) updatePayload.sale_info = bulkSale.trim();
      const CHUNK=50;
      for(let i=0;i<ids.length;i+=CHUNK){
        await supabase.from('leads').update(updatePayload).in('id',ids.slice(i,i+CHUNK));
      }
      if(bulkDate){
        const rows=ids.map(id=>({lead_id:id,date:bulkDate,by:bulkBy,note:bulkNote,sale_info:bulkSale.trim()||''}));
        await supabase.from('outreaches').insert(rows);
      }
      await loadLeads();
      msg(bulkSel.size+' leads opdateret');
      setBulkSel(new Set()); setBulk(false); setBulkSale('');
    } catch(e) { msg('Fejl: '+e.message,'err'); }
    setSaving(false);
  };

  const bulkDelete = async () => {
    if(bulkSel.size===0) return msg('Vælg leads','err');
    if(!confirm(`Slet ${bulkSel.size} leads permanent? Dette kan ikke fortrydes.`)) return;
    setSaving(true);
    try {
      const ids=[...bulkSel];
      // Batch in chunks of 50 to avoid PostgREST URL length limits
      const CHUNK = 50;
      for(let i=0;i<ids.length;i+=CHUNK){
        const batch=ids.slice(i,i+CHUNK);
        await supabase.from('outreaches').delete().in('lead_id',batch);
        const {error}=await supabase.from('leads').delete().in('id',batch);
        if(error) throw error;
      }
      setLeads(leads.filter(l=>!bulkSel.has(l.id)));
      msg(ids.length+' leads slettet');
      setBulkSel(new Set()); setBulk(false);
    } catch(e) { msg('Fejl: '+e.message,'err'); }
    setSaving(false);
  };

  const deleteAllLeads = async () => {
    if(!confirm('Slet ALLE leads permanent? Dette kan ikke fortrydes.')) return;
    if(!confirm('Er du helt sikker? Alle '+leads.length+' leads slettes.')) return;
    setSaving(true);
    try {
      await supabase.from('outreaches').delete().neq('id','00000000-0000-0000-0000-000000000000');
      await supabase.from('leads').delete().neq('id','00000000-0000-0000-0000-000000000000');
      setLeads([]); msg('Alle leads slettet');
    } catch(e) { msg('Fejl: '+e.message,'err'); }
    setSaving(false);
  };

  const renameCategory = async (oldCat, newCat) => {
    if(!newCat.trim()||oldCat===newCat) return;
    try {
      const {error} = await supabase.from('leads').update({category:newCat}).eq('category',oldCat);
      if(error) throw error;
      setLeads(leads.map(l=>l.category===oldCat?{...l,category:newCat}:l));
      msg('Kategori omdøbt');
    } catch(e) { msg('Fejl: '+e.message,'err'); }
  };

  const deleteCategoryLeads = async (cat) => {
    if(!confirm(`Slet alle leads i kategorien "${cat}"?`)) return;
    const ids = leads.filter(l=>l.category===cat).map(l=>l.id);
    if(!ids.length) return;
    try {
      await supabase.from('outreaches').delete().in('lead_id', ids);
      const {error} = await supabase.from('leads').delete().eq('category', cat);
      if(error) throw error;
      setLeads(leads.filter(l=>l.category!==cat)); msg('Kategori slettet');
    } catch(e) { msg('Fejl: '+e.message,'err'); }
  };

  const importLeads = async () => {
    if(!iPrev.length) return;
    setSaving(true);
    try {
      let skipped = 0;
      for(const lead of iPrev){
        const {_outreaches,...leadData} = lead;
        const {data,error} = await supabase.from('leads').insert(leadData).select().single();
        if(error){ console.warn('Lead insert fejl:', leadData.name, error.message); skipped++; continue; }
        if(_outreaches&&_outreaches.length>0){
          const rows=_outreaches.map(o=>({lead_id:data.id,by:o.by||'Jeppe',note:o.note||'',date:o.date||null,sale_info:o.sale_info||''}));
          const {error:oErr} = await supabase.from('outreaches').insert(rows);
          if(oErr) console.warn('Outreach insert fejl for', data.id, oErr.message);
        }
      }
      if(skipped>0) msg(`${iPrev.length-skipped} leads importeret (${skipped} sprunget over)`,'ok');
      else msg(iPrev.length+' leads importeret');
      await loadLeads();
      setIText(''); setIPrev([]); setView('list');
    } catch(e) { msg('Fejl: '+e.message,'err'); }
    setSaving(false);
  };

  const connectShopify = async () => {
    if(!shopDomain.trim()||!shopToken.trim()) return msg('Udfyld URL og token','err');
    setShopLoading(true); setShopError('');
    try {
      const url='https://'+shopDomain.trim()+'/admin/api/2024-01/orders.json?limit=250&status=any&fields=id,created_at,total_price,financial_status,line_items';
      const r=await fetch(url,{headers:{'X-Shopify-Access-Token':shopToken.trim()}});
      if(!r.ok) throw new Error('HTTP '+r.status+' - '+r.statusText);
      const d=await r.json(); const orders=d.orders||[];
      setShopOrders(orders); setShopOK(true);
      msg('Tilsluttet - '+orders.length+' ordrer hentet'); setView('dashboard');
    } catch(e) { setShopError(e.message); }
    setShopLoading(false);
  };
  const refreshShop = async () => {
    setShopLoading(true);
    try {
      const url='https://'+shopDomain+'/admin/api/2024-01/orders.json?limit=250&status=any&fields=id,created_at,total_price,financial_status,line_items';
      const r=await fetch(url,{headers:{'X-Shopify-Access-Token':shopToken}});
      const d=await r.json(); setShopOrders(d.orders||[]);
      msg('Shopify opdateret');
    } catch(e) { msg('Fejl: '+e.message,'err'); }
    setShopLoading(false);
  };

  if(loading) return(
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:'#0a0f1e',color:'#e2e8f0',flexDirection:'column',gap:12}}>
      <div style={{width:36,height:36,border:'3px solid #1f2937',borderTop:'3px solid #0ea5e9',borderRadius:'50%',animation:'spin 1s linear infinite'}}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{color:'#4b5563',fontSize:13}}>Indlæser leads fra Supabase...</div>
    </div>
  );

  const CC={
    card:{background:'#111827',border:'1px solid #1f2937',borderRadius:14},
    inner:{background:'#0d1420',border:'1px solid #1a2332',borderRadius:10},
  };
  const NAV=[
    {id:'dashboard',label:'Dashboard'},
    {id:'list',label:'Leads'},
    {id:'import',label:'Importér'},
    {id:'scraper',label:'Lead scraper'},
    {id:'templates',label:'Mail templates'},
    {id:'shopify_settings',label:'Shopify'},
    {id:'settings',label:'Indstillinger'},
  ];

  if (authLoading) {
    return (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:'#020617',color:'#e5e7eb',fontFamily:'system-ui,sans-serif',flexDirection:'column',gap:12}}>
        <div style={{width:36,height:36,border:'3px solid #1f2937',borderTop:'3px solid #0ea5e9',borderRadius:'50%',animation:'spin 1s linear infinite'}}/>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{color:'#4b5563',fontSize:13}}>Tjekker login...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'radial-gradient(circle at top,#1f2933,#020617 55%)',color:'#e5e7eb',fontFamily:'system-ui,sans-serif',padding:24}}>
        <style>{`
          *{box-sizing:border-box}
          input,button{font-family:inherit}
        `}</style>
        <div style={{width:'100%',maxWidth:880,display:'grid',gridTemplateColumns:'minmax(0,1.1fr) minmax(0,1fr)',gap:32,alignItems:'stretch'}}>
          <div style={{padding:32,borderRadius:26,background:'linear-gradient(135deg,#0b1120,#020617)',border:'1px solid #1f2937',boxShadow:'0 24px 80px rgba(0,0,0,0.85)'}}>
            <div style={{marginBottom:26}}>
              <div style={{fontSize:26,fontWeight:800,marginBottom:6,letterSpacing:0.5}}>Surfmore CRM</div>
              <div style={{fontSize:13,color:'#9ca3af',maxWidth:320}}>Login kræves for at se leads, outreach‑historik og mailskabeloner.</div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:10,fontSize:12,color:'#9ca3af'}}>
              <div>• Ét login pr. medarbejder (oprettes i Supabase → Authentication → Users).</div>
              <div>• Del adgang sikkert med Surfmore‑emails (fx <span style={{color:'#e5e7eb'}}>jeppe@surfmore.dk</span>).</div>
              <div>• Alle ændringer logges i Supabase databasen.</div>
            </div>
          </div>
          <div style={{background:'#020617',borderRadius:26,border:'1px solid #1f2937',padding:28,boxShadow:'0 20px 60px rgba(0,0,0,0.7)',display:'flex',flexDirection:'column',gap:16}}>
            <div>
              <div style={{fontSize:18,fontWeight:700,marginBottom:4}}>Log ind</div>
              <div style={{fontSize:12,color:'#6b7280'}}>Brug din arbejds‑email og adgangskode</div>
            </div>
            {authError&&(
              <div style={{background:'#b91c1c22',border:'1px solid #b91c1c55',borderRadius:10,padding:'9px 11px',fontSize:12,color:'#fecaca'}}>
                {authError}
              </div>
            )}
            <form onSubmit={handleLogin} style={{display:'flex',flexDirection:'column',gap:12}}>
              <div>
                <label style={{fontSize:12,color:'#9ca3af',display:'block',marginBottom:6}}>Email</label>
                <input
                  className="inp"
                  type="email"
                  value={authEmail}
                  onChange={e=>setAuthEmail(e.target.value)}
                  placeholder="Arbejds-email"
                  style={{height:44,fontSize:14}}
                />
              </div>
              <div>
                <label style={{fontSize:12,color:'#9ca3af',display:'block',marginBottom:6}}>Adgangskode</label>
                <input
                  className="inp"
                  type="password"
                  value={authPassword}
                  onChange={e=>setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{height:44,fontSize:14}}
                />
              </div>
              <button
                type="submit"
                className="btn btn-p"
                disabled={authLoading || !authEmail || !authPassword}
                style={{marginTop:4,justifyContent:'center',height:44,fontSize:14}}
              >
                {authLoading ? 'Logger ind...' : 'Log ind'}
              </button>
            </form>
            <div style={{marginTop:6,fontSize:11,color:'#4b5563',lineHeight:1.6}}>
              Brugere oprettes i Supabase under <span style={{color:'#e5e7eb'}}>Authentication → Users</span>.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return(
    <div style={{display:'flex',minHeight:'100vh',background:'#0a0f1e',color:'#e2e8f0',fontFamily:'system-ui,sans-serif'}}>
      <style>{`
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#1f2937;border-radius:2px}
        input,select,textarea{font-family:inherit}
        .btn{cursor:pointer;border:none;border-radius:8px;font-weight:600;font-size:13px;transition:all 0.15s;font-family:inherit}
        .btn-p{background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;padding:8px 18px}.btn-p:hover{opacity:0.85;transform:translateY(-1px)}
        .btn-g{background:transparent;color:#6b7280;padding:8px 12px;border:1px solid #1f2937}.btn-g:hover{background:#111827;color:#e2e8f0}
        .btn-d{background:#ef444415;color:#ef4444;padding:5px 10px;border:1px solid #ef444430}
        .btn-v{background:#7c3aed20;color:#a78bfa;padding:8px 14px;border:1px solid #7c3aed40}.btn-v:hover{background:#7c3aed30}
        .inp{background:#111827;border:1px solid #1f2937;border-radius:8px;color:#e2e8f0;padding:8px 12px;font-size:14px;width:100%;outline:none;transition:border 0.15s}.inp:focus{border-color:#0ea5e9}
        .rh:hover{background:#111827 !important;cursor:pointer}
        .tag{background:#0ea5e915;color:#38bdf8;border:1px solid #0ea5e925;border-radius:5px;padding:2px 7px;font-size:11px;font-weight:600}
        label{font-size:12px;color:#6b7280;display:block;margin-bottom:4px}
        .sl{font-size:10px;color:#4b5563;text-transform:uppercase;letter-spacing:0.8px;font-weight:700;margin-bottom:10px}
        .navbtn{display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:9px;cursor:pointer;border:none;background:none;color:#4b5563;font-family:inherit;font-size:13px;font-weight:500;width:100%;transition:all 0.15s;text-align:left}
        .navbtn:hover{background:#111827;color:#9ca3af}
        .navbtn.active{background:#111827;color:#0ea5e9;font-weight:600}
      `}</style>

      {toast&&<div style={{position:'fixed',top:16,right:16,zIndex:9999,background:toast.t==='err'?'#dc2626':'#16a34a',color:'#fff',padding:'10px 18px',borderRadius:10,fontWeight:600,fontSize:13,boxShadow:'0 4px 20px rgba(0,0,0,0.5)',pointerEvents:'none'}}>{toast.m}</div>}

      {/* Sidebar */}
      <div style={{width:160,background:'#080d18',borderRight:'1px solid #0f172a',display:'flex',flexDirection:'column',padding:'20px 10px',gap:2,position:'sticky',top:0,height:'100vh',flexShrink:0}}>
        <div style={{fontSize:15,fontWeight:700,color:'#e2e8f0',marginBottom:4,padding:'0 4px'}}>Surfmore</div>
        <div style={{fontSize:11,color:'#4b5563',marginBottom:20,padding:'0 4px'}}>CRM</div>
        {NAV.map(n=>(
          <button key={n.id} className={'navbtn'+(view===n.id?' active':'')} onClick={()=>{setBulk(false);setView(n.id);}}>
            {n.label}
          </button>
        ))}
        <div style={{marginTop:'auto',padding:'0 4px'}}>
          <div style={{fontSize:10,color:'#1f2937',display:'flex',alignItems:'center',gap:5}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:'#22c55e'}}/>
            <span style={{color:'#4b5563'}}>Supabase</span>
          </div>
        </div>
      </div>

      <div style={{flex:1,overflow:'auto',minWidth:0}}>

        {/* DASHBOARD */}
        {view==='dashboard'&&(()=>{
          // Pipeline data
          const pipelineStages = [
            {key:'not_contacted',label:'Ikke kontaktet',color:'#64748b',count:stats.nc},
            {key:'outreach_done',label:'Outreach sendt',color:'#3b82f6',count:stats.out},
            {key:'won',label:'Solgt',color:'#22c55e',count:stats.won},
          ];
          const maxPipe = Math.max(...pipelineStages.map(s=>s.count),1);

          // Recent activity: batch imports (grouped by created_at date) + recent outreaches
          const importBatches = (() => {
            const groups = {};
            for(const l of leads){
              const d=(l.created_at||'').slice(0,10);
              if(!d) continue;
              if(!groups[d]) groups[d]={date:d,count:0};
              groups[d].count++;
            }
            return Object.values(groups).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
          })();
          const recentOutreaches = leads
            .flatMap(l=>(l.outreaches||[]).map(o=>({...o,leadName:l.name,leadId:l.id})))
            .filter(o=>o.date)
            .sort((a,b)=>(b.date||'').localeCompare(a.date||''))
            .slice(0,5);

          // Follow-up: leads with outreach_done but oldest last outreach
          const needFollowUp = leads
            .filter(l=>l.status==='outreach_done')
            .map(l=>{
              const lastOtr=(l.outreaches||[]).filter(o=>o.date).sort((a,b)=>b.date.localeCompare(a.date))[0];
              return {...l,lastOtrDate:lastOtr?.date||null};
            })
            .sort((a,b)=>(a.lastOtrDate||'').localeCompare(b.lastOtrDate||''))
            .slice(0,5);

          const noEmail = leads.filter(l=>!l.email).length;

          return(
          <div style={{padding:28}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24}}>
              <div>
                <h1 style={{fontSize:22,fontWeight:700,marginBottom:3}}>Dashboard</h1>
                <div style={{color:'#4b5563',fontSize:13}}>Overblik over leads og aktivitet</div>
              </div>
              <div style={{display:'flex',gap:8}}>
                {shopOK&&<button className="btn btn-g" onClick={refreshShop} disabled={shopLoading} style={{fontSize:12}}>{shopLoading?'Henter...':'Synk Shopify'}</button>}
                <button className="btn btn-g" onClick={loadLeads} style={{fontSize:12}}>↻ Opdater</button>
                <button className="btn btn-p" onClick={openAdd}>+ Nyt lead</button>
              </div>
            </div>

            {/* Top KPI cards */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:14}}>
              {[
                {l:'Totale leads',v:stats.total,c:'#6366f1',sub:'i databasen',click:()=>setView('list')},
                {l:'Ikke kontaktet',v:stats.nc,c:'#64748b',sub:'klar til outreach',click:()=>{setFStatus('not_contacted');setView('list');}},
                {l:'Outreach sendt',v:stats.out,c:'#3b82f6',sub:'afventer salg',click:()=>{setFStatus('outreach_done');setView('list');}},
                {l:'Solgt',v:stats.won,c:'#22c55e',sub:'konverterede leads',click:()=>{setFStatus('won');setView('list');}},
              ].map(s=>(
                <div key={s.l} style={{...CC.card,padding:'18px 20px',cursor:'pointer'}} onClick={s.click}>
                  <div style={{fontSize:10,color:s.c,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,marginBottom:6}}>{s.l}</div>
                  <div style={{fontSize:30,fontWeight:700,color:s.c,marginBottom:4}}>{s.v}</div>
                  <div style={{fontSize:11,color:'#4b5563'}}>{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Pipeline + Activity row */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>

              {/* Pipeline funnel */}
              <div style={{...CC.card,padding:20}}>
                <div style={{fontSize:13,fontWeight:600,color:'#9ca3af',marginBottom:16}}>Pipeline</div>
                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  {pipelineStages.map((s,i)=>{
                    const pct = stats.total>0?Math.round(s.count/stats.total*100):0;
                    const conv = i>0&&pipelineStages[i-1].count>0?Math.round(s.count/pipelineStages[i-1].count*100):null;
                    return(
                      <div key={s.key}>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                          <span style={{fontSize:12,color:'#9ca3af',fontWeight:600}}>{s.label}</span>
                          <span style={{fontSize:12,color:s.color,fontWeight:700}}>{s.count} <span style={{color:'#4b5563',fontWeight:400}}>({pct}%)</span></span>
                        </div>
                        <div style={{height:8,background:'#1f2937',borderRadius:4,overflow:'hidden'}}>
                          <div style={{height:'100%',width:(s.count/maxPipe*100)+'%',background:s.color,borderRadius:4,transition:'width 0.4s'}}/>
                        </div>
                        {conv!==null&&<div style={{fontSize:10,color:'#4b5563',marginTop:3,textAlign:'right'}}>↑ {conv}% konvertering fra forrige trin</div>}
                      </div>
                    );
                  })}
                </div>
                <div style={{marginTop:16,paddingTop:14,borderTop:'1px solid #1f2937',display:'flex',gap:16}}>
                  <div style={{fontSize:12,color:'#4b5563'}}>
                    Total outreaches: <span style={{color:'#e2e8f0',fontWeight:600}}>{leads.reduce((s,l)=>s+(l.outreaches||[]).length,0)}</span>
                  </div>
                  {noEmail>0&&(
                    <button
                      className="btn btn-g"
                      style={{fontSize:12,padding:'4px 10px',borderColor:'#ef444430',color:'#ef4444',background:'#111827'}}
                      onClick={()=>{resetFiltersAndSort();setFMissingEmail(true);setView('list');}}
                    >
                      {noEmail} leads uden email →
                    </button>
                  )}
                </div>
              </div>

              {/* Recent activity */}
              <div style={{...CC.card,padding:20,display:'flex',flexDirection:'column',gap:0}}>
                <div style={{fontSize:13,fontWeight:600,color:'#9ca3af',marginBottom:14}}>Seneste aktivitet</div>

                {/* Batch imports */}
                {importBatches.length>0&&(
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:10,color:'#4b5563',textTransform:'uppercase',letterSpacing:0.5,marginBottom:8}}>Imports</div>
                    {importBatches.map((b,i)=>(
                      <div key={b.date} style={{display:'flex',alignItems:'center',gap:10,padding:'6px 0',borderBottom:i<importBatches.length-1?'1px solid #0d1420':'none'}}>
                        <div style={{width:7,height:7,borderRadius:'50%',background:'#6366f1',flexShrink:0}}/>
                        <div style={{flex:1,fontSize:12,fontWeight:600}}>{b.count} leads tilføjet</div>
                        <div style={{fontSize:11,color:'#4b5563',flexShrink:0}}>{fmtDate(b.date)}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Recent outreaches */}
                {recentOutreaches.length>0&&(
                  <div>
                    <div style={{fontSize:10,color:'#4b5563',textTransform:'uppercase',letterSpacing:0.5,marginBottom:8}}>Seneste outreaches</div>
                    {recentOutreaches.map((o,i)=>(
                      <div key={o.id||i} style={{display:'flex',gap:10,alignItems:'flex-start',padding:'6px 0',borderBottom:i<recentOutreaches.length-1?'1px solid #0d1420':'none',cursor:'pointer'}}
                        onClick={()=>{const l=leads.find(x=>x.id===o.leadId);if(l){setSel(l);setView('detail');}}}>
                        <div style={{width:7,height:7,borderRadius:'50%',background:'#3b82f6',marginTop:4,flexShrink:0}}/>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.leadName}</div>
                          <div style={{fontSize:11,color:'#4b5563',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.note||'Outreach sendt'}</div>
                        </div>
                        <div style={{fontSize:11,color:'#4b5563',flexShrink:0}}>{fmtDate(o.date)}</div>
                      </div>
                    ))}
                  </div>
                )}
                {importBatches.length===0&&recentOutreaches.length===0&&<div style={{color:'#4b5563',fontSize:13}}>Ingen aktivitet endnu</div>}
              </div>
            </div>

            {/* Follow-up + no-email row */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>

              {/* Needs follow-up */}
              <div style={{...CC.card,padding:20}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                  <div style={{fontSize:13,fontWeight:600,color:'#9ca3af'}}>Opfølgning mangler</div>
                  <span style={{fontSize:11,color:'#4b5563'}}>ældste outreach først</span>
                </div>
                {needFollowUp.length===0&&<div style={{color:'#4b5563',fontSize:13}}>Ingen afventende leads</div>}
                {needFollowUp.map((l,i)=>(
                  <div key={l.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:i<needFollowUp.length-1?'1px solid #0d1420':'none',cursor:'pointer'}}
                    onClick={()=>{setSel(l);setView('detail');}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.name}</div>
                      <div style={{fontSize:11,color:'#4b5563'}}>{l.category}</div>
                    </div>
                    <div style={{fontSize:11,color:l.lastOtrDate?'#f59e0b':'#ef4444',flexShrink:0}}>{l.lastOtrDate?fmtDate(l.lastOtrDate):'Ingen dato'}</div>
                  </div>
                ))}
                {needFollowUp.length>0&&<button className="btn btn-g" style={{fontSize:11,marginTop:10,width:'100%'}} onClick={()=>{setFStatus('outreach_done');setView('list');}}>Se alle outreach leads →</button>}
              </div>

              {/* Shopify OR leads without email */}
              <div style={{...CC.card,padding:20}}>
                {shopOK?(
                  <>
                    <div style={{fontSize:13,fontWeight:600,color:'#9ca3af',marginBottom:14}}>Shopify overblik</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
                      {[
                        {l:'Total omsætning',v:totalRev.toLocaleString('da-DK',{maximumFractionDigits:0})+' kr',c:'#22c55e'},
                        {l:'Betalte ordrer',v:paid.length,c:'#0ea5e9'},
                        {l:'Denne måned',v:revThis.toLocaleString('da-DK',{maximumFractionDigits:0})+' kr',c:'#f59e0b'},
                        {l:'Vækst vs. forrige',v:(growth>0?'+':'')+growth.toFixed(1)+'%',c:growth>=0?'#22c55e':'#ef4444'},
                      ].map(s=>(
                        <div key={s.l} style={{background:'#0d1420',borderRadius:8,padding:'10px 12px'}}>
                          <div style={{fontSize:10,color:'#4b5563',marginBottom:3}}>{s.l}</div>
                          <div style={{fontSize:16,fontWeight:700,color:s.c}}>{s.v}</div>
                        </div>
                      ))}
                    </div>
                    <MiniLineChart data={monthly}/>
                  </>
                ):(
                  <>
                    <div style={{fontSize:13,fontWeight:600,color:'#9ca3af',marginBottom:10}}>Hurtige genveje</div>
                    <div style={{display:'flex',flexDirection:'column',gap:8}}>
                      <button className="btn btn-g" style={{textAlign:'left',justifyContent:'flex-start',fontSize:12}} onClick={openAdd}>+ Tilføj nyt lead manuelt</button>
                      <button className="btn btn-g" style={{textAlign:'left',justifyContent:'flex-start',fontSize:12}} onClick={()=>setView('import')}>↑ Importér leads fra CSV</button>
                      <button className="btn btn-g" style={{textAlign:'left',justifyContent:'flex-start',fontSize:12}} onClick={()=>setView('shopify_settings')}>⚡ Tilslut Shopify</button>
                      {noEmail>0&&<button className="btn btn-g" style={{textAlign:'left',justifyContent:'flex-start',fontSize:12,color:'#ef4444',borderColor:'#ef444430'}} onClick={()=>{resetFiltersAndSort();setFMissingEmail(true);setView('list');}}>{noEmail} leads mangler email →</button>}
                    </div>
                  </>
                )}
              </div>
            </div>

            {shopOK&&(
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
                <div style={{...CC.card,padding:20}}><div style={{fontSize:13,fontWeight:600,color:'#9ca3af',marginBottom:14}}>Månedlig omsætning</div><MiniLineChart data={monthly}/></div>
                <div style={{...CC.card,padding:20}}><div style={{fontSize:13,fontWeight:600,color:'#9ca3af',marginBottom:14}}>Top produkter</div><HBarChart data={products}/></div>
              </div>
            )}

            {/* Leads pr. kategori */}
            <div style={{...CC.card,padding:20}}>
              <div style={{fontSize:13,fontWeight:600,color:'#9ca3af',marginBottom:14}}>Leads pr. kategori</div>
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                {catHierarchy.map(parent=>{
                  const total = leads.filter(l=>l.category===parent.name||parent.subs.includes(l.category)).length;
                  const wonC = leads.filter(l=>(l.category===parent.name||parent.subs.includes(l.category))&&l.status==='won').length;
                  const outC = leads.filter(l=>(l.category===parent.name||parent.subs.includes(l.category))&&l.status==='outreach_done').length;
                  if(!total) return null;
                  return(
                    <div key={parent.name} style={{...CC.inner,padding:'12px 16px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:parent.subs.length?10:0,cursor:'pointer'}}
                        onClick={()=>{setFCats(new Set([parent.name,...parent.subs]));setView('list');}}>
                        <span style={{fontSize:14,fontWeight:700}}>{parent.name}</span>
                        <span style={{fontSize:12,color:'#6b7280'}}>{total} leads · <span style={{color:'#22c55e'}}>{wonC} solgt</span> · <span style={{color:'#3b82f6'}}>{outC} outreach</span></span>
                      </div>
                      {parent.subs.length>0&&(
                        <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                          {parent.subs.map(sub=>{
                            const subLabel=sub.replace(parent.name,'').replace(/^\s*\(|\)\s*$/g,'').trim();
                            const cnt=leads.filter(l=>l.category===sub).length;
                            const won=leads.filter(l=>l.category===sub&&l.status==='won').length;
                            if(!cnt) return null;
                            return(
                              <div key={sub} style={{background:'#0a0f1e',border:'1px solid #1f2937',borderRadius:7,padding:'5px 10px',cursor:'pointer',fontSize:12}}
                                onClick={e=>{e.stopPropagation();setFCats(new Set([sub]));setView('list');}}>
                                <span style={{color:'#9ca3af'}}>{subLabel}</span>
                                <span style={{color:'#4b5563',marginLeft:6}}>{cnt}</span>
                                {won>0&&<span style={{color:'#22c55e',marginLeft:4}}>· {won} solgt</span>}
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
        {view==='shopify_settings'&&(
          <div style={{padding:28,maxWidth:520}}>
            <h2 style={{fontWeight:700,marginBottom:6}}>Shopify integration</h2>
            <div style={{color:'#4b5563',fontSize:13,marginBottom:22}}>Tilslut din butik for at se omsætning i dashboardet</div>
            <div style={{...CC.card,padding:22,marginBottom:14}}>
              <div style={{marginBottom:12}}><label>Butiks-URL (f.eks. min-butik.myshopify.com)</label><input className="inp" value={shopDomain} onChange={e=>setShopDomain(e.target.value)} placeholder="surfmore.myshopify.com"/></div>
              <div style={{marginBottom:16}}><label>Admin API Access Token</label><input className="inp" type="password" value={shopToken} onChange={e=>setShopToken(e.target.value)} placeholder="shpat_xxxxxxxx"/>
                <div style={{fontSize:11,color:'#4b5563',marginTop:5}}>Shopify Admin → Indstillinger → Apps → Udvikl apps → Admin API access token</div>
              </div>
              {shopError&&<div style={{background:'#ef444415',border:'1px solid #ef444430',borderRadius:8,padding:'10px 14px',fontSize:13,color:'#ef4444',marginBottom:12}}>{shopError}</div>}
              <div style={{display:'flex',gap:10}}>
                <button className="btn btn-p" onClick={connectShopify} disabled={shopLoading}>{shopLoading?'Forbinder...':'Tilslut'}</button>
                {shopOK&&<button className="btn btn-g" onClick={refreshShop}>Opdater data</button>}
              </div>
              {shopOK&&<div style={{fontSize:12,color:'#22c55e',marginTop:10}}>✓ Tilsluttet · {shopOrders.length} ordrer hentet</div>}
            </div>
            <div style={{...CC.card,padding:16,fontSize:12,color:'#4b5563',lineHeight:2}}>
              <div style={{fontWeight:600,color:'#9ca3af',marginBottom:6}}>Sådan opretter du API-nøgle:</div>
              1. Indstillinger → Apps og salgskanaler<br/>
              2. Udvikl apps → Opret en app<br/>
              3. Admin API scopes: read_orders, read_products<br/>
              4. Installér appen → kopiér Admin API access token
            </div>
          </div>
        )}

        {/* TEMPLATES */}
        {view==='templates'&&(
          <div style={{padding:28,display:'grid',gridTemplateColumns:'minmax(0,1.4fr) minmax(0,1fr)',gap:20,alignItems:'flex-start'}}>
            {/* Liste over templates */}
            <div style={{minWidth:0}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                <div>
                  <h2 style={{fontWeight:700,marginBottom:4}}>Mail templates</h2>
                  <div style={{fontSize:13,color:'#4b5563'}}>Gem dine standard outbound-mails med tokens og kategorier</div>
                </div>
                <button className="btn btn-p" onClick={openNewTemplate}>+ Ny template</button>
              </div>
              <div style={{...CC.card,padding:14}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                  <thead>
                    <tr style={{borderBottom:'1px solid #1f2937'}}>
                      {['Navn','Type','Sprog','Kategorier','Aktiv','Sidst opdateret',''].map(h=>(
                        <th key={h} style={{textAlign:'left',padding:'8px 10px',fontSize:11,textTransform:'uppercase',letterSpacing:0.5,color:'#4b5563'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(!templates||templates.length===0)&&(
                      <tr>
                        <td colSpan={7} style={{padding:18,fontSize:13,color:'#4b5563'}}>Ingen templates endnu. Klik &ldquo;Ny template&rdquo; for at oprette din første.</td>
                      </tr>
                    )}
                    {templates.map(t=>(
                      <tr key={t.id} style={{borderBottom:'1px solid #020617',cursor:'pointer',background:editTpl&&editTpl.id===t.id?'#020617':'transparent'}}
                        onClick={()=>openEditTemplate(t)}>
                        <td style={{padding:'8px 10px',fontWeight:600}}>{t.name}</td>
                        <td style={{padding:'8px 10px',color:'#9ca3af'}}>{t.type}</td>
                        <td style={{padding:'8px 10px',color:'#9ca3af'}}>{t.language?.toUpperCase()}</td>
                        <td style={{padding:'8px 10px',color:'#6b7280',fontSize:12,verticalAlign:'top'}}>
                          {(!(t.category_tags||[]).length)&&<span>Global</span>}
                          {(t.category_tags||[]).length>0&&(
                            <div style={{display:'flex',flexDirection:'column',gap:3,maxHeight:72,overflow:'hidden'}}>
                              {(t.category_tags||[]).slice(0,3).map(tag=>(
                                <div key={tag} style={{whiteSpace:'nowrap',textOverflow:'ellipsis',overflow:'hidden'}}>
                                  {tag}
                                </div>
                              ))}
                              {(t.category_tags||[]).length>3&&(
                                <div style={{fontSize:11,color:'#9ca3af'}}>
                                  +{(t.category_tags||[]).length-3} flere
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{padding:'8px 10px'}}>
                          <span style={{fontSize:11,padding:'2px 8px',borderRadius:999,background:t.active?'#14532d':'#111827',color:t.active?'#4ade80':'#6b7280',border:'1px solid '+(t.active?'#16a34a55':'#1f2937')}}>
                            {t.active?'Aktiv':'Arkiveret'}
                          </span>
                        </td>
                        <td style={{padding:'8px 10px',color:'#4b5563',fontSize:12}}>{(t.updated_at||t.created_at||'').slice(0,10)}</td>
                        <td style={{padding:'8px 6px',textAlign:'right'}}>
                          <button className="btn btn-d" style={{fontSize:11,padding:'4px 8px'}} onClick={e=>{e.stopPropagation();deleteTemplate(t);}}>Slet</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Editor / preview i højre kolonne */}
            <div style={{minWidth:0}}>
              <div style={{...CC.card,padding:18,marginBottom:14}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                  <div style={{fontSize:13,fontWeight:600}}>Editor</div>
                  {editTpl&&<span style={{fontSize:11,color:'#4b5563'}}>ID: {editTpl.id?.slice(0,8)||'ny'}</span>}
                </div>
                {!editTpl&&(
                  <div style={{fontSize:13,color:'#4b5563'}}>Vælg en template i listen til venstre, eller klik &ldquo;Ny template&rdquo;.</div>
                )}
                {editTpl&&(
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    <div>
                      <label>Navn</label>
                      <input className="inp" value={editTpl.name} onChange={e=>setEditTpl({...editTpl,name:e.target.value})}/>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1.1fr 0.9fr',gap:8}}>
                      <div>
                        <label>Type</label>
                        <select className="inp" value={editTpl.type} onChange={e=>setEditTpl({...editTpl,type:e.target.value})}>
                          <option value="cold_outreach">Cold outreach</option>
                          <option value="follow_up">Follow-up</option>
                          <option value="re_engage">Re-engage</option>
                          <option value="partner_intro">Intro partner</option>
                          <option value="offer">Tilbud</option>
                        </select>
                      </div>
                      <div>
                        <label>Sprog</label>
                        <select className="inp" value={editTpl.language} onChange={e=>setEditTpl({...editTpl,language:e.target.value})}>
                          <option value="da">Dansk</option>
                          <option value="en">Engelsk</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label>Fra-email (valgfri)</label>
                      <input className="inp" value={editTpl.from_email||''} onChange={e=>setEditTpl({...editTpl,from_email:e.target.value})} placeholder="f.eks. jeppe@surfmore.dk"/>
                    </div>
                    <div>
                      <label>Knyttet til kategorier (valgfri)</label>
                      <div style={{position:'relative',marginBottom:6}}>
                        <button type="button" className="btn btn-g" style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 10px',fontSize:13}}
                          onClick={()=>setTplCatOpen(o=>!o)}>
                          <span style={{color:tplCats.size?'#e5e7eb':'#6b7280'}}>
                            {tplCats.size?`${tplCats.size} valgt`:'Alle kategorier (global)'}
                          </span>
                          <span style={{fontSize:10}}>{tplCatOpen?'▲':'▼'}</span>
                        </button>
                        {tplCatOpen&&(
                          <div style={{position:'absolute',zIndex:300,top:'calc(100% + 4px)',left:0,right:0,background:'#020617',border:'1px solid #1f2937',borderRadius:10,boxShadow:'0 10px 30px rgba(0,0,0,0.6)',maxHeight:260,overflow:'hidden',display:'flex',flexDirection:'column'}}
                            onMouseLeave={()=>setTplCatOpen(false)}>
                            <div style={{padding:'6px 8px',borderBottom:'1px solid #1f2937',display:'flex',gap:6,alignItems:'center'}}>
                              <input className="inp" style={{flex:1,padding:'5px 8px',fontSize:12}} placeholder="Søg kategori..." value={tplCatSearch} onChange={e=>setTplCatSearch(e.target.value)}/>
                              <button className="btn btn-g" style={{fontSize:11,padding:'3px 6px'}} onClick={()=>{setTplCats(new Set());setTplCatSearch('');}}>Ryd</button>
                              <button className="btn btn-g" style={{fontSize:11,padding:'3px 6px'}} onClick={()=>setTplCatOpen(false)}>Luk</button>
                            </div>
                            <div style={{padding:'4px 0',overflowY:'auto'}}>
                              {catHierarchy.filter(parent=>{
                                if(!tplCatSearch) return true;
                                const q=tplCatSearch.toLowerCase();
                                if(parent.name.toLowerCase().includes(q)) return true;
                                return parent.subs.some(s=>s.toLowerCase().includes(q));
                              }).map(parent=>{
                                const catsForParent = parent.subs.length? parent.subs : [parent.name];
                                const allSelected = catsForParent.every(c=>tplCats.has(c));
                                const someSelected = !allSelected && catsForParent.some(c=>tplCats.has(c));
                                return(
                                  <div key={parent.name} style={{borderBottom:'1px solid #020617'}}>
                                    <button
                                      type="button"
                                      style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 10px',background:someSelected||allSelected?'#0ea5e910':'transparent',border:'none',color:'#e5e7eb',fontSize:13,cursor:'pointer'}}
                                      onClick={()=>{const n=new Set(tplCats); if(allSelected){catsForParent.forEach(c=>n.delete(c));} else {catsForParent.forEach(c=>n.add(c));} setTplCats(n);}}
                                    >
                                      <span>{parent.name}</span>
                                      <span style={{fontSize:11,color:'#9ca3af'}}>{allSelected?'✓':someSelected?'~':''}</span>
                                    </button>
                                    {parent.subs.length>0&&(
                                      <div style={{padding:'2px 4px 6px'}}>
                                        {parent.subs.map(sub=>{
                                          const sel = tplCats.has(sub);
                                          const subLabel=sub.replace(parent.name,'').replace(/^\s*\(|\)\s*$/g,'').trim();
                                          return(
                                            <button key={sub} type="button" style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'4px 12px',background:sel?'#0ea5e908':'transparent',border:'none',color:sel?'#e5e7eb':'#9ca3af',fontSize:12,cursor:'pointer'}}
                                              onClick={()=>{const n=new Set(tplCats);sel?n.delete(sub):n.add(sub);setTplCats(n);}}>
                                              <span>{subLabel}</span>
                                              {sel&&<span style={{fontSize:11}}>✓</span>}
                                            </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                              {!allCats.length&&<div style={{padding:'8px 10px',fontSize:11,color:'#4b5563'}}>Ingen kategorier endnu – importer eller opret leads først.</div>}
                            </div>
                            <div style={{padding:'6px 8px',borderTop:'1px solid #1f2937',display:'flex',gap:6}}>
                              <input className="inp" style={{flex:1,padding:'7px 9px',fontSize:12,background:'#020617',borderColor:'#2563eb'}} placeholder="Egen label (fx Produkt: Wings)" value={tplCatCustom} onChange={e=>setTplCatCustom(e.target.value)}/>
                              <button className="btn btn-p" style={{fontSize:11,padding:'4px 10px'}} onClick={()=>{if(!tplCatCustom.trim())return;const n=new Set(tplCats);n.add(tplCatCustom.trim());setTplCats(n);setTplCatCustom('');}}>Tilføj</button>
                            </div>
                          </div>
                        )}
                      </div>
                      {(tplCats.size>0)&&(
                        <div style={{display:'flex',flexWrap:'wrap',gap:6,maxHeight:72,overflowY:'auto'}}>
                          {[...tplCats].map(tag=>(
                            <span key={tag} style={{padding:'3px 8px',borderRadius:999,background:'#020617',border:'1px solid #1f2937',fontSize:11,color:'#e5e7eb',maxWidth:200,whiteSpace:'nowrap',textOverflow:'ellipsis',overflow:'hidden'}}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <label>Subject</label>
                      <input className="inp" value={editTpl.subject} onChange={e=>setEditTpl({...editTpl,subject:e.target.value})} placeholder="f.eks. Samarbejde med Surfmore?"/>
                    </div>
                    <div>
                      <label>Body (understøtter &#123;&#123;tokens&#125;&#125;)</label>
                      <textarea
                        className="inp"
                        rows={7}
                        value={editTpl.body}
                        onChange={e=>setEditTpl({...editTpl,body:e.target.value})}
                        style={{resize:'vertical',fontFamily:'monospace',fontSize:12}}
                        placeholder={'Hej {{lead.contact_person | default:"der"}} ...'}
                      />
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:4}}>
                      <label style={{display:'flex',alignItems:'center',gap:6}}>
                        <input type="checkbox" checked={editTpl.active!==false} onChange={e=>setEditTpl({...editTpl,active:e.target.checked})}/>
                        <span style={{fontSize:12,color:'#9ca3af'}}>Aktiv</span>
                      </label>
                      <button className="btn btn-p" style={{fontSize:12,padding:'7px 16px'}} disabled={saving} onClick={saveTemplate}>{saving?'Gemmer...':'Gem template'}</button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{...CC.card,padding:16}}>
                <div style={{fontSize:13,fontWeight:600,marginBottom:6}}>Tokens</div>
                <div style={{fontSize:11,color:'#6b7280',marginBottom:8}}>
                  Brug tokens til at personalisere mails. Skriv f.eks. <code style={{fontFamily:'monospace'}}>Hej {'{{lead.name}}'}</code> i body.
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:6,fontSize:11}}>
                  {['{{lead.name}}','{{lead.category}}','{{lead.country}}','{{lead.contact_person | default:"der"}}','{{user.name}}','{{company.name}}','{{lead.notes_last}}'].map(t=>(
                    <span key={t} style={{padding:'2px 6px',borderRadius:6,background:'#020617',border:'1px solid #1f2937',color:'#9ca3af'}}>{t}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SETTINGS */}
        {view==='settings'&&(
          <div style={{padding:28,maxWidth:680}}>
            <h2 style={{fontWeight:700,marginBottom:6}}>Indstillinger</h2>
            <div style={{color:'#4b5563',fontSize:13,marginBottom:24}}>Administrer data, kategorier og lande</div>

            {/* Danger zone */}
            <div style={{...CC.card,padding:20,marginBottom:16,border:'1px solid #ef444430'}}>
              <div style={{fontSize:13,fontWeight:700,color:'#ef4444',marginBottom:12}}>Slet alle leads</div>
              <div style={{fontSize:12,color:'#6b7280',marginBottom:12}}>Sletter permanent alle {leads.length} leads og tilhørende outreaches. Kan ikke fortrydes.</div>
              <button className="btn btn-d" disabled={saving||leads.length===0} onClick={deleteAllLeads}>{saving?'Sletter...':'Slet alle '+leads.length+' leads'}</button>
            </div>

            {/* Kategori management */}
            <div style={{...CC.card,padding:20,marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:700,color:'#e2e8f0',marginBottom:4}}>Kategorier</div>
              <div style={{fontSize:12,color:'#4b5563',marginBottom:14}}>{allCats.length} kategorier · klik på en kategori for at omdøbe eller slette den</div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {allCats.map(cat=>{
                  const cnt=leads.filter(l=>l.category===cat).length;
                  const isEditing=settingsRename[cat]!==undefined;
                  return(
                    <div key={cat} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',background:'#0d1420',borderRadius:8,border:'1px solid #1a2332'}}>
                      {isEditing?(
                        <>
                          <input className="inp" style={{flex:1,padding:'4px 8px',fontSize:13}} value={settingsRename[cat]} onChange={e=>setSettingsRename(r=>({...r,[cat]:e.target.value}))}
                            onKeyDown={e=>{if(e.key==='Enter'){renameCategory(cat,settingsRename[cat]);setSettingsRename(r=>{const n={...r};delete n[cat];return n;});}if(e.key==='Escape')setSettingsRename(r=>{const n={...r};delete n[cat];return n;});}}/>
                          <button className="btn btn-p" style={{fontSize:11,padding:'4px 10px'}} onClick={()=>{renameCategory(cat,settingsRename[cat]);setSettingsRename(r=>{const n={...r};delete n[cat];return n;});}}>Gem</button>
                          <button className="btn btn-g" style={{fontSize:11,padding:'4px 8px'}} onClick={()=>setSettingsRename(r=>{const n={...r};delete n[cat];return n;})}>Annuller</button>
                        </>
                      ):(
                        <>
                          <span style={{flex:1,fontSize:13}}>{cat}</span>
                          <span style={{fontSize:11,color:'#4b5563'}}>{cnt} leads</span>
                          <button className="btn btn-g" style={{fontSize:11,padding:'3px 8px'}} onClick={()=>setSettingsRename(r=>({...r,[cat]:cat}))}>Omdøb</button>
                          <button className="btn btn-d" style={{fontSize:11,padding:'3px 8px'}} onClick={()=>deleteCategoryLeads(cat)}>Slet</button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Lande */}
            <div style={{...CC.card,padding:20}}>
              <div style={{fontSize:13,fontWeight:700,color:'#e2e8f0',marginBottom:4}}>Lande i databasen</div>
              <div style={{fontSize:12,color:'#4b5563',marginBottom:14}}>Lande opdages automatisk ved import</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                {allCountries.map(c=>(
                  <div key={c} style={{background:'#0d1420',border:'1px solid #1a2332',borderRadius:7,padding:'6px 14px',fontSize:13}}>
                    {c} · <span style={{color:'#4b5563'}}>{leads.filter(l=>l.country===c).length} leads</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* IMPORT */}
        {view==='import'&&(
          <div style={{padding:28,maxWidth:760}}>
            <h2 style={{fontWeight:700,marginBottom:20}}>Importér leads</h2>
            <div style={{...CC.card,padding:22}}>
              <div style={{background:'#080d18',border:'1px solid #1a2332',borderRadius:8,padding:'10px 14px',marginBottom:14,fontSize:12,color:'#4b5563',fontFamily:'monospace'}}>
                Format: Navn · Kategori · Underkategori · Land · Mail · Telefon · By · B2B Outreach (gentages pr. outreach) · Salg/Udbytte · evt. Kontaktperson
              </div>
              <div style={{marginBottom:12}}>
                <label>Upload fil (CSV / TSV / TXT)</label>
                <input type="file" accept=".csv,.tsv,.txt" ref={fileRef} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{setIText(ev.target.result);setIPrev(runP(ev.target.result));};r.readAsText(f,'UTF-8');}} style={{display:'none'}}/>
                <button className="btn btn-g" style={{marginTop:6}} onClick={()=>fileRef.current.click()}>Vælg fil</button>
              </div>
              <div style={{marginBottom:14}}>
                <label>Eller indsæt data direkte</label>
                <textarea className="inp" rows={6} value={iText} onChange={e=>{setIText(e.target.value);setIPrev(runP(e.target.value));}} style={{resize:'vertical',fontFamily:'monospace',fontSize:12}} placeholder="Navn,Kategori,Underkategori,Land,Mail,Telefon,By,B2B Outreach 1,B2B Outreach 2,B2B Outreach 3,Salg/Udbytte"/>
              </div>
              {iPrev.length>0&&(
                <div>
                  <div style={{fontSize:13,color:'#6b7280',marginBottom:10,display:'flex',gap:16}}>
                    <span>Preview: <strong style={{color:'#e2e8f0'}}>{iPrev.length}</strong> leads</span>
                    <span style={{color:'#22c55e'}}>Solgt: {iPrev.filter(l=>l.status==='won').length}</span>
                    <span style={{color:'#f59e0b'}}>Outreach: {iPrev.filter(l=>l._outreaches?.length>0).length}</span>
                    <span style={{color:'#ef4444'}}>Ingen email: {iPrev.filter(l=>!l.email).length}</span>
                  </div>
                  <div style={{maxHeight:240,overflow:'auto',marginBottom:14,border:'1px solid #1f2937',borderRadius:8}}>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                      <thead><tr style={{background:'#080d18',position:'sticky',top:0}}>
                        {['Navn','Email','By','Status','Outreach','Salg'].map(h=><th key={h} style={{padding:'7px 10px',textAlign:'left',color:'#4b5563',fontWeight:700,fontSize:10,textTransform:'uppercase',borderBottom:'1px solid #1f2937'}}>{h}</th>)}
                      </tr></thead>
                      <tbody>{iPrev.map((l,i)=>(
                        <tr key={i} style={{borderBottom:'1px solid #0d1420',background:i%2?'#ffffff03':'transparent'}}>
                          <td style={{padding:'5px 10px',fontWeight:600,maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.name}</td>
                          <td style={{padding:'5px 10px',color:l.email?'#38bdf8':'#ef4444',maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.email||'mangler'}</td>
                          <td style={{padding:'5px 10px',color:'#4b5563'}}>{l.city||'—'}</td>
                          <td style={{padding:'5px 10px'}}><StatusBadge value={l.status}/></td>
                          <td style={{padding:'5px 10px',color:'#f59e0b'}}>{l._outreaches?.length>0?l._outreaches.length+'x':'—'}</td>
                          <td style={{padding:'5px 10px',color:l.sale_info?'#22c55e':'#4b5563',maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.sale_info||l.product||'—'}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <button className="btn btn-p" disabled={saving} onClick={importLeads}>{saving?'Importerer...':'Importér '+iPrev.length+' leads → Supabase'}</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ADD/EDIT */}
        {view==='add'&&editLead&&(
          <div style={{padding:28,maxWidth:640}}>
            <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:18}}>
              <button className="btn btn-g" onClick={()=>{setView('list');setEditLead(null);}}>Tilbage</button>
              <h2 style={{fontWeight:700}}>{leads.find(l=>l.id===editLead.id)?'Rediger lead':'Nyt lead'}</h2>
            </div>
            <div style={{...CC.card,padding:22}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                {[['Navn *','name','text'],['Email','email','email'],['Telefon','phone','text'],['By','city','text']].map(([lb,k,t])=>(
                  <div key={k}><label>{lb}</label><input className="inp" type={t} value={editLead[k]||''} onChange={e=>setEditLead({...editLead,[k]:e.target.value})}/></div>
                ))}
                <div><label>Kategori</label><input className="inp" value={editLead.category||''} onChange={e=>setEditLead({...editLead,category:e.target.value})} list="cat-list"/><datalist id="cat-list">{allCats.map(c=><option key={c} value={c}/>)}</datalist></div>
                <div><label>Land</label><input className="inp" value={editLead.country||''} onChange={e=>setEditLead({...editLead,country:e.target.value})} list="country-list"/><datalist id="country-list">{[...new Set([...COUNTRIES,...allCountries])].sort().map(c=><option key={c} value={c}/>)}</datalist></div>
                <div><label>Status</label><select className="inp" value={editLead.status} onChange={e=>setEditLead({...editLead,status:e.target.value})}>{STATUS_OPTIONS.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
                <div><label>Kontaktperson</label><input className="inp" value={editLead.contact_person||''} onChange={e=>setEditLead({...editLead,contact_person:e.target.value})}/></div>
              </div>
              <div style={{marginTop:12}}><label>Produkt</label><input className="inp" value={editLead.product||''} onChange={e=>setEditLead({...editLead,product:e.target.value})}/></div>
              <div style={{marginTop:12}}><label>Salg info</label><input className="inp" value={editLead.sale_info||''} onChange={e=>setEditLead({...editLead,sale_info:e.target.value})}/></div>
              <div style={{marginTop:12}}><label>Noter</label><textarea className="inp" rows={3} value={editLead.notes||''} onChange={e=>setEditLead({...editLead,notes:e.target.value})} style={{resize:'vertical'}}/></div>
              <div style={{display:'flex',gap:8,marginTop:14}}>
                <button className="btn btn-p" disabled={saving} onClick={saveLead}>{saving?'Gemmer...':'Gem'}</button>
                <button className="btn btn-g" onClick={()=>{setView('list');setEditLead(null);}}>Annuller</button>
              </div>
            </div>
          </div>
        )}

        {/* DETAIL */}
        {view==='detail'&&sel&&(
          <div style={{padding:28,maxWidth:640}}>
            <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:18}}>
              <button className="btn btn-g" onClick={()=>setView('list')}>Tilbage</button>
              <h2 style={{fontWeight:700,flex:1}}>{sel.name}</h2>
              <button className="btn btn-g" onClick={()=>openEdit(sel)}>Rediger</button>
              <button className="btn btn-d" onClick={()=>delLead(sel.id)}>Slet</button>
            </div>
            {!sel.email&&(
              <div style={{background:'#ef444415',border:'1px solid #ef444430',borderRadius:10,padding:'12px 16px',marginBottom:12,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <span style={{fontSize:13,color:'#ef4444'}}>Ingen email på dette lead</span>
                <button className="btn btn-p" style={{fontSize:12,padding:'5px 12px'}} onClick={()=>openEdit(sel)}>Tilføj email</button>
              </div>
            )}
            <div style={{...CC.card,padding:20,marginBottom:12}}>
              <div style={{display:'grid',gridTemplateColumns:'minmax(0,2fr) minmax(0,1.6fr)',gap:18}}>
                <div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                    {[['Email',sel.email],['Telefon',sel.phone],['By',sel.city],['Land',sel.country],['Kategori',sel.category],['Kontaktperson',sel.contact_person]].map(([lb,v])=>(
                      <div key={lb}><div style={{fontSize:11,color:'#4b5563',marginBottom:2}}>{lb}</div><div style={{fontSize:14,color:lb==='Email'&&!v?'#ef4444':undefined}}>{v||'—'}</div></div>
                    ))}
                  </div>
                  {sel.product&&<div style={{background:'#1e40af15',border:'1px solid #1e40af30',borderRadius:8,padding:'8px 12px',fontSize:13,color:'#93c5fd',marginBottom:8}}>Produkt: {sel.product}</div>}
                  {sel.sale_info&&(
                    <div style={{background:'#14532d15',border:'1px solid #14532d30',borderRadius:8,padding:'8px 12px',fontSize:13,color:'#4ade80',marginBottom:8,display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
                      <span>Salg: {sel.sale_info}</span>
                      <button className="btn btn-g" style={{fontSize:11,padding:'4px 10px'}} onClick={()=>clearSale(sel)}>Fjern salg</button>
                    </div>
                  )}
                </div>
                <div>
                  <div style={{fontSize:11,color:'#4b5563',marginBottom:6}}>Noter</div>
                  <div style={{maxHeight:140,overflowY:'auto',border:'1px solid #1f2937',borderRadius:8,marginBottom:8,background:'#080d18'}}>
                    {notesList.length===0&&<div style={{fontSize:12,color:'#4b5563',padding:'8px 10px'}}>Ingen noter endnu</div>}
                    {notesList.map(n=>(
                      <div key={n.id} style={{padding:'8px 10px',borderBottom:'1px solid #020617',display:'flex',gap:8}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,fontWeight:600,color:'#e5e7eb',marginBottom:2,whiteSpace:'nowrap',textOverflow:'ellipsis',overflow:'hidden'}}>{n.title||'Note'}</div>
                          {n.created_at&&<div style={{fontSize:10,color:'#6b7280',marginBottom:2}}>{fmtDate((n.created_at||'').slice(0,10))}</div>}
                          {n.text&&<div style={{fontSize:12,color:'#9ca3af',whiteSpace:'pre-line'}}>{n.text}</div>}
                        </div>
                        <button className="btn btn-d" style={{fontSize:10,padding:'3px 6px',alignSelf:'flex-start'}} onClick={()=>deleteDetailNote(sel,n.id)}>×</button>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:11,color:'#4b5563',marginBottom:4}}>Tilføj note</div>
                  <input className="inp" style={{marginBottom:6,fontSize:13}} placeholder="Titel (f.eks. Telefonnotat)" value={noteTitle} onChange={e=>setNoteTitle(e.target.value)}/>
                  <textarea className="inp" rows={3} value={noteBody} onChange={e=>setNoteBody(e.target.value)} style={{resize:'vertical',fontSize:13}} placeholder="Skriv ekstra info om leadet her"/>
                  <div style={{marginTop:6,display:'flex',justifyContent:'flex-end'}}>
                    <button className="btn btn-p" style={{fontSize:11,padding:'5px 12px'}} disabled={saving} onClick={()=>addDetailNote(sel)}>{saving?'Gemmer...':'Gem note'}</button>
                  </div>
                </div>
              </div>
            </div>
            <div style={{...CC.card,padding:18,marginBottom:12}}>
              <div className="sl">Status</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {STATUS_OPTIONS.map(s=>(
                  <button key={s.value} onClick={()=>updSt(sel,s.value)} style={{cursor:'pointer',border:'1px solid '+(sel.status===s.value?s.color:'#1f2937'),background:sel.status===s.value?s.color+'22':'transparent',color:sel.status===s.value?s.color:'#4b5563',borderRadius:7,padding:'6px 13px',fontSize:12,fontWeight:600}}>{s.label}</button>
                ))}
              </div>
            </div>
            <div style={{...CC.card,padding:20}}>
              <div className="sl">Outreach log ({(sel.outreaches||[]).length})</div>
              {!(sel.outreaches||[]).length&&<div style={{color:'#4b5563',fontSize:13,marginBottom:14}}>Ingen outreach endnu</div>}
              {(sel.outreaches||[]).map(o=>(
                <div key={o.id} style={{borderBottom:'1px solid #0d1420',paddingBottom:10,marginBottom:10}}>
                  {editOtrId===o.id?(
                    <div style={{background:'#080d18',borderRadius:8,padding:12}}>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
                        <div><label>Dato</label><input className="inp" type="date" value={editOtr.date} onChange={e=>setEditOtr({...editOtr,date:e.target.value})}/></div>
                        <div><label>Af</label><input className="inp" value={editOtr.by} onChange={e=>setEditOtr({...editOtr,by:e.target.value})}/></div>
                      </div>
                      <div style={{marginBottom:8}}><label>Outreach besked</label><input className="inp" value={editOtr.note||''} onChange={e=>setEditOtr({...editOtr,note:e.target.value})}/></div>
                      <div style={{marginBottom:10}}><label>Salg</label><input className="inp" value={editOtr.sale_info||''} onChange={e=>setEditOtr({...editOtr,sale_info:e.target.value})} placeholder="f.eks. Solgt 15 stk"/></div>
                      <div style={{display:'flex',gap:8}}>
                        <button className="btn btn-p" style={{padding:'6px 14px',fontSize:12}} onClick={()=>saveEditOtr(sel)}>Gem</button>
                        <button className="btn btn-g" style={{padding:'6px 12px',fontSize:12}} onClick={()=>{setEditOtrId(null);setEditOtr(null);}}>Annuller</button>
                      </div>
                    </div>
                  ):(
                    <div style={{display:'flex',alignItems:'flex-start',gap:10}}>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:2}}>
                          <span style={{fontSize:13,fontWeight:600}}>{o.by}</span>
                          <span style={{fontSize:12,color:'#4b5563'}}>· {fmtDate(o.date)}</span>
                          {o.sale_info&&<span style={{fontSize:11,color:'#4ade80',background:'#14532d15',border:'1px solid #14532d30',borderRadius:4,padding:'1px 6px'}}>Salg</span>}
                        </div>
                        {o.note&&<div style={{fontSize:12,color:'#6b7280'}}>{o.note}</div>}
                        {o.sale_info&&<div style={{fontSize:12,color:'#4ade80',marginTop:2}}>{o.sale_info}</div>}
                      </div>
                      <div style={{display:'flex',gap:5}}>
                        <button className="btn btn-g" style={{padding:'3px 9px',fontSize:11}} onClick={()=>{setEditOtrId(o.id);setEditOtr({...o});}}>Rediger</button>
                        <button className="btn btn-d" style={{padding:'3px 8px',fontSize:11}} onClick={()=>delOtr(sel,o.id)}>×</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div style={{paddingTop:14,borderTop:'1px solid #0d1420'}}>
                <div className="sl">Tilføj outreach</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
                  <div><label>Dato *</label><input className="inp" type="date" value={newOtr.date} onChange={e=>setNewOtr({...newOtr,date:e.target.value})}/></div>
                  <div><label>Af</label><input className="inp" value={newOtr.by} onChange={e=>setNewOtr({...newOtr,by:e.target.value})}/></div>
                </div>
                <div style={{marginBottom:8}}><label>Outreach besked</label><input className="inp" value={newOtr.note} onChange={e=>setNewOtr({...newOtr,note:e.target.value})} placeholder="f.eks. Email sendt med katalog"/></div>
                <div style={{marginBottom:12}}><label>Salg (sætter status til Solgt automatisk)</label><input className="inp" value={newOtr.sale_info} onChange={e=>setNewOtr({...newOtr,sale_info:e.target.value})} placeholder="f.eks. Solgt 20 stk vandkikkerter" style={{borderColor:newOtr.sale_info?'#22c55e55':''}}/></div>
                <button className="btn btn-p" onClick={()=>addOtr(sel)}>Tilføj outreach</button>
              </div>
            </div>
          </div>
        )}

        {/* LIST */}
        {view==='list'&&(
          <div style={{padding:28}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <h2 style={{fontWeight:700}}>Leads</h2>
              <div style={{display:'flex',gap:8}}>
                {!bulk&&<button className="btn btn-v" onClick={()=>{setBulk(true);setBulkSel(new Set());}}>Bulk rediger</button>}
                {bulk&&<button className="btn btn-g" onClick={()=>{setBulk(false);setBulkSel(new Set());}}>Afslut bulk</button>}
                <button className="btn btn-p" onClick={openAdd}>+ Nyt lead</button>
              </div>
            </div>

            {bulk&&(
              <div style={{background:'#1e1b4b',border:'1px solid #4c1d9533',borderRadius:12,padding:'14px 18px',display:'flex',gap:14,alignItems:'flex-end',flexWrap:'wrap',marginBottom:16}}>
                <div>
                  <div style={{fontSize:11,color:'#a78bfa',fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,marginBottom:8}}>Bulk · {bulkSel.size} valgt</div>
                  <div style={{display:'flex',gap:8}}>
                    <button className="btn btn-g" style={{fontSize:12,padding:'5px 10px'}} onClick={()=>setBulkSel(new Set(filtered.map(l=>l.id)))}>Vælg alle ({filtered.length})</button>
                    <button className="btn btn-g" style={{fontSize:12,padding:'5px 10px'}} onClick={()=>setBulkSel(new Set())}>Fravælg alle</button>
                  </div>
                </div>
                <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'flex-end',flex:1}}>
                  <div><label>Sæt status</label><select className="inp" style={{width:150}} value={bulkSale.trim()?'won':bulkSt} onChange={e=>setBulkSt(e.target.value)} disabled={!!bulkSale.trim()}>{STATUS_OPTIONS.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
                  <div><label>Outreach dato</label><input className="inp" type="date" style={{width:140}} value={bulkDate} onChange={e=>setBulkDate(e.target.value)}/></div>
                  <div><label>Af</label><input className="inp" style={{width:90}} value={bulkBy} onChange={e=>setBulkBy(e.target.value)}/></div>
                  <div><label>Outreach besked</label><input className="inp" style={{width:180}} value={bulkNote} onChange={e=>setBulkNote(e.target.value)} placeholder="f.eks. Email sendt"/></div>
                  <div><label>Salg <span style={{color:'#22c55e',fontSize:10}}>(sætter automatisk → Solgt)</span></label><input className="inp" style={{width:180}} value={bulkSale} onChange={e=>setBulkSale(e.target.value)} placeholder="f.eks. Wingfoil pakke"/></div>
                  <button className="btn" style={{background:'#7c3aed',color:'#fff',padding:'8px 16px',alignSelf:'flex-end'}} disabled={saving} onClick={applyBulk}>{saving?'Gemmer...':'Anvend på '+bulkSel.size}</button>
                  <button className="btn btn-d" style={{padding:'8px 16px',alignSelf:'flex-end',fontSize:13}} disabled={saving} onClick={bulkDelete}>Slet valgte ({bulkSel.size})</button>
                </div>
              </div>
            )}

            <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
              <input className="inp" style={{maxWidth:200}} placeholder="Søg..." value={search} onChange={e=>setSearch(e.target.value)}/>

              {/* Hierarkisk kategori mega-menu */}
              <div style={{position:'relative'}}>
                <button className="btn btn-g" style={{whiteSpace:'nowrap',minWidth:170,textAlign:'left',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}
                  onClick={()=>{setCatOpen(o=>!o);setCatSearch('');}}>
                  <span>{fCats.size===0?'Alle kategorier':`${fCats.size} valgt`}</span>
                  <span style={{fontSize:10}}>{catOpen?'▲':'▼'}</span>
                </button>
                {catOpen&&(
                  <div style={{position:'absolute',top:'calc(100% + 4px)',left:0,zIndex:200,background:'#111827',border:'1px solid #1f2937',borderRadius:10,minWidth:280,maxHeight:440,display:'flex',flexDirection:'column',boxShadow:'0 8px 32px rgba(0,0,0,0.6)'}}>
                    <div style={{padding:'8px 10px',borderBottom:'1px solid #1f2937',display:'flex',gap:6,flexShrink:0}}>
                      <input className="inp" style={{flex:1,padding:'5px 9px',fontSize:12}} placeholder="Søg kategori..." value={catSearch} onChange={e=>setCatSearch(e.target.value)} autoFocus/>
                      <button className="btn btn-g" style={{fontSize:11,padding:'3px 8px',whiteSpace:'nowrap'}} onClick={()=>{setFCats(new Set());setCatSearch('');}}>Ryd</button>
                    </div>
                    <div style={{overflowY:'auto',padding:'4px 0'}}>
                    {catHierarchy.filter(p=> !catSearch || p.name.toLowerCase().includes(catSearch.toLowerCase()) || p.subs.some(s=>s.toLowerCase().includes(catSearch.toLowerCase()))).map(parent=>{
                      const parentSelected = fCats.has(parent.name);
                      const subSel = parent.subs.filter(s=>fCats.has(s)).length;
                      const allSubSel = parent.subs.length>0 && parent.subs.every(s=>fCats.has(s));
                      const hierExpanded = catHierOpen.has(parent.name);
                      const toggleParent = ()=>{
                        const n=new Set(fCats);
                        if(parent.subs.length===0){parentSelected?n.delete(parent.name):n.add(parent.name);}
                        else{if(allSubSel){parent.subs.forEach(s=>n.delete(s));n.delete(parent.name);}else{parent.subs.forEach(s=>n.add(s));n.add(parent.name);}}
                        setFCats(n);
                      };
                      const isSel = parent.subs.length===0?parentSelected:(subSel>0||parentSelected);
                      return(
                        <div key={parent.name}>
                          <div style={{display:'flex',alignItems:'center',padding:'7px 12px',cursor:'pointer',background:isSel?'#0ea5e910':'transparent',gap:6}}
                            onClick={parent.subs.length===0?toggleParent:()=>{const n=new Set(catHierOpen);n.has(parent.name)?n.delete(parent.name):n.add(parent.name);setCatHierOpen(n);}}>
                            <div style={{width:14,height:14,borderRadius:3,border:'1px solid '+(isSel?'#0ea5e9':'#374151'),background:isSel?'#0ea5e9':'transparent',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}
                              onClick={e=>{e.stopPropagation();toggleParent();}}>
                              {isSel&&<span style={{color:'#fff',fontSize:10,lineHeight:1}}>✓</span>}
                            </div>
                            <span style={{fontSize:13,fontWeight:600,flex:1,color:isSel?'#e2e8f0':'#9ca3af'}}>{parent.name}</span>
                            {parent.subs.length>0&&<span style={{fontSize:10,color:'#4b5563'}}>{subSel>0?`${subSel}/${parent.subs.length}`:''} {hierExpanded?'▲':'▼'}</span>}
                          </div>
                          {parent.subs.length>0&&hierExpanded&&parent.subs.map(sub=>{
                            const subLabel=sub.replace(parent.name,'').replace(/^\s*\(|\)\s*$/g,'').trim();
                            const sel=fCats.has(sub);
                            return(
                              <div key={sub} style={{display:'flex',alignItems:'center',gap:6,padding:'5px 12px 5px 32px',cursor:'pointer',background:sel?'#0ea5e908':'transparent'}}
                                onClick={()=>{const n=new Set(fCats);sel?n.delete(sub):n.add(sub);setFCats(n);}}>
                                <div style={{width:12,height:12,borderRadius:2,border:'1px solid '+(sel?'#0ea5e9':'#374151'),background:sel?'#0ea5e9':'transparent',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                                  {sel&&<span style={{color:'#fff',fontSize:9,lineHeight:1}}>✓</span>}
                                </div>
                                <span style={{fontSize:12,color:sel?'#e2e8f0':'#6b7280'}}>{subLabel}</span>
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

              <select className="inp" style={{maxWidth:155}} value={fStatus} onChange={e=>setFStatus(e.target.value)}><option value="Alle">Alle statusser</option>{STATUS_OPTIONS.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select>
              <select className="inp" style={{maxWidth:140}} value={fCountry} onChange={e=>setFCountry(e.target.value)}>
                <option value="Alle">Alle lande</option>
                {[...new Set([...COUNTRIES,...allCountries])].sort().map(c=><option key={c} value={c}>{c}</option>)}
              </select>
              <button className="btn btn-g" style={{fontSize:12,padding:'7px 14px',marginLeft:'auto'}} disabled={bulkSel.size===0} onClick={copyEmailsBulk}>
                Kopier emails ({bulkSel.size})
              </button>
              <button className="btn btn-v" style={{fontSize:12,padding:'7px 16px'}} onClick={resetFiltersAndSort}>Nulstil filtre</button>
              <span style={{fontSize:13,color:'#4b5563'}}>{filtered.length} leads</span>
            </div>

            <div style={{...CC.card,overflow:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead><tr style={{borderBottom:'1px solid #1f2937'}}>
                  {bulk&&<th style={{padding:'10px 8px 10px 14px',width:36}}></th>}
                  {[
                    {label:'Navn',key:'name'},
                    {label:'Kategori',key:'category'},
                    {label:'Email',key:'email'},
                    {label:'Land',key:'country'},
                    {label:'Status',key:'status'},
                    {label:'Outreach',key:'outreach'},
                    {label:'Salg',key:'sale'},
                  ].map(col=>{
                    const isActive = sortKey===col.key;
                    const arrow = isActive ? (sortDir==='asc'?'▲':'▼') : '↕';
                    return (
                      <th
                        key={col.key}
                        style={{padding:'10px 14px',textAlign:'left',color:isActive?'#e5e7eb':'#4b5563',fontWeight:700,fontSize:11,textTransform:'uppercase',letterSpacing:0.4,whiteSpace:'nowrap',cursor:'pointer'}}
                        onClick={()=>{
                          if(sortKey===col.key){
                            setSortDir(d=>d==='asc'?'desc':'asc');
                          }else{
                            setSortKey(col.key);
                            setSortDir(col.key==='outreach' ? 'desc' : 'asc');
                          }
                        }}
                      >
                        <span>{col.label}</span>
                        <span style={{marginLeft:4,fontSize:10,color:isActive?'#e5e7eb':'#6b7280'}}>{arrow}</span>
                      </th>
                    );
                  })}
                </tr></thead>
                <tbody>
                  {!sorted.length&&<tr><td colSpan={bulk?8:7} style={{padding:32,textAlign:'center',color:'#4b5563'}}>Ingen leads fundet. <button className="btn btn-g" onClick={openAdd} style={{marginLeft:8}}>+ Tilføj</button></td></tr>}
                  {sorted.map(lead=>(
                    <tr key={lead.id} className={bulk?'':'rh'} style={{borderBottom:'1px solid #0d1420',background:bulkSel.has(lead.id)?'#7c3aed10':'transparent',cursor:bulk?'default':'pointer'}}
                      onClick={()=>{if(!bulk){setSel(lead);setView('detail');}}}>
                      {bulk&&<td style={{padding:'10px 8px 10px 14px'}} onClick={e=>{e.stopPropagation();const n=new Set(bulkSel);n.has(lead.id)?n.delete(lead.id):n.add(lead.id);setBulkSel(n);}}>
                        <input type="checkbox" checked={bulkSel.has(lead.id)} readOnly style={{width:16,height:16,cursor:'pointer',accentColor:'#7c3aed'}}/>
                      </td>}
                      <td style={{padding:'10px 14px',fontWeight:600,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{lead.name}</td>
                      <td style={{padding:'10px 14px'}}><span className="tag">{lead.category}</span></td>
                      <td style={{padding:'10px 14px',maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{lead.email?<span style={{color:'#4b5563'}}>{lead.email}</span>:<span style={{color:'#ef4444',fontSize:11,fontWeight:600}}>+ Tilføj email</span>}</td>
                      <td style={{padding:'10px 14px',color:'#4b5563',whiteSpace:'nowrap'}}>{lead.country||'—'}</td>
                      <td style={{padding:'10px 14px'}}><StatusBadge value={lead.status}/></td>
                      <td style={{padding:'10px 14px',color:'#6b7280'}}>{(lead.outreaches||[]).length?<span style={{fontSize:12,lineHeight:1.6}}>{lead.outreaches.length}x{lead.outreaches.map(o=>o.date).filter(Boolean).map(d=><span key={d} style={{display:'block',fontSize:11,color:'#4b5563'}}>{fmtDate(d)}</span>)}</span>:<span style={{color:'#1f2937'}}>—</span>}</td>
                      <td style={{padding:'10px 14px'}}>{lead.sale_info?<span style={{color:'#4ade80',fontSize:12,fontWeight:600}}>{lead.sale_info.slice(0,32)}</span>:<span style={{color:'#1f2937'}}>—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SCRAPER */}
        {view==='scraper'&&(
          <div style={{padding:28}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div>
                <h2 style={{fontWeight:700,marginBottom:4}}>Lead scraper</h2>
                <div style={{fontSize:13,color:'#4b5563'}}>Indsæt URL’er, så henter vi emails og formaterer dem til import</div>
              </div>
              <button className="btn btn-p" onClick={sendScrapeToImport} disabled={!scrapeRows.length}>Send {scrapeRows.length||0} til import</button>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'minmax(0,1.1fr) minmax(0,1.1fr)',gap:18,marginBottom:18}}>
              <div style={{...CC.card,padding:18}}>
                <div className="sl">Kilder (URL’er)</div>
                <div style={{fontSize:12,color:'#6b7280',marginBottom:8}}>En URL pr. linje. Vi kigger også kort på kontakt‑sider på samme domæne.</div>
                <textarea
                  className="inp"
                  rows={8}
                  value={scrapeUrls}
                  onChange={e=>setScrapeUrls(e.target.value)}
                  placeholder={'https://eksempel.dk\nhttps://andet-site.dk/kontakt'}
                  style={{fontFamily:'monospace',fontSize:12,resize:'vertical'}}
                />
                <div style={{marginTop:10,display:'flex',gap:10}}>
                  <div style={{flex:1}}>
                    <label>Land</label>
                    <input className="inp" value={scrapeCountry} onChange={e=>setScrapeCountry(e.target.value)}/>
                  </div>
                  <div style={{flex:1}}>
                    <label>Standardkategori</label>
                    <input className="inp" value={scrapeCategory} onChange={e=>setScrapeCategory(e.target.value)} placeholder="f.eks. Pilatescentre"/>
                  </div>
                </div>
                <button className="btn btn-g" style={{marginTop:12}} onClick={runScrape} disabled={scrapeLoading}>
                  {scrapeLoading ? 'Scraper...' : 'Scrap emails'}
                </button>
              </div>

              <div style={{...CC.card,padding:18}}>
                <div className="sl">Importformat</div>
                <div style={{background:'#080d18',border:'1px solid #1a2332',borderRadius:8,padding:'8px 12px',marginBottom:10,fontSize:12,color:'#9ca3af',fontFamily:'monospace'}}>
                  Format: Navn · Kategori · Underkategori · Land · Mail · Telefon · By · B2B Outreach (gentages pr. outreach) · Salg/Udbytte · evt. Kontaktperson
                </div>
                <div style={{fontSize:12,color:'#6b7280',marginBottom:6}}>{scrapeRows.length} leads fundet. Du kan tilrette i import‑previewet bagefter.</div>
                <div style={{maxHeight:260,overflow:'auto',border:'1px solid #1f2937',borderRadius:8}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead>
                      <tr style={{background:'#020617',position:'sticky',top:0}}>
                        {['Navn','Kategori','Underkategori','Land','Mail','Telefon','By','Kontaktperson'].map(h=>(
                          <th key={h} style={{padding:'6px 8px',textAlign:'left',fontSize:10,textTransform:'uppercase',letterSpacing:0.5,color:'#4b5563',borderBottom:'1px solid #1f2937'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {!scrapeRows.length&&(
                        <tr><td colSpan={8} style={{padding:14,fontSize:12,color:'#4b5563'}}>Ingen leads endnu. Indsæt URL’er og tryk “Scrap emails”.</td></tr>
                      )}
                      {scrapeRows.map((r,i)=>(
                        <tr key={r.sourceUrl+':'+r.email+':'+i} style={{borderBottom:'1px solid #020617',background:i%2?'#020617':'transparent'}}>
                          <td style={{padding:'6px 8px',fontWeight:600,maxWidth:180,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.name}</td>
                          <td style={{padding:'6px 8px',color:'#9ca3af'}}>{r.category||scrapeCategory||'—'}</td>
                          <td style={{padding:'6px 8px',color:'#4b5563'}}>—</td>
                          <td style={{padding:'6px 8px',color:'#4b5563'}}>{r.country||scrapeCountry||'—'}</td>
                          <td style={{padding:'6px 8px',color:'#38bdf8'}}>{r.email}</td>
                          <td style={{padding:'6px 8px',color:'#4b5563'}}>{r.phone||'—'}</td>
                          <td style={{padding:'6px 8px',color:'#4b5563'}}>{r.city||'—'}</td>
                          <td style={{padding:'6px 8px',color:'#4b5563'}}>{r.contact_person||'—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
