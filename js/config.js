// Toda la configuración en un solo lugar.
export const CONFIG = {
  center: [-23.65, -70.40],
  zoom: 12,
  bounds: [[-23.80, -70.55], [-23.45, -70.30]],   // límite de Antofagasta
  viewbox: '-70.55,-23.45,-70.30,-23.80',          // formato Nominatim: izq,arriba,der,abajo
  provider: 'osrm',                                // cambiar aquí al migrar (ors, google, mapbox...)
  defaultServiceMin: 5
};
