// Sugerencias de direcciones y geocodificación inversa.
// Sin clave usa Photon (datos de OpenStreetMap, con pocos números de casa en Chile).
// Con CONFIG.tomtomKey usa TomTom, o con CONFIG.hereKey usa HERE: ambos resuelven el número de casa (exacto o interpolado).
// Cada resultado trae exact = true si llegó hasta el número de la casa.
import { CONFIG } from '../config.js';

const PHOTON = 'https://photon.komoot.io';
const TOMTOM = 'https://api.tomtom.com/search/2';
const HERE = 'https://geocode.search.hereapi.com/v1/geocode';
const HERE_REV = 'https://revgeocode.search.hereapi.com/v1/revgeocode';

const fromPhoton = f => {
  const p = f.properties || {};
  const main = p.street ? p.street + (p.housenumber ? ' ' + p.housenumber : '') : (p.name || '');
  const area = p.district || p.locality;
  return {
    main: main || 'Punto en el mapa',
    sub: [p.street && p.name && p.name !== p.street ? p.name : null, area, p.city].filter(Boolean).join(', '),
    label: [main, area].filter(Boolean).join(', ') || 'Punto en el mapa',
    lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], exact: !!p.housenumber
  };
};

const fromHere = i => {
  const a = i.address || {};
  const main = a.street ? a.street + (a.houseNumber ? ' ' + a.houseNumber : '') : i.title;
  return {
    main, sub: [a.district, a.city].filter(Boolean).join(', '),
    label: [main, a.district].filter(Boolean).join(', ') || i.title,
    lat: i.position.lat, lng: i.position.lng, exact: i.resultType === 'houseNumber'
  };
};

const fromTomTom = r => {
  const a = r.address || {};
  const main = a.streetName ? a.streetName + (a.streetNumber ? ' ' + a.streetNumber : '') : (r.poi?.name || a.freeformAddress);
  const area = a.municipalitySubdivision;
  return {
    main, sub: [area, a.municipality].filter(Boolean).join(', '),
    label: [main, area].filter(Boolean).join(', ') || a.freeformAddress,
    lat: r.position.lat, lng: r.position.lon, exact: r.type === 'Point Address' || r.type === 'Address Range'   // punto exacto o interpolado
  };
};

export const providerId = () => (CONFIG.tomtomKey ? 't' : CONFIG.hereKey ? 'h' : 'p');   // distingue la caché de cada proveedor

const inBounds = r => { const b = CONFIG.bounds; return r.lat >= b[0][0] && r.lat <= b[1][0] && r.lng >= b[0][1] && r.lng <= b[1][1]; };

// Si escribió un número y el servicio solo halló la calle, conserva lo escrito y lo marca "(aprox.)".
const approxify = (items, q) => items.map(r => (/\d/.test(q) && !r.exact)
  ? { ...r, label: q.trim() + ' (aprox.)', sub: (r.sub ? r.sub + ' · ' : '') + 'sin número exacto' } : r);

async function get(url, params) {
  const r = await fetch(url + '?' + new URLSearchParams(params));
  if (!r.ok) throw new Error('Buscador no disponible (' + r.status + ')');
  return r.json();
}

export async function search(q) {
  if (CONFIG.tomtomKey) {
    const [lat, lon] = CONFIG.center;
    const d = await get(`${TOMTOM}/search/${encodeURIComponent(q)}.json`, { key: CONFIG.tomtomKey, countrySet: 'CL', lat, lon, radius: 35000,
      limit: 8, language: 'es-ES', typeahead: 'true', idxSet: 'PAD,Addr,Str' });
    return approxify((d.results || []).map(fromTomTom).filter(inBounds).slice(0, 6), q);
  }
  if (CONFIG.hereKey) {
    const d = await get(HERE, { q: q + ', Antofagasta', in: 'countryCode:CHL', at: CONFIG.center.join(','), limit: 8, lang: 'es', apiKey: CONFIG.hereKey });
    return approxify((d.items || []).filter(i => i.position).map(fromHere).filter(inBounds).slice(0, 6), q);
  }
  const [lat, lon] = CONFIG.center;
  return approxify(((await get(PHOTON + '/api/', { q, limit: 6, bbox: CONFIG.bbox, lat, lon })).features || []).map(fromPhoton), q);
}

export async function reverse(lat, lng) {
  if (CONFIG.tomtomKey) {
    const x = (await get(`${TOMTOM}/reverseGeocode/${lat},${lng}.json`, { key: CONFIG.tomtomKey, language: 'es-ES' })).addresses?.[0];
    if (!x) return null;
    const [la, lo] = String(x.position).split(',').map(Number);
    return fromTomTom({ address: x.address, position: { lat: la, lon: lo }, type: 'Point Address' });
  }
  if (CONFIG.hereKey) {
    const d = await get(HERE_REV, { at: lat + ',' + lng, limit: 1, lang: 'es', apiKey: CONFIG.hereKey });
    return d.items?.length ? fromHere(d.items[0]) : null;
  }
  const f = (await get(PHOTON + '/reverse', { lat, lon: lng })).features || [];
  return f.length ? fromPhoton(f[0]) : null;
}
