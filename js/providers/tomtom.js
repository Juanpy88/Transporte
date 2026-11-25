// Rutas con TomTom: el orden de las paradas se calcula aquí (el optimizador de TomTom admite solo 12 puntos)
// y TomTom calcula la ruta real con tráfico (hasta 150 puntos por consulta).
import { CONFIG } from '../config.js';

const ROUTE = 'https://api.tomtom.com/routing/1/calculateRoute';
const R = 6371000, rad = Math.PI / 180;
const dist = (a, b) => Math.hypot((b.lng - a.lng) * rad * Math.cos((a.lat + b.lat) / 2 * rad), (b.lat - a.lat) * rad) * R;

// Vecino más cercano + mejora 2-opt. El inicio (0) y, si existe, el destino quedan fijos.
function sequence(P, fixedEnd) {
  const n = P.length, last = fixedEnd ? n - 1 : -1;
  const free = [...Array(n).keys()].filter(i => i !== 0 && i !== last);
  const path = [0];
  while (free.length) {
    const cur = P[path[path.length - 1]]; let bi = 0;
    free.forEach((p, k) => { if (dist(cur, P[p]) < dist(cur, P[free[bi]])) bi = k; });
    path.push(free.splice(bi, 1)[0]);
  }
  if (fixedEnd) path.push(last);
  for (let improved = true, guard = 0; improved && guard++ < 50;) {
    improved = false;
    for (let i = 1; i < path.length - 1; i++)
      for (let j = i + 1; j < path.length - (fixedEnd ? 1 : 0); j++) {
        const a = P[path[i - 1]], b = P[path[i]], c = P[path[j]], e = j + 1 < path.length ? P[path[j + 1]] : null;
        const before = dist(a, b) + (e ? dist(c, e) : 0), after = dist(a, c) + (e ? dist(b, e) : 0);
        if (after < before - 1e-6) { path.splice(i, j - i + 1, ...path.slice(i, j + 1).reverse()); improved = true; }
      }
  }
  return path;
}

export async function solve(points, { optimize, fixedEnd }) {
  const order = optimize ? sequence(points, fixedEnd) : points.map((_, i) => i);
  const coords = order.map(i => `${points[i].lat.toFixed(6)},${points[i].lng.toFixed(6)}`).join(':');
  const res = await fetch(`${ROUTE}/${coords}/json?` + new URLSearchParams({
    key: CONFIG.tomtomKey, traffic: 'true', travelMode: 'car', routeType: 'fastest', routeRepresentation: 'polyline'
  }));
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new Error('TomTom rutas (' + res.status + '): ' + (e?.error?.description || e?.detailedError?.message || 'revisa que la clave tenga Routing'));
  }
  const r = (await res.json()).routes?.[0];
  if (!r) throw new Error('TomTom no encontró una ruta entre esos puntos.');
  return {
    order,
    legs: r.legs.map(l => ({ duration: l.summary.travelTimeInSeconds, distance: l.summary.lengthInMeters })),
    geometry: r.legs.flatMap(l => l.points.map(p => [p.latitude, p.longitude]))
  };
}
