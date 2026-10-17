// Cliente mínimo de las API GraphQL y REST de GitHub. Solo lee: nunca escribe en GitHub.
//
// GitHub corta las consultas que tardan más de 10 s (responde 502 o 504). Medido el 16-oct-2026:
// una búsqueda de 100 repos con la fecha del último commit tarda ~9,5 s; de 50 repos sin ella, ~3,5 s.
// Por eso cada búsqueda va sola, pide 50 repos sin commit, y las fechas se piden luego en lotes.
//
// Medido el 17-oct-2026 para el robot diario: con todos sus campos, 25 repos tardan ~5 s y 50 ya
// superan los recursos que permite GitHub (RESOURCE_LIMITS_EXCEEDED, por las descargas de cada
// archivo). Con 3 peticiones a la vez, 600 repos tardan ~44 s; pero si ese ritmo se mantiene con
// los 3.000, GitHub frena (límite secundario de tiempo de CPU por minuto). Por eso el robot usa
// un presupuesto de tiempo de respuesta por minuto (presupuestoPorMinutoMs).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const URL_API = 'https://api.github.com';
const URL_GRAPHQL = `${URL_API}/graphql`;
const REPOS_POR_PETICION = 25;
const FECHAS_POR_PETICION = 30;
const AGENTE = 'all-open-project-robot';

/**
 * GitHub no ha podido responder a tiempo (502, 503, 504) ni tras reintentar, o la consulta pide
 * demasiado (RESOURCE_LIMITS_EXCEEDED). En los dos casos ayuda partir el lote.
 */
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

export interface TokenDelRobot {
  token: string;
  /**
   * Personal (de solo lectura) o el automático de Actions. Con el de Actions, GitHub frena mucho
   * antes: medido el 17-oct-2026, por encima de ~31 s de respuesta por minuto; con uno personal,
   * apenas a 90.
   */
  tipo: 'personal' | 'actions';
}

/**
 * Token del robot: el personal de solo lectura (ROBOT_TOKEN) si lo hay y sirve; si no (no está o
 * ha caducado), el de siempre, avisando para renovarlo.
 */
export async function obtenerTokenDelRobot(
  avisar: (texto: string) => void,
): Promise<TokenDelRobot> {
  const personal = process.env.ROBOT_TOKEN?.trim();
  if (personal) {
    const prueba = await fetch(`${URL_API}/rate_limit`, {
      headers: { authorization: `bearer ${personal}`, 'user-agent': AGENTE },
    });
    if (prueba.ok) return { token: personal, tipo: 'personal' };
    avisar(
      `El token personal del robot (ROBOT_TOKEN) no sirve (GitHub responde ${prueba.status}; ¿ha caducado?): se usa el de Actions, más lento`,
    );
  }
  const token = await obtenerToken();
  const deActions = process.env.GITHUB_ACTIONS === 'true' && token === process.env.GITHUB_TOKEN;
  return { token, tipo: deActions ? 'actions' : 'personal' };
}

interface ErrorGraphql {
  type?: string;
  message: string;
  /** Campo de la consulta al que se refiere: [alias] si es un repo concreto. */
  path?: (string | number)[];
}

export interface OpcionesCliente {
  /** Tiempo mínimo entre el inicio de dos peticiones, para no rozar los límites de GitHub. */
  pausaMs?: number;
  reintentos?: number;
  /**
   * Tiempo de respuesta de GraphQL que se permite por minuto, sumando las peticiones simultáneas.
   * GitHub limita su tiempo de CPU (60 s por minuto para GraphQL) y aconseja estimarlo con el
   * tiempo de respuesta. Sin valor, no se limita.
   */
  presupuestoPorMinutoMs?: number;
}

export interface OpcionesConsulta {
  /**
   * No falla si algún repositorio pedido no existe o GitHub lo tiene bloqueado (vuelve como null).
   * Quien llama debe comprobar que no faltan demasiados: si el token no sirve, faltarían todos.
   */
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
  /** GET a la API REST (ruta como «/repos/o/r»). Devuelve null si no existe (404, 409 o 451). */
  rest<T>(ruta: string): Promise<T | null>;
  /** Puntos de la API GraphQL que quedan en esta hora, según la última respuesta. */
  restantes(): number | null;
  /** Veces que GitHub ha frenado al cliente (403 o 429) y el presupuesto con el que sigue. */
  frenos(): { veces: number; presupuestoPorMinutoMs: number | null };
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

/** El presupuesto por minuto nunca baja de aquí, por mucho que frene GitHub. */
const PRESUPUESTO_MINIMO_MS = 30_000;

export function crearCliente(token: string, opciones: OpcionesCliente = {}): ClienteGithub {
  const pausaMs = opciones.pausaMs ?? 1000;
  const reintentos = opciones.reintentos ?? 5;
  let presupuesto = opciones.presupuestoPorMinutoMs;
  let restantes: number | null = null;
  let frenazos = 0;

  // Turnos en fila: aunque haya varias peticiones a la vez, empiezan con pausaMs de separación.
  // Si GitHub frena a una (403 o 429), todas esperan hasta pausaHasta en vez de seguir insistiendo.
  let turno = Promise.resolve();
  let ultimaPeticion = 0;
  let pausaHasta = 0;
  function esperarTurno(): Promise<void> {
    const anterior = turno;
    let liberar = () => {};
    turno = new Promise((resolver) => {
      liberar = resolver;
    });
    return anterior.then(async () => {
      const espera = Math.max(ultimaPeticion + pausaMs, pausaHasta) - Date.now();
      if (espera > 0) await dormir(espera);
      ultimaPeticion = Date.now();
      liberar();
    });
  }
  function frenar(respuesta: Response, intento: number, texto = ''): number {
    const ms = esperaTrasLimite(respuesta.headers, intento);
    pausaHasta = Math.max(pausaHasta, Date.now() + ms);
    frenazos++;
    // Si GitHub frena aun con presupuesto, el ritmo baja un 20 % para el resto de la ejecución.
    if (presupuesto !== undefined) {
      presupuesto = Math.max(PRESUPUESTO_MINIMO_MS, Math.round(presupuesto * 0.8));
    }
    const motivo = texto ? ` («${texto.replace(/\s+/g, ' ').slice(0, 120)}»)` : '';
    const ritmo =
      presupuesto === undefined
        ? ''
        : `; el ritmo baja a ${Math.round(presupuesto / 1000)} s por minuto`;
    console.warn(
      `\nGitHub respondió ${respuesta.status}${motivo}: se reintenta en ${Math.round(ms / 1000)} s${ritmo}`,
    );
    return ms;
  }

  // Presupuesto de tiempo de respuesta: lo gastado por las peticiones del último minuto, más lo que
  // gastarán las que están en marcha (estimado con la media).
  const recientes: { fin: number; ms: number }[] = [];
  let enMarcha = 0;
  async function esperarPresupuesto(): Promise<void> {
    if (presupuesto === undefined) return;
    for (;;) {
      const ahora = Date.now();
      while (recientes.length > 0 && (recientes[0]?.fin ?? ahora) < ahora - 60_000) {
        recientes.shift();
      }
      const gastado = recientes.reduce((total, r) => total + r.ms, 0);
      const media = recientes.length > 0 ? gastado / recientes.length : 0;
      if (gastado + enMarcha * media < presupuesto) return;
      await dormir(250);
    }
  }

  async function pedirGraphql(cuerpo: string): Promise<{ respuesta: Response; texto: string }> {
    await esperarTurno();
    await esperarPresupuesto();
    enMarcha++;
    const inicio = Date.now();
    try {
      const respuesta = await fetch(URL_GRAPHQL, {
        method: 'POST',
        headers: {
          authorization: `bearer ${token}`,
          'content-type': 'application/json',
          'user-agent': AGENTE,
        },
        body: cuerpo,
      });
      return { respuesta, texto: await respuesta.text() };
    } finally {
      enMarcha--;
      recientes.push({ fin: Date.now(), ms: Date.now() - inicio });
    }
  }

  async function graphql<T>(
    query: string,
    variables: Record<string, unknown> = {},
    { permitirNoEncontrados = false, reintentos: reintentosConsulta }: OpcionesConsulta = {},
  ): Promise<T> {
    const maxReintentos = reintentosConsulta ?? reintentos;
    for (let intento = 0; ; intento++) {
      const { respuesta, texto } = await pedirGraphql(JSON.stringify({ query, variables }));
      const quedan = respuesta.headers.get('x-ratelimit-remaining');
      if (quedan !== null) restantes = Number(quedan);

      const limitado = respuesta.status === 403 || respuesta.status === 429;
      if (limitado || respuesta.status >= 500) {
        if (intento >= maxReintentos) {
          const mensaje = `GitHub respondió ${respuesta.status} tras ${intento + 1} intentos`;
          throw limitado ? new Error(mensaje) : new ErrorTemporalDeGithub(mensaje);
        }
        // Un límite frena a todas las peticiones; un fallo del servidor, solo a esta.
        await dormir(
          limitado
            ? frenar(respuesta, intento, texto)
            : esperaTrasLimite(respuesta.headers, intento),
        );
        continue;
      }
      if (!respuesta.ok) {
        throw new Error(`GitHub respondió ${respuesta.status}: ${texto}`);
      }

      const cuerpo = JSON.parse(texto) as { data?: T; errors?: ErrorGraphql[] };
      const errores = (cuerpo.errors ?? []).filter(
        (e) => !(permitirNoEncontrados && esDeUnRepo(e)),
      );
      if (errores.some((e) => e.type === 'RESOURCE_LIMITS_EXCEEDED')) {
        throw new ErrorTemporalDeGithub(
          'La consulta pide demasiado a GitHub (RESOURCE_LIMITS_EXCEEDED)',
        );
      }
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

  async function rest<T>(ruta: string): Promise<T | null> {
    for (let intento = 0; ; intento++) {
      await esperarTurno();
      const respuesta = await fetch(`${URL_API}${ruta}`, {
        headers: {
          authorization: `bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': AGENTE,
        },
      });
      // No existe, está vacío (409) o bloqueado por motivos legales (451).
      if ([404, 409, 451].includes(respuesta.status)) return null;
      const limitado =
        respuesta.status === 429 ||
        (respuesta.status === 403 &&
          (respuesta.headers.has('retry-after') ||
            respuesta.headers.get('x-ratelimit-remaining') === '0'));
      if (limitado || respuesta.status >= 500) {
        if (intento >= reintentos) {
          throw new Error(
            `GitHub respondió ${respuesta.status} en ${ruta} tras ${intento + 1} intentos`,
          );
        }
        await dormir(
          limitado ? frenar(respuesta, intento) : esperaTrasLimite(respuesta.headers, intento),
        );
        continue;
      }
      if (!respuesta.ok) {
        throw new Error(
          `GitHub respondió ${respuesta.status} en ${ruta}: ${await respuesta.text()}`,
        );
      }
      return (await respuesta.json()) as T;
    }
  }

  return {
    graphql,
    rest,
    restantes: () => restantes,
    frenos: () => ({ veces: frenazos, presupuestoPorMinutoMs: presupuesto ?? null }),
  };
}

/** Error de un repo concreto (su alias, «r3») que no existe o está bloqueado: vuelve como null. */
function esDeUnRepo(error: ErrorGraphql): boolean {
  return (error.type === 'NOT_FOUND' || error.type === 'FORBIDDEN') && error.path?.length === 1;
}

/** Campos de cada repositorio. La fecha del último commit se pide aparte porque es lenta. */
const CAMPOS_REPO_SIN_TOPICS = `
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
  licenseInfo { spdxId }`;
/** Los topics son lo más caro de pedir: el 40 % del tiempo de la consulta diaria (17-oct-2026). */
const CAMPO_TOPICS = 'repositoryTopics(first: 20) { nodes { topic { name } } }';
const CAMPOS_REPO = `${CAMPOS_REPO_SIN_TOPICS}\n  ${CAMPO_TOPICS}`;
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
  /** No viene en la consulta diaria (los topics se piden aparte). */
  repositoryTopics?: { nodes: { topic: { name: string } }[] };
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
    topics: nodo.repositoryTopics?.nodes.map((n) => n.topic.name) ?? [],
  };
}

function trocear<T>(lista: readonly T[], tamano: number): T[][] {
  const trozos: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) trozos.push(lista.slice(i, i + tamano));
  return trozos;
}

/** Ejecuta tareas con un máximo de `concurrencia` a la vez. */
export async function enParalelo<T>(
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
async function conDivision<T>(
  grupo: readonly T[],
  pedir: (grupo: readonly T[]) => Promise<void>,
  /** Si se da, un elemento que falla solo no detiene todo: se anota y se sigue. */
  alFallarUno?: (elemento: T, error: Error) => void,
) {
  try {
    await pedir(grupo);
  } catch (error) {
    if (!(error instanceof ErrorTemporalDeGithub)) throw error;
    if (grupo.length === 1) {
      if (alFallarUno && grupo[0] !== undefined) {
        alFallarUno(grupo[0], error);
        return;
      }
      throw error;
    }
    const mitad = Math.ceil(grupo.length / 2);
    await conDivision(grupo.slice(0, mitad), pedir, alFallarUno);
    await conDivision(grupo.slice(mitad), pedir, alFallarUno);
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

// --- Robot diario ----------------------------------------------------------------------------

/** Lo que el robot diario pide cada noche de cada proyecto (los topics van aparte, por turnos). */
const CAMPOS_DIARIO = `
  databaseId
  ${CAMPOS_REPO_SIN_TOPICS}
  isDisabled
  hasIssuesEnabled
  owner { __typename ... on Organization { isVerified } }
  ${CAMPO_COMMIT}
  issuesAbiertas: issues(states: OPEN) { totalCount }
  issuesCerradas: issues(states: CLOSED) { totalCount }
  latestRelease {
    tagName
    publishedAt
    releaseAssets(first: 100) { totalCount nodes { name downloadCount } }
  }`;

interface NodoDiario extends NodoRepo {
  databaseId: number;
  isDisabled: boolean;
  hasIssuesEnabled: boolean;
  owner: { __typename: string; isVerified?: boolean };
  issuesAbiertas: { totalCount: number };
  issuesCerradas: { totalCount: number };
  latestRelease: {
    tagName: string;
    publishedAt: string | null;
    releaseAssets: { totalCount: number; nodes: { name: string; downloadCount: number }[] };
  } | null;
}

/** Archivo de una versión publicada, con sus descargas. */
export interface ArchivoVersion {
  nombre: string;
  descargas: number;
}

/** Lo que el robot diario lee de cada repo. */
export interface RepoDiario extends RepoGithub {
  /** Identificador numérico de GitHub: no cambia aunque renombren o transfieran el repo. */
  id: number;
  deshabilitado: boolean;
  /** null si el repo tiene las issues desactivadas. */
  issuesAbiertas: number | null;
  issuesCerradas: number | null;
  /** Si el dueño es una organización verificada por GitHub; null si es una persona. */
  organizacionVerificada: boolean | null;
  /** Última versión publicada (la que GitHub marca como «latest»); null si no hay. */
  version: {
    nombre: string;
    fecha: string | null;
    archivos: ArchivoVersion[];
    /** Archivos de la versión; si son más de 100, solo se leen los 100 primeros. */
    totalArchivos: number;
  } | null;
}

/**
 * Fecha en UTC con el formato de GitHub (2026-10-17T03:17:00Z). La del commit es un GitTimestamp,
 * que según la documentación puede llevar la zona horaria del autor.
 */
export function enUtc(fecha: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(fecha)) return fecha;
  const momento = new Date(fecha);
  if (Number.isNaN(momento.getTime())) throw new Error(`Fecha no válida de GitHub: «${fecha}»`);
  return momento.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function leerRepoDiario(nodo: NodoDiario): RepoDiario {
  const version = nodo.latestRelease;
  const base = leerRepo(nodo);
  return {
    ...base,
    creado: enUtc(base.creado),
    ultimoPush: base.ultimoPush === null ? null : enUtc(base.ultimoPush),
    ultimoCommit: base.ultimoCommit === null ? null : enUtc(base.ultimoCommit),
    id: nodo.databaseId,
    deshabilitado: nodo.isDisabled,
    issuesAbiertas: nodo.hasIssuesEnabled ? nodo.issuesAbiertas.totalCount : null,
    issuesCerradas: nodo.hasIssuesEnabled ? nodo.issuesCerradas.totalCount : null,
    organizacionVerificada:
      nodo.owner.__typename === 'Organization' ? nodo.owner.isVerified === true : null,
    version: version
      ? {
          nombre: version.tagName,
          fecha: version.publishedAt === null ? null : enUtc(version.publishedAt),
          archivos: version.releaseAssets.nodes.map((a) => ({
            nombre: a.name,
            descargas: a.downloadCount,
          })),
          totalArchivos: version.releaseAssets.totalCount,
        }
      : null,
  };
}

export interface ResultadoDiario {
  /** Datos de cada repo pedido; null si ya no existe o GitHub lo tiene bloqueado. */
  repos: Map<string, RepoDiario | null>;
  /** Repos que GitHub no ha podido servir ni pidiéndolos solos, con el motivo. */
  fallidos: Map<string, string>;
}

/**
 * Pide los datos del robot diario por nombre, en lotes de 25 y varios a la vez. Si GitHub no llega
 * a tiempo o la consulta pide demasiado, parte el lote; un repo que falla incluso solo se anota en
 * `fallidos` y no detiene a los demás.
 */
export async function obtenerReposDiario(
  cliente: ClienteGithub,
  nombres: readonly string[],
  {
    concurrencia = 3,
    alProgresar,
  }: { concurrencia?: number; alProgresar?: (hechos: number) => void } = {},
): Promise<ResultadoDiario> {
  const repos = new Map<string, RepoDiario | null>();
  const fallidos = new Map<string, string>();
  const trozos = trocear([...new Set(nombres)], REPOS_POR_PETICION);
  await enParalelo(trozos, concurrencia, async (trozo) => {
    await conDivision(
      trozo,
      async (grupo) => {
        const { query, variables } = consultaPorNombre(grupo, CAMPOS_DIARIO);
        const datos = await cliente.graphql<Record<string, NodoDiario | null>>(query, variables, {
          permitirNoEncontrados: true,
          reintentos: grupo.length > 1 ? 1 : 5,
        });
        grupo.forEach((nombre, i) => {
          const nodo = datos[`r${i}`];
          repos.set(nombre, nodo ? leerRepoDiario(nodo) : null);
        });
      },
      (nombre, error) => fallidos.set(nombre, error.message),
    );
    alProgresar?.(repos.size + fallidos.size);
  });
  return { repos, fallidos };
}

/**
 * Topics de cada repo por nombre. Los que no existen o fallan incluso solos no aparecen en el
 * resultado (quien llama se queda con los que ya tenía).
 */
export async function obtenerTopics(
  cliente: ClienteGithub,
  nombres: readonly string[],
  concurrencia = 3,
): Promise<Map<string, string[]>> {
  const resultado = new Map<string, string[]>();
  type Nodo = Required<Pick<NodoRepo, 'repositoryTopics'>>;
  await enParalelo(trocear([...new Set(nombres)], REPOS_POR_PETICION), concurrencia, (trozo) =>
    conDivision(
      trozo,
      async (grupo) => {
        const { query, variables } = consultaPorNombre(grupo, CAMPO_TOPICS);
        const datos = await cliente.graphql<Record<string, Nodo | null>>(query, variables, {
          permitirNoEncontrados: true,
          reintentos: grupo.length > 1 ? 1 : 5,
        });
        grupo.forEach((nombre, i) => {
          const nodo = datos[`r${i}`];
          if (nodo)
            resultado.set(
              nombre,
              nodo.repositoryTopics.nodes.map((n) => n.topic.name),
            );
        });
      },
      () => {},
    ),
  );
  return resultado;
}

/** Un archivo o carpeta de un repo, en su rama principal. */
export interface PeticionArchivo {
  repo: string;
  /** Ruta dentro del repo; '' es la raíz. */
  ruta: string;
}

export const claveArchivo = (p: PeticionArchivo) => `${p.repo}:${p.ruta}`;

/** Variables y alias de una consulta que pide un objeto git («HEAD:ruta») de varios repos. */
function consultaDeObjetos(grupo: readonly PeticionArchivo[], campos: string) {
  const parametros = grupo
    .map((_, i) => `$o${i}: String!, $n${i}: String!, $e${i}: String!`)
    .join(', ');
  const cuerpo = grupo
    .map(
      (_, i) =>
        `r${i}: repository(owner: $o${i}, name: $n${i}) { object(expression: $e${i}) { ${campos} } }`,
    )
    .join('\n');
  const variables: Record<string, string> = {};
  grupo.forEach((p, i) => {
    const [propietario = '', repo = ''] = p.repo.split('/');
    variables[`o${i}`] = propietario;
    variables[`n${i}`] = repo;
    variables[`e${i}`] = `HEAD:${p.ruta}`;
  });
  return { query: `query(${parametros}) {\n${cuerpo}\n}`, variables };
}

async function pedirObjetos<N, R>(
  cliente: ClienteGithub,
  peticiones: readonly PeticionArchivo[],
  campos: string,
  porLote: number,
  leer: (objeto: N | null) => R | null,
  concurrencia: number,
): Promise<Map<string, R | null>> {
  const resultados = new Map<string, R | null>();
  await enParalelo(trocear(peticiones, porLote), concurrencia, async (trozo) => {
    await conDivision(trozo, async (grupo) => {
      const { query, variables } = consultaDeObjetos(grupo, campos);
      const datos = await cliente.graphql<Record<string, { object: N | null } | null>>(
        query,
        variables,
        { permitirNoEncontrados: true, reintentos: grupo.length > 1 ? 1 : 5 },
      );
      grupo.forEach((p, i) => {
        resultados.set(claveArchivo(p), leer(datos[`r${i}`]?.object ?? null));
      });
    });
  });
  return resultados;
}

export interface EntradaCarpeta {
  nombre: string;
  tipo: 'blob' | 'tree' | 'commit';
}

/** Contenido de carpetas (la raíz es ''). Vuelve null si la carpeta no existe. */
export function obtenerEntradas(
  cliente: ClienteGithub,
  peticiones: readonly PeticionArchivo[],
  concurrencia = 3,
): Promise<Map<string, EntradaCarpeta[] | null>> {
  return pedirObjetos<
    { entries?: { name: string; type: EntradaCarpeta['tipo'] }[] },
    EntradaCarpeta[]
  >(
    cliente,
    peticiones,
    '... on Tree { entries { name type } }',
    25,
    (objeto) => objeto?.entries?.map((e) => ({ nombre: e.name, tipo: e.type })) ?? null,
    concurrencia,
  );
}

export interface TextoArchivo {
  /** null si el archivo es binario. */
  texto: string | null;
  /** GitHub no da el texto entero de los archivos muy grandes. */
  truncado: boolean;
}

/** Texto de archivos. Vuelve null si el archivo no existe. */
export function obtenerTextos(
  cliente: ClienteGithub,
  peticiones: readonly PeticionArchivo[],
  concurrencia = 3,
): Promise<Map<string, TextoArchivo | null>> {
  return pedirObjetos<
    { text?: string | null; isBinary?: boolean; isTruncated?: boolean },
    TextoArchivo
  >(
    cliente,
    peticiones,
    '... on Blob { text isBinary isTruncated }',
    20,
    (objeto) =>
      objeto && 'isBinary' in objeto
        ? {
            texto: objeto.isBinary ? null : (objeto.text ?? null),
            truncado: objeto.isTruncated === true,
          }
        : null,
    concurrencia,
  );
}

/** Todas las rutas de archivos de un repo (rama principal). Vuelve null si el repo está vacío. */
export async function obtenerArbol(
  cliente: ClienteGithub,
  repo: string,
): Promise<{ rutas: string[]; truncado: boolean } | null> {
  const arbol = await cliente.rest<{ truncated: boolean; tree: { path: string; type: string }[] }>(
    `/repos/${repo}/git/trees/HEAD?recursive=1`,
  );
  if (!arbol) return null;
  return {
    rutas: arbol.tree.filter((e) => e.type === 'blob').map((e) => e.path),
    truncado: arbol.truncated,
  };
}

// --- Radar horario ----------------------------------------------------------------------------

/** Lo que el radar necesita de un repo que aún no está en el catálogo. */
const CAMPOS_RADAR = `
  databaseId
  ${CAMPOS_REPO}`;

type NodoRadar = NodoRepo & { databaseId: number };

/** Un repo visto por el radar: los datos de siempre más su id de GitHub. */
export interface RepoRadar extends RepoGithub {
  id: number;
}

function leerRepoRadar(nodo: NodoRadar): RepoRadar {
  const base = leerRepo(nodo);
  return {
    ...base,
    creado: enUtc(base.creado),
    ultimoPush: base.ultimoPush === null ? null : enUtc(base.ultimoPush),
    id: nodo.databaseId,
  };
}

/**
 * Búsqueda de repos para el radar, página a página (50 por página: con más, GitHub puede pasar de
 * sus 10 s). Devuelve como mucho `maximo` repos, en el orden de la búsqueda.
 */
export async function buscarParaRadar(
  cliente: ClienteGithub,
  consulta: string,
  maximo: number,
): Promise<{ total: number; repos: RepoRadar[] }> {
  const query = `query($q: String!, $despues: String) {
  search(type: REPOSITORY, query: $q, first: 50, after: $despues) {
    repositoryCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on Repository { ${CAMPOS_RADAR} } }
  }
}`;
  interface Pagina {
    search: {
      repositoryCount: number;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: (NodoRadar | Record<string, never>)[];
    };
  }
  const repos: RepoRadar[] = [];
  let total = 0;
  let despues: string | null = null;
  while (repos.length < maximo) {
    const datos: Pagina = await cliente.graphql<Pagina>(query, { q: consulta, despues });
    total = datos.search.repositoryCount;
    const nodos = datos.search.nodes.filter((n): n is NodoRadar => 'nameWithOwner' in n);
    repos.push(...nodos.map(leerRepoRadar));
    if (!datos.search.pageInfo.hasNextPage || !datos.search.pageInfo.endCursor) break;
    despues = datos.search.pageInfo.endCursor;
  }
  return { total, repos: repos.slice(0, maximo) };
}

/** Datos de repos por nombre para el radar. Los que no existen vuelven como null. */
export async function obtenerReposRadar(
  cliente: ClienteGithub,
  nombres: readonly string[],
): Promise<Map<string, RepoRadar | null>> {
  const resultados = new Map<string, RepoRadar | null>();
  for (const trozo of trocear([...new Set(nombres)], REPOS_POR_PETICION)) {
    await conDivision(
      trozo,
      async (grupo) => {
        const { query, variables } = consultaPorNombre(grupo, CAMPOS_RADAR);
        const datos = await cliente.graphql<Record<string, NodoRadar | null>>(query, variables, {
          permitirNoEncontrados: true,
          reintentos: grupo.length > 1 ? 1 : 5,
        });
        grupo.forEach((nombre, i) => {
          const nodo = datos[`r${i}`];
          resultados.set(nombre, nodo ? leerRepoRadar(nodo) : null);
        });
      },
      () => {},
    );
  }
  return resultados;
}

/** Estrellas de un repo en este momento. */
export interface EstrellasActuales {
  id: number;
  /** propietario/repo actual (cambia si lo renombran). */
  repo: string;
  estrellas: number;
  archivado: boolean;
}

/** Repos por consulta al leer solo las estrellas: medido el 17-oct-2026, 100 tardan ~2,8 s (1 punto). */
const ESTRELLAS_POR_PETICION = 100;

/**
 * Estrellas actuales de muchos repos por su nombre. Los que no existen vuelven como null; los que
 * GitHub no sirve ni pidiéndolos solos van a `fallidos` (el radar sigue sin ellos).
 */
export async function obtenerEstrellas(
  cliente: ClienteGithub,
  nombres: readonly string[],
  {
    concurrencia = 2,
    alProgresar,
  }: { concurrencia?: number; alProgresar?: (hechos: number) => void } = {},
): Promise<{ estrellas: Map<string, EstrellasActuales | null>; fallidos: Set<string> }> {
  const estrellas = new Map<string, EstrellasActuales | null>();
  const fallidos = new Set<string>();
  interface Nodo {
    databaseId: number;
    nameWithOwner: string;
    stargazerCount: number;
    isArchived: boolean;
  }
  await enParalelo(
    trocear([...new Set(nombres)], ESTRELLAS_POR_PETICION),
    concurrencia,
    async (trozo) => {
      await conDivision(
        trozo,
        async (grupo) => {
          const { query, variables } = consultaPorNombre(
            grupo,
            'databaseId nameWithOwner stargazerCount isArchived',
          );
          const datos = await cliente.graphql<Record<string, Nodo | null>>(query, variables, {
            permitirNoEncontrados: true,
            reintentos: grupo.length > 1 ? 1 : 5,
          });
          grupo.forEach((nombre, i) => {
            const nodo = datos[`r${i}`];
            estrellas.set(
              nombre,
              nodo
                ? {
                    id: nodo.databaseId,
                    repo: nodo.nameWithOwner,
                    estrellas: nodo.stargazerCount,
                    archivado: nodo.isArchived,
                  }
                : null,
            );
          });
        },
        (nombre) => fallidos.add(nombre),
      );
      alProgresar?.(estrellas.size + fallidos.size);
    },
  );
  return { estrellas, fallidos };
}

/** Estrellas que ganó un repo un día (calendario de GitHub). */
export interface DiaDelHistorial {
  dia: string;
  estrellas: number;
}

/**
 * Historial oficial de estrellas por día (GET /repos/{o}/{r}/stargazers/history, septiembre de
 * 2026). Va por semanas, de la más reciente a la más antigua, cada una con sus 7 días desde el
 * domingo; el campo `week` es la fecha de ese domingo a las 00:00 UTC. Los días son del calendario
 * de GitHub, que no coincide con UTC (ver diaDeGithub). Devuelve null si el repo no existe.
 */
export async function obtenerHistorialDeEstrellas(
  cliente: ClienteGithub,
  repo: string,
  semanas = 3,
): Promise<DiaDelHistorial[] | null> {
  const datos = await cliente.rest<{ week: number; total: number; days: number[] }[]>(
    `/repos/${repo}/stargazers/history?per_page=${semanas}`,
  );
  if (!datos) return null;
  return datos
    .flatMap((semana) =>
      semana.days.map((estrellas, i) => ({
        dia: new Date((semana.week + i * 86_400) * 1000).toISOString().slice(0, 10),
        estrellas,
      })),
    )
    .sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));
}

/**
 * Día en el calendario del historial de estrellas de GitHub. Medido el 17-oct-2026: el día de hoy
 * se ponía a cero hacia las 07:00 UTC, la medianoche de la costa oeste de EE. UU. (hora del Pacífico).
 */
export function diaDeGithub(momento: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(momento);
}

/**
 * Momento en que empieza un día del calendario de GitHub (medianoche en la costa oeste de EE. UU.,
 * a las 07:00 o a las 08:00 UTC según el horario de verano).
 */
export function inicioDelDiaDeGithub(dia: string): Date {
  for (const desfase of ['-07:00', '-08:00']) {
    const inicio = new Date(`${dia}T00:00:00${desfase}`);
    if (diaDeGithub(inicio) === dia && diaDeGithub(new Date(inicio.getTime() - 1)) !== dia) {
      return inicio;
    }
  }
  throw new Error(`No se sabe cuándo empieza el día ${dia} de GitHub`);
}

/** Lo que hace falta para decidir si un repo es una posible copia. */
const CAMPOS_COPIA = `
  databaseId
  nameWithOwner
  description
  createdAt
  stargazerCount
  isFork
  defaultBranchRef { target { ... on Commit { history { totalCount } } } }
  latestRelease { releaseAssets(first: 30) { nodes { name downloadCount } } }
  raiz: object(expression: "HEAD:") { ... on Tree { entries { name type } } }`;

export interface DetallesCopia {
  id: number;
  repo: string;
  descripcion: string | null;
  creado: string;
  estrellas: number;
  esFork: boolean;
  /** Commits de la rama principal (0 si no tiene rama). */
  commits: number;
  /** Archivos de su última versión, con sus descargas. */
  version: { nombre: string; descargas: number }[];
  /** Archivos sueltos de la raíz del repo. */
  raiz: string[];
}

/** Detalles de posibles copias por nombre, de 10 en 10 (contar los commits es lento). */
export async function obtenerDetallesCopia(
  cliente: ClienteGithub,
  nombres: readonly string[],
): Promise<Map<string, DetallesCopia | null>> {
  interface Nodo {
    databaseId: number;
    nameWithOwner: string;
    description: string | null;
    createdAt: string;
    stargazerCount: number;
    isFork: boolean;
    defaultBranchRef: { target: { history?: { totalCount: number } } | null } | null;
    latestRelease: { releaseAssets: { nodes: { name: string; downloadCount: number }[] } } | null;
    raiz: { entries?: { name: string; type: string }[] } | null;
  }
  const resultados = new Map<string, DetallesCopia | null>();
  for (const trozo of trocear([...new Set(nombres)], 10)) {
    await conDivision(
      trozo,
      async (grupo) => {
        const { query, variables } = consultaPorNombre(grupo, CAMPOS_COPIA);
        const datos = await cliente.graphql<Record<string, Nodo | null>>(query, variables, {
          permitirNoEncontrados: true,
          reintentos: grupo.length > 1 ? 1 : 3,
        });
        grupo.forEach((nombre, i) => {
          const n = datos[`r${i}`];
          resultados.set(
            nombre,
            n
              ? {
                  id: n.databaseId,
                  repo: n.nameWithOwner,
                  descripcion: n.description,
                  creado: enUtc(n.createdAt),
                  estrellas: n.stargazerCount,
                  esFork: n.isFork,
                  commits: n.defaultBranchRef?.target?.history?.totalCount ?? 0,
                  version: (n.latestRelease?.releaseAssets.nodes ?? []).map((a) => ({
                    nombre: a.name,
                    descargas: a.downloadCount,
                  })),
                  raiz: (n.raiz?.entries ?? []).filter((e) => e.type === 'blob').map((e) => e.name),
                }
              : null,
          );
        });
      },
      () => {},
    );
  }
  return resultados;
}
