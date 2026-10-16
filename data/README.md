# Datos

Todo lo que hay en esta carpeta se publica con licencia [CC BY 4.0](LICENSE): puedes copiarlo, adaptarlo y usarlo, también con fines comerciales, citando la fuente.

| Archivo | Qué es |
|---|---|
| `taxonomia.yaml` | Áreas y subtemas del catálogo, en español e inglés, con los topics de GitHub de cada uno |
| `alternativas.yaml` | Programas de pago o cerrados y sus alternativas open source |
| `semilla.yaml` | Cómo se elige la lista inicial: ajustes, búsquedas extra, altas y exclusiones |
| `editorial.yaml` | Registro público de las correcciones manuales, con motivo y fecha |
| `semilla.generada.json` | Lista inicial generada por `jobs/semilla.ts`, con las cifras del día en que se generó |

Los YAML se validan con los esquemas de `packages/core/src/datos.ts` en cada cambio (`pnpm test`).

Las cifras (estrellas, fechas, licencias) salen de la API de GitHub en la fecha indicada en cada archivo. Si ves un error, avísanos con una *issue*.
