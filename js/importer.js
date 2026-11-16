// Importación y exportación de Excel/CSV (SheetJS, cargado en index.html) y ubicación masiva de direcciones.
import { search } from './providers/geocoder.js';

const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const COLS = {
  client: ['cliente', 'nombre', 'destinatario'],
  address: ['direccion', 'domicilio', 'calle'],
  commune: ['comuna', 'sector', 'ciudad'],
  phone: ['telefono', 'fono', 'celular', 'whatsapp', 'movil'],
  packages: ['paquetes', 'bultos', 'cantidad', 'unidades'],
  notes: ['notas', 'observaciones', 'observacion', 'detalle', 'descripcion', 'producto'],
  lat: ['lat', 'latitud'], lng: ['lng', 'lon', 'long', 'longitud']
};

export async function readRows(file) {
  const wb = XLSX.read(await file.arrayBuffer());
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  if (!raw.length) return [];
  const keys = Object.keys(raw[0]), col = {};
  for (const [f, al] of Object.entries(COLS))
    col[f] = keys.find(k => al.includes(norm(k))) || (f === 'lat' || f === 'lng' ? null : keys.find(k => al.some(a => norm(k).includes(a))));
  if (!col.address) throw new Error('No encontré una columna "Dirección" en el archivo.');
  return raw.map(r => {
    const g = f => (col[f] ? String(r[col[f]]).trim() : '');
    let address = g('address'); if (!address) return null;
    const c = g('commune'); if (c && !norm(address).includes(norm(c))) address += ', ' + c;
    const lat = parseFloat(g('lat').replace(',', '.')), lng = parseFloat(g('lng').replace(',', '.'));
    const ok = isFinite(lat) && isFinite(lng);
    return { client: g('client'), phone: g('phone'), address, packages: parseInt(g('packages')) || 1, notes: g('notes'), lat: ok ? lat : null, lng: ok ? lng : null };
  }).filter(Boolean);
}

const CK = 'antofa-rutas:geocache', sleep = ms => new Promise(r => setTimeout(r, ms));

// Ubica una a una las paradas sin coordenadas (con caché para no repetir búsquedas).
export async function locate(stops, onProgress, ctl) {
  let cache = {}; try { cache = JSON.parse(localStorage.getItem(CK)) || {}; } catch { /* sin caché */ }
  const todo = stops.filter(s => s.lat == null); let ok = 0, n = 0;
  for (const s of todo) {
    if (ctl.stop) break;
    let hit = cache[s.address];
    if (hit === undefined) {
      try { const r = (await search(s.address))[0]; hit = r ? { lat: r.lat, lng: r.lng } : null; cache[s.address] = hit; } catch { hit = undefined; }
      await sleep(300);
    }
    if (hit) { s.lat = hit.lat; s.lng = hit.lng; ok++; }
    onProgress(++n, todo.length);
  }
  try { localStorage.setItem(CK, JSON.stringify(cache)); } catch { /* caché llena */ }
  return { ok, total: todo.length };
}

function download(rows, name) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Hoja1');
  XLSX.writeFile(wb, name);
}
export const template = () => download([
  ['Cliente', 'Dirección', 'Comuna', 'Teléfono', 'Paquetes', 'Notas'],
  ['Juan Pérez', 'Av. Argentina 1234', 'Antofagasta', '912345678', 2, 'Dejar con conserje'],
  ['María Soto', 'Latorre 2450', 'Antofagasta', '987654321', 1, '']
], 'plantilla_entregas.xlsx');
export const exportRoute = rows => download([['Orden', 'Hora estimada', 'Cliente', 'Dirección', 'Teléfono', 'Paquetes', 'Notas', 'Estado'], ...rows], 'ruta_del_dia.xlsx');
