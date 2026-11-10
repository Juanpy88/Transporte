// Selector de proveedor de rutas. Para migrar: crear otro archivo con la misma
// función solve() y registrarlo aquí. El resto de la app no cambia.
import { CONFIG } from '../config.js';
import * as osrm from './osrm.js';

const providers = { osrm /*, ors, google, mapbox */ };
export const routing = providers[CONFIG.provider];

/* Contrato de solve(points, { optimize, roundtrip }):
   points: [{lat, lng}] (el índice 0 es el inicio)
   devuelve: {
     order:    [índices de points en el orden de visita, empezando en 0],
     legs:     [{duration (s), distance (m)}] un tramo por cada salto del orden
               (si roundtrip, incluye el tramo de regreso),
     geometry: [[lat, lng], ...] trazado completo de la ruta
   } */
