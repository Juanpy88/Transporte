import { CONFIG } from './config.js';
import { routing } from './providers/routing.js';
import { search, reverse } from './providers/geocoder.js';
import { Gps } from './gps.js';
import { storage } from './storage.js';
import { readRows, locate, template, exportRoute } from './importer.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hhmm = d => new Date(d).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
const dur = m => m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`;
const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const loc = s => s.lat != null;
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
let tt; const toast = t => { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(tt); tt = setTimeout(() => { e.hidden = true; }, 4500); };

/* ---------- Estado (la jornada actual se guarda sola como borrador) ---------- */
const DRAFT = 'antofa-rutas:draft';
const fresh = () => ({ start: null, end: null, stops: [], route: null, opts: { depart: '08:00', service: 3, optimize: true }, name: '', savedId: null });
let S = fresh();
try { Object.assign(S, JSON.parse(localStorage.getItem(DRAFT)) || {}); } catch { /* borrador dañado */ }
let pt; const persist = () => { clearTimeout(pt); pt = setTimeout(() => { try { localStorage.setItem(DRAFT, JSON.stringify(S)); } catch { toast('No hay espacio para guardar el borrador.'); } }, 300); };
const commit = () => { persist(); renderAll(); };
let onlyWarn = false, tab = 'stops', saved = [];

/* ---------- Mapa ---------- */
const map = L.map('map', { maxBounds: CONFIG.bounds, minZoom: 12, zoomControl: false }).setView(CONFIG.center, CONFIG.zoom);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
const gps = new Gps(map), layer = L.layerGroup().addTo(map);

const pin = (t, c = '') => c === 'start'
  ? L.divIcon({ className: '', html: '<div class="pin start"></div>', iconSize: [30, 30], iconAnchor: [15, 29] })
  : L.divIcon({ className: '', html: `<div class="pin ${c}">${t}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] });

function freeMap() { gps.follow = false; $('#recenter').hidden = false; }
map.on('dragstart', freeMap);
$('#recenter').onclick = () => { gps.follow = true; $('#recenter').hidden = true; if (gps.pos) map.setView([gps.pos.lat, gps.pos.lng], Math.max(map.getZoom(), 16)); };

function fitAll() {
  const pts = [...S.stops.filter(loc), S.start, S.end].filter(Boolean).map(p => [p.lat, p.lng]);
  if (!pts.length) return;
  freeMap();
  map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [innerWidth > 700 ? 450 : 30, 30], paddingBottomRight: [30, 30], maxZoom: 16 });
}

function syncMap() {
  layer.clearLayers();
  const idx = new Map((S.route?.order || []).map((id, i) => [id, i + 1]));
  if (S.route) layer.addLayer(L.polyline(S.route.geometry, { color: '#fff', weight: 9, opacity: .9 })).addLayer(L.polyline(S.route.geometry, { color: '#2563eb', weight: 5 }));
  S.stops.filter(loc).forEach(s => {
    const n = idx.get(s.id), c = s.status === 'done' ? 'done' : s.status === 'failed' ? 'fail' : n ? '' : 'sm';
    L.marker([s.lat, s.lng], { icon: pin(n ?? '', c) }).on('click', () => openSheet('stop', s.id)).addTo(layer);
  });
  if (S.start) L.marker([S.start.lat, S.start.lng], { icon: pin('', 'start') }).addTo(layer);
  if (S.end) L.marker([S.end.lat, S.end.lng], { icon: pin('', 'end') }).addTo(layer);
}

/* ---------- Pestañas ---------- */
function setTab(t) {
  tab = t; $('#panel').hidden = t === 'map';
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  ['stops', 'route', 'saved'].forEach(v => { $('#v-' + v).hidden = v !== t; });
}
$('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); };

/* ---------- Pestaña Paradas ---------- */
function renderStops() {
  const n = S.stops.length, warn = S.stops.filter(s => !loc(s)).length;
  $('#cStops').textContent = n || '';
  $('#chips').innerHTML = `<span class="chip"><b>${n}</b> paradas</span><span class="chip"><b>${sum(S.stops, s => s.packages)}</b> paquetes</span>` +
    (warn ? `<button class="chip warn${onlyWarn ? ' on' : ''}" data-w="1"><b>${warn}</b> sin ubicar</button>` : '');
  $('#base').innerHTML = ['start', 'end'].map(k => `<button class="b" data-b="${k}"><span class="dot ${k}"></span><div>
    <small>${k === 'start' ? 'Salida' : 'Destino final (opcional)'}</small><b>${S[k] ? esc(S[k].label) : 'Definir…'}</b></div></button>`).join('');
  const q = $('#filter').value.trim().toLowerCase();
  $('#list').innerHTML = S.stops.map((s, i) => ({ s, i })).filter(({ s }) =>
    (!onlyWarn || !loc(s)) && (!q || (s.client + ' ' + s.address + ' ' + s.notes).toLowerCase().includes(q)))
    .map(({ s, i }) => `<li class="st ${s.status}${loc(s) ? '' : ' warn'}" data-id="${s.id}"><span class="num">${i + 1}</span>
      <div class="info"><b>${esc(s.client || 'Sin nombre')}</b><small>${esc(s.address)}</small></div>
      ${loc(s) ? '' : '<em>Sin ubicar</em>'}<span class="pk">${s.packages} paq.</span></li>`).join('') ||
    '<li class="sub" style="padding:16px 0">Aún no hay paradas. Agrégalas una a una o importa un Excel.</li>';
}
$('#chips').addEventListener('click', e => { if (e.target.closest('[data-w]')) { onlyWarn = !onlyWarn; renderStops(); } });
$('#base').addEventListener('click', e => { const b = e.target.closest('button'); if (b) openSheet(b.dataset.b); });
$('#list').addEventListener('click', e => { const li = e.target.closest('li[data-id]'); if (li) openSheet('stop', li.dataset.id); });
$('#filter').oninput = renderStops;
$('#add').onclick = () => openSheet('stop');
$('#tpl').onclick = template;
$('#clr').onclick = () => { if (S.stops.length && confirm(`¿Quitar las ${S.stops.length} paradas?`)) { S.stops = []; S.route = null; commit(); } };

/* ---------- Importar Excel ---------- */
let ctl = null;
$('#imp').onclick = () => $('#file').click();
$('#file').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const rows = await readRows(f);
    if (!rows.length) { toast('No encontré filas con dirección.'); return; }
    if (S.stops.length && confirm(`Se encontraron ${rows.length} entregas.\n\nAceptar: reemplazar las ${S.stops.length} actuales.\nCancelar: agregarlas al final.`)) S.stops = [];
    S.stops.push(...rows.map(r => ({ id: nid(), status: 'pending', ...r })));
    S.route = null; commit(); setTab('stops'); locateStops();
  } catch (err) { toast(err.message); }
};
async function locateStops() {
  if (ctl || !S.stops.some(s => !loc(s))) return;
  ctl = { stop: false }; $('#prog').hidden = false;
  const r = await locate(S.stops, (n, t) => {
    $('#progTxt').textContent = `Ubicando direcciones… ${n}/${t}`; $('#progBar').style.width = (n / t * 100) + '%';
    persist(); if (n % 10 === 0) renderStops();
  }, ctl);
  $('#prog').hidden = true; ctl = null; S.route = null; commit(); fitAll();
  toast(`${r.ok} de ${r.total} direcciones ubicadas.` + (r.ok < r.total ? ' Revisa las marcadas "Sin ubicar".' : ''));
}
$('#progX').onclick = () => { if (ctl) ctl.stop = true; };

/* ---------- Hoja para agregar o editar ---------- */
let sh = null, pick = null, prevTab = 'stops', sugT, sugSeq = 0, sugItems = [];
const locTxt = () => { $('#fLoc').textContent = sh.pt ? 'Ubicación fijada' : 'Sin ubicación'; $('#fLoc').className = sh.pt ? 'ok' : 'warnTxt'; };

function openSheet(mode, id) {
  const s = id && S.stops.find(x => x.id === id), b = mode !== 'stop' ? S[mode] : null;
  sh = { mode, id, pt: s ? (loc(s) ? { lat: s.lat, lng: s.lng } : null) : b ? { lat: b.lat, lng: b.lng } : null };
  $('#shTitle').textContent = mode === 'start' ? 'Punto de salida' : mode === 'end' ? 'Destino final' : id ? 'Editar parada' : 'Nueva parada';
  $('#fAddr').value = s ? s.address : b ? b.label : '';
  $('#fClient').value = s?.client || ''; $('#fPhone').value = s?.phone || ''; $('#fPk').value = s?.packages || 1; $('#fNotes').value = s?.notes || '';
  $('#fExtra').hidden = mode !== 'stop'; $('#fGps').hidden = mode !== 'start'; $('#fDel').hidden = !(id || b);
  $('#fSugg').innerHTML = ''; locTxt(); $('#sheet').hidden = false;
  if (!s && !b) $('#fAddr').focus();
}
const closeSheet = () => { $('#sheet').hidden = true; sh = null; };
$('#shX').onclick = closeSheet;

$('#fAddr').addEventListener('input', e => {
  sh.pt = null; locTxt(); clearTimeout(sugT);
  const q = e.target.value.trim();
  if (q.length < 3) { $('#fSugg').innerHTML = ''; return; }
  sugT = setTimeout(async () => {
    const my = ++sugSeq;
    try {
      const it = await search(q); if (my !== sugSeq) return;
      sugItems = it;
      $('#fSugg').innerHTML = it.map((r, i) => `<li data-i="${i}"><b>${esc(r.main)}</b><span>${esc(r.sub)}</span></li>`).join('');
    } catch (err) { toast(err.message); }
  }, 350);
});
$('#fSugg').addEventListener('pointerdown', e => {
  const li = e.target.closest('li'); if (!li) return;
  e.preventDefault();
  const r = sugItems[+li.dataset.i];
  sh.pt = { lat: r.lat, lng: r.lng }; $('#fAddr').value = r.label; $('#fSugg').innerHTML = ''; locTxt();
});

$('#fMap').onclick = () => {
  $('#sheet').hidden = true; prevTab = tab; setTab('map'); freeMap();
  $('#banner').hidden = false; $('#map').classList.add('picking');
  if (sh.pt) map.setView([sh.pt.lat, sh.pt.lng], 16);
  pick = (lat, lng) => {
    sh.pt = { lat, lng }; locTxt();
    if (!$('#fAddr').value.trim()) reverse(lat, lng).then(r => { if (r && sh && !$('#fAddr').value.trim()) $('#fAddr').value = r.label; }).catch(() => {});
  };
};
function endPick() { pick = null; $('#banner').hidden = true; $('#map').classList.remove('picking'); setTab(prevTab); $('#sheet').hidden = false; }
map.on('click', e => { if (!pick) return; const p = pick; endPick(); p(e.latlng.lat, e.latlng.lng); });
$('#bannerX').onclick = endPick;

$('#fGps').onclick = () => {
  if (!gps.pos) { toast('Aún no hay ubicación del GPS.'); return; }
  sh.pt = { lat: gps.pos.lat, lng: gps.pos.lng }; locTxt();
  reverse(gps.pos.lat, gps.pos.lng).then(r => { $('#fAddr').value = r?.label || 'Mi ubicación'; }).catch(() => { $('#fAddr').value = 'Mi ubicación'; });
};

$('#fSave').onclick = async () => {
  const addr = $('#fAddr').value.trim();
  if (!addr && !sh.pt) { toast('Escribe una dirección o fíjala en el mapa.'); return; }
  if (!sh.pt) {                       // no eligió sugerencia: intenta ubicar lo escrito
    $('#fSave').textContent = 'Ubicando…';
    try { const r = (await search(addr))[0]; if (r) sh.pt = { lat: r.lat, lng: r.lng }; } catch { /* queda sin ubicar */ }
    $('#fSave').textContent = 'Guardar';
  }
  if (sh.mode === 'stop') {
    const d = { client: $('#fClient').value.trim(), phone: $('#fPhone').value.trim(), address: addr, packages: Math.max(1, +$('#fPk').value || 1),
      notes: $('#fNotes').value.trim(), lat: sh.pt?.lat ?? null, lng: sh.pt?.lng ?? null };
    if (sh.id) Object.assign(S.stops.find(x => x.id === sh.id), d); else S.stops.push({ id: nid(), status: 'pending', ...d });
    if (!sh.pt) toast('No pude ubicar esa dirección. Ábrela y usa "Fijar en el mapa".');
  } else {
    if (!sh.pt) { toast('No encontré esa dirección. Elige una sugerencia o fíjala en el mapa.'); return; }
    S[sh.mode] = { lat: sh.pt.lat, lng: sh.pt.lng, label: addr };
  }
  S.route = null; commit(); closeSheet();
};
$('#fDel').onclick = () => {
  if (sh.mode === 'stop') S.stops = S.stops.filter(x => x.id !== sh.id); else S[sh.mode] = null;
  S.route = null; commit(); closeSheet();
};

/* ---------- Pestaña Ruta ---------- */
const syncOpts = () => { $('#depart').value = S.opts.depart; $('#service').value = S.opts.service; $('#optimize').checked = S.opts.optimize; };
$('#v-route').addEventListener('change', e => {
  if (!['depart', 'service', 'optimize'].includes(e.target.id)) return;
  S.opts = { depart: $('#depart').value || '08:00', service: +$('#service').value || 0, optimize: $('#optimize').checked };
  S.route = null; commit();
});

$('#calc').onclick = async () => {
  if (!S.start) { toast('Primero define el punto de salida.'); setTab('stops'); return; }
  const todo = S.stops.filter(s => loc(s) && s.status === 'pending');
  if (!todo.length) { toast('No hay paradas pendientes con ubicación.'); return; }
  const pts = [{ ...S.start, id: 'start' }, ...todo.map(s => ({ lat: s.lat, lng: s.lng, id: s.id })), ...(S.end ? [{ ...S.end, id: 'end' }] : [])];
  $('#calc').textContent = 'Calculando…'; $('#calc').disabled = true;
  try {
    const r = await routing.solve(pts, { optimize: S.opts.optimize, fixedEnd: !!S.end });
    const [h, m] = S.opts.depart.split(':').map(Number);
    let t = new Date(); t.setHours(h, m, 0, 0);
    const eta = {}; let endT = t;
    r.order.forEach((idx, pos) => {
      if (!pos) return;
      t = new Date(+t + r.legs[pos - 1].duration * 1000); endT = t;
      if (pts[idx].id !== 'end') { eta[pts[idx].id] = t.toISOString(); t = new Date(+t + S.opts.service * 60000); }
    });
    S.route = {
      order: r.order.map(i => pts[i].id).filter(id => id !== 'start' && id !== 'end'), eta, geometry: r.geometry,
      km: sum(r.legs, l => l.distance) / 1000, driveMin: sum(r.legs, l => l.duration) / 60, end: endT.toISOString(),
      skipped: S.stops.filter(s => !loc(s) && s.status === 'pending').length
    };
    commit(); fitAll();
  } catch (err) { toast(err.message + (todo.length > 80 ? ' (el servidor de pruebas puede rechazar rutas muy largas)' : '')); }
  $('#calc').textContent = 'Calcular ruta'; $('#calc').disabled = false;
};

function routeItems() { return (S.route?.order || []).map(id => S.stops.find(s => s.id === id)).filter(Boolean); }

function renderRoute() {
  const r = S.route;
  $('#rsum').hidden = !r; $('#exp').hidden = !r;
  if (!r) { $('#rlist').innerHTML = ''; return; }
  const items = routeItems(), done = items.filter(s => s.status === 'done').length, failed = items.filter(s => s.status === 'failed').length;
  $('#rsum').innerHTML = `<b>${items.length} paradas · ${sum(items, s => s.packages)} paquetes</b>
    <div>${r.km.toFixed(1)} km · ${dur(r.driveMin)} conduciendo · termina ${hhmm(r.end)}</div>
    <div class="track"><i style="width:${items.length ? done / items.length * 100 : 0}%"></i></div>
    <small>${done} entregadas · ${failed} no entregadas${r.skipped ? ` · ${r.skipped} sin ubicar quedaron fuera` : ''}</small>`;
  $('#rlist').innerHTML = items.map((s, i) => `<li class="rt ${s.status}" data-id="${s.id}">
    <div class="top"><span class="num">${i + 1}</span><div class="info"><b>${esc(s.client || 'Sin nombre')}</b><small>${esc(s.address)}</small>${s.notes ? `<small class="nt">${esc(s.notes)}</small>` : ''}</div>
    <div class="eta"><time>${hhmm(r.eta[s.id])}</time><small>${s.packages} paq.</small></div></div>
    <div class="acts"><button data-act="nav">Navegar</button>${s.phone ? '<button data-act="wa">WhatsApp</button>' : ''}
    <button data-act="ok" class="${s.status === 'done' ? 'on' : ''}">Entregado</button><button data-act="no" class="${s.status === 'failed' ? 'bad' : ''}">No entregado</button></div></li>`).join('');
}

function waLink(s) {
  let n = s.phone.replace(/\D/g, ''); if (n.length === 9) n = '56' + n;
  return `https://wa.me/${n}?text=` + encodeURIComponent(`Hola ${s.client || ''}, tu pedido llegará aproximadamente a las ${hhmm(S.route.eta[s.id])}.`);
}
$('#rlist').addEventListener('click', e => {
  const li = e.target.closest('li'); if (!li) return;
  const s = S.stops.find(x => x.id === li.dataset.id), a = e.target.closest('button')?.dataset.act;
  if (a === 'nav') open(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving`, '_blank');
  else if (a === 'wa') open(waLink(s), '_blank');
  else if (a === 'ok' || a === 'no') { const v = a === 'ok' ? 'done' : 'failed'; s.status = s.status === v ? 'pending' : v; commit(); }
  else { freeMap(); setTab('map'); map.setView([s.lat, s.lng], 17); }
});
$('#exp').onclick = () => exportRoute(routeItems().map((s, i) =>
  [i + 1, hhmm(S.route.eta[s.id]), s.client, s.address, s.phone, s.packages, s.notes, { pending: 'Pendiente', done: 'Entregado', failed: 'No entregado' }[s.status]]));

/* ---------- Pestaña Guardadas ---------- */
const updateEditing = () => { $('#editing').textContent = S.savedId ? 'Editando: ' + S.name : 'Jornada nueva (sin guardar). El borrador se conserva solo.'; };

async function saveDay(asNew) {
  if (!S.stops.length) { toast('No hay paradas que guardar.'); return; }
  const name = $('#rname').value.trim() || 'Jornada ' + new Date().toLocaleDateString('es-CL');
  $('#rname').value = name; S.name = name;
  const r = await storage.save({ id: asNew ? undefined : S.savedId || undefined, name, data: JSON.parse(JSON.stringify(S)) });
  S.savedId = r.id; persist(); updateEditing(); refreshSaved(); toast('Jornada guardada.');
}
async function refreshSaved() {
  saved = await storage.list();
  $('#saved').innerHTML = saved.length ? saved.map(r => `<li data-id="${r.id}"><strong>${esc(r.name)}</strong>
    <div class="sub">${r.data.stops.length} paradas · ${sum(r.data.stops, s => s.packages)} paquetes · ${new Date(r.updatedAt).toLocaleDateString('es-CL')}</div>
    <button data-act="open">Abrir</button><button data-act="rename">Renombrar</button><button data-act="del">Eliminar</button></li>`).join('')
    : '<li class="sub">Aún no hay jornadas guardadas.</li>';
}
$('#save').onclick = () => saveDay(false);
$('#saveNew').onclick = () => saveDay(true);
$('#newDay').onclick = () => {
  if (S.stops.length && !confirm('¿Empezar una jornada nueva? Se conservan la salida, el destino y las opciones.')) return;
  S = Object.assign(fresh(), { start: S.start, end: S.end, opts: S.opts });
  $('#rname').value = ''; updateEditing(); commit(); setTab('stops');
};
$('#saved').addEventListener('click', async e => {
  const act = e.target.dataset.act; if (!act) return;
  const r = saved.find(x => x.id === e.target.closest('li').dataset.id);
  if (act === 'open') {
    S = Object.assign(fresh(), r.data, { savedId: r.id, name: r.name });
    $('#rname').value = r.name; syncOpts(); updateEditing(); commit(); fitAll(); setTab('stops'); return;
  }
  if (act === 'rename') {
    const name = prompt('Nuevo nombre:', r.name)?.trim();
    if (name) { await storage.save({ id: r.id, name }); if (r.id === S.savedId) { S.name = name; $('#rname').value = name; updateEditing(); persist(); } }
  }
  if (act === 'del' && confirm(`¿Eliminar "${r.name}"?`)) { await storage.remove(r.id); if (r.id === S.savedId) { S.savedId = null; updateEditing(); persist(); } }
  refreshSaved();
});

/* ---------- Inicio ---------- */
function renderAll() { renderStops(); renderRoute(); syncMap(); }

let first = true;
gps.start(p => {
  if (!first) return; first = false;
  if (p.acc > 150) toast(`Ubicación aproximada (±${Math.round(p.acc)} m). Es normal en computadores.`);
  if (!S.start) {
    S.start = { lat: p.lat, lng: p.lng, label: 'Mi ubicación' }; commit();
    reverse(p.lat, p.lng).then(r => { if (r && S.start?.label === 'Mi ubicación') { S.start.label = r.label; commit(); } }).catch(() => {});
  }
}, err => toast(err + '. Activa la ubicación para ver dónde estás.'));

syncOpts(); $('#rname').value = S.name || ''; updateEditing(); renderAll(); setTab('stops'); refreshSaved();
if (S.stops.length || S.start) fitAll();
