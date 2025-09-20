
// ---- Core data model (localStorage) ----
const KEY = id => `order_${id}`;
const LIST = 'order_list_v1';
export function newId(){ return 'ord_' + Date.now(); }

export function getOrder(id){
  try { return JSON.parse(localStorage.getItem(KEY(id))||'null'); } catch(e){ return null; }
}
export function saveOrder(o){
  localStorage.setItem(KEY(o.id), JSON.stringify(o));
  // maintain index
  const idx = getOrdersIndex();
  const i = idx.findIndex(x=>x.id===o.id);
  if(i>=0){ idx[i] = {id:o.id, name:o.client?.name||'', phone:o.client?.phone||''}; }
  else { idx.unshift({id:o.id, name:o.client?.name||'', phone:o.client?.phone||''}); }
  localStorage.setItem(LIST, JSON.stringify(idx.slice(0,300)));
}
export function getOrdersIndex(){
  try { return JSON.parse(localStorage.getItem(LIST)||'[]'); } catch(e){ return []; }
}
export function ensureOrderFromURL(){
  const sp = new URLSearchParams(location.search);
  let id = sp.get('id');
  if(!id){ id = newId(); sp.set('id', id); history.replaceState(null,'',`?${sp}`); }
  let o = getOrder(id);
  if(!o){
    o = { id, client:{name:'',phone:''}, tepiha:[], staza:[], shk:{qty:0, per:0.3},
          price:2.5, paid:0, photos:{client:'', tepiha:{}, staza:{}},
          totals:{m2:0, eur:0, debt:0}, status:'pranim' };
    saveOrder(o);
  }
  return o;
}
export const r2 = n => Math.round((+n||0)*100)/100;
export const fmt2 = n => r2(n).toFixed(2);
export function calcTotals(o){
  const sum = a => (a||[]).reduce((s,v)=>s+(parseFloat(v)||0),0);
  const m2 = sum(o.tepiha) + sum(o.staza) + ((+o.shk.qty||0) * (+o.shk.per||0));
  const eur = m2 * (+o.price||0);
  const debt = Math.max(0, eur - (+o.paid||0));
  o.totals = {m2:r2(m2), eur:r2(eur), debt:r2(debt)};
  return o;
}

// ---- Messaging (SMS/WhatsApp) ----
export function composeMessage(o, kind='start'){
  const pcs = (o.tepiha?.length||0) + (o.staza?.length||0);
  const m2 = fmt2(o.totals?.m2||0);
  const eur = fmt2(o.totals?.eur||0);
  const name = o.client?.name || 'Klient';
  if(kind==='start') return `Pershendetje ${name}! Procesi i pastrimit ka filluar. Keni ${pcs} copa, gjithsej ${m2} m². Totali: €${eur}.`;
  if(kind==='ready') return `Pershendetje ${name}! Tepihat tuaj jane GATI per t'u marre. Totali: €${eur}.`;
  return `Pershendetje ${name}!`;
}
export function openMessage(o, kind='start', via='sms'){
  const phone = (o.client?.phone||'').replace(/\D+/g,'');
  const body = encodeURIComponent(composeMessage(o,kind));
  if(via==='whatsapp'){ window.open(`https://wa.me/${phone}?text=${body}`, '_blank'); }
  else { location.href = `sms:+${phone}?&body=${body}`; }
}

// ---- Status + Theme (incl. NO-SHOW) ----
export function setStatusAndTheme(o, status){
  o.status = status; saveOrder(o);
  const cls = document.documentElement.classList;
  ['status-pranim','status-pastrim','status-gati','status-transport','status-marrje','status-noshow'].forEach(c=>cls.remove(c));
  const map = {pranim:'status-pranim', pastrim:'status-pastrim', gati:'status-gati', transport:'status-transport', marrje:'status-marrje', noshow:'status-noshow'};
  cls.add(map[status] || 'status-pranim');
}

// ---- Future: Supabase (disabled by default) ----
export const SB = {
  enabled: false,
  url: '', key: '',
  async pushOrder(o){ if(!this.enabled) return null; /* TODO: implement */ return null; },
  async listOrders(){ if(!this.enabled) return getOrdersIndex(); }
};

// ---- Simple list rendering helper ----
export function renderOrdersList(el){
  const idx = getOrdersIndex();
  el.innerHTML = idx.map(x=>`<a class="btn" href="/pranimi/?id=${encodeURIComponent(x.id)}">${x.name||'(pa emër)'} • ${x.phone||''}</a>`).join('<br>');
}
