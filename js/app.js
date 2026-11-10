import { CONFIG } from './config.js';
import { routing } from './providers/routing.js';
import { geocode } from './providers/geocoder.js';
import { Simulator } from './simulator.js';
import { Gps } from './gps.js';
import { storage } from './storage.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = d => d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
const min = s => Math.max(1, Math.round(s / 60));
const msg = t => { $('#msg').textContent = t; };

const map = L.map('map', { maxBounds: CONFIG.bounds, minZoom: 11 }).setView(CONFIG.center, CONFIG.zoom);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
const sim = new Simulator(map), gps = new Gps(map);

let base = { start: null, end: null }, stops = [], markers = new Map();
let line = null, result = null, uid = 0, currentId = null, saved = [];

const allPts = () => [base.start, ...stops, base.end].filter(Boolean);
const pin = (t, c = '') => L.divIcon({ className: '', html: `<div class="pin ${c}">${t}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });

/* ---------- Puntos ---------- */
function mk(lat, lng, label, service, role) {
  const p = { id: ++uid, lat, lng, label, service, role };
  const m = L.marker([lat, lng], { draggable: true }).addTo(map);
  m.on('dragend', () => { const q = m.getLatLng(); p.lat = q.lat; p.lng = q.lng; invalidate(); });
  markers.set(p.id, m);
  return p;
}

function place(role, lat, lng, label) {
  if (role === 'stop') stops.push(mk(lat, lng, label || 'Parada ' + (stops.length + 1), CONFIG.defaultServiceMin, role));
  else {
    const old = base[role];
    if (old) { markers.get(old.id).remove(); markers.delete(old.id); }
    base[role] = mk(lat, lng, label || (role === 'start' ? 'Punto de partida' : 'Punto de dejada'), 0, role);
    $('#target').value = 'stop';
  }
  invalidate();
}

function removePoint(id) {
  markers.get(id)?.remove(); markers.delete(id);
  if (base.start?.id === id) base.start = null;
  if (base.end?.id === id) base.end = null;
  stops = stops.filter(s => s.id !== id);
  invalidate();
}

function clearAll() {
  markers.forEach(m => m.remove()); markers.clear();
  base = { start: null, end: null }; stops = [];
  invalidate();
}

function invalidate() {          // cualquier cambio borra el resultado anterior
  result = null; sim.stop();
  if (line) { line.remove(); line = null; }
  $('#summary').textContent = ''; $('#eta').innerHTML = ''; $('#simInfo').textContent = '';
  stops.forEach((s, i) => markers.get(s.id).setIcon(pin(i + 1)));
  if (base.start) markers.get(base.start.id).setIcon(pin('I', 'start'));
  if (base.end) markers.get(base.end.id).setIcon(pin('F', 'end'));
  renderPoints();
}

function renderPoints() {
  $('#stops').innerHTML = allPts().map(p => {
    const tag = p.role === 'start' ? 'Inicio' : p.role === 'end' ? 'Destino' : 'P' + (stops.indexOf(p) + 1);
    const svc = p.role === 'stop' ? `<input class="svc" type="number" min="0" value="${p.service}" title="Minutos de servicio">` : '';
    return `<li data-id="${p.id}"><div class="s"><span class="tag ${p.role}">${tag}</span>
      <input class="name" type="text" value="${esc(p.label)}">${svc}<button data-del="${p.id}">✕</button></div></li>`;
  }).join('');
}

$('#stops').addEventListener('input', e => {
  const p = allPts().find(x => x.id === +e.target.closest('li').dataset.id);
  if (e.target.classList.contains('name')) p.label = e.target.value;
  if (e.target.classList.contains('svc')) p.service = +e.target.value || 0;
});
$('#stops').addEventListener('click', e => { if (e.target.dataset.del) removePoint(+e.target.dataset.del); });
map.on('click', e => place($('#target').value, e.latlng.lat, e.latlng.lng));

$('#q').addEventListener('keydown', async e => {
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  msg('Buscando…');
  try {
    const list = await geocode(e.target.value.trim());
    msg(list.length ? '' : 'Sin resultados. Haz clic en el mapa para ubicar el punto.');
    $('#results').innerHTML = list.map((r, i) => `<li data-i="${i}">${esc(r.label)}</li>`).join('');
    $('#results').onclick = ev => {
      const r = list[ev.target.dataset.i]; if (!r) return;
      place($('#target').value, r.lat, r.lng, r.label.split(',').slice(0, 2).join(','));
      map.setView([r.lat, r.lng], 15);
      $('#results').innerHTML = ''; $('#q').value = '';
    };
  } catch (err) { msg(err.message); }
});

/* ---------- Cálculo ---------- */
$('#calc').onclick = async () => {
  if (!base.start) { msg('Falta el punto de partida.'); return; }
  const pts = allPts();
  if (pts.length < 2) { msg('Agrega al menos una parada o el punto de dejada.'); return; }
  msg('Calculando…');
  try {
    result = await routing.solve(pts, { optimize: $('#optimize').checked, fixedEnd: !!base.end });
    result.pts = pts;
    msg('');
    showResult();
  } catch (err) { msg(err.message); }
};

function showResult() {
  const { order, legs, geometry, pts } = result;
  line = L.polyline(geometry, { color: '#2563eb', weight: 5, opacity: .8 }).addTo(map);
  map.fitBounds(line.getBounds(), { padding: [40, 40] });

  const [h, m] = $('#depart').value.split(':').map(Number);
  let t = new Date(); t.setHours(h, m, 0, 0);
  const rows = ['<tr><th>#</th><th>Parada</th><th>Tramo</th><th>Llegada</th></tr>'];

  order.forEach((idx, pos) => {
    const p = pts[idx], isEnd = p.role === 'end';
    markers.get(p.id).setIcon(pos === 0 ? pin('I', 'start') : isEnd ? pin('F', 'end') : pin(pos));
    if (pos === 0) { rows.push(`<tr><td>I</td><td>${esc(p.label)}</td><td>—</td><td>${fmt(t)} (salida)</td></tr>`); return; }
    t = new Date(t.getTime() + legs[pos - 1].duration * 1000);
    rows.push(`<tr><td>${isEnd ? 'F' : pos}</td><td>${esc(p.label)}</td><td>${min(legs[pos - 1].duration)} min</td><td>${fmt(t)}</td></tr>`);
    t = new Date(t.getTime() + p.service * 60000);
  });
  $('#eta').innerHTML = rows.join('');
  const dist = legs.reduce((a, l) => a + l.distance, 0) / 1000;
  $('#summary').textContent = `Total: ${dist.toFixed(1)} km · ${min(legs.reduce((a, l) => a + l.duration, 0))} min de manejo`;
}

$('#sim').onclick = () => {
  if (!result) { msg('Calcula la ruta primero.'); return; }
  const { order, legs, geometry, pts } = result;
  const total = legs.reduce((a, l) => a + l.duration, 0);
  let acc = 0; const cum = legs.map(l => (acc += l.duration));
  sim.start(geometry, total, +$('#speed').value, el => {
    const k = cum.findIndex(c => c > el);
    $('#simInfo').textContent = k === -1 ? 'Recorrido completado.'
      : `Próxima parada: ${pts[order[k + 1]].label} en ${min(cum[k] - el)} min`;
  });
};

$('#clear').onclick = () => { clearAll(); currentId = null; $('#rname').value = ''; updateEditing(); };

/* ---------- GPS ---------- */
function gpsOff() { gps.stop(); $('#gpsBtn').textContent = 'Activar GPS'; $('#gpsStart').disabled = true; $('#gpsInfo').textContent = ''; }
$('#gpsBtn').onclick = () => {
  if (gps.active) { gpsOff(); return; }
  $('#gpsBtn').textContent = 'Desactivar GPS';
  $('#gpsInfo').textContent = 'Buscando señal…';
  gps.start(p => {
    $('#gpsStart').disabled = false;
    $('#gpsInfo').textContent = `Precisión ±${Math.round(p.acc)} m` + (p.speed != null ? ` · ${Math.round(p.speed * 3.6)} km/h` : '');
  }, err => { gpsOff(); $('#gpsInfo').textContent = err; });
};
$('#follow').onchange = e => { gps.follow = e.target.checked; };
$('#gpsStart').onclick = () => { if (gps.pos) place('start', gps.pos.lat, gps.pos.lng, 'Mi ubicación'); };

/* ---------- Rutas guardadas ---------- */
const strip = p => p && { lat: p.lat, lng: p.lng, label: p.label, service: p.service };
const snapshot = () => ({
  start: strip(base.start), end: strip(base.end), stops: stops.map(strip),
  options: { optimize: $('#optimize').checked, depart: $('#depart').value }
});

function updateEditing() {
  $('#editing').textContent = currentId ? 'Editando: ' + $('#rname').value : 'Ruta nueva (sin guardar)';
}

async function save(asNew) {
  if (!allPts().length) { msg('No hay nada que guardar.'); return; }
  const name = $('#rname').value.trim() || 'Ruta sin nombre';
  $('#rname').value = name;
  const r = await storage.save({ id: asNew ? undefined : currentId || undefined, name, data: snapshot() });
  currentId = r.id; updateEditing(); await refreshSaved(); msg('Ruta guardada.');
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
  clearAll();
  const d = r.data;
  if (d.start) place('start', d.start.lat, d.start.lng, d.start.label);
  if (d.end) place('end', d.end.lat, d.end.lng, d.end.label);
  d.stops.forEach(s => { place('stop', s.lat, s.lng, s.label); stops[stops.length - 1].service = s.service; });
  $('#optimize').checked = d.options.optimize; $('#depart').value = d.options.depart;
  $('#rname').value = r.name; currentId = r.id;
  invalidate(); updateEditing();
  if (markers.size) map.fitBounds(L.featureGroup([...markers.values()]).getBounds(), { padding: [40, 40] });
}

$('#save').onclick = () => save(false);
$('#saveNew').onclick = () => save(true);
$('#rname').oninput = () => { if (currentId) updateEditing(); };

$('#saved').addEventListener('click', async e => {
  const act = e.target.dataset.act; if (!act) return;
  const r = saved.find(x => x.id === e.target.closest('li').dataset.id);
  if (act === 'open') load(r);
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

refreshSaved();
