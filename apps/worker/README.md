# apps/worker

Worker de Cloudflare (Hono + D1). Recibe los datos del robot en `/ingest` y sirve la salud del robot. La API pública, el servidor MCP, la búsqueda y la versión Markdown de las páginas llegan en las fases E y F.

| Ruta | Para qué |
|---|---|
| `GET /estado` | Página interna con la última ejecución del robot, sus errores y avisos |
| `GET /api/v1/estado` | Lo mismo en JSON (público, con caché de 60 s) |
| `POST /ingest/ejecucion` | El robot anota el comienzo y el final de cada ejecución |
| `POST /ingest/proyectos?fecha=AAAA-MM-DD` | Ficha y foto del día de un lote de proyectos |
| `POST /ingest/cierre` | Da de baja los proyectos que ya no están (con un tope del 10 % salvo `?forzar=1`) |
| `GET /ingest/historial?desde=…&hasta=…` | Fotos de referencia para calcular el impulso |

Todo `/ingest` exige `Authorization: Bearer <INGEST_KEY>`. La clave es un secreto: en Cloudflare con `wrangler secret put INGEST_KEY` y en local en `.dev.vars` (`INGEST_KEY=…`, no se sube al repo).

## Límites del plan gratuito
El Worker no lee el JSON del robot: lo pasa tal cual a D1 una sola vez (se guarda un momento en `ingesta_lotes` y las demás consultas lo leen de ahí) y SQLite lo recorre con `json_each`. Así cada petición hace como mucho 6 consultas, lleve 10 proyectos o 2.000 (los tests lo comprueban), y gasta poca CPU: medido en Cloudflare el 17-oct-2026, 3-4 ms con lotes de 250 KB, cuando el límite es 10 ms. El robot manda lotes de 200 KB.

## En local
```sh
pnpm --filter @aop/worker run migrar:local   # crea las tablas en .wrangler/
pnpm --filter @aop/worker run dev            # http://localhost:8787
WORKER_URL=http://localhost:8787 INGEST_KEY=<la de .dev.vars> pnpm diario
```

## Base de datos
El esquema está en `migrations/`. Para cambiarlo se añade una migración nueva (`0002_…sql`); las que ya se han aplicado no se tocan. Ojo: `wrangler d1 export` no admite tablas virtuales (la búsqueda `fts_projects`); las copias de seguridad van con Time Travel de D1 (7 días en el plan gratuito).
