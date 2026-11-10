import { CONFIG } from './config.js';
import { routing } from './providers/routing.js';
import { geocode } from './providers/geocoder.js';
import { Simulator } from './simulator.js';

const $ = s => document.querySelector(s);
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = d => d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
const min = s => Math.max(1, Math.round(s / 60));

const map = L.map('map', { maxBounds: CONFIG.bounds, minZoom: 11 }).setView(CONFIG.center, CONFIG.zoom);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
const sim = new Simulator(map);

let stops = [], markers = new Map(), line = null, result = null, uid = 0;

function addStop(lat, lng, label) {
  const s = { id: ++uid, lat, lng, label: label || 'Parada ' + uid, service: CONFIG.defaultServiceMin };
  const m = L.marker([lat, lng], { draggable: true }).addTo(map);
  m.on('dragend', () => { const p = m.getLatLng(); s.lat = p.lat; s.lng = p.lng; invalidate(); });
  markers.set(s.id, m);
  stops.push(s);
  invalidate();
}

function removeStop(id) {
  markers.get(id).remove(); markers.delete(id);
  stops = stops.filter(s => s.id !== id);
  invalidate();
}

function invalidate() {         // cualquier cambio borra el resultado anterior
  result = null; sim.stop();
  if (line) { line.remove(); line = null; }
  $('#summary').textContent = ''; $('#eta').innerHTML = ''; $('#simInfo').textContent = '';
  stops.forEach((s, i) => markers.get(s.id).setIcon(pin(i + 1)));
  renderStops();
}

const pin = n => L.divIcon({ className: '', html: `<div class="pin">${n}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });

function renderStops() {
  $('#stops').innerHTML = stops.map((s, i) => `
    <li data-id="${s.id}"><div class="s">
      <input class="name" type="text" value="${esc(s.label)}" title="${i === 0 ? 'Inicio' : 'Nombre'}">
      <input class="svc" type="number" min="0" value="${s.service}" title="Minutos de servicio">
      <button data-del="${s.id}">✕</button></div></li>`).join('');
}

$('#stops').addEventListener('input', e => {
  const s = stops.find(x => x.id === +e.target.closest('li').dataset.id);
  if (e.target.classList.contains('name')) s.label = e.target.value;
  if (e.target.classList.contains('svc')) { s.service = +e.target.value || 0; }
});
$('#stops').addEventListener('click', e => { if (e.target.dataset.del) removeStop(+e.target.dataset.del); });

map.on('click', e => addStop(e.latlng.lat, e.latlng.lng));

$('#q').addEventListener('keydown', async e => {
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  $('#msg').textContent = 'Buscando…';
  try {
    const list = await geocode(e.target.value.trim());
    $('#msg').textContent = list.length ? '' : 'Sin resultados. Haz clic en el mapa para ubicar el punto.';
    $('#results').innerHTML = list.map((r, i) => `<li data-i="${i}">${esc(r.label)}</li>`).join('');
    $('#results').onclick = ev => {
      const r = list[ev.target.dataset.i]; if (!r) return;
      addStop(r.lat, r.lng, r.label.split(',').slice(0, 2).join(','));
      map.setView([r.lat, r.lng], 15);
      $('#results').innerHTML = ''; $('#q').value = '';
    };
  } catch (err) { $('#msg').textContent = err.message; }
});

$('#calc').onclick = async () => {
  if (stops.length < 2) { $('#msg').textContent = 'Agrega al menos 2 paradas.'; return; }
  $('#msg').textContent = 'Calculando…';
  try {
    const opts = { optimize: $('#optimize').checked, roundtrip: $('#roundtrip').checked };
    result = await routing.solve(stops, opts);
    $('#msg').textContent = '';
    showResult(opts.roundtrip);
  } catch (err) { $('#msg').textContent = err.message; }
};

function showResult(roundtrip) {
  const { order, legs, geometry } = result;
  if (line) line.remove();
  line = L.polyline(geometry, { color: '#2563eb', weight: 5, opacity: .8 }).addTo(map);
  map.fitBounds(line.getBounds(), { padding: [40, 40] });

  const [h, m] = $('#depart').value.split(':').map(Number);
  let t = new Date(); t.setHours(h, m, 0, 0);
  const rows = [`<tr><th>#</th><th>Parada</th><th>Tramo</th><th>Llegada</th></tr>`];
  order.forEach((idx, pos) => markers.get(stops[idx].id).setIcon(pin(pos + 1)));

  const arrivals = [];
  order.forEach((idx, pos) => {
    const s = stops[idx];
    if (pos === 0) { rows.push(`<tr><td>1</td><td>${esc(s.label)}</td><td>—</td><td>${fmt(t)} (salida)</td></tr>`); return; }
    t = new Date(t.getTime() + legs[pos - 1].duration * 1000);
    arrivals.push(t);
    rows.push(`<tr><td>${pos + 1}</td><td>${esc(s.label)}</td><td>${min(legs[pos - 1].duration)} min</td><td>${fmt(t)}</td></tr>`);
    t = new Date(t.getTime() + s.service * 60000);
  });
  if (roundtrip) {
    const l = legs[legs.length - 1];
    t = new Date(t.getTime() + l.duration * 1000);
    rows.push(`<tr><td>↩</td><td>Regreso al inicio</td><td>${min(l.duration)} min</td><td>${fmt(t)}</td></tr>`);
  }
  $('#eta').innerHTML = rows.join('');
  const dist = legs.reduce((a, l) => a + l.distance, 0) / 1000;
  const dur = legs.reduce((a, l) => a + l.duration, 0);
  $('#summary').textContent = `Total: ${dist.toFixed(1)} km · ${min(dur)} min de manejo`;
}

$('#sim').onclick = () => {
  if (!result) { $('#msg').textContent = 'Calcula la ruta primero.'; return; }
  const { order, legs, geometry } = result;
  const total = legs.reduce((a, l) => a + l.duration, 0);
  let acc = 0; const cumLeg = legs.map(l => (acc += l.duration));
  sim.start(geometry, total, +$('#speed').value, el => {
    const k = cumLeg.findIndex(c => c > el);
    $('#simInfo').textContent = k === -1 ? 'Recorrido completado.'
      : `Próxima parada: ${stops[order[(k + 1) % order.length]].label} en ${min(cumLeg[k] - el)} min`;
  });
};

$('#clear').onclick = () => {
  markers.forEach(m => m.remove()); markers.clear(); stops = []; invalidate();
};
