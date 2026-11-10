// Selector de proveedor de rutas. Para migrar: crear otro archivo con la misma
// función solve() y registrarlo aquí. El resto de la app no cambia.
import { CONFIG } from '../config.js';
import * as osrm from './osrm.js';

const providers = { osrm /*, ors, google, mapbox */ };
export const routing = providers[CONFIG.provider];

/* Contrato de solve(points, { optimize, fixedEnd }):
   points: [{lat, lng}]. El índice 0 es el inicio fijo; si fixedEnd es true,
           el último punto es el destino fijo.
   devuelve: {
     order:    [índices de points en orden de visita],
     legs:     [{duration (s), distance (m)}] un tramo por cada salto del orden,
     geometry: [[lat, lng], ...] trazado completo
   } */
