# CLAUDE.md

Guía técnica del repositorio, para personas y agentes de IA.

## Qué es
Web bilingüe (español principal, inglés) que recoge lo mejor del open source de GitHub, lo explica en lenguaje llano y lo verifica: repo oficial, copias falsas, si sigue vivo y licencia. Monorepo pnpm con TypeScript.

Arquitectura prevista: robot en GitHub Actions (`jobs/`) → Worker de Cloudflare (`apps/worker/`, Hono + D1) → web estática (`apps/web/`, Astro). Todo el trabajo pesado va en Actions; el Worker hace tareas ligeras (10 ms de CPU por petición en el plan gratuito).

## Comandos
| Comando | Qué hace |
|---|---|
| `pnpm install` | Instala dependencias (Node 24, pnpm 12) |
| `pnpm lint` | Biome: errores y formato de todo el repo |
| `pnpm format` | Biome: aplica el formato y los arreglos seguros |
| `pnpm typecheck` | `tsc --noEmit` en cada paquete |
| `pnpm test` | Vitest en cada paquete |
| `pnpm build` | Compila lo que tiene build (por ahora, `packages/core` a `dist/`) |
| `pnpm semilla` | Regenera `data/semilla.generada.json` leyendo GitHub. Con `-- --cache` reutiliza las búsquedas de las últimas 24 h |
| `pnpm --filter @aop/jobs run explorar -- <topic>…` | Cuántos repos activos tiene un topic y cuáles salen primero |
| `pnpm --filter @aop/jobs run muestra` | Tabla con una muestra de la semilla y la lista de temas |
| `pnpm --filter @aop/jobs run licencias` | Regenera la lista SPDX de `packages/core/src/licencias-spdx.ts` |

Los scripts de `jobs/` usan `GITHUB_TOKEN` (en Actions) o la sesión local de `gh`. Solo leen.

## Estructura
```
apps/web/        Web pública (Astro estática) · se crea en la Fase E
apps/worker/     API, MCP, /ingest, búsqueda y Markdown (Hono + D1) · se crea en la Fase B
packages/core/   Lógica pura con tests: estado, licencias, instaladores, temas, listas y esquemas de data/
jobs/            Scripts del robot (Node 24): semilla, exploración de topics, lista SPDX
  lib/github.ts    Cliente GraphQL de solo lectura (reintentos, límites, lotes)
  lib/datos.ts     Lee y valida data/*.yaml
  lib/seleccion.ts Lógica pura de la semilla (cupos y temas)
data/            taxonomia.yaml · alternativas.yaml · semilla.yaml · editorial.yaml · semilla.generada.json (CC BY 4.0)
docs/            Metodología pública
design/maqueta/  Copia de la maqueta aprobada, como referencia visual
```

## Convenciones
- **TypeScript estricto y ESM.** Solo sintaxis que Node ejecuta sin compilar (`erasableSyntaxOnly`): nada de `enum`, `namespace` ni propiedades en el constructor. Los imports relativos llevan la extensión `.ts`, y los de solo tipos van con `import type`.
- **`packages/core` es puro:** sin red, sin archivos y sin APIs de Node ni del navegador (su tsconfig no carga esos tipos), para que funcione igual en el robot, el Worker y la web. Se consume como código fuente (`exports` → `src/index.ts`).
- **Nombres del dominio en español** (estado, licencia, tema…). Los valores que van a datos y API son códigos estables en minúsculas con guiones (`vivo`, `con-limites`, `edicion-de-fotos`); la web los traduce.
- **Datos en YAML**, validados con los esquemas zod de `packages/core/src/datos.ts`. `jobs/lib/datos.test.ts` falla si algún archivo no cumple su formato o no encaja con los demás.
- **Tests junto al código** (`*.test.ts`). Los tests no usan la red.
- **Un solo linter y formateador: Biome** (`biome.json`). Comillas simples, punto y coma, 2 espacios, 100 columnas.
- Comentarios, mensajes de error y textos en español.

## Reglas del producto que afectan al código
- Las cifras y los hechos salen siempre de los datos. La IA solo redacta, y un validador lo comprueba.
- Ninguna alerta de copia falsa se publica sin revisión humana.
- Las correcciones manuales van en `data/editorial.yaml`, con motivo y fecha.
- Si un dato no se puede calcular con seguridad, se marca para revisar (por ejemplo, la licencia `otra`) en vez de suponerlo.
- El robot nunca escribe en GitHub.

## Reglas de cálculo (detalle en `docs/metodologia.md`)
- **Estado:** `terminado` lo marca una persona; `abandonado` si está archivado o lleva más de 12 meses sin commits en la rama principal; `lento` de 3 a 12 meses; `vivo` menos de 3.
- **Licencia:** `open-source` (aprobada por la OSI o libre según la FSF), `con-limites` (BUSL, SSPL, Elastic, PolyForm, FSL, Sustainable Use, Creative Commons NC/ND…), `otra` (GitHub no la identifica) y `sin-licencia`.
- **Instaladores:** por la extensión de los archivos de la última versión (`.exe`/`.msi` → Windows, `.dmg`/`.pkg` → Mac, `.AppImage`/`.deb`/`.rpm` → Linux, `.apk` → Android; los `.apk` de Alpine van a Linux).
- **Temas:** por los topics de GitHub; cada topic pertenece a un solo subtema.
