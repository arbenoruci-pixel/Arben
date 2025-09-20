
/* assets/app.js — FIXED v2 (2025-09-20)
   - Strong multi-field SEARCH: name (accent-insensitive), phone (digits), X-code (23/X23), multi-term tokens
   - Stops GATI -> PASTRIMI bounce (monotonic status + last-write-wins by updatedAt)
   - Auto-migrates old orders on load (adds updatedAt, bumps GATI freshness)
   - Limit active orders per client (name + phone)
*/

/* =========================
   CONFIG
   ========================= */
const STORAGE_KEY = 'orders_v1';
const MAX_ACTIVE_ORDERS_PER_CLIENT = 1;
const STATUS = { PRANIM: 'pranim', PASTRIM: 'pastrim', GATI: 'gati', DOREZUAR: 'dorezuar' };
const ACTIVE_STATUSES = new Set([STATUS.PRANIM, STATUS.PASTRIM, STATUS.GATI]);
const STATUS_RANK = { pranim:1, pastrim:2, gati:3, dorezuar:4 };

/* =========================
   UTILS
   ========================= */
const nowTs = () => Date.now();
function uid(){ return 'ord_' + Math.random().toString(36).slice(2,10) + nowTs().toString(36); }

// Accent-insensitive folding
function fold(s=''){
  try {
    return String(s).normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase().trim();
  } catch {
    // Fallback if \p{Diacritic} unsupported
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
  }
}
function normalizePhone(s=''){ return String(s).replace(/\D/g,''); }
function normalizeXCode(s=''){
  const str = String(s).trim().toUpperCase();
  const n = str.replace(/^X/, '');
  const nNoPad = n.replace(/^0+/, '') || '0';
  return nNoPad;
}

/* =========================
   STORAGE
   ========================= */
function loadOrders(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  }catch{ return []; }
}
function saveOrders(list){ localStorage.setItem(STORAGE_KEY, JSON.stringify(list || [])); }
function getOrderById(id){ return loadOrders().find(o => o.id === id); }

// Defensive save: last-write-wins + no status downgrade
function saveOrder(order){
  const list = loadOrders();
  const i = list.findIndex(o => o.id === order.id);

  if(!order.updatedAt){ order.updatedAt = nowTs(); }

  if(i === -1){
    list.push(order);
  } else {
    const prev = list[i];
    const prevTs = Number(prev.updatedAt || 0);
    const nextTs = Number(order.updatedAt || 0);
    const chosen = nextTs >= prevTs ? order : prev;

    // never downgrade status
    const a = STATUS_RANK[String(prev.status).toLowerCase()] || 0;
    const b = STATUS_RANK[String(chosen.status).toLowerCase()] || 0;
    if(b < a){
      chosen.status = prev.status;
      chosen.updatedAt = Math.max(prevTs, nextTs, nowTs());
    }
    list[i] = chosen;
  }
  saveOrders(list);
}

/* =========================
   AUTO-MIGRATION ON LOAD
   ========================= */
(function migrateOrdersOnLoad(){
  try{
    const list = loadOrders();
    if(!list.length) return;
    let changed=false;
    const now = nowTs();
    for(const o of list){
      const before = JSON.stringify(o);
      if(o.status){ o.status = String(o.status).toLowerCase(); }
      if(!o.updatedAt){ o.updatedAt = o.ts ? Number(o.ts) : now; }
      if(o.status === STATUS.GATI && o.updatedAt < now - 5000){ o.updatedAt = now; }
      if(JSON.stringify(o) !== before) changed=true;
    }
    if(changed) saveOrders(list);
  }catch{}
})();

/* =========================
   SYNC STUBS
   ========================= */
async function fetchRemoteOrders(){ return []; }
async function pushDirtyOrders(){}
function mergeOrders(remoteList=[], localList=[]){
  const byId = new Map();
  const put = x => {
    const prev = byId.get(x.id);
    if(!prev) byId.set(x.id, x);
    else {
      const a = Number(prev.updatedAt||0);
      const b = Number(x.updatedAt||0);
      byId.set(x.id, b > a ? x : prev);
    }
  };
  for(const it of localList) put(it);
  for(const it of remoteList) put(it);
  return Array.from(byId.values());
}
async function syncOrders(){
  const local = loadOrders();
  const remote = await fetchRemoteOrders();
  const merged = mergeOrders(remote, local);
  saveOrders(merged);
  await pushDirtyOrders();
  return merged;
}

/* =========================
   ORDER LOGIC
   ========================= */
function clientKeyFrom(name, phone){ return fold(name) + '|' + normalizePhone(phone); }
function countActiveOrdersForClient(name, phone){
  const key = clientKeyFrom(name, phone);
  return loadOrders().filter(o => clientKeyFrom(o.client_name, o.client_phone) === key && ACTIVE_STATUSES.has(o.status)).length;
}
function ensureClientLimitOrThrow(name, phone){
  if(!name || !phone) return;
  const active = countActiveOrdersForClient(name, phone);
  if(active >= MAX_ACTIVE_ORDERS_PER_CLIENT){
    throw new Error(`Ky klient ka tashmë ${active} porosi aktive. Lejohen deri në ${MAX_ACTIVE_ORDERS_PER_CLIENT}.`);
  }
}
function nextXCodeNumber(){
  const list = loadOrders();
  const nums = list.map(o => {
    const n = Number(normalizeXCode(o.code));
    return Number.isFinite(n) ? n : 0;
    });
  const max = nums.length ? Math.max(...nums) : 0;
  return max + 1;
}
function createOrder({ client_name, client_phone, client_code, pay_rate=0, pay_m2=0, pieces=[], notes='' }){
  ensureClientLimitOrThrow(client_name, client_phone);
  const id = uid();
  const code = 'X' + String(nextXCodeNumber()).padStart(3,'0');
  const order = {
    id, code,
    status: STATUS.PRANIM,
    ts: nowTs(),
    updatedAt: nowTs(),
    client_name: client_name || '',
    client_phone: client_phone || '',
    client_code: client_code || '',
    pay_rate: Number(pay_rate || 0),
    pay_m2: Number(pay_m2 || 0),
    pay_euro: Number((Number(pay_rate||0)*Number(pay_m2||0)).toFixed(2)),
    pieces: Array.isArray(pieces) ? pieces : [],
    notes: notes || '',
    flags: { readyToday: false, noShow: false },
  };
  saveOrder(order);
  return order;
}

/* =========================
   STATUS CHANGES
   ========================= */
function updateOrderStatus(id, newStatus){
  const o = getOrderById(id);
  if(!o) return;
  const cur = String(o.status).toLowerCase();
  const next = String(newStatus).toLowerCase();
  if(cur === next) return;
  o.status = next;
  o.updatedAt = nowTs();
  saveOrder(o);
}
function saveFormEdits(id, formValues={}){
  const o = getOrderById(id);
  if(!o) return;
  const keepStatus = o.status;
  const updated = { ...o, ...formValues, status: keepStatus, updatedAt: nowTs() };
  saveOrder(updated);
}

/* =========================
   STRONG MULTI-FIELD SEARCH
   - Splits query into tokens by space
   - Name: accent-insensitive contains ALL tokens (AND)
   - Phone: any token with digits must be substring of phone (OR across tokens)
   - X-code: token equals/starts with code number
   - Overall match if ANY of {nameMatch, phoneMatch, xMatch} is true
   ========================= */
function searchOrders(rawQuery=''){
  const q = String(rawQuery || '').trim();
  if(!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);

  const out = [];
  const seen = new Set();

  for(const o of loadOrders()){
    const nameF = fold(o.client_name);
    const phoneF = normalizePhone(o.client_phone);
    const xF = normalizeXCode(o.code);

    // NAME: require ALL text tokens (that aren’t pure digits) to be contained
    const nameTokens = tokens.filter(t => !/^\d+$/.test(t));
    const nameMatch = nameTokens.length
      ? nameTokens.every(t => nameF.includes(fold(t)))
      : false;

    // PHONE: if any token has digits, match if any such token is substring
    const phoneTokens = tokens.map(normalizePhone).filter(t => t.length>0);
    const phoneMatch = phoneTokens.length
      ? phoneTokens.some(t => phoneF.includes(t))
      : false;

    // X-CODE: match if any token equals or is prefix of x number (no 'X' needed)
    const xTokens = tokens.map(normalizeXCode).filter(Boolean);
    const xMatch = xTokens.length
      ? xTokens.some(t => xF === t || xF.startsWith(t))
      : false;

    if(nameMatch || phoneMatch || xMatch){
      if(!seen.has(o.id)){
        seen.add(o.id);
        out.push(o);
      }
    }
  }

  out.sort((a,b)=>Number(b.updatedAt||0) - Number(a.updatedAt||0));
  return out;
}

// Debug helper to see what field matched
function debugSearch(rawQuery=''){
  const q = String(rawQuery || '').trim();
  const tokens = q.split(/\s+/).filter(Boolean);
  const rows = [];
  for(const o of loadOrders()){
    const nameF = fold(o.client_name);
    const phoneF = normalizePhone(o.client_phone);
    const xF = normalizeXCode(o.code);

    const nameTokens = tokens.filter(t => !/^\d+$/.test(t));
    const nameMatch = nameTokens.length ? nameTokens.every(t => nameF.includes(fold(t))) : false;

    const phoneTokens = tokens.map(normalizePhone).filter(t => t.length>0);
    const phoneMatch = phoneTokens.length ? phoneTokens.some(t => phoneF.includes(t)) : false;

    const xTokens = tokens.map(normalizeXCode).filter(Boolean);
    const xMatch = xTokens.length ? xTokens.some(t => xF === t || xF.startsWith(t)) : false;

    if(nameMatch || phoneMatch || xMatch){
      rows.push({
        id: o.id, code: o.code, client_name: o.client_name, client_phone: o.client_phone,
        nameMatch, phoneMatch, xMatch, updatedAt: o.updatedAt
      });
    }
  }
  return rows;
}

/* =========================
   LISTS by status
   ========================= */
function listPastrimi(){ return loadOrders().filter(o => o.status === STATUS.PASTRIM && !o.flags.noShow); }
function listGati(){ return loadOrders().filter(o => o.status === STATUS.GATI && !o.flags.noShow); }
function listMarrjeSot(){ return loadOrders().filter(o => o.status === STATUS.GATI && o.flags.readyToday && !o.flags.noShow); }

/* =========================
   UI HOOKS (optional)
   ========================= */
document.addEventListener('click', (e)=>{
  const q = sel => e.target.closest(sel);
  const gBtn = q('[data-action="mark-gati"]');
  if(gBtn){ updateOrderStatus(gBtn.getAttribute('data-id'), STATUS.GATI); return; }
  const pBtn = q('[data-action="mark-pastrim"]');
  if(pBtn){ updateOrderStatus(pBtn.getAttribute('data-id'), STATUS.PASTRIM); return; }
  const dBtn = q('[data-action="mark-dorezuar"]');
  if(dBtn){ updateOrderStatus(dBtn.getAttribute('data-id'), STATUS.DOREZUAR); return; }
});
document.addEventListener('input', (e)=>{
  if(e.target && e.target.id === 'search'){
    const results = searchOrders(e.target.value);
    if(typeof window.renderSearch === 'function'){ window.renderSearch(results); }
  }
});

/* =========================
   EXPORTS
   ========================= */
window.Tepiha = {
  // CRUD / status
  createOrder, saveFormEdits, updateOrderStatus,
  // lists
  listPastrimi, listGati, listMarrjeSot,
  // search
  searchOrders, debugSearch,
  // sync
  syncOrders,
  // utils
  loadOrders, saveOrders, getOrderById,
};
