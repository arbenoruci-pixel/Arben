/* assets/app.js — DROP-IN (v2025-09-20)
   ✅ Limit per client (orders aktive)
   ✅ Search by name / phone / X-code
   ✅ Fix status regress (GATI nuk kthehet në PASTRIMI)
   ✅ Merge by updatedAt (last-write-wins)
   ✅ Ruaj status-in ekzistues kur editon fusha të tjera
*/

/* =========================
   KONFIGURIM I SHKURTËR
   ========================= */
const STORAGE_KEY = 'orders_v1';
const MAX_ACTIVE_ORDERS_PER_CLIENT = 1; // sa porosi aktive lejohen për të njëjtin klient
const ACTIVE_STATUSES = new Set(['pranim','pastrim','gati']); // “aktive” = jo dorëzuar/arkivuar
const STATUS = { PRANIM: 'pranim', PASTRIM: 'pastrim', GATI: 'gati', DOREZUAR: 'dorezuar' };

/* =========================
   UTIL
   ========================= */
const nowTs = () => Date.now();

function uid() {
  return 'ord_' + Math.random().toString(36).slice(2, 10) + nowTs().toString(36);
}

function normalizePhone(s='') {
  return String(s).replace(/\D/g, ''); // hiq simbolet, mbaj vetëm numra
}

function normalizeName(s='') {
  return String(s).trim().toUpperCase();
}

function normalizeXCode(s='') {
  const str = String(s).trim().toUpperCase();
  // lejo “23”, “X23”, “x023”
  const n = str.replace(/^X/, '');
  const nNoPad = n.replace(/^0+/, '') || '0';
  return nNoPad;
}

/* =========================
   STORAGE
   ========================= */
function loadOrders() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveOrders(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list || []));
}

function getOrderById(id) {
  return loadOrders().find(o => o.id === id);
}

function saveOrder(order) {
  const list = loadOrders();
  const i = list.findIndex(o => o.id === order.id);
  if (i === -1) list.push(order);
  else list[i] = order;
  saveOrders(list);
}

/* =========================
   SYNC MERGE (last-write-wins by updatedAt)
   ========================= */
// Nëse përdor cloud, thirri këto dy për të bërë merge korrekt.
// Nëse s’ke cloud, i lë si NO-OP.
async function fetchRemoteOrders() {
  // TODO: zëvendëso me thirrjen reale (Supabase, etj.)
  return []; // p.sh. [{...}]
}

async function pushDirtyOrders(/*orders*/) {
  // TODO: dërgo ndryshimet reale në cloud nëse përdor një
}

function mergeOrders(remoteList = [], localList = []) {
  const byId = new Map();
  const put = (x) => {
    const prev = byId.get(x.id);
    if (!prev) byId.set(x.id, x);
    else {
      const a = Number(prev.updatedAt || 0);
      const b = Number(x.updatedAt || 0);
      byId.set(x.id, b > a ? x : prev);
    }
  };
  for (const it of localList) put(it);
  for (const it of remoteList) put(it);
  return Array.from(byId.values());
}

async function syncOrders() {
  const local = loadOrders();
  const remote = await fetchRemoteOrders();
  const merged = mergeOrders(remote, local);
  saveOrders(merged);
  await pushDirtyOrders(/*differences*/);
  return merged;
}

/* =========================
   LOGJIKA E POROSIVE
   ========================= */
function clientKeyFrom(name, phone) {
  return normalizeName(name) + '|' + normalizePhone(phone);
}

function countActiveOrdersForClient(name, phone) {
  const key = clientKeyFrom(name, phone);
  return loadOrders().filter(o => {
    const ok = clientKeyFrom(o.client_name, o.client_phone) === key;
    return ok && ACTIVE_STATUSES.has(o.status);
  }).length;
}

function ensureClientLimitOrThrow(name, phone) {
  if (!name || !phone) return; // leje inputet e zbrazëta nëse e ke flow-in ashtu, ose vendosi required
  const activeCount = countActiveOrdersForClient(name, phone);
  if (activeCount >= MAX_ACTIVE_ORDERS_PER_CLIENT) {
    throw new Error(`Ky klient ka tashmë ${activeCount} porosi aktive. Nuk lejohet më shumë se ${MAX_ACTIVE_ORDERS_PER_CLIENT}.`);
  }
}

function createOrder({ client_name, client_phone, client_code, pay_rate = 0, pay_m2 = 0, pieces = [], notes = '' }) {
  // Blloko porositë e shumta për të njëjtin klient (aktive)
  ensureClientLimitOrThrow(client_name, client_phone);

  const id = uid();
  const codeNum = nextXCodeNumber(); // p.sh. 24 -> gjenero numrin e radhës sipas logjikës tënde
  const code = 'X' + String(codeNum).padStart(3, '0');

  const order = {
    id,
    code,
    status: STATUS.PRANIM,
    ts: nowTs(),
    updatedAt: nowTs(),
    client_name: client_name || '',
    client_phone: client_phone || '',
    client_code: client_code || '', // nëse ke një kod klienti vete
    pay_rate: Number(pay_rate || 0),
    pay_m2: Number(pay_m2 || 0),
    pay_euro: Number((Number(pay_rate || 0) * Number(pay_m2 || 0)).toFixed(2)),
    pieces: Array.isArray(pieces) ? pieces : [],
    notes: notes || '',
    flags: { readyToday: false, noShow: false },
  };

  saveOrder(order);
  return order;
}

// Placeholder — zëvendësoje me logjikën tënde ekzistuese për X-codes (lease 30 min., etj.)
function nextXCodeNumber() {
  const list = loadOrders();
  const nums = list.map(o => {
    const n = Number(normalizeXCode(o.code));
    return Number.isFinite(n) ? n : 0;
  });
  const max = nums.length ? Math.max(...nums) : 0;
  return max + 1;
}

/* =========================
   NDRYSHIMI I STATUSIT — STABIL
   ========================= */
function updateOrderStatus(id, newStatus) {
  const o = getOrderById(id);
  if (!o) return;
  if (o.status === newStatus) return;
  o.status = newStatus;
  o.updatedAt = nowTs();
  saveOrder(o);
}

function saveFormEdits(id, formValues = {}) {
  const o = getOrderById(id);
  if (!o) return;
  // RUJE STATUSIN E EKZISTUESHEM — MOS e mbishkruaj
  const keepStatus = o.status;
  const updated = { ...o, ...formValues, status: keepStatus, updatedAt: nowTs() };
  saveOrder(updated);
}

/* =========================
   KËRKIMI — EMËR / TELEFON / X-KOD
   ========================= */
function searchOrders(rawQuery = '') {
  const q = String(rawQuery).trim();
  if (!q) return [];

  const qUpper = q.toUpperCase();
  const qDigits = normalizePhone(q);
  const qX = normalizeXCode(q);

  const seen = new Set();
  const out = [];

  for (const o of loadOrders()) {
    const nameMatch = normalizeName(o.client_name).includes(qUpper);
    const phoneMatch = normalizePhone(o.client_phone).includes(qDigits) && qDigits.length > 0;
    const xMatch = normalizeXCode(o.code) === qX || normalizeXCode(o.code).startsWith(qX);

    if (nameMatch || phoneMatch || xMatch) {
      if (!seen.has(o.id)) {
        seen.add(o.id);
        out.push(o);
      }
    }
  }
  // Mund ta renditësh sipas updatedAt zbritës
  out.sort((a,b) => Number(b.updatedAt||0) - Number(a.updatedAt||0));
  return out;
}

/* =========================
   LISTAT SIPAS STATUSIT
   ========================= */
function listPastrimi() {
  return loadOrders().filter(o => o.status === STATUS.PASTRIM && !o.flags.noShow);
}

function listGati() {
  return loadOrders().filter(o => o.status === STATUS.GATI && !o.flags.noShow);
}

function listMarrjeSot() {
  return loadOrders().filter(o => o.status === STATUS.GATI && o.flags.readyToday && !o.flags.noShow);
}

/* =========================
   HOOK-E TË SHPEJTA PËR UI
   ========================= */
// Lidhe këto atribute në HTML me butona dhe inpute ekzistuese

document.addEventListener('click', (e) => {
  const toAction = (sel) => e.target.closest(sel);

  // KALO NË GATI
  const gBtn = toAction('[data-action="mark-gati"]');
  if (gBtn) {
    const id = gBtn.getAttribute('data-id');
    updateOrderStatus(id, STATUS.GATI);
    return;
  }

  // KALO NË PASTRIM (kur dalin nga PRANIMI)
  const pBtn = toAction('[data-action="mark-pastrim"]');
  if (pBtn) {
    const id = pBtn.getAttribute('data-id');
    updateOrderStatus(id, STATUS.PASTRIM);
    return;
  }

  // DOREZUAR
  const dBtn = toAction('[data-action="mark-dorezuar"]');
  if (dBtn) {
    const id = dBtn.getAttribute('data-id');
    updateOrderStatus(id, STATUS.DOREZUAR);
    return;
  }
});

// KËRKIM LIVE: <input id="search" />
document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'search') {
    const q = e.target.value;
    const results = searchOrders(q);
    // Këtu thirr funksionin tënd të renditjes, p.sh. renderSearch(results)
    if (typeof window.renderSearch === 'function') {
      window.renderSearch(results);
    }
  }
});

/* =========================
   EKSPORTO FUNKSIONET (nëse i thërret nga HTML inline)
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

  // utils për debug
  loadOrders,
  saveOrders,
  getOrderById,
};