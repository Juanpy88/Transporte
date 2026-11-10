// Búsqueda de direcciones (Nominatim/OSM). Máx. 1 solicitud por segundo.
import { CONFIG } from '../config.js';

export async function geocode(q) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({
    format: 'jsonv2', q: q + ', Antofagasta', viewbox: CONFIG.viewbox,
    bounded: 1, limit: 5, countrycodes: 'cl'
  });
  const r = await fetch(u);
  if (!r.ok) throw new Error('Buscador no disponible (' + r.status + ')');
  return (await r.json()).map(x => ({ label: x.display_name, lat: +x.lat, lng: +x.lon }));
}
