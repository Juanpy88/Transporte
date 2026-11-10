// Sugerencias de direcciones y geocodificación inversa (Photon, basado en OSM, gratuito).
// Para migrar (Google Places, Mapbox...): mantener las funciones search() y reverse() con la misma forma.
import { CONFIG } from '../config.js';

const BASE = 'https://photon.komoot.io';

const toItem = f => {
  const p = f.properties || {};
  const main = p.street ? p.street + (p.housenumber ? ' ' + p.housenumber : '') : (p.name || '');
  const area = p.district || p.locality;
  return {
    main: main || 'Punto en el mapa',
    sub: [p.street && p.name && p.name !== p.street ? p.name : null, area, p.city].filter(Boolean).join(', '),
    label: [main, area].filter(Boolean).join(', ') || 'Punto en el mapa',
    lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0]
  };
};

async function get(path, params) {
  const r = await fetch(BASE + path + '?' + new URLSearchParams(params));
  if (!r.ok) throw new Error('Buscador no disponible (' + r.status + ')');
  return (await r.json()).features || [];
}

export async function search(q) {
  const [lat, lon] = CONFIG.center;
  return (await get('/api/', { q, limit: 6, bbox: CONFIG.bbox, lat, lon })).map(toItem);
}

export async function reverse(lat, lng) {
  const f = await get('/reverse', { lat, lon: lng });
  return f.length ? toItem(f[0]) : null;
}
