# apps/worker

Dos Workers de Cloudflare (Hono + D1) con la misma base de datos:

- **Público** (`wrangler.jsonc`, `all-open-project`): recibe los datos del robot y del radar en `/ingest`, sirve la salud de los dos y las tendencias. Su cron (a los :23 de cada hora) pide a GitHub que ejecute el radar y, a las 03:23 UTC, también el robot diario (`src/disparo.ts`), porque las tareas programadas de GitHub no son fiables. Usa el secreto `DISPARO_TOKEN`: un token de GitHub que solo puede lanzar los workflows de este repo (permiso «Actions: Read and write»). Si ya hay una ejecución reciente (por ejemplo, una lanzada a mano), no la repite; si no puede lanzar, lo apunta en `/estado`. La API completa, el servidor MCP, la búsqueda y la versión Markdown de las páginas llegan en las fases E y F.
- **Revisión** (`wrangler.revisar.jsonc`, `all-open-project-revisar`): la página donde una persona decide sobre las posibles copias falsas y los proyectos nuevos que propone el radar. Se protege entero con Cloudflare Access (pestaña «Access» del Worker → «All traffic»). Además, el Worker comprueba que la petición viene de Access (`ctx.access`) y que el correo está en el secreto `REVISORES` (separados por comas). Sin las dos cosas, no abre.

| Ruta | Para qué |
|---|---|
| `GET /estado` | Página interna con la última ejecución del robot, sus errores y avisos |
| `GET /api/v1/estado` | Lo mismo en JSON (público, con caché de 60 s) |
| `POST /ingest/ejecucion` | El robot anota el comienzo y el final de cada ejecución |
| `POST /ingest/proyectos?fecha=AAAA-MM-DD` | Ficha y foto del día de un lote de proyectos |
| `POST /ingest/cierre` | Da de baja los proyectos que ya no están (con un tope del 10 % salvo `?forzar=1`) |
| `GET /ingest/historial?desde=…&hasta=…` | Fotos de referencia para calcular el impulso |
| `GET /ingest/radar/estado?desde=AAAA-MM-DDTHH` | Lo que el radar necesita al empezar: candidatos, alertas existentes, su memoria y las horas guardadas |
| `GET /ingest/radar/hora/AAAA-MM-DDTHH` | Las estrellas de todo lo vigilado en una hora |
| `POST /ingest/radar/guardar` | Lo que cambia en una hora (la hora, candidatos, memoria, tendencias, registro «en auge» y alertas nuevas), en una transacción |
| `GET /ingest/radar/aceptados` | Candidatos aceptados por una persona: el robot diario los añade a la semilla |
| `GET /api/v1/tendencias` | Público: lo que está en auge y lo que más sube, con sus cifras (caché de 5 min) |

Todo `/ingest` exige `Authorization: Bearer <INGEST_KEY>`. La clave es un secreto: en Cloudflare con `wrangler secret put INGEST_KEY` y en local en `.dev.vars` (`INGEST_KEY=…`, no se sube al repo).

## Límites del plan gratuito
El Worker no lee el JSON del robot: lo pasa tal cual a D1 una sola vez (se guarda un momento en `ingesta_lotes` y las demás consultas lo leen de ahí) y SQLite lo recorre con `json_each`. Así cada petición hace como mucho 6 consultas, lleve 10 proyectos o 2.000 (los tests lo comprueban), y gasta poca CPU: medido en Cloudflare el 17-oct-2026, 3-4 ms con lotes de 250 KB, cuando el límite es 10 ms. El robot manda lotes de 200 KB.

## Página de revisión

| Ruta | Para qué |
|---|---|
| `GET /` | Posibles copias pendientes (con sus pruebas), revisadas hace poco, proyectos propuestos para el catálogo y los que entraron |
| `POST /alertas/:id` | `decision=publicar` (es una copia) o `descartar`. Solo cambia alertas pendientes |
| `POST /candidatos/:id/aceptar` · `rechazar` · `sacar` | Decisiones sobre los proyectos nuevos |

Los formularios solo valen desde la propia página (se comprueba la cabecera `Origin`). En la base de datos no se guarda el correo de quien revisa, solo una huella (`persona:` y 12 cifras de su SHA-256).

## En local
```sh
pnpm --filter @aop/worker run migrar:local   # crea las tablas en .wrangler/
pnpm --filter @aop/worker run dev            # http://localhost:8787
WORKER_URL=http://localhost:8787 INGEST_KEY=<la de .dev.vars> pnpm diario
WORKER_URL=http://localhost:8787 INGEST_KEY=<la de .dev.vars> pnpm radar
pnpm --filter @aop/worker run dev:revisar   # http://localhost:8788, con REVISORES=… en .dev.vars
```

## Base de datos
El esquema está en `migrations/`. Para cambiarlo se añade una migración nueva (`0002_…sql`); las que ya se han aplicado no se tocan. Ojo: `wrangler d1 export` no admite tablas virtuales (la búsqueda `fts_projects`); las copias de seguridad van con Time Travel de D1 (7 días en el plan gratuito).
