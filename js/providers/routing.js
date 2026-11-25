// Selector de proveedor de rutas. Con CONFIG.tomtomKey usa TomTom (tráfico en vivo, hasta 150 paradas);
// sin clave sigue usando el servidor de pruebas OSRM. El resto de la app no cambia.
import { CONFIG } from '../config.js';
import * as osrm from './osrm.js';
import * as tomtom from './tomtom.js';

const providers = { osrm, tomtom /*, google, here */ };
export const routing = providers[CONFIG.tomtomKey ? 'tomtom' : CONFIG.provider];

/* Contrato de solve(points, { optimize, fixedEnd }):
   points: [{lat, lng}]. El índice 0 es el inicio fijo; si fixedEnd es true,
           el último punto es el destino fijo.
   devuelve: {
     order:    [índices de points en orden de visita],
     legs:     [{duration (s), distance (m)}] un tramo por cada salto del orden,
     geometry: [[lat, lng], ...] trazado completo
   } */
