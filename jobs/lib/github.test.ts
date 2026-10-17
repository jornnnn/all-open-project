import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ClienteGithub,
  crearCliente,
  ErrorTemporalDeGithub,
  obtenerDatosActuales,
  obtenerRepos,
  obtenerReposDiario,
  obtenerTokenDelRobot,
  obtenerTopics,
} from './github.ts';

function nodo(nombre: string) {
  return {
    databaseId: 42,
    nameWithOwner: nombre,
    description: 'Un programa',
    homepageUrl: '',
    stargazerCount: 1234,
    forkCount: 5,
    isFork: false,
    isArchived: false,
    isMirror: false,
    isDisabled: false,
    hasIssuesEnabled: true,
    createdAt: '2020-01-01T00:00:00Z',
    pushedAt: '2026-10-01T00:00:00Z',
    primaryLanguage: { name: 'Go' },
    licenseInfo: { spdxId: 'MIT' },
    repositoryTopics: { nodes: [{ topic: { name: 'cli' } }] },
    owner: { __typename: 'Organization', isVerified: true },
    defaultBranchRef: { target: { committedDate: '2026-09-30T00:00:00Z' } },
    issuesAbiertas: { totalCount: 7 },
    issuesCerradas: { totalCount: 93 },
    latestRelease: {
      tagName: 'v1.2.0',
      publishedAt: '2026-09-01T10:00:00Z',
      releaseAssets: {
        totalCount: 2,
        nodes: [
          { name: 'app-setup.exe', downloadCount: 500 },
          { name: 'app.dmg', downloadCount: 300 },
        ],
      },
    },
  };
}

/**
 * Cliente falso: GitHub «no llega a tiempo» si se le piden más de `maximo` repos a la vez o si
 * entre ellos está alguno de `siempreFallan`.
 */
function clienteFalso(existentes: Set<string>, maximo: number, siempreFallan = new Set<string>()) {
  const tamanos: number[] = [];
  const cliente: ClienteGithub = {
    restantes: () => 5000,
    frenos: () => ({ veces: 0, presupuestoPorMinutoMs: null }),
    rest: async () => null,
    async graphql<T>(_query: string, variables: Record<string, unknown> = {}) {
      const nombres = Object.keys(variables)
        .filter((k) => k.startsWith('o'))
        .map((k) => `${variables[k]}/${variables[`n${k.slice(1)}`]}`);
      tamanos.push(nombres.length);
      if (nombres.length > maximo || nombres.some((n) => siempreFallan.has(n))) {
        throw new ErrorTemporalDeGithub('502');
      }
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

describe('obtenerReposDiario', () => {
  it('lee todo lo del robot diario: id, issues, organización verificada y última versión', async () => {
    const { cliente } = clienteFalso(new Set(['o/existe']), 25);
    const { repos, fallidos } = await obtenerReposDiario(cliente, ['o/existe', 'o/borrado']);
    expect(fallidos.size).toBe(0);
    expect(repos.get('o/borrado')).toBeNull();
    expect(repos.get('o/existe')).toMatchObject({
      id: 42,
      repo: 'o/existe',
      deshabilitado: false,
      issuesAbiertas: 7,
      issuesCerradas: 93,
      organizacionVerificada: true,
      ultimoCommit: '2026-09-30T00:00:00Z',
      version: {
        nombre: 'v1.2.0',
        fecha: '2026-09-01T10:00:00Z',
        totalArchivos: 2,
        archivos: [
          { nombre: 'app-setup.exe', descargas: 500 },
          { nombre: 'app.dmg', descargas: 300 },
        ],
      },
    });
  });

  it('un repo que falla incluso solo se anota y no detiene a los demás', async () => {
    const nombres = Array.from({ length: 8 }, (_, i) => `o/r${i}`);
    const { cliente } = clienteFalso(new Set(nombres), 25, new Set(['o/r5']));
    const { repos, fallidos } = await obtenerReposDiario(cliente, nombres);
    expect([...fallidos.keys()]).toEqual(['o/r5']);
    expect(repos.size).toBe(7);
    expect([...repos.values()].every((r) => r !== null)).toBe(true);
  });
});

describe('crearCliente', () => {
  afterEach(() => vi.unstubAllGlobals());

  const responder = (cuerpo: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(cuerpo), { status: 200 })),
    );

  it('un repo que no existe o está bloqueado vuelve como null si se permite', async () => {
    responder({
      data: { r0: null, r1: null, r2: { nameWithOwner: 'o/b' } },
      errors: [
        { type: 'NOT_FOUND', path: ['r0'], message: 'Could not resolve to a Repository' },
        { type: 'FORBIDDEN', path: ['r1'], message: 'Repository access blocked' },
      ],
    });
    const cliente = crearCliente('token', { pausaMs: 0 });
    const datos = await cliente.graphql<Record<string, unknown>>(
      'query',
      {},
      {
        permitirNoEncontrados: true,
      },
    );
    expect(datos).toEqual({ r0: null, r1: null, r2: { nameWithOwner: 'o/b' } });
    await expect(cliente.graphql('query')).rejects.toThrow('Could not resolve');
  });

  it('un error sin repo concreto no se oculta nunca', async () => {
    responder({
      data: { r0: null },
      errors: [{ type: 'FORBIDDEN', message: 'Token sin permisos' }],
    });
    const cliente = crearCliente('token', { pausaMs: 0 });
    await expect(cliente.graphql('query', {}, { permitirNoEncontrados: true })).rejects.toThrow(
      'Token sin permisos',
    );
  });

  it('si la consulta pide demasiado, avisa para partir el lote', async () => {
    responder({
      data: { r0: null },
      errors: [{ type: 'RESOURCE_LIMITS_EXCEEDED', path: ['r0', 'latestRelease'], message: 'x' }],
    });
    const cliente = crearCliente('token', { pausaMs: 0 });
    await expect(cliente.graphql('query', {}, { permitirNoEncontrados: true })).rejects.toThrow(
      ErrorTemporalDeGithub,
    );
  });

  it('si GitHub frena, espera lo que pide y baja el ritmo un 20 % para el resto', async () => {
    const respuestas = [
      new Response('{"message":"You have exceeded a secondary rate limit"}', {
        status: 403,
        headers: { 'retry-after': '0.01' },
      }),
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respuestas.shift()),
    );
    const cliente = crearCliente('token', { pausaMs: 0, presupuestoPorMinutoMs: 60_000 });
    expect(await cliente.graphql('query')).toEqual({ ok: true });
    expect(cliente.frenos()).toEqual({ veces: 1, presupuestoPorMinutoMs: 48_000 });
  });
});

describe('obtenerTopics', () => {
  it('devuelve los topics de cada repo y deja fuera los que no existen', async () => {
    const cliente: ClienteGithub = {
      restantes: () => 5000,
      frenos: () => ({ veces: 0, presupuestoPorMinutoMs: null }),
      rest: async () => null,
      async graphql<T>(query: string, variables: Record<string, unknown> = {}) {
        expect(query).toContain('repositoryTopics');
        expect(query).not.toContain('stargazerCount');
        const datos = Object.fromEntries(
          Object.keys(variables)
            .filter((k) => k.startsWith('o'))
            .map((k) => {
              const nombre = `${variables[k]}/${variables[`n${k.slice(1)}`]}`;
              const topics = nombre === 'o/sin-topics' ? [] : ['cli', 'rust'];
              return [
                `r${k.slice(1)}`,
                nombre === 'o/borrado'
                  ? null
                  : { repositoryTopics: { nodes: topics.map((name) => ({ topic: { name } })) } },
              ];
            }),
        );
        return datos as T;
      },
    };
    const topics = await obtenerTopics(cliente, ['o/a', 'o/sin-topics', 'o/borrado']);
    expect(topics).toEqual(
      new Map([
        ['o/a', ['cli', 'rust']],
        ['o/sin-topics', []],
      ]),
    );
  });
});

describe('obtenerTokenDelRobot', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const github = (status: number) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status })),
    );

  it('usa el token personal de solo lectura si sirve', async () => {
    vi.stubEnv('ROBOT_TOKEN', 'personal');
    vi.stubEnv('GITHUB_TOKEN', 'de-actions');
    github(200);
    const avisos: string[] = [];
    expect(await obtenerTokenDelRobot((a) => avisos.push(a))).toEqual({
      token: 'personal',
      tipo: 'personal',
    });
    expect(avisos).toEqual([]);
  });

  it('si el personal ha caducado, avisa y usa el de Actions', async () => {
    vi.stubEnv('ROBOT_TOKEN', 'caducado');
    vi.stubEnv('GITHUB_TOKEN', 'de-actions');
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    github(401);
    const avisos: string[] = [];
    expect(await obtenerTokenDelRobot((a) => avisos.push(a))).toEqual({
      token: 'de-actions',
      tipo: 'actions',
    });
    expect(avisos[0]).toContain('ROBOT_TOKEN');
  });

  it('sin token personal, en Actions usa el automático', async () => {
    vi.stubEnv('ROBOT_TOKEN', '');
    vi.stubEnv('GITHUB_TOKEN', 'de-actions');
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    expect(await obtenerTokenDelRobot(() => {})).toEqual({ token: 'de-actions', tipo: 'actions' });
  });
});
