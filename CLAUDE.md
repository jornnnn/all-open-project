# CLAUDE.md

Guía técnica del repositorio, para personas y agentes de IA.

## Qué es
Web bilingüe (español principal, inglés) que recoge lo mejor del open source de GitHub, lo explica en lenguaje llano y lo verifica: repo oficial, copias falsas, si sigue vivo y licencia. Monorepo pnpm con TypeScript.

Arquitectura: robot en GitHub Actions (`jobs/`) → Worker de Cloudflare (`apps/worker/`, Hono + D1) → web estática (`apps/web/`, Astro, Fase E). Todo el trabajo pesado va en Actions; el Worker hace tareas ligeras (10 ms de CPU por petición y 50 consultas a D1 en el plan gratuito).

## Comandos
| Comando | Qué hace |
|---|---|
| `pnpm install` | Instala dependencias (Node 24, pnpm 12) |
| `pnpm lint` | Biome: errores y formato de todo el repo |
| `pnpm format` | Biome: aplica el formato y los arreglos seguros |
| `pnpm typecheck` | `tsc --noEmit` en cada paquete (en el Worker, antes genera sus tipos con `wrangler types`) |
| `pnpm test` | Vitest en cada paquete (los del Worker corren dentro del runtime de Workers, con un D1 local) |
| `pnpm build` | Compila lo que tiene build (por ahora, `packages/core` a `dist/`) |
| `pnpm diario` | Robot diario: lee GitHub, guarda en D1 a través del Worker y escribe `data/export/proyectos.json`. Necesita `WORKER_URL` e `INGEST_KEY`; con `-- --sin-worker` no guarda nada (prueba en local) y con `-- --limite 50` solo hace los 50 primeros |
| `pnpm --filter @aop/jobs run verificar` | Compara una muestra al azar de D1 con la API REST de GitHub (estrellas ±1 %, fechas exactas). `-- --local` usa el D1 de `wrangler dev` |
| `pnpm semilla` | Regenera `data/semilla.generada.json` leyendo GitHub. Con `-- --cache` reutiliza las búsquedas de las últimas 24 h |
| `pnpm --filter @aop/jobs run explorar -- <topic>…` | Cuántos repos activos tiene un topic y cuáles salen primero |
| `pnpm --filter @aop/jobs run muestra` | Tabla con una muestra de la semilla y la lista de temas |
| `pnpm --filter @aop/jobs run licencias` | Regenera la lista SPDX (`packages/core/src/licencias-spdx.ts`) y las plantillas de `jobs/licencias/` |
| `pnpm --filter @aop/worker run dev` | Worker en local (`http://localhost:8787`), con la clave de `apps/worker/.dev.vars` |
| `pnpm --filter @aop/worker run migrar:local` · `migrar:remoto` | Aplica `apps/worker/migrations/` al D1 local o al de Cloudflare |
| `pnpm --filter @aop/worker run desplegar` | Despliega el Worker (antes, confirmación de Marc) |

Los scripts de `jobs/` usan `GITHUB_TOKEN` (en Actions) o la sesión local de `gh`. Solo leen de GitHub.

## Estructura
```
apps/web/          Web pública (Astro estática) · se crea en la Fase E
apps/worker/       Worker (Hono + D1): /ingest (robot), /estado y /api/v1/estado
  migrations/        Esquema de D1: projects, snapshots, hourly, candidates, alerts, texts, runs,
                     fts_projects e ingesta_lotes (el lote del robot mientras dura la petición)
  src/ingesta.ts     Escrituras agrupadas con json_each: 6 consultas por petición, lleve lo que lleve
  src/estado.ts      Salud del robot (JSON y página interna)
packages/core/     Lógica pura con tests: estado, licencias (también por su texto), instaladores, temas,
                   listas, puntuación v1, esquemas de data/ y formato de los datos abiertos (catalogo.ts)
jobs/              Scripts del robot (Node 24)
  diario.ts          Robot diario (lo lanza .github/workflows/robot-diario.yml a las 03:17 UTC)
  verificar-muestra.ts  Comprueba una muestra de D1 contra GitHub
  lib/github.ts      Cliente GraphQL y REST de solo lectura (reintentos, ritmo, lotes que se parten)
  lib/catalogo.ts    Lógica pura de la ficha diaria de cada proyecto
  lib/anterior.ts    Datos del día anterior: topics y licencias dudosas se renuevan por turnos, cada semana
  lib/licencias.ts   Revisión de las licencias «otra» y «sin licencia» leyendo sus archivos
  lib/worker.ts      Cliente de /ingest (lotes de 200 KB como mucho, por la CPU del Worker)
  lib/exportar.ts    data/export/proyectos.json
  lib/datos.ts       Lee y valida data/*.yaml
  lib/seleccion.ts   Lógica pura de la semilla (cupos y temas)
  licencias/         Textos oficiales de SPDX (generados, no se editan a mano)
data/              taxonomia.yaml · alternativas.yaml · semilla.yaml · editorial.yaml · semilla.generada.json ·
                   export/proyectos.json (CC BY 4.0)
docs/              Metodología pública
design/maqueta/    Copia de la maqueta aprobada, como referencia visual
```

## Convenciones
- **TypeScript estricto y ESM.** Solo sintaxis que Node ejecuta sin compilar (`erasableSyntaxOnly`): nada de `enum`, `namespace` ni propiedades en el constructor. Los imports relativos llevan la extensión `.ts`, y los de solo tipos van con `import type`.
- **`packages/core` es puro:** sin red, sin archivos y sin APIs de Node ni del navegador (su tsconfig no carga esos tipos), para que funcione igual en el robot, el Worker y la web. Se consume como código fuente (`exports` → `src/index.ts`).
- **Nombres del dominio en español** (estado, licencia, tema…). Los valores que van a datos y API son códigos estables en minúsculas con guiones (`vivo`, `con-limites`, `edicion-de-fotos`); la web los traduce. Las tablas de D1 van en inglés, como en el plan técnico, y sus columnas se llaman igual que los campos de los datos abiertos.
- **Datos en YAML**, validados con los esquemas zod de `packages/core/src/datos.ts`. `jobs/lib/datos.test.ts` falla si algún archivo no cumple su formato o no encaja con los demás.
- **Tests junto al código** (`*.test.ts`; en el Worker, en `apps/worker/test/`). Los tests no usan la red.
- **Un solo linter y formateador: Biome** (`biome.json`). Comillas simples, punto y coma, 2 espacios, 100 columnas.
- Comentarios, mensajes de error y textos en español.
- **pnpm 12 rechaza los paquetes publicados hace menos de un día** y solo deja ejecutar scripts de instalación a los de `allowBuilds` en `pnpm-workspace.yaml` (esbuild y workerd, que necesita wrangler). No se añaden excepciones.

## Límites del plan gratuito que afectan al código
- **D1: 100.000 filas escritas y 5 millones leídas al día para toda la cuenta**, compartida con otros proyectos de Marc. Si se pasa, D1 deja de responder hasta las 00:00 UTC. Cada índice suma una fila escrita por cambio: por eso hay pocos índices, el nombre del repo se actualiza aparte y la búsqueda (FTS5) solo se reescribe si cambia el texto. `/api/v1/estado` lee solo las últimas filas de `runs`.
- **Worker:** 10 ms de CPU y 50 consultas por petición. El Worker no lee el JSON del robot: lo pasa tal cual a D1, **una sola vez** (se guarda en `ingesta_lotes` y las demás consultas lo leen de ahí), y SQLite lo recorre con `json_each`. Medido en Cloudflare: enviarlo una vez por consulta costaba 24-36 ms de CPU por lote; así, 3-4 ms con lotes de 250 KB. El robot manda lotes de 200 KB.
- **GitHub:** corta las consultas de más de 10 s (por eso, lotes de 25 repos) y limita el tiempo de CPU de GraphQL por minuto, con el token de Actions más que con uno personal. El robot usa el secreto `ROBOT_TOKEN` (token personal de solo lectura, con el que GitHub frena mucho menos) si existe y sirve; si no, el automático de Actions. Su cliente lleva un presupuesto de tiempo de respuesta por minuto (75 s con el personal, 30 s con el de Actions), lo baja un 20 % cada vez que GitHub frena y para todas sus peticiones mientras tanto. Los topics (el 40 % del coste de la consulta) y la revisión de las licencias dudosas se renuevan por turnos, una vez por semana cada proyecto.

## Reglas del producto que afectan al código
- Las cifras y los hechos salen siempre de los datos. La IA solo redacta, y un validador lo comprueba.
- Ninguna alerta de copia falsa se publica sin revisión humana.
- Las correcciones manuales van en `data/editorial.yaml`, con motivo y fecha. El robot diario las aplica cada noche.
- Si un dato no se puede calcular con seguridad, se marca para revisar (por ejemplo, la licencia `otra`) en vez de suponerlo. «Sin licencia» solo se publica después de buscar en todo el repo.
- El robot solo lee de GitHub. Lo único que escribe es el commit diario de `data/export/` en este repositorio.
- Si GitHub no da más del 2 % de la semilla, el robot no publica nada ese día.

## Reglas de cálculo (detalle en `docs/metodologia.md`)
- **Estado:** `terminado` lo marca una persona; `abandonado` si está archivado o lleva más de 12 meses sin commits en la rama principal; `lento` de 3 a 12 meses; `vivo` menos de 3.
- **Licencia:** `open-source` (aprobada por la OSI o libre según la FSF), `con-limites` (BUSL, SSPL, Elastic, PolyForm, FSL, Sustainable Use, Creative Commons NC/ND…), `otra` (no se sabe con seguridad) y `sin-licencia`. Cuando GitHub no lo sabe, `licencias-texto.ts` compara los archivos con los textos oficiales de SPDX: open source solo si no sobra ninguna frase.
- **Instaladores:** por la extensión de los archivos de la última versión (`.exe`/`.msi` → Windows, `.dmg`/`.pkg` → Mac, `.AppImage`/`.deb`/`.rpm` → Linux, `.apk` → Android; los `.apk` de Alpine van a Linux).
- **Temas:** por los topics de GitHub; cada topic pertenece a un solo subtema. El robot diario usa los temas de la semilla revisada, salvo corrección manual.
- **Puntuación v1 (0-100):** relativa al tema principal: popularidad 30, impulso 20, salud 30 y uso real 20; si un apartado no tiene datos, su peso se reparte entre los demás. Resta 30 si está archivado, 20 si lleva más de 12 meses sin cambios y 15 si no tiene licencia.
