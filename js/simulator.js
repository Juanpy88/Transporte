// Mueve un vehículo ficticio a lo largo de la ruta calculada.
export class Simulator {
  constructor(map) { this.map = map; this.m = null; this.raf = null; }

  start(geo, totalSeconds, speed, onTick) {
    this.stop();
    const cum = [0];
    for (let i = 1; i < geo.length; i++) cum.push(cum[i - 1] + this.map.distance(geo[i - 1], geo[i]));
    const totalD = cum[cum.length - 1] || 1;
    this.m = L.circleMarker(geo[0], { radius: 9, color: '#fff', weight: 3, fillColor: '#e11d48', fillOpacity: 1 }).addTo(this.map);
    const t0 = performance.now();
    let k = 0;
    const step = now => {
      const el = Math.min(((now - t0) / 1000) * speed, totalSeconds);
      const target = (el / totalSeconds) * totalD;
      while (k < cum.length - 2 && cum[k + 1] < target) k++;
      const f = Math.min(1, (target - cum[k]) / ((cum[k + 1] - cum[k]) || 1));
      this.m.setLatLng([geo[k][0] + (geo[k + 1][0] - geo[k][0]) * f, geo[k][1] + (geo[k + 1][1] - geo[k][1]) * f]);
      onTick(el);
      if (el < totalSeconds) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  stop() { cancelAnimationFrame(this.raf); if (this.m) this.m.remove(); this.m = null; }
}
