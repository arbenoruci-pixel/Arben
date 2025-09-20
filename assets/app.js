
/* assets/app.js — FIXED (2025-09-20)
   - Stops GATI -> PASTRIMI bounce (monotonic status + last-write-wins by updatedAt)
   - Auto-migrates old orders on load (adds updatedAt, bumps GATI freshness)
   - Search by name / phone / X-code
   - Limit active orders per client (name + phone)
   - Drop-in: no UI/design changes required
*/

/* =========================
   CONFIG
   ========================= */
const STORAGE_KEY = 'orders_v1';
const MAX_ACTIVE_ORDERS_PER_CLIENT = 1; // how many active orders allowed per client (name+phone)
const STATUS = { PRANIM: 'pranim', PASTRIM: 'pastrim', GATI: 'gati', DOREZUAR: 'dorezuar' };
const ACTIVE_STATUSES = new Set([STATUS.PRANIM, STATUS.PASTRIM, STATUS.GATI]);
const STATUS_RANK = { pranim:1, pastrim:2, gati:3, dorezuar:4 };

/* =========================
   UTILS
   ========================= */
const nowTs = () => Date.now();
function uid() { return 'ord_' + Math.random().toString(36).slice(2,10) + nowTs().toString(36); }
function normalizePhone(s=''){ return String(s).replace(/\D/g,''); }
function normalizeName(s=''){ return String(s).trim().toUpperCase(); }
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
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveOrders(list){ localStorage.setItem(STORAGE_KEY, JSON.stringify(list || [])); }
function getOrderById(id){ return loadOrders().find(o => o.id === id); }

// Defensive save: last-write-wins + no status downgrade
function saveOrder(order){
  const list = loadOrders();
  const i = list.findIndex(o => o.id === order.id);

  // ensure updatedAt
  if(!order.updatedAt){ order.updatedAt = nowTs(); }

  if(i === -1){
    list.push(order);
  } else {
    const prev = list[i];
    const prevTs = Number(prev.updatedAt || 0);
    const nextTs = Number(order.updatedAt || 0);

    // last-write-wins
    const chosen = nextTs >= prevTs ? order : prev;

    // hard guard: never downgrade status
    const a = STATUS_RANK[String(prev.status).toLowerCase()] || 0;
    const b = STATUS_RANK[String(chosen.status).toLowerCase()] || 0;
    if (b < a) {
      chosen.status = prev.status;
      chosen.updatedAt = Math.max(prevTs, nextTs, nowTs());
    }
    list[i] = chosen;
  }
  saveOrders(list);
}

/* =========================
   ONE-TIME AUTO-MIGRATION ON LOAD
   (adds updatedAt; bumps old GATI to fresh timestamps)
   ========================= */
(function migrateOrdersOnLoad(){
  try{
    const list = loadOrders();
    if(!list.length) return;
    let changed = false;
    const now = nowTs();

    for(const o of list){
      const before = JSON.stringify(o);

      // normalize status
      if(o.status){ o.status = String(o.status).toLowerCase(); }

      // ensure updatedAt
      if(!o.updatedAt){
        o.updatedAt = o.ts ? Number(o.ts) : now;
      }

      // if already GATI but with very old updatedAt, bump to now
      if(o.status === STATUS.GATI && o.updatedAt < now - 5000){
        o.updatedAt = now;
      }

      if(JSON.stringify(o) !== before) changed = true;
    }
    if(changed) saveOrders(list);
  }catch(e){ /* ignore */ }
})();

/* =========================
   SYNC (stubs) — replace with real cloud calls if used
   ========================= */
async function fetchRemoteOrders(){ return []; }
async function pushDirtyOrders(){ /* no-op */ }
function mergeOrders(remoteList=[], localList=[]){
  const byId = new Map();
  const put = x => {
    const prev = byId.get(x.id);
    if(!prev){ byId.set(x.id, x); }
    else{
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
function clientKeyFrom(name, phone){ return normalizeName(name) + '|' + normalizePhone(phone); }
function countActiveOrdersForClient(name, phone){
  const key = clientKeyFrom(name, phone);
  return loadOrders().filter(o => {
    const ok = clientKeyFrom(o.client_name, o.client_phone) === key;
    return ok && ACTIVE_STATUSES.has(o.status);
  }).length;
}
function ensureClientLimitOrThrow(name, phone){
  if(!name || !phone) return; // allow if your flow collects later
  const activeCount = countActiveOrdersForClient(name, phone);
  if(activeCount >= MAX_ACTIVE_ORDERS_PER_CLIENT){
    throw new Error(`Ky klient ka tashmë ${activeCount} porosi aktive. Lejohen deri në ${MAX_ACTIVE_ORDERS_PER_CLIENT}.`);
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
  const codeNum = nextXCodeNumber();
  const code = 'X' + String(codeNum).padStart(3,'0');

  const order = {
    id,
    code,
    status: STATUS.PRUNIM, // typo guard (will fix below)
    ts: nowTs(),
    updatedAt: nowTs(),
    client_name: client_name || '',
    client_phone: client_phone || '',
    client_code: client_code || '',
    pay_rate: Number(pay_rate || 0),
    pay_m2: Number(pay_m2 || 0),
    pay_euro: Number((Number(pay_rate || 0) * Number(pay_m2 || 0)).toFixed(2)),
    pieces: Array.isArray(pieces) ? pieces : [],
    notes: notes || '',
    flags: { readyToday: false, noShow: false },
  };

  // small typo fix in case: ensure valid status
  if(order.status !== STATUS.PRANIM) order.status = STATUS.PRANIM;

  saveOrder(order);
  return order;
}

/* =========================
   STATUS CHANGES (stable)
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
   SEARCH — name / phone / X-code
   ========================= */
function searchOrders(rawQuery=''){
  const q = String(rawQuery).trim();
  if(!q) return [];
  const qUpper = q.toUpperCase();
  const qDigits = normalizePhone(q);
  const qX = normalizeXCode(q);

  const out = [];
  const seen = new Set();

  for(const o of loadOrders()){
    const nameMatch = normalizeName(o.client_name).includes(qUpper);
    const phoneMatch = qDigits.length ? normalizePhone(o.client_phone).includes(qDigits) : false;
    const xMatch = normalizeXCode(o.code) === qX || normalizeXCode(o.code).startsWith(qX);

    if(nameMatch || phoneMatch || xMatch){
      if(!seen.has(o.id)){
        seen.add(o.id);
        out.push(o);
      }
    }
  }
  out.sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0));
  return out;
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
  const toAction = sel => e.target.closest(sel);

  const gBtn = toAction('[data-action="mark-gati"]');
  if(gBtn){ updateOrderStatus(gBtn.getAttribute('data-id'), STATUS.GATI); return; }

  const pBtn = toAction('[data-action="mark-pastrim"]');
  if(pBtn){ updateOrderStatus(pBtn.getAttribute('data-id'), STATUS.PASTRIM); return; }

  const dBtn = toAction('[data-action="mark-dorezuar"]');
  if(dBtn){ updateOrderStatus(dBtn.getAttribute('data-id'), STATUS.DOREZUAR); return; }
});

document.addEventListener('input', (e)=>{
  if(e.target && e.target.id === 'search'){
    const q = e.target.value;
    const results = searchOrders(q);
    if(typeof window.renderSearch === 'function'){ window.renderSearch(results); }
  }
});

/* =========================
   EXPORTS
   ========================= */
window.Tepiha = {
  // CRUD / status
  createOrder,
  saveFormEdits,
  updateOrderStatus,

  // lists
  listPastrimi,
  listGati,
  listMarrjeSot,

  // search
  searchOrders,

  // sync
  syncOrders,

  // utils
  loadOrders,
  saveOrders,
  getOrderById,
};