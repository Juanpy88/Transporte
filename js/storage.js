// Guardado de rutas. Hoy usa localStorage (solo en este navegador y dispositivo).
// Para migrar a Supabase u otra base de datos: reimplementar estas 3 funciones
// con la misma forma (todas async) y el resto de la app no cambia.
const KEY = 'antofa-rutas:v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const write = l => localStorage.setItem(KEY, JSON.stringify(l));

export const storage = {
  async list() { return read().sort((a, b) => b.updatedAt - a.updatedAt); },

  // route: { id?, name, data }. Con id existente actualiza; sin id crea una nueva.
  async save(route) {
    const l = read(), now = Date.now();
    let r = route.id && l.find(x => x.id === route.id);
    if (r) Object.assign(r, route, { updatedAt: now });
    else { r = { ...route, id: crypto.randomUUID(), createdAt: now, updatedAt: now }; l.push(r); }
    write(l);
    return r;
  },

  async remove(id) { write(read().filter(x => x.id !== id)); }
};
