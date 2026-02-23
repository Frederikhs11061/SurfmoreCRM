'use client';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

// ─── Constants ──────────────────────────────────────────────────────────────
const DEFAULT_CATEGORIES = [
  'Butik & Webshop','Skoler & klubber','Folkeskoler','Børnehaver','Efterskoler',
  'Gymnasium','Højskoler','Skateparks','Spejdergrupper','Kajakklubber',
  'Drager & Legetøj','Indkøbsforeninger','Havne','Naturskoler, centre & vejledere','Andet',
];
const DEFAULT_COUNTRIES = ['Danmark','Norge','Sverige'];
const STATUS_OPTIONS = [
  { value:'not_contacted', label:'Ikke kontaktet', color:'#64748b' },
  { value:'outreach_done', label:'Outreach sendt',  color:'#f59e0b' },
  { value:'in_dialogue',   label:'I dialog',        color:'#3b82f6' },
  { value:'won',           label:'Solgt',            color:'#22c55e' },
  { value:'lost',          label:'Tabt',             color:'#ef4444' },
  { value:'not_relevant',  label:'Ikke relevant',    color:'#6b7280' },
];
const DEFAULT_LEAD = {
  name:'',category:'Butik & Webshop',country:'Danmark',
  email:'',phone:'',city:'',status:'not_contacted',
  notes:'',sale_info:'',contact_person:'',product:'',
};
const DEFAULT_OTR = { date:'',by:'Jeppe',note:'',sale_info:'' };

// ─── CSV Parsing helpers ─────────────────────────────────────────────────────
function parseCSVFull(text) {
  // Full CSV parser that handles quoted fields with newlines
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i+1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

function isHeader(p){const l=p.map(x=>x.toLowerCase());return l.some(x=>x==='klubber'||x==='navn'||x==='name'||x==='mail'||x==='email'||x==='land');}
function findEmail(p){return p.findIndex(x=>/^[^\s@,]+@[^\s@,]+\.[^\s@,]{2,}$/.test(x.replace(/\s/g,'')));}

// Detect if a field is a sale/revenue field ("Købt X stk", "Solgt X stk", "Bestilt X stk")
function isSaleField(s){ return s && /købt|solgt|bestilt|leveret|faktura/i.test(s); }

// Extract outreach entries from a text field
function parseOtrField(raw, isSale=false) {
  if(!raw||!raw.trim()) return [];
  const dm = raw.match(/(\d{1,2}[\.\/-]\d{1,2}[\.\/-]?\d{0,4})/);
  const bm = raw.match(/^([A-Za-z\xC6\xE6\xD8\xF8\xC5\xE5\/]+)[\s\-–]+/);
  return [{
    date: dm ? dm[1] : '',
    by: bm ? bm[1].trim() : 'Jeppe',
    note: raw.trim(),
    sale_info: isSale ? raw.trim() : ''
  }];
}

// Map type string to CRM category
function mapCategory(type, defaultCat) {
  if(!type) return defaultCat;
  const t = type.toLowerCase();
  if(t.includes('vinterbade')||t.includes('badeklub')||t.includes('badelaug')||t.includes('saunaclub')||t.includes('saunaklub')) return 'Skoler & klubber';
  if(t.includes('kajak')) return 'Kajakklubber';
  if(t.includes('surf')||t.includes('wake')||t.includes('vandski')||t.includes('kite')||t.includes('sup')||t.includes('wind')||t.includes('sejlklub')||t.includes('blokart')) return 'Skoler & klubber';
  if(t.includes('spejder')) return 'Spejdergrupper';
  if(t.includes('efterskole')) return 'Efterskoler';
  if(t.includes('gymnasium')||t.includes('gym')) return 'Gymnasium';
  if(t.includes('folkeskole')||t.includes('grundskole')) return 'Folkeskoler';
  if(t.includes('børnehave')||t.includes('vuggestue')||t.includes('daginstitut')) return 'Børnehaver';
  if(t.includes('naturskole')||t.includes('naturcenter')||t.includes('friluft')) return 'Naturskoler, centre & vejledere';
  if(t.includes('skiklub')||t.includes('ski ')) return 'Skoler & klubber';
  if(t.includes('butik')||t.includes('webshop')||t.includes('shop')) return 'Butik & Webshop';
  if(t.includes('havn')) return 'Havne';
  if(t.includes('indkøb')) return 'Indkøbsforeninger';
  if(t.includes('drager')||t.includes('legetøj')) return 'Drager & Legetøj';
  return defaultCat;
}

// Detect country from string, add new ones dynamically
function detectCountry(raw, countries, defaultCountry) {
  if(!raw) return defaultCountry;
  const r = raw.trim();
  // Normalize common variants
  const norm = {'damark':'Danmark','dk':'Danmark','denmark':'Danmark','norway':'Norge','no':'Norge','sweden':'Sverige','se':'Sverige','se':'Sverige','finland':'Finland','fi':'Finland','germany':'Tyskland','de':'Tyskland','netherlands':'Holland','nl':'Holland','uk':'UK','gb':'UK','usa':'USA','us':'USA','france':'Frankrig','fr':'Frankrig','spain':'Spanien','es':'Spanien','poland':'Polen','pl':'Polen','faroe':'Færøerne','fo':'Færøerne'};
  const lo = r.toLowerCase();
  if(norm[lo]) return norm[lo];
  // Check if it matches any known country
  const known = countries.find(c => c.toLowerCase() === lo || lo.startsWith(c.toLowerCase()));
  if(known) return known;
  // If it looks like a country name (capitalized, no special chars), return it as new country
  if(r.length > 1 && r.length < 30 && /^[A-Za-zÆØÅæøåÄÖÜäöü\s\-]+$/.test(r) && r[0] === r[0].toUpperCase()) return r;
  return defaultCountry;
}

function parseLine(line, cat, country) {
  // Try to parse as structured 8-col format: Navn,Type,Land,Mail,Otr1,Otr2,Udbytte,Otr3
  // OR fall back to generic parsing
  const p = line; // already an array when called from parseCSVFull
  if(!Array.isArray(p) || p.length === 0 || (p.length === 1 && !p[0])) return null;
  if(isHeader(p)) return null;
  if(!p[0] && !p[3]) return null;

  const knownC = ['Danmark','Sverige','Norge'];

  // ── Detect structured format: col3 looks like email and col1 looks like a type ──
  const col3isEmail = p[3] && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p[3].replace(/\s/g,''));
  if (col3isEmail && p.length >= 5) {
    // Structured format: Navn | Type | Land | Mail | Otr... | Udbytte | Otr...
    const name = p[0] || '';
    const type = p[1] || '';
    const ctry = knownC.find(c => (p[2]||'').toLowerCase().startsWith(c.toLowerCase())) || country;
    const email = p[3].replace(/\s/g,'');
    const resolvedCat = mapCategory(type, cat);

    // Collect outreach columns (4,5,7) and udbytte/sale col (6)
    const otrFields = [p[4], p[5], p[7]].filter(x => x && x.trim() && !isSaleField(x));
    const saleField = [p[4], p[5], p[6], p[7]].find(x => isSaleField(x)) || '';

    const outreaches = [];
    for (const f of otrFields) { outreaches.push(...parseOtrField(f, false)); }
    if (saleField) { outreaches.push(...parseOtrField(saleField, true)); }

    const hasSale = !!saleField;
    const has15pct = [p[4],p[5],p[6],p[7]].some(x => x && x.includes('15%'));
    let status = 'not_contacted';
    if (hasSale) status = 'won';
    else if (has15pct) status = 'in_dialogue';
    else if (outreaches.length > 0) status = 'outreach_done';

    const sale_info = saleField || (has15pct ? '15% medlemsrabat aftalt' : '');

    if (!name && !email) return null;
    return { name, category: resolvedCat, country: ctry, email, phone:'', city:'', status, _outreaches: outreaches, notes: type ? 'Type: '+type : '', sale_info, contact_person:'', product:'' };
  }

  // ── Generic fallback: find email anywhere ──
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
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [countries, setCountries] = useState(DEFAULT_COUNTRIES);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('dashboard');
  const [sel, setSel] = useState(null);
  const [editLead, setEditLead] = useState(null);
  const [search, setSearch] = useState('');
  const [fCat, setFCat] = useState('Alle');
  const [fStatus, setFStatus] = useState('Alle');
  const [fCountry, setFCountry] = useState('Alle');
  const [newOtr, setNewOtr] = useState({...DEFAULT_OTR});
  const [editOtrId, setEditOtrId] = useState(null);
  const [editOtr, setEditOtr] = useState(null);
  const [iText, setIText] = useState('');
  const [iPrev, setIPrev] = useState([]);
  const [iCat, setICat] = useState('Butik & Webshop');
  const [iCountry, setICountry] = useState('Danmark');
  const [bulk, setBulk] = useState(false);
  const [bulkSel, setBulkSel] = useState(new Set());
  const [bulkSt, setBulkSt] = useState('outreach_done');
  const [bulkDate, setBulkDate] = useState('');
  const [bulkBy, setBulkBy] = useState('Jeppe');
  const [bulkNote, setBulkNote] = useState('');
  const [shopDomain, setShopDomain] = useState('');
  const [shopToken, setShopToken] = useState('');
  const [shopOrders, setShopOrders] = useState([]);
  const [shopLoading, setShopLoading] = useState(false);
  const [shopError, setShopError] = useState('');
  const [shopOK, setShopOK] = useState(false);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  // ── Load from Supabase ──────────────────────────────────────────────────
  useEffect(()=>{
    loadLeads();
  },[]);

  const loadLeads = async () => {
    setLoading(true);
    try {
      const { data: leadsData, error: leadsError } = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });
      if (leadsError) throw leadsError;

      const { data: outreachData, error: oError } = await supabase
        .from('outreaches')
        .select('*')
        .order('date', { ascending: true });
      if (oError) throw oError;

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
    out:leads.filter(l=>l.status==='outreach_done'||l.status==='in_dialogue').length,
    nc:leads.filter(l=>l.status==='not_contacted').length,
  };

  const runP = txt => {
    const rows = parseCSVFull(txt.trim());
    const dynCountries = [...countries];
    const dynCats = [...categories];
    const parsed = rows.map(row => {
      const result = parseLine(row, iCat, iCountry, dynCountries);
      if(!result) return null;
      // Collect new countries
      if(result.country && !dynCountries.includes(result.country)) dynCountries.push(result.country);
      // Collect new categories (from type mapping)
      if(result.category && !dynCats.includes(result.category)) dynCats.push(result.category);
      return result;
    }).filter(Boolean);
    return parsed;
  };

  const filtered = leads.filter(l=>{
    if(fCat!=='Alle'&&l.category!==fCat)return false;
    if(fStatus!=='Alle'&&l.status!==fStatus)return false;
    if(fCountry!=='Alle'&&l.country!==fCountry)return false;
    if(search){const q=search.toLowerCase();if(!l.name.toLowerCase().includes(q)&&!(l.email||'').toLowerCase().includes(q))return false;}
    return true;
  });

  const openAdd = () => { setEditLead({...DEFAULT_LEAD}); setView('add'); };
  const openEdit = l => { setEditLead({...l}); setView('add'); };

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
      const {error} = await supabase.from('leads').delete().eq('id',id);
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
      await supabase.from('leads').update({status:bulkSt}).in('id',ids);
      if(bulkDate){
        const rows=ids.map(id=>({lead_id:id,date:bulkDate,by:bulkBy,note:bulkNote,sale_info:''}));
        await supabase.from('outreaches').insert(rows);
      }
      await loadLeads();
      msg(bulkSel.size+' leads opdateret');
      setBulkSel(new Set()); setBulk(false);
    } catch(e) { msg('Fejl: '+e.message,'err'); }
    setSaving(false);
  };

  const importLeads = async () => {
    if(!iPrev.length) return;
    setSaving(true);
    try {
      for(const lead of iPrev){
        const {_outreaches,...leadData} = lead;
        const {data,error} = await supabase.from('leads').insert(leadData).select().single();
        if(error) throw error;
        if(_outreaches&&_outreaches.length>0){
          const rows=_outreaches.map(o=>({lead_id:data.id,...o}));
          await supabase.from('outreaches').insert(rows);
        }
      }
      await loadLeads();
      // Add any new categories or countries discovered during import
      const newCats = [...categories];
      const newCtries = [...countries];
      for(const lead of iPrev) {
        if(lead.category && !newCats.includes(lead.category)) newCats.push(lead.category);
        if(lead.country && !newCtries.includes(lead.country)) newCtries.push(lead.country);
      }
      if(newCats.length !== categories.length) setCategories(newCats);
      if(newCtries.length !== countries.length) setCountries(newCtries);
      setIText(''); setIPrev([]); setView('list');
      msg(iPrev.length+' leads importeret');
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
    {id:'shopify_settings',label:'Shopify'},
  ];

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
        {view==='dashboard'&&(
          <div style={{padding:28}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24}}>
              <div>
                <h1 style={{fontSize:22,fontWeight:700,marginBottom:3}}>Dashboard</h1>
                <div style={{color:'#4b5563',fontSize:13}}>Overblik over leads og omsætning</div>
              </div>
              <div style={{display:'flex',gap:8}}>
                {shopOK&&<button className="btn btn-g" onClick={refreshShop} disabled={shopLoading} style={{fontSize:12}}>{shopLoading?'Henter...':'Synk Shopify'}</button>}
                <button className="btn btn-g" onClick={loadLeads} style={{fontSize:12}}>↻ Opdater</button>
                <button className="btn btn-p" onClick={openAdd}>+ Nyt lead</button>
              </div>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:14}}>
              {[{l:'Totale leads',v:stats.total,c:'#6366f1'},{l:'Ikke kontaktet',v:stats.nc,c:'#6b7280'},{l:'I gang',v:stats.out,c:'#f59e0b'},{l:'Solgt',v:stats.won,c:'#22c55e'}].map(s=>(
                <div key={s.l} style={{...CC.card,padding:'18px 20px'}}>
                  <div style={{fontSize:10,color:s.c,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,marginBottom:6}}>{s.l}</div>
                  <div style={{fontSize:30,fontWeight:700,color:s.c}}>{s.v}</div>
                </div>
              ))}
            </div>

            {shopOK&&(
              <>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:14}}>
                  {[
                    {l:'Total omsætning',v:totalRev.toLocaleString('da-DK',{maximumFractionDigits:0})+' kr',c:'#22c55e',sub:(growth>0?'+':'')+growth.toFixed(1)+'% vs forrige måned'},
                    {l:'Betalte ordrer',v:paid.length,c:'#0ea5e9',sub:'Alle tider'},
                    {l:'Denne måned',v:revThis.toLocaleString('da-DK',{maximumFractionDigits:0})+' kr',c:'#f59e0b',sub:new Date().toLocaleString('da-DK',{month:'long',year:'numeric'})},
                  ].map(s=>(
                    <div key={s.l} style={{...CC.card,padding:'18px 20px'}}>
                      <div style={{fontSize:10,color:s.c,fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,marginBottom:6}}>{s.l}</div>
                      <div style={{fontSize:26,fontWeight:700,color:s.c,marginBottom:3}}>{s.v}</div>
                      <div style={{fontSize:11,color:'#4b5563'}}>{s.sub}</div>
                    </div>
                  ))}
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
                  <div style={{...CC.card,padding:20}}><div style={{fontSize:13,fontWeight:600,color:'#9ca3af',marginBottom:14}}>Månedlig omsætning</div><MiniLineChart data={monthly}/></div>
                  <div style={{...CC.card,padding:20}}><div style={{fontSize:13,fontWeight:600,color:'#9ca3af',marginBottom:14}}>Top produkter</div><HBarChart data={products}/></div>
                </div>
              </>
            )}

            {!shopOK&&(
              <div style={{...CC.card,padding:24,textAlign:'center',marginBottom:14}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:6}}>Tilslut Shopify for omsætnings-dashboard</div>
                <div style={{color:'#4b5563',fontSize:13,marginBottom:14}}>Se ordrer, omsætning og top-produkter direkte her</div>
                <button className="btn btn-p" onClick={()=>setView('shopify_settings')}>Tilslut Shopify</button>
              </div>
            )}

            <div style={{...CC.card,padding:20}}>
              <div style={{fontSize:13,fontWeight:600,color:'#9ca3af',marginBottom:14}}>Leads pr. kategori</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                {categories.map(cat=>{
                  const cnt=leads.filter(l=>l.category===cat).length;
                  const wonC=leads.filter(l=>l.category===cat&&l.status==='won').length;
                  if(!cnt)return null;
                  return(
                    <div key={cat} style={{...CC.inner,padding:'10px 14px',cursor:'pointer'}} onClick={()=>{setFCat(cat);setView('list');}}>
                      <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{cat}</div>
                      <div style={{fontSize:11,color:'#4b5563'}}>{cnt} leads · <span style={{color:'#22c55e'}}>{wonC} solgt</span></div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

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

        {/* IMPORT */}
        {view==='import'&&(
          <div style={{padding:28,maxWidth:760}}>
            <h2 style={{fontWeight:700,marginBottom:20}}>Importér leads</h2>
            <div style={{...CC.card,padding:22}}>
              <div style={{background:'#080d18',border:'1px solid #1a2332',borderRadius:8,padding:'10px 14px',marginBottom:14,fontSize:12,color:'#4b5563',fontFamily:'monospace'}}>
                Format: Navn, By, Land, Mail, B2B Outreach, Produkt, Hvem?, Notat
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
                <div><label>Standardkategori</label><select className="inp" value={iCat} onChange={e=>{setICat(e.target.value);setIPrev(runP(iText));}}>{categories.map(c=><option key={c}>{c}</option>)}</select></div>
                <div><label>Standardland</label><select className="inp" value={iCountry} onChange={e=>{setICountry(e.target.value);setIPrev(runP(iText));}}>{countries.map(c=><option key={c}>{c}</option>)}</select></div>
              </div>
              <div style={{marginBottom:12}}>
                <label>Upload fil (CSV / TSV / TXT)</label>
                <input type="file" accept=".csv,.tsv,.txt" ref={fileRef} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{setIText(ev.target.result);setIPrev(runP(ev.target.result));};r.readAsText(f,'UTF-8');}} style={{display:'none'}}/>
                <button className="btn btn-g" style={{marginTop:6}} onClick={()=>fileRef.current.click()}>Vælg fil</button>
              </div>
              <div style={{marginBottom:14}}>
                <label>Eller indsæt data direkte</label>
                <textarea className="inp" rows={6} value={iText} onChange={e=>{setIText(e.target.value);setIPrev(runP(e.target.value));}} style={{resize:'vertical',fontFamily:'monospace',fontSize:12}} placeholder="Navn,By,Land,Mail,B2B Outreach,Produkt,Hvem?,Notat"/>
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
                <div><label>Kategori</label><select className="inp" value={editLead.category} onChange={e=>setEditLead({...editLead,category:e.target.value})}>{categories.map(c=><option key={c}>{c}</option>)}</select></div>
                <div><label>Land</label><select className="inp" value={editLead.country} onChange={e=>setEditLead({...editLead,country:e.target.value})}>{countries.map(c=><option key={c}>{c}</option>)}</select></div>
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
            <div style={{...CC.card,padding:20,marginBottom:12}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                {[['Email',sel.email],['Telefon',sel.phone],['By',sel.city],['Land',sel.country],['Kategori',sel.category],['Kontaktperson',sel.contact_person]].map(([lb,v])=>(
                  <div key={lb}><div style={{fontSize:11,color:'#4b5563',marginBottom:2}}>{lb}</div><div style={{fontSize:14}}>{v||'—'}</div></div>
                ))}
              </div>
              {sel.product&&<div style={{background:'#1e40af15',border:'1px solid #1e40af30',borderRadius:8,padding:'8px 12px',fontSize:13,color:'#93c5fd',marginBottom:8}}>Produkt: {sel.product}</div>}
              {sel.sale_info&&<div style={{background:'#14532d15',border:'1px solid #14532d30',borderRadius:8,padding:'8px 12px',fontSize:13,color:'#4ade80',marginBottom:8}}>Salg: {sel.sale_info}</div>}
              {sel.notes&&<div style={{fontSize:13,color:'#6b7280',background:'#080d18',borderRadius:8,padding:'8px 12px',whiteSpace:'pre-line'}}>{sel.notes}</div>}
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
                      <div style={{marginBottom:8}}><label>Note</label><input className="inp" value={editOtr.note||''} onChange={e=>setEditOtr({...editOtr,note:e.target.value})}/></div>
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
                          <span style={{fontSize:12,color:'#4b5563'}}>· {o.date}</span>
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
                <div style={{marginBottom:8}}><label>Note / beskrivelse</label><input className="inp" value={newOtr.note} onChange={e=>setNewOtr({...newOtr,note:e.target.value})} placeholder="f.eks. Email sendt med katalog"/></div>
                <div style={{marginBottom:12}}><label>Salg (sætter status til Solgt automatisk)</label><input className="inp" value={newOtr.sale_info} onChange={e=>setNewOtr({...newOtr,sale_info:e.target.value})} placeholder="f.eks. Solgt 20 stk vandkikkerter" style={{borderColor:newOtr.sale_info?'#22c55e55':''}}/></div>
                <button className="btn btn-p" onClick={()=>addOtr(sel)}>Tilføj outreach</button>
              </div>
            </div>
          </div>
        )}

        {/* LIST */}
        {view==='settings'&&(
          <div style={{padding:28,maxWidth:600}}>
            <h2 style={{fontWeight:700,marginBottom:20}}>Indstillinger</h2>
            <div style={{...CC.card,padding:22,marginBottom:16}}>
              <div className="sl">Kategorier</div>
              <div style={{fontSize:12,color:'#6b7280',marginBottom:14}}>Slet kategorier du ikke bruger. Leads i den kategori flyttes til "Andet".</div>
              {categories.map(cat=>(
                <div key={cat} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #0d1420'}}>
                  <span style={{fontSize:14}}>{cat}</span>
                  <button className="btn btn-d" style={{padding:'3px 10px',fontSize:11}} onClick={()=>{
                    if(!confirm('Slet kategorien "'+cat+'"? Leads flyttes til "Andet".')) return;
                    setLeads(leads.map(l=>l.category===cat?{...l,category:'Andet'}:l));
                    setCategories(categories.filter(c=>c!==cat));
                    // Update in DB
                    supabase.from('leads').update({category:'Andet'}).eq('category',cat).then(()=>msg('Kategori slettet'));
                  }}>Slet</button>
                </div>
              ))}
              <div style={{marginTop:14,display:'flex',gap:8}}>
                <input className="inp" placeholder="Ny kategori..." id="newCatInput" style={{flex:1}} onKeyDown={e=>{if(e.key==='Enter'){const v=e.target.value.trim();if(v&&!categories.includes(v)){setCategories([...categories,v]);e.target.value='';}}}}/>
                <button className="btn btn-p" style={{padding:'8px 14px'}} onClick={()=>{const el=document.getElementById('newCatInput');const v=el.value.trim();if(v&&!categories.includes(v)){setCategories([...categories,v]);el.value='';}}}>Tilføj</button>
              </div>
            </div>
            <div style={{...CC.card,padding:22}}>
              <div className="sl">Lande</div>
              {countries.map(c=>(
                <div key={c} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #0d1420'}}>
                  <span style={{fontSize:14}}>{c}</span>
                  {!['Danmark','Norge','Sverige'].includes(c)&&<button className="btn btn-d" style={{padding:'3px 10px',fontSize:11}} onClick={()=>{if(confirm('Slet land "'+c+'"?'))setCountries(countries.filter(x=>x!==c));}}>Slet</button>}
                </div>
              ))}
            </div>
          </div>
        )}

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
                  <div><label>Sæt status</label><select className="inp" style={{width:150}} value={bulkSt} onChange={e=>setBulkSt(e.target.value)}>{STATUS_OPTIONS.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
                  <div><label>Outreach dato</label><input className="inp" type="date" style={{width:140}} value={bulkDate} onChange={e=>setBulkDate(e.target.value)}/></div>
                  <div><label>Af</label><input className="inp" style={{width:90}} value={bulkBy} onChange={e=>setBulkBy(e.target.value)}/></div>
                  <div><label>Note</label><input className="inp" style={{width:160}} value={bulkNote} onChange={e=>setBulkNote(e.target.value)} placeholder="f.eks. Email sendt"/></div>
                  <button className="btn" style={{background:'#7c3aed',color:'#fff',padding:'8px 16px',alignSelf:'flex-end'}} disabled={saving} onClick={applyBulk}>{saving?'Gemmer...':'Anvend på '+bulkSel.size}</button>
                </div>
              </div>
            )}

            <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
              <input className="inp" style={{maxWidth:200}} placeholder="Søg..." value={search} onChange={e=>setSearch(e.target.value)}/>
              <select className="inp" style={{maxWidth:190}} value={fCat} onChange={e=>setFCat(e.target.value)}><option>Alle</option>{categories.map(c=><option key={c}>{c}</option>)}</select>
              <select className="inp" style={{maxWidth:155}} value={fStatus} onChange={e=>setFStatus(e.target.value)}><option value="Alle">Alle statusser</option>{STATUS_OPTIONS.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select>
              <select className="inp" style={{maxWidth:120}} value={fCountry} onChange={e=>setFCountry(e.target.value)}><option value="Alle">Alle lande</option>{countries.map(c=><option key={c}>{c}</option>)}</select>
              <span style={{fontSize:13,color:'#4b5563',marginLeft:'auto'}}>{filtered.length} leads</span>
            </div>

            <div style={{...CC.card,overflow:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead><tr style={{borderBottom:'1px solid #1f2937'}}>
                  {bulk&&<th style={{padding:'10px 8px 10px 14px',width:36}}></th>}
                  {['Navn','Kategori','Email','By','Status','Outreach','Salg'].map(h=><th key={h} style={{padding:'10px 14px',textAlign:'left',color:'#4b5563',fontWeight:700,fontSize:11,textTransform:'uppercase',letterSpacing:0.4,whiteSpace:'nowrap'}}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {!filtered.length&&<tr><td colSpan={bulk?8:7} style={{padding:32,textAlign:'center',color:'#4b5563'}}>Ingen leads fundet. <button className="btn btn-g" onClick={openAdd} style={{marginLeft:8}}>+ Tilføj</button></td></tr>}
                  {filtered.map(lead=>(
                    <tr key={lead.id} className={bulk?'':'rh'} style={{borderBottom:'1px solid #0d1420',background:bulkSel.has(lead.id)?'#7c3aed10':'transparent',cursor:bulk?'default':'pointer'}}
                      onClick={()=>{if(!bulk){setSel(lead);setView('detail');}}}>
                      {bulk&&<td style={{padding:'10px 8px 10px 14px'}} onClick={e=>{e.stopPropagation();const n=new Set(bulkSel);n.has(lead.id)?n.delete(lead.id):n.add(lead.id);setBulkSel(n);}}>
                        <input type="checkbox" checked={bulkSel.has(lead.id)} readOnly style={{width:16,height:16,cursor:'pointer',accentColor:'#7c3aed'}}/>
                      </td>}
                      <td style={{padding:'10px 14px',fontWeight:600,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{lead.name}</td>
                      <td style={{padding:'10px 14px'}}><span className="tag">{lead.category}</span></td>
                      <td style={{padding:'10px 14px',color:'#4b5563',maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{lead.email||'—'}</td>
                      <td style={{padding:'10px 14px',color:'#4b5563',whiteSpace:'nowrap'}}>{lead.city||'—'}</td>
                      <td style={{padding:'10px 14px'}}><StatusBadge value={lead.status}/></td>
                      <td style={{padding:'10px 14px',color:'#6b7280'}}>{(lead.outreaches||[]).length?<span style={{fontSize:12}}>{lead.outreaches.length}x · {lead.outreaches[lead.outreaches.length-1].date}</span>:<span style={{color:'#1f2937'}}>—</span>}</td>
                      <td style={{padding:'10px 14px'}}>{lead.sale_info?<span style={{color:'#4ade80',fontSize:12,fontWeight:600}}>{lead.sale_info.slice(0,32)}</span>:<span style={{color:'#1f2937'}}>—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
