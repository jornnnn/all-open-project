// Lanza el radar cada hora y el robot cada noche desde el cron de Cloudflare (wrangler.jsonc).
//
// Las tareas programadas de GitHub Actions no son fiables: el 17-oct-2026 GitHub no lanzó ninguna de
// las tres primeras horas del radar (18:23, 19:23 y 20:23 UTC), ni después de desactivarlo y volver
// a activarlo, mientras sí lanzaba las de otros repos. El cron de Cloudflare llega a su hora, así que
// el Worker pide a GitHub que ejecute los workflows (workflow_dispatch) con un token que solo puede
// lanzar los workflows de este repo (DISPARO_TOKEN, un secreto).
//
// Antes de lanzar, mira si ya hay una ejecución reciente (por ejemplo, una lanzada a mano), para no
// repetirla. Lo que no se puede lanzar queda en /estado como una ejecución fallida, con el motivo.

import { HORA_DEL_ROBOT } from './estado.ts';
import { SQL_EJECUCION } from './ingesta.ts';
import type { Entorno } from './tipos.ts';

const WORKFLOWS = 'https://api.github.com/repos/jornnnn/all-open-project/actions/workflows';
/** Si el radar ya se ha lanzado en estos minutos (a mano, por ejemplo), no se repite. */
export const MINUTOS_SIN_REPETIR_RADAR = 45;

export interface Tarea {
  tipo: 'diario' | 'radar';
  workflow: string;
  /** Si ya hay una ejecución creada desde este momento, no se lanza otra. */
  desde: string;
}

export interface Resultado {
  tipo: Tarea['tipo'];
  lanzado: boolean;
  /** Por qué no se ha lanzado: «reciente» si ya había una ejecución; si no, el error. */
  motivo?: string;
  error?: string;
}

const sinMilisegundos = (fecha: Date) => fecha.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Lo que toca lanzar en este momento: a la hora del robot (03:23 UTC), el robot primero, y el radar
 * siempre. Como van en el mismo grupo de concurrencia, el radar espera a que el robot termine.
 */
export function tareas(momento: Date): Tarea[] {
  const lista: Tarea[] = [];
  if (momento.getUTCHours() === HORA_DEL_ROBOT.horas) {
    // Una vez al día: si ya se ha ejecutado hoy (UTC), no se repite.
    const hoy = momento.toISOString().slice(0, 10);
    lista.push({ tipo: 'diario', workflow: 'robot-diario.yml', desde: `${hoy}T00:00:00Z` });
  }
  const antes = new Date(momento.getTime() - MINUTOS_SIN_REPETIR_RADAR * 60_000);
  lista.push({ tipo: 'radar', workflow: 'radar-horario.yml', desde: sinMilisegundos(antes) });
  return lista;
}

function pedirAGitHub(ruta: string, token: string, init: RequestInit = {}): Promise<Response> {
  const cabeceras = new Headers(init.headers);
  cabeceras.set('accept', 'application/vnd.github+json');
  cabeceras.set('authorization', `Bearer ${token}`);
  // GitHub rechaza las peticiones sin User-Agent.
  cabeceras.set('user-agent', 'all-open-project (cron de Cloudflare)');
  cabeceras.set('x-github-api-version', '2022-11-28');
  return fetch(`${WORKFLOWS}/${ruta}`, { ...init, headers: cabeceras });
}

/** Lanza una tarea si no hay una ejecución reciente. Lanza un error si GitHub no responde bien. */
async function lanzar(tarea: Tarea, token: string): Promise<Resultado> {
  const consulta = new URLSearchParams({ per_page: '1', created: `>=${tarea.desde}` });
  const recientes = await pedirAGitHub(`${tarea.workflow}/runs?${consulta}`, token);
  if (!recientes.ok) {
    throw new Error(`GitHub respondió ${recientes.status} al mirar las ejecuciones recientes`);
  }
  const { total_count: total } = await recientes.json<{ total_count: number }>();
  if (total > 0) return { tipo: tarea.tipo, lanzado: false, motivo: 'reciente' };
  const respuesta = await pedirAGitHub(`${tarea.workflow}/dispatches`, token, {
    method: 'POST',
    body: JSON.stringify({ ref: 'main' }),
  });
  if (!respuesta.ok) throw new Error(`GitHub respondió ${respuesta.status} al lanzar el workflow`);
  return { tipo: tarea.tipo, lanzado: true };
}

/** Lanza lo que toque. Cada tarea va por su cuenta: si una falla, la otra se intenta igual. */
export async function disparar(token: string | undefined, momento: Date): Promise<Resultado[]> {
  const resultados: Resultado[] = [];
  for (const tarea of tareas(momento)) {
    if (!token) {
      resultados.push({
        tipo: tarea.tipo,
        lanzado: false,
        error: 'falta el secreto DISPARO_TOKEN',
      });
      continue;
    }
    try {
      resultados.push(await lanzar(tarea, token));
    } catch (error) {
      resultados.push({ tipo: tarea.tipo, lanzado: false, error: (error as Error).message });
    }
  }
  return resultados;
}

/** El cron: lanza lo que toque y apunta en /estado (tabla runs) lo que no se haya podido lanzar. */
export async function lanzarLoQueToca(entorno: Entorno, momento: Date): Promise<Resultado[]> {
  const resultados = await disparar(entorno.DISPARO_TOKEN, momento);
  const fallos = resultados.filter((r) => r.error !== undefined);
  if (fallos.length > 0) {
    const cuando = momento.toISOString();
    await entorno.DB.batch(
      fallos.map((f) =>
        entorno.DB.prepare(SQL_EJECUCION).bind(
          JSON.stringify({
            id: `disparo-${f.tipo}-${cuando}`,
            tipo: f.tipo,
            estado: 'error',
            inicio: cuando,
            fin: cuando,
            errores: [`No se ha podido lanzar en GitHub Actions: ${f.error}`],
          }),
        ),
      ),
    );
  }
  console.log(JSON.stringify({ disparo: momento.toISOString(), resultados }));
  return resultados;
}
