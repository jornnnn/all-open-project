// Cliente mínimo de la API GraphQL de GitHub. Solo lee: nunca escribe en GitHub.
//
// GitHub corta las consultas que tardan más de 10 s (responde 502 o 504). Medido el 16-oct-2026:
// una búsqueda de 100 repos con la fecha del último commit tarda ~9,5 s; de 50 repos sin ella, ~3,5 s.
// Por eso cada búsqueda va sola, pide 50 repos sin commit, y las fechas se piden luego en lotes.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const URL_GRAPHQL = 'https://api.github.com/graphql';
const REPOS_POR_PETICION = 25;
const FECHAS_POR_PETICION = 30;

/** GitHub no ha podido responder a tiempo (502, 503, 504) ni tras reintentar. */
export class ErrorTemporalDeGithub extends Error {}

/**
 * Token para leer de GitHub: el de Actions (GITHUB_TOKEN), uno propio (GH_TOKEN)
 * o, en local, el de la sesión de `gh`.
 */
export async function obtenerToken(): Promise<string> {
  const delEntorno = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (delEntorno) return delEntorno;
  try {
    const { stdout } = await promisify(execFile)('gh', ['auth', 'token']);
    if (stdout.trim()) return stdout.trim();
  } catch {
    // Sin gh o sin sesión: se avisa abajo.
  }
  throw new Error(
    'Falta el token de GitHub: define GITHUB_TOKEN o inicia sesión con «gh auth login».',
  );
}

interface ErrorGraphql {
  type?: string;
  message: string;
}

export interface OpcionesCliente {
  /** Tiempo mínimo entre el inicio de dos peticiones, para no rozar los límites de GitHub. */
  pausaMs?: number;
  reintentos?: number;
}

export interface OpcionesConsulta {
  /** No falla si algún repositorio pedido no existe (vuelve como null). */
  permitirNoEncontrados?: boolean;
  /** Reintentos para esta consulta, si se quieren menos que los del cliente. */
  reintentos?: number;
}

export interface ClienteGithub {
  graphql<T>(
    query: string,
    variables?: Record<string, unknown>,
    opciones?: OpcionesConsulta,
  ): Promise<T>;
  /** Puntos de la API que quedan en esta hora, según la última respuesta. */
  restantes(): number | null;
}

const dormir = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

/** Cuánto esperar antes de reintentar, según las cabeceras de límite de GitHub. */
function esperaTrasLimite(cabeceras: Headers, intento: number): number {
  const reintentarTras = Number(cabeceras.get('retry-after'));
  if (reintentarTras > 0) return reintentarTras * 1000;
  if (cabeceras.get('x-ratelimit-remaining') === '0') {
    const reinicio = Number(cabeceras.get('x-ratelimit-reset')) * 1000;
    if (reinicio > Date.now()) return reinicio - Date.now() + 1000;
  }
  return Math.min(60_000, 5000 * 2 ** intento);
}

export function crearCliente(token: string, opciones: OpcionesCliente = {}): ClienteGithub {
  const pausaMs = opciones.pausaMs ?? 1000;
  const reintentos = opciones.reintentos ?? 5;
  let restantes: number | null = null;

  // Turnos en fila: aunque haya varias peticiones a la vez, empiezan con pausaMs de separación.
  let turno = Promise.resolve();
  let ultimaPeticion = 0;
  function esperarTurno(): Promise<void> {
    const anterior = turno;
    let liberar = () => {};
    turno = new Promise((resolver) => {
      liberar = resolver;
    });
    return anterior.then(async () => {
      const espera = ultimaPeticion + pausaMs - Date.now();
      if (espera > 0) await dormir(espera);
      ultimaPeticion = Date.now();
      liberar();
    });
  }

  async function graphql<T>(
    query: string,
    variables: Record<string, unknown> = {},
    { permitirNoEncontrados = false, reintentos: reintentosConsulta }: OpcionesConsulta = {},
  ): Promise<T> {
    const maxReintentos = reintentosConsulta ?? reintentos;
    for (let intento = 0; ; intento++) {
      await esperarTurno();
      const respuesta = await fetch(URL_GRAPHQL, {
        method: 'POST',
        headers: {
          authorization: `bearer ${token}`,
          'content-type': 'application/json',
          'user-agent': 'all-open-project-robot',
        },
        body: JSON.stringify({ query, variables }),
      });
      const quedan = respuesta.headers.get('x-ratelimit-remaining');
      if (quedan !== null) restantes = Number(quedan);

      const limitado = respuesta.status === 403 || respuesta.status === 429;
      if (limitado || respuesta.status >= 500) {
        if (intento >= maxReintentos) {
          const mensaje = `GitHub respondió ${respuesta.status} tras ${intento + 1} intentos`;
          throw limitado ? new Error(mensaje) : new ErrorTemporalDeGithub(mensaje);
        }
        const ms = esperaTrasLimite(respuesta.headers, intento);
        console.warn(
          `\nGitHub respondió ${respuesta.status}; reintento en ${Math.round(ms / 1000)} s`,
        );
        await dormir(ms);
        continue;
      }
      if (!respuesta.ok) {
        throw new Error(`GitHub respondió ${respuesta.status}: ${await respuesta.text()}`);
      }

      const cuerpo = (await respuesta.json()) as { data?: T; errors?: ErrorGraphql[] };
      const errores = (cuerpo.errors ?? []).filter(
        (e) => !(permitirNoEncontrados && e.type === 'NOT_FOUND'),
      );
      if (errores.some((e) => e.type === 'RATE_LIMITED') && intento < maxReintentos) {
        await dormir(esperaTrasLimite(respuesta.headers, intento));
        continue;
      }
      if (errores.length > 0 || cuerpo.data === undefined) {
        const detalle = errores.map((e) => e.message).join(' | ') || 'respuesta sin datos';
        throw new Error(`Error de la API de GitHub: ${detalle}`);
      }
      return cuerpo.data;
    }
  }

  return { graphql, restantes: () => restantes };
}

/** Campos de cada repositorio. La fecha del último commit se pide aparte porque es lenta. */
const CAMPOS_REPO = `
  nameWithOwner
  description
  homepageUrl
  stargazerCount
  forkCount
  isFork
  isArchived
  isMirror
  createdAt
  pushedAt
  primaryLanguage { name }
  licenseInfo { spdxId }
  repositoryTopics(first: 20) { nodes { topic { name } } }`;
const CAMPO_COMMIT = 'defaultBranchRef { target { ... on Commit { committedDate } } }';

interface NodoRepo {
  nameWithOwner: string;
  description: string | null;
  homepageUrl: string | null;
  stargazerCount: number;
  forkCount: number;
  isFork: boolean;
  isArchived: boolean;
  isMirror: boolean;
  createdAt: string;
  pushedAt: string | null;
  primaryLanguage: { name: string } | null;
  licenseInfo: { spdxId: string | null } | null;
  repositoryTopics: { nodes: { topic: { name: string } }[] };
  defaultBranchRef?: { target: { committedDate?: string } | null } | null;
}

/** Datos de un repositorio tal como los da GitHub, con nombres en español. */
export interface RepoGithub {
  /** propietario/repo, con las mayúsculas actuales en GitHub. */
  repo: string;
  descripcion: string | null;
  web: string | null;
  estrellas: number;
  forks: number;
  esFork: boolean;
  archivado: boolean;
  espejo: boolean;
  creado: string;
  ultimoPush: string | null;
  /** Fecha del último commit de la rama principal; null si no se ha pedido o no hay rama. */
  ultimoCommit: string | null;
  lenguaje: string | null;
  /** Identificador SPDX que da GitHub (null si no hay licencia). */
  licencia: string | null;
  topics: string[];
}

function leerRepo(nodo: NodoRepo): RepoGithub {
  return {
    repo: nodo.nameWithOwner,
    descripcion: nodo.description,
    web: nodo.homepageUrl || null,
    estrellas: nodo.stargazerCount,
    forks: nodo.forkCount,
    esFork: nodo.isFork,
    archivado: nodo.isArchived,
    espejo: nodo.isMirror,
    creado: nodo.createdAt,
    ultimoPush: nodo.pushedAt,
    ultimoCommit: nodo.defaultBranchRef?.target?.committedDate ?? null,
    lenguaje: nodo.primaryLanguage?.name ?? null,
    licencia: nodo.licenseInfo?.spdxId ?? null,
    topics: nodo.repositoryTopics.nodes.map((n) => n.topic.name),
  };
}

function trocear<T>(lista: readonly T[], tamano: number): T[][] {
  const trozos: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) trozos.push(lista.slice(i, i + tamano));
  return trozos;
}

/** Ejecuta tareas con un máximo de `concurrencia` a la vez. */
async function enParalelo<T>(
  tareas: readonly T[],
  concurrencia: number,
  hacer: (tarea: T) => Promise<void>,
): Promise<void> {
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < tareas.length) {
      const tarea = tareas[siguiente++] as T;
      await hacer(tarea);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrencia, tareas.length) }, trabajador));
}

/** Pide un grupo; si GitHub no llega a tiempo, lo parte en dos y lo vuelve a intentar. */
async function conDivision<T>(grupo: readonly T[], pedir: (grupo: readonly T[]) => Promise<void>) {
  try {
    await pedir(grupo);
  } catch (error) {
    if (!(error instanceof ErrorTemporalDeGithub) || grupo.length === 1) throw error;
    const mitad = Math.ceil(grupo.length / 2);
    await conDivision(grupo.slice(0, mitad), pedir);
    await conDivision(grupo.slice(mitad), pedir);
  }
}

/** Variables y alias de una consulta con varios repositorios por nombre. */
function consultaPorNombre(grupo: readonly string[], campos: string) {
  const parametros = grupo.map((_, i) => `$o${i}: String!, $n${i}: String!`).join(', ');
  const cuerpo = grupo
    .map((_, i) => `r${i}: repository(owner: $o${i}, name: $n${i}) { ${campos} }`)
    .join('\n');
  const variables: Record<string, string> = {};
  grupo.forEach((nombre, i) => {
    const [propietario = '', repo = ''] = nombre.split('/');
    variables[`o${i}`] = propietario;
    variables[`n${i}`] = repo;
  });
  return { query: `query(${parametros}) {\n${cuerpo}\n}`, variables };
}

export interface ResultadoBusqueda {
  /** Repos que GitHub dice que cumplen la consulta (puede haber más de los devueltos). */
  total: number;
  repos: RepoGithub[];
}

/** Ejecuta búsquedas de repositorios, una por petición y varias a la vez. */
export async function buscarRepos(
  cliente: ClienteGithub,
  consultas: readonly string[],
  porConsulta: number,
  {
    concurrencia = 3,
    alProgresar,
  }: { concurrencia?: number; alProgresar?: (hechas: number) => void } = {},
): Promise<Map<string, ResultadoBusqueda>> {
  const resultados = new Map<string, ResultadoBusqueda>();
  const query = `query($q: String!) {
  search(type: REPOSITORY, query: $q, first: ${porConsulta}) {
    repositoryCount
    nodes { ... on Repository { ${CAMPOS_REPO} } }
  }
}`;
  await enParalelo([...new Set(consultas)], concurrencia, async (consulta) => {
    const datos = await cliente.graphql<{
      search: { repositoryCount: number; nodes: (NodoRepo | Record<string, never>)[] };
    }>(query, { q: consulta });
    const nodos = datos.search.nodes.filter((n): n is NodoRepo => 'nameWithOwner' in n);
    resultados.set(consulta, { total: datos.search.repositoryCount, repos: nodos.map(leerRepo) });
    alProgresar?.(resultados.size);
  });
  return resultados;
}

/** Pide repositorios por nombre (propietario/repo), con su último commit. Los que no existen vuelven como null. */
export async function obtenerRepos(
  cliente: ClienteGithub,
  nombres: readonly string[],
): Promise<Map<string, RepoGithub | null>> {
  const resultados = new Map<string, RepoGithub | null>();
  for (const trozo of trocear([...new Set(nombres)], REPOS_POR_PETICION)) {
    await conDivision(trozo, async (grupo) => {
      const { query, variables } = consultaPorNombre(grupo, `${CAMPOS_REPO}\n  ${CAMPO_COMMIT}`);
      const datos = await cliente.graphql<Record<string, NodoRepo | null>>(query, variables, {
        permitirNoEncontrados: true,
        reintentos: grupo.length > 1 ? 1 : 5,
      });
      grupo.forEach((nombre, i) => {
        const nodo = datos[`r${i}`];
        resultados.set(nombre, nodo ? leerRepo(nodo) : null);
      });
    });
  }
  return resultados;
}

/** Lo que puede cambiar de un día para otro y hay que comprobar justo antes de publicar. */
export interface DatosActuales {
  /** propietario/repo actual (cambia si lo renombran o lo transfieren). */
  repo: string;
  estrellas: number;
  esFork: boolean;
  archivado: boolean;
  /** Fecha del último commit de la rama principal (null si no tiene rama). */
  ultimoCommit: string | null;
}

/** Datos actuales de cada repo por su nombre. Los que ya no existen vuelven como null. */
export async function obtenerDatosActuales(
  cliente: ClienteGithub,
  nombres: readonly string[],
  alProgresar?: (hechas: number) => void,
): Promise<Map<string, DatosActuales | null>> {
  const resultados = new Map<string, DatosActuales | null>();
  const campos = `nameWithOwner stargazerCount isFork isArchived ${CAMPO_COMMIT}`;
  type Nodo = Pick<
    NodoRepo,
    'nameWithOwner' | 'stargazerCount' | 'isFork' | 'isArchived' | 'defaultBranchRef'
  >;
  for (const trozo of trocear([...new Set(nombres)], FECHAS_POR_PETICION)) {
    await conDivision(trozo, async (grupo) => {
      const { query, variables } = consultaPorNombre(grupo, campos);
      const datos = await cliente.graphql<Record<string, Nodo | null>>(query, variables, {
        permitirNoEncontrados: true,
        reintentos: grupo.length > 1 ? 1 : 5,
      });
      grupo.forEach((nombre, i) => {
        const nodo = datos[`r${i}`];
        resultados.set(
          nombre,
          nodo
            ? {
                repo: nodo.nameWithOwner,
                estrellas: nodo.stargazerCount,
                esFork: nodo.isFork,
                archivado: nodo.isArchived,
                ultimoCommit: nodo.defaultBranchRef?.target?.committedDate ?? null,
              }
            : null,
        );
      });
    });
    alProgresar?.(resultados.size);
  }
  return resultados;
}
