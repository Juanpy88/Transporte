// Proveedor gratuito: servidor demo público de OSRM (sin clave, sin tráfico, solo para pruebas).
const BASE = 'https://router.project-osrm.org';

export async function solve(points, { optimize, fixedEnd }) {
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
  const common = 'overview=full&geometries=geojson&steps=false';
  const url = optimize
    ? `${BASE}/trip/v1/driving/${coords}?${common}&roundtrip=false&source=first&destination=${fixedEnd ? 'last' : 'any'}`
    : `${BASE}/route/v1/driving/${coords}?${common}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error('Error del servicio de rutas (' + res.status + ')');
  const data = await res.json();
  if (data.code !== 'Ok') throw new Error('No se pudo calcular la ruta: ' + data.code);

  const r = optimize ? data.trips[0] : data.routes[0];
  const order = optimize
    ? data.waypoints.map((w, i) => ({ i, k: w.waypoint_index })).sort((a, b) => a.k - b.k).map(o => o.i)
    : points.map((_, i) => i);

  return {
    order,
    legs: r.legs.map(l => ({ duration: l.duration, distance: l.distance })),
    geometry: r.geometry.coordinates.map(([lng, lat]) => [lat, lng])
  };
}
