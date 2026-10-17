# Datos

Todo lo que hay en esta carpeta se publica con licencia [CC BY 4.0](LICENSE): puedes copiarlo, adaptarlo y usarlo, también con fines comerciales, citando la fuente.

| Archivo | Qué es |
|---|---|
| `taxonomia.yaml` | Áreas y subtemas del catálogo, en español e inglés, con los topics de GitHub de cada uno |
| `alternativas.yaml` | Programas de pago o cerrados y sus alternativas open source |
| `semilla.yaml` | Cómo se elige la lista inicial: ajustes, búsquedas extra, altas y exclusiones |
| `editorial.yaml` | Registro público de las correcciones manuales, con motivo y fecha |
| `semilla.generada.json` | Lista inicial generada por `jobs/semilla.ts`, con las cifras del día en que se generó |
| `export/proyectos.json` | **Foto diaria de todo el catálogo**, que publica el robot cada noche (ver abajo) |

Los YAML se validan con los esquemas de `packages/core/src/datos.ts` en cada cambio (`pnpm test`).

## `export/proyectos.json`

El robot diario lo reescribe cada noche (03:17 UTC) y lo publica con un commit, así que el historial de git guarda la foto de cada día. La cabecera dice cuándo se leyeron los datos (`generado`), de qué día es la foto (`fecha`) y un resumen. Después va la lista `proyectos`, un proyecto por línea, ordenada por nombre. Cada proyecto lleva:

| Campo | Qué es |
|---|---|
| `id` | Identificador numérico de GitHub (no cambia aunque renombren el repo) |
| `repo` | `propietario/repo`, como se llama hoy en GitHub |
| `descripcion`, `web`, `lenguaje`, `topics` | Lo que dice GitHub. Los *topics* se renuevan una vez por semana por proyecto, por turnos |
| `temas`, `area`, `publico` | Subtemas de `taxonomia.yaml` (el primero es el principal), su área y si es para usar (`usar`) o para programar (`programar`) |
| `estrellas`, `forks`, `issues_abiertas`, `issues_cerradas` | Cifras de GitHub en el momento de leerlas (las *issues* son `null` si el repo las tiene desactivadas) |
| `creado`, `ultimo_push`, `ultimo_cambio` | Fechas en UTC. `ultimo_cambio` es el último *commit* de la rama principal |
| `archivado`, `estado` | Estado: `vivo`, `lento`, `abandonado` o `terminado` |
| `licencia_github`, `licencia`, `licencias`, `licencia_motivo` | Lo que dice GitHub, nuestra categoría (`open-source`, `con-limites`, `otra`, `sin-licencia`), las licencias reconocidas y, si hizo falta leer los archivos, cómo se decidió |
| `organizacion_verificada`, `oficial` | Si el dueño es una organización verificada por GitHub (`null` si es una persona) y si una persona ha confirmado que es el repo oficial (`null` si nadie lo ha comprobado) |
| `version` | Última versión publicada en GitHub: nombre, fecha y descargas de sus archivos |
| `instaladores`, `sistemas` | Archivos instalables de esa versión por sistema y la lista de sistemas |
| `estrellas_por_dia` | Estrellas ganadas al día en los últimos 30 días (`null` hasta tener 7 días de fotos) |
| `puntuacion`, `puntuacion_detalle` | Puntuación de 0 a 100 y sus apartados |
| `origen` | De dónde sale en la semilla: `busqueda`, `alta` o `alternativa:<programa>` |

El formato está definido y validado en `packages/core/src/catalogo.ts`. Cómo se calcula cada cosa: [metodología](../docs/metodologia.md).

Las cifras (estrellas, fechas, licencias) salen de la API de GitHub en la fecha indicada en cada archivo. Si ves un error, avísanos con una *issue*.
