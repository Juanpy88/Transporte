import { CONFIG } from './config.js';
import { routing } from './providers/routing.js';
import { search, reverse } from './providers/geocoder.js';
import { Simulator } from './simulator.js';
import { Gps } from './gps.js';
import { storage } from './storage.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = d => d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
const min = s => Math.max(1, Math.round(s / 60));
const msg = t => { $('#msg').textContent = t; };

const map = L.map('map', { maxBounds: CONFIG.bounds, minZoom: 11, zoomControl: false }).setView(CONFIG.center, CONFIG.zoom);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
const sim = new Simulator(map), gps = new Gps(map);

let uid = 0, slots = [], markers = new Map(), line = null, result = null;
let activeId = null, currentId = null, saved = [], autoStart = false, seq = 0, timer = null, cur = { id: 0, items: [] };

const mkSlot = role => ({ id: ++uid, role, text: '', pt: null });   // pt = {lat, lng, label}
const stopsOf = () => slots.filter(s => s.role === 'stop');
const slotById = id => slots.find(s => s.id === id);
const pin = (t, c = '') => L.divIcon({ className: '', html: `<div class="pin ${c}">${t}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
const rowEl = s => document.querySelector(`.prow[data-id="${s.id}"]`);

/* ---------- Mapa y seguimiento GPS ---------- */
function freeMap() { gps.follow = false; $('#recenter').hidden = false; }
map.on('dragstart', freeMap);
$('#recenter').onclick = () => {
  gps.follow = true; $('#recenter').hidden = true;
  if (gps.pos) map.setView([gps.pos.lat, gps.pos.lng], Math.max(map.getZoom(), 16));
};
gps.start(p => {
  if (autoStart) return;
  autoStart = true;
  const s = slots[0];
  if (!s.pt && !s.text) startFromGps();
}, err => msg(err + '. Activa la ubicación para ver dónde estás.'));

function startFromGps() {
  if (!gps.pos) return;
  const s = slots[0];
  setPoint(s, gps.pos.lat, gps.pos.lng, 'Mi ubicación');
  addressOf(s, 'Mi ubicación');
}

/* ---------- Puntos ---------- */
function ensureMarker(s) {
  if (markers.has(s.id)) { markers.get(s.id).setLatLng([s.pt.lat, s.pt.lng]); return; }
  const m = L.marker([s.pt.lat, s.pt.lng], { draggable: true }).addTo(map);
  m.on('dragend', () => {
    const q = m.getLatLng(); s.pt.lat = q.lat; s.pt.lng = q.lng; invalidate();
    addressOf(s);
  });
  markers.set(s.id, m);
}
const dropMarker = s => { markers.get(s.id)?.remove(); markers.delete(s.id); };

function setPoint(s, lat, lng, label) {
  s.pt = { lat, lng, label }; s.text = label;
  ensureMarker(s); invalidate(); render();
}
function clearPoint(s) { s.pt = null; dropMarker(s); invalidate(); }

function setText(s) {
  s.text = s.pt.label;
  const i = rowEl(s)?.querySelector('input'); if (i) i.value = s.text;
}
async function addressOf(s, fallback = 'Punto en el mapa') {
  if (!s.pt) return;
  const { lat, lng } = s.pt;
  let label = fallback;
  try { label = (await reverse(lat, lng))?.label || fallback; } catch { /* usa el texto de respaldo */ }
  if (s.pt && s.pt.lat === lat && s.pt.lng === lng) { s.pt.label = label; setText(s); }
}

function invalidate() {          // cualquier cambio borra el resultado anterior
  result = null; sim.stop();
  if (line) { line.remove(); line = null; }
  $('#result').hidden = true; $('#simInfo').textContent = '';
  let n = 0;
  slots.forEach(s => { if (s.pt) markers.get(s.id).setIcon(s.role === 'stop' ? pin(++n) : pin('', s.role)); });
}

function render() {
  const stops = stopsOf();
  $('#points').innerHTML = slots.map(s => {
    const ph = s.role === 'start' ? 'Punto de partida' : s.role === 'end' ? 'Destino' : 'Añadir parada';
    const last = s === stops[stops.length - 1];
    const acts = s.role !== 'stop' ? '' :
      (stops.length > 1 || s.text ? '<button data-act="rm" title="Quitar parada">×</button>' : '') +
      (last ? '<button data-act="add" title="Añadir otra parada">+</button>' : '');
    return `<div class="prow${s.id === activeId ? ' active' : ''}" data-id="${s.id}"><span class="dot ${s.role}"></span>
      <input type="text" placeholder="${ph}" value="${esc(s.text)}" autocomplete="off"><div class="acts">${acts}</div><ul class="sugg" hidden></ul></div>`;
  }).join('');
}

function resetSlots(d) {
  markers.forEach(m => m.remove()); markers.clear();
  const mk = (role, p) => {
    const s = mkSlot(role);
    if (p) { s.pt = { lat: p.lat, lng: p.lng, label: p.label }; s.text = p.label; ensureMarker(s); }
    return s;
  };
  slots = [mk('start', d?.start), ...(d?.stops?.length ? d.stops : [null]).map(p => mk('stop', p)), mk('end', d?.end)];
  invalidate(); render();
}

/* ---------- Fila activa: el mapa solo fija puntos cuando una fila está seleccionada ---------- */
function setActive(id) {
  activeId = id;
  document.querySelectorAll('.prow').forEach(r => r.classList.toggle('active', +r.dataset.id === id));
  $('#hint').hidden = !id; $('#map').classList.toggle('picking', !!id);
}
$('#panel').addEventListener('pointerdown', e => { if (!e.target.closest('.prow')) setActive(null); });

map.on('click', e => {
  const s = slotById(activeId); if (!s) return;
  setActive(null);
  setPoint(s, e.latlng.lat, e.latlng.lng, 'Buscando dirección…');
  addressOf(s);
});

/* ---------- Autocompletado ---------- */
function showSugg(row, s, items) {
  cur = { id: s.id, items };
  const ul = row.querySelector('.sugg');
  ul.innerHTML = items.map((r, i) => `<li data-i="${i}"><b>${esc(r.main)}</b><span>${esc(r.sub)}</span></li>`).join('');
  ul.hidden = !items.length;
}
const meItem = () => gps.pos && { main: 'Mi ubicación actual', sub: '', label: 'Mi ubicación', lat: gps.pos.lat, lng: gps.pos.lng, me: true };

$('#points').addEventListener('focusin', e => {
  if (e.target.tagName !== 'INPUT') return;
  const row = e.target.closest('.prow'), s = slotById(+row.dataset.id);
  setActive(s.id);
  if (!s.text && meItem()) showSugg(row, s, [meItem()]);
});
$('#points').addEventListener('focusout', e => { const u = e.target.closest('.prow')?.querySelector('.sugg'); if (u) u.hidden = true; });

$('#points').addEventListener('input', e => {
  if (e.target.tagName !== 'INPUT') return;
  const row = e.target.closest('.prow'), s = slotById(+row.dataset.id);
  s.text = e.target.value;
  if (s.pt) clearPoint(s);
  clearTimeout(timer);
  const q = s.text.trim();
  if (q.length < 3) { showSugg(row, s, !q && meItem() ? [meItem()] : []); return; }
  timer = setTimeout(async () => {
    const my = ++seq;
    try {
      const items = await search(q);
      if (my !== seq) return;
      msg(items.length ? '' : 'Sin sugerencias. Toca este recuadro y luego el mapa para fijar el punto.');
      showSugg(row, s, items);
    } catch (err) { msg(err.message); }
  }, 350);
});

$('#points').addEventListener('pointerdown', e => {      // pointerdown: se ejecuta antes de que el input pierda el foco
  const li = e.target.closest('.sugg li'); if (!li) return;
  e.preventDefault();
  const s = slotById(cur.id), r = cur.items[+li.dataset.i]; if (!s || !r) return;
  setActive(null); freeMap();
  setPoint(s, r.lat, r.lng, r.label);
  if (r.me) addressOf(s, 'Mi ubicación');
  map.setView([r.lat, r.lng], Math.max(map.getZoom(), 15));
});

$('#points').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const s = slotById(+b.closest('.prow').dataset.id);
  if (b.dataset.act === 'add') {
    const n = mkSlot('stop'); slots.splice(slots.indexOf(s) + 1, 0, n); render();
    rowEl(n).querySelector('input').focus();
  } else {
    dropMarker(s);
    if (stopsOf().length > 1) slots.splice(slots.indexOf(s), 1); else { s.pt = null; s.text = ''; }
    invalidate(); render();
  }
});

/* ---------- Cálculo y resultado ---------- */
$('#calc').onclick = async () => {
  const st = slots[0], en = slots[slots.length - 1];
  const bad = slots.find(s => s.text.trim() && !s.pt);
  if (bad) { msg(`Elige una sugerencia para "${bad.text}" o fíjala en el mapa.`); return; }
  if (!st.pt) { msg('Falta el punto de partida.'); return; }
  const svc = +$('#service').value || 0;
  const mp = (s, role) => ({ id: s.id, lat: s.pt.lat, lng: s.pt.lng, label: s.pt.label, role, service: role === 'stop' ? svc : 0 });
  const pts = [mp(st, 'start'), ...stopsOf().filter(s => s.pt).map(s => mp(s, 'stop')), ...(en.pt ? [mp(en, 'end')] : [])];
  if (pts.length < 2) { msg('Agrega al menos una parada o el destino.'); return; }
  msg('Calculando…');
  try {
    result = await routing.solve(pts, { optimize: $('#optimize').checked, fixedEnd: !!en.pt });
    result.pts = pts; msg(''); showResult();
  } catch (err) { msg(err.message); }
};

const li = (cls, n, label, sub, t) =>
  `<li><span class="n ${cls}">${n}</span><div><b>${esc(label)}</b><small>${sub}</small></div><time>${fmt(t)}</time></li>`;

function showResult() {
  const { order, legs, geometry, pts } = result;
  line = L.layerGroup([L.polyline(geometry, { color: '#fff', weight: 10, opacity: .9 }), L.polyline(geometry, { color: '#111', weight: 5 })]).addTo(map);
  freeMap();
  const wide = innerWidth > 700;
  map.fitBounds(L.polyline(geometry).getBounds(), { paddingTopLeft: [wide ? 420 : 30, 30], paddingBottomRight: [30, wide ? 30 : innerHeight * .55] });

  const [h, m] = $('#depart').value.split(':').map(Number);
  let t = new Date(); t.setHours(h, m, 0, 0);
  const items = [];
  order.forEach((idx, pos) => {
    const p = pts[idx];
    if (pos === 0) { markers.get(p.id).setIcon(pin('', 'start')); items.push(li('start', '', p.label, 'Salida', t)); return; }
    t = new Date(t.getTime() + legs[pos - 1].duration * 1000);
    const end = p.role === 'end';
    markers.get(p.id).setIcon(end ? pin('', 'end') : pin(pos));
    items.push(li(end ? 'end' : '', end ? '' : pos, p.label, min(legs[pos - 1].duration) + ' min desde la anterior', t));
    t = new Date(t.getTime() + p.service * 60000);
  });
  $('#eta').innerHTML = items.join('');
  const dist = legs.reduce((a, l) => a + l.distance, 0) / 1000;
  $('#summary').textContent = `${dist.toFixed(1)} km · ${min(legs.reduce((a, l) => a + l.duration, 0))} min de manejo`;
  $('#result').hidden = false;
}

$('#sim').onclick = () => {
  if (!result) return;
  const { order, legs, geometry, pts } = result;
  const total = legs.reduce((a, l) => a + l.duration, 0);
  let acc = 0; const cum = legs.map(l => (acc += l.duration));
  sim.start(geometry, total, +$('#speed').value, el => {
    const k = cum.findIndex(c => c > el);
    $('#simInfo').textContent = k === -1 ? 'Recorrido completado.'
      : `Próxima parada: ${pts[order[k + 1]].label} en ${min(cum[k] - el)} min`;
  });
};

/* ---------- Rutas guardadas ---------- */
const strip = (s, svc) => s.pt ? { lat: s.pt.lat, lng: s.pt.lng, label: s.pt.label, service: svc } : null;
const snapshot = () => {
  const svc = +$('#service').value || 0;
  return {
    start: strip(slots[0], 0), end: strip(slots[slots.length - 1], 0),
    stops: stopsOf().filter(s => s.pt).map(s => strip(s, svc)),
    options: { optimize: $('#optimize').checked, depart: $('#depart').value, service: svc }
  };
};
const updateEditing = () => { $('#editing').textContent = currentId ? 'Editando: ' + $('#rname').value : 'Ruta nueva (sin guardar)'; };
const showView = v => { $('#viewPlan').hidden = v !== 'plan'; $('#viewSaved').hidden = v !== 'saved'; };

async function save(asNew) {
  const d = snapshot();
  if (!d.start && !d.end && !d.stops.length) { msg('No hay nada que guardar.'); return; }
  const name = $('#rname').value.trim() || 'Ruta sin nombre';
  $('#rname').value = name;
  const r = await storage.save({ id: asNew ? undefined : currentId || undefined, name, data: d });
  currentId = r.id; updateEditing(); msg('Ruta guardada.'); refreshSaved();
}

async function refreshSaved() {
  saved = await storage.list();
  $('#saved').innerHTML = saved.length ? saved.map(r => `
    <li data-id="${r.id}"><strong>${esc(r.name)}</strong>
      <div class="meta">${r.data.stops.length} paradas · ${new Date(r.updatedAt).toLocaleDateString('es-CL')}</div>
      <button data-act="open">Abrir</button><button data-act="rename">Renombrar</button><button data-act="del">Eliminar</button>
    </li>`).join('') : '<li class="meta">Aún no hay rutas guardadas.</li>';
}

function load(r) {
  const d = r.data;
  resetSlots(d);
  $('#optimize').checked = d.options.optimize; $('#depart').value = d.options.depart; $('#service').value = d.options.service ?? 5;
  $('#rname').value = r.name; currentId = r.id; updateEditing(); msg(''); showView('plan');
  if (markers.size) { freeMap(); map.fitBounds(L.featureGroup([...markers.values()]).getBounds(), { padding: [60, 60], maxZoom: 16 }); }
}

$('#save').onclick = () => save(false);
$('#saveNew').onclick = () => save(true);
$('#rname').oninput = () => { if (currentId) updateEditing(); };
$('#openSaved').onclick = () => { refreshSaved(); showView('saved'); };
$('#back').onclick = () => showView('plan');
$('#newRoute').onclick = () => {
  resetSlots(null); currentId = null; $('#rname').value = ''; updateEditing(); msg('');
  startFromGps();
};

$('#saved').addEventListener('click', async e => {
  const act = e.target.dataset.act; if (!act) return;
  const r = saved.find(x => x.id === e.target.closest('li').dataset.id);
  if (act === 'open') { load(r); return; }
  if (act === 'rename') {
    const name = prompt('Nuevo nombre:', r.name)?.trim();
    if (name) { await storage.save({ id: r.id, name }); if (r.id === currentId) { $('#rname').value = name; updateEditing(); } }
  }
  if (act === 'del' && confirm(`¿Eliminar "${r.name}"?`)) {
    await storage.remove(r.id);
    if (r.id === currentId) { currentId = null; updateEditing(); }
  }
  refreshSaved();
});

resetSlots(null);
refreshSaved();
