# All Open Project

> Nombre provisional.

Lo mejor del open source de GitHub, explicado en lenguaje llano y verificado: cuál es el repositorio oficial, si hay copias falsas, si sigue vivo y qué permite su licencia. En español y en inglés, para quien busca programas gratis y para quien programa. Sin anuncios.

**Estado:** en construcción. Ya están la base del repositorio, la lógica de datos con tests y la lista inicial de proyectos. La web, la API y el servidor MCP llegarán en las próximas fases.

## Qué hay aquí

| Carpeta | Qué es |
|---|---|
| `packages/core` | Lógica pura con tests: estado, licencias, instaladores, temas y esquemas de los datos |
| `jobs` | Scripts del robot (Node 24) que leen GitHub |
| `data` | Datos editoriales y abiertos ([CC BY 4.0](data/LICENSE)) |
| `docs` | [Metodología pública](docs/metodologia.md) |
| `apps/web` | Web pública (en preparación) |
| `apps/worker` | API, MCP y búsqueda (en preparación) |
| `design/maqueta` | Maqueta de la web, como referencia |

## Cómo se ejecuta

Necesitas Node 24 y pnpm 12.

```sh
pnpm install
pnpm test        # tests (Vitest)
pnpm lint        # errores y formato (Biome)
pnpm typecheck   # tipos (TypeScript)
pnpm build       # compila lo que se publica
pnpm semilla     # regenera data/semilla.generada.json leyendo GitHub
```

`pnpm semilla` usa la variable `GITHUB_TOKEN` o, si no existe, la sesión de la herramienta `gh`. Solo lee: nunca escribe en GitHub.

## Licencias

- Código: [AGPL-3.0](LICENSE).
- Datos de `data/`: [CC BY 4.0](data/LICENSE). Puedes reutilizarlos citando la fuente.

[English version](README.en.md) · [Cómo colaborar](CONTRIBUTING.md)
