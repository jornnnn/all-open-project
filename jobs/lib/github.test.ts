import { describe, expect, it } from 'vitest';
import {
  type ClienteGithub,
  ErrorTemporalDeGithub,
  obtenerDatosActuales,
  obtenerRepos,
} from './github.ts';

function nodo(nombre: string) {
  return {
    nameWithOwner: nombre,
    description: 'Un programa',
    homepageUrl: '',
    stargazerCount: 1234,
    forkCount: 5,
    isFork: false,
    isArchived: false,
    isMirror: false,
    createdAt: '2020-01-01T00:00:00Z',
    pushedAt: '2026-10-01T00:00:00Z',
    primaryLanguage: { name: 'Go' },
    licenseInfo: { spdxId: 'MIT' },
    repositoryTopics: { nodes: [{ topic: { name: 'cli' } }] },
    defaultBranchRef: { target: { committedDate: '2026-09-30T00:00:00Z' } },
  };
}

/** Cliente falso: GitHub «no llega a tiempo» si se le piden más de `maximo` repos a la vez. */
function clienteFalso(existentes: Set<string>, maximo: number) {
  const tamanos: number[] = [];
  const cliente: ClienteGithub = {
    restantes: () => 5000,
    async graphql<T>(_query: string, variables: Record<string, unknown> = {}) {
      const nombres = Object.keys(variables)
        .filter((k) => k.startsWith('o'))
        .map((k) => `${variables[k]}/${variables[`n${k.slice(1)}`]}`);
      tamanos.push(nombres.length);
      if (nombres.length > maximo) throw new ErrorTemporalDeGithub('502');
      const datos = Object.fromEntries(
        nombres.map((n, i) => [`r${i}`, existentes.has(n) ? nodo(n) : null]),
      );
      return datos as T;
    },
  };
  return { cliente, tamanos };
}

describe('obtenerRepos', () => {
  it('traduce los campos de GitHub y devuelve null para los repos que no existen', async () => {
    const { cliente } = clienteFalso(new Set(['o/existe']), 50);
    const repos = await obtenerRepos(cliente, ['o/existe', 'o/no-existe']);
    expect(repos.get('o/no-existe')).toBeNull();
    expect(repos.get('o/existe')).toEqual({
      repo: 'o/existe',
      descripcion: 'Un programa',
      web: null,
      estrellas: 1234,
      forks: 5,
      esFork: false,
      archivado: false,
      espejo: false,
      creado: '2020-01-01T00:00:00Z',
      ultimoPush: '2026-10-01T00:00:00Z',
      ultimoCommit: '2026-09-30T00:00:00Z',
      lenguaje: 'Go',
      licencia: 'MIT',
      topics: ['cli'],
    });
  });

  it('si GitHub no llega a tiempo, parte el lote en dos sin perder ningún repo', async () => {
    const nombres = Array.from({ length: 10 }, (_, i) => `o/r${i}`);
    const { cliente, tamanos } = clienteFalso(new Set(nombres), 3);
    const repos = await obtenerRepos(cliente, nombres);
    expect([...repos.keys()]).toEqual(nombres);
    expect([...repos.values()].every((r) => r !== null)).toBe(true);
    // 10 → 5 + 5 → cada 5 en 3 + 2 → los 3 entran.
    expect(tamanos).toEqual([10, 5, 3, 2, 5, 3, 2]);
  });

  it('si falla con un solo repo, no oculta el error', async () => {
    const { cliente } = clienteFalso(new Set(['o/a']), 0);
    await expect(obtenerRepos(cliente, ['o/a'])).rejects.toThrow(ErrorTemporalDeGithub);
  });
});

describe('obtenerDatosActuales', () => {
  it('devuelve lo que se comprueba antes de publicar, y null si el repo ya no existe', async () => {
    const { cliente } = clienteFalso(new Set(['o/existe']), 50);
    const datos = await obtenerDatosActuales(cliente, ['o/existe', 'o/borrado']);
    expect(datos.get('o/borrado')).toBeNull();
    expect(datos.get('o/existe')).toEqual({
      repo: 'o/existe',
      estrellas: 1234,
      esFork: false,
      archivado: false,
      ultimoCommit: '2026-09-30T00:00:00Z',
    });
  });
});
