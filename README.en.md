# All Open Project

> Working title.

The best open source on GitHub, explained in plain language and verified: which repository is the official one, whether there are fake copies, whether it is still alive and what its license allows. In Spanish and English, for people looking for free software and for developers. No ads.

**Status:** under construction. The repository foundation, the data logic with tests and the initial project list are ready. The website, the API and the MCP server come in the next phases.

## What's inside

| Folder | What it is |
|---|---|
| `packages/core` | Pure, tested logic: status, licenses, installers, topics and data schemas |
| `jobs` | Robot scripts (Node 24) that read GitHub |
| `data` | Editorial and open data ([CC BY 4.0](data/LICENSE)) |
| `docs` | [Public methodology](docs/methodology.md) |
| `apps/web` | Public website (coming) |
| `apps/worker` | API, MCP and search (coming) |
| `design/maqueta` | Website mockup, for reference |

## How to run it

You need Node 24 and pnpm 12.

```sh
pnpm install
pnpm test        # tests (Vitest)
pnpm lint        # errors and formatting (Biome)
pnpm typecheck   # types (TypeScript)
pnpm build       # builds what gets published
pnpm semilla     # regenerates data/semilla.generada.json from GitHub
```

`pnpm semilla` uses the `GITHUB_TOKEN` variable or, if it is not set, your `gh` CLI session. It only reads: it never writes to GitHub.

## Licenses

- Code: [AGPL-3.0](LICENSE).
- Data in `data/`: [CC BY 4.0](data/LICENSE). You can reuse it with attribution.

[Versión en español](README.md) · [Contributing](CONTRIBUTING.md)
