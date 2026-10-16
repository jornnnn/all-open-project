# Cómo colaborar

Gracias por echar una mano. Este proyecto vive de la confianza, así que las reglas son pocas pero firmes.

## Datos

- **Corregir un dato** (estado, licencia, temas, repo oficial…): abre una *issue* con la fuente, o un *pull request* que añada la corrección a `data/editorial.yaml` con su motivo y su fecha. Ese archivo es público y registra todas las correcciones manuales.
- **Proponer un programa o una alternativa:** edita `data/semilla.yaml` (altas) o `data/alternativas.yaml`. Usa el repositorio original, nunca un fork ni una copia.
- **Cambiar la taxonomía:** cada *topic* de GitHub va en un solo subtema. Antes de añadirlo, mira qué repos trae con `pnpm --filter @aop/jobs run explorar -- <topic>`.
- Las cifras salen siempre de los datos de GitHub. La IA puede redactar textos, pero nunca poner cifras ni hechos.
- Ninguna alerta de copia falsa se publica sin revisión humana.

## Código

1. `pnpm install`
2. Haz el cambio, con tests si toca lógica (`*.test.ts` junto al código).
3. Antes de enviarlo: `pnpm format`, `pnpm lint`, `pnpm typecheck` y `pnpm test`.

Las convenciones están en [CLAUDE.md](CLAUDE.md).

## Licencia de las contribuciones

El código que aportes se publica con licencia [AGPL-3.0](LICENSE) y los datos, con [CC BY 4.0](data/LICENSE).

---

**English:** issues and pull requests are welcome in English too. Data fixes go to `data/editorial.yaml` with a reason and a source; code changes need `pnpm lint`, `pnpm typecheck` and `pnpm test` to pass. Code is AGPL-3.0 and data is CC BY 4.0.
