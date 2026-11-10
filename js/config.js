// Toda la configuración en un solo lugar.
export const CONFIG = {
  center: [-23.65, -70.40],
  zoom: 12,
  bounds: [[-24.00, -70.80], [-23.30, -70.10]],   // límite del mapa, con margen amplio: uno ajustado hace saltar el zoom
  bbox: '-70.55,-23.80,-70.30,-23.45',             // búsqueda de direcciones: minLon,minLat,maxLon,maxLat
  provider: 'osrm',                                // cambiar aquí al migrar (ors, google, mapbox...)
  defaultServiceMin: 5
};
