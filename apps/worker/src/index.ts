// Worker de All Open Project: recibe los datos del robot y del radar (/ingest), sirve la salud de
// los dos (/estado y /api/v1/estado) y las tendencias (/api/v1/tendencias), y su cron lanza el
// radar cada hora y el robot cada noche (src/disparo.ts). El resto de la API pública, el MCP y la
// búsqueda llegan en las fases E y F. La página para revisar las posibles copias es otro Worker
// (src/revisar.ts), protegido entero con Cloudflare Access.

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { lanzarLoQueToca } from './disparo.ts';
import { estado } from './estado.ts';
import { ingesta } from './ingesta.ts';
import { radar, tendencias } from './radar.ts';
import type { Contexto, Entorno } from './tipos.ts';

const app = new Hono<Contexto>();

app.get('/', (c) =>
  c.json({
    nombre: 'All Open Project',
    descripcion: 'Lo mejor del open source, explicado y verificado. La web llegará pronto.',
    estado: '/estado',
    api: { estado: '/api/v1/estado', tendencias: '/api/v1/tendencias' },
    codigo: 'https://github.com/jornnnn/all-open-project',
  }),
);
// Los navegadores piden el icono aunque la página no lo enlace: sin contenido, mejor que un 404.
app.get('/favicon.ico', (c) => c.body(null, 204));
// El radar va dentro de /ingest para compartir su clave y su límite de tamaño.
ingesta.route('/radar', radar);
app.route('/ingest', ingesta);
app.route('/', estado);
app.route('/', tendencias);

app.notFound((c) => c.json({ error: 'No existe' }, 404));
app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  console.error(error);
  return c.json({ error: 'Error interno' }, 500);
});

export default {
  fetch: app.fetch,
  /** Cron de wrangler.jsonc (a los :23 de cada hora): lanza el radar y, a las 03:23, el robot. */
  scheduled(controlador, entorno, ctx) {
    ctx.waitUntil(lanzarLoQueToca(entorno, new Date(controlador.scheduledTime)));
  },
} satisfies ExportedHandler<Entorno>;
