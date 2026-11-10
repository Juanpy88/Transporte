// Ubicación en vivo del dispositivo (Geolocation API). Requiere HTTPS o localhost.
export class Gps {
  constructor(map) { this.map = map; this.id = null; this.pos = null; this.follow = true; this.marker = null; this.circle = null; this.lock = null; }
  get active() { return this.id !== null; }

  start(onUpdate, onError) {
    if (!navigator.geolocation) { onError('Este navegador no tiene GPS'); return; }
    navigator.wakeLock?.request('screen').then(l => { this.lock = l; }).catch(() => {}); // evita que se apague la pantalla
    this.id = navigator.geolocation.watchPosition(p => {
      const ll = [p.coords.latitude, p.coords.longitude];
      const first = !this.pos;
      this.pos = { lat: ll[0], lng: ll[1], acc: p.coords.accuracy, speed: p.coords.speed, t: p.timestamp };
      if (!this.marker) {
        this.circle = L.circle(ll, { radius: p.coords.accuracy, color: '#2563eb', weight: 1, fillOpacity: .1 }).addTo(this.map);
        this.marker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, keyboard: false, zIndexOffset: -100 }).addTo(this.map);
      }
      this.marker.setLatLng(ll); this.circle.setLatLng(ll).setRadius(p.coords.accuracy);
      if (first) this.map.setView(ll, 16); else if (this.follow && !this.map.getBounds().pad(-0.25).contains(ll)) this.map.panTo(ll, { animate: false });
      onUpdate(this.pos);
    }, e => onError(e.code === 1 ? 'Permiso de ubicación denegado' : 'No se pudo obtener la ubicación'),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  }

  stop() {
    if (this.id !== null) navigator.geolocation.clearWatch(this.id);
    this.id = null; this.pos = null;
    this.marker?.remove(); this.circle?.remove(); this.marker = this.circle = null;
    this.lock?.release().catch(() => {}); this.lock = null;
  }
}
