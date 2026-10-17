import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disparar, lanzarLoQueToca, tareas } from '../src/disparo.ts';
import type { EstadoRobot } from '../src/estado.ts';
import worker from '../src/index.ts';
import { pedir, vaciarTablas } from './ayudantes.ts';

beforeEach(vaciarTablas);
afterEach(() => vi.restoreAllMocks());

const TOKEN = 'github_pat_de_prueba';

interface Llamada {
  url: string;
  metodo: string;
  cuerpo: string | null;
  cabeceras: Headers;
}

/** Sustituye a GitHub: cada petición del Worker pasa por `responder` y queda apuntada. */
function simularGitHub(responder: (url: URL, metodo: string) => Response) {
  const llamadas: Llamada[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (entrada, init) => {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
    const metodo = init?.method ?? 'GET';
    llamadas.push({
      url: url.toString(),
      metodo,
      cuerpo: typeof init?.body === 'string' ? init.body : null,
      cabeceras: new Headers(init?.headers),
    });
    return responder(url, metodo);
  });
  return llamadas;
}

/** GitHub sin ejecuciones recientes, que acepta lanzar cualquier workflow. */
const sinRecientes = (_url: URL, metodo: string) =>
  metodo === 'POST'
    ? new Response(null, { status: 204 })
    : Response.json({ total_count: 0, workflow_runs: [] });

describe('tareas', () => {
  it('a las 03:23 UTC, el robot (una vez al día) y después el radar', () => {
    expect(tareas(new Date('2026-10-18T03:23:00.123Z'))).toEqual([
      { tipo: 'diario', workflow: 'robot-diario.yml', desde: '2026-10-18T00:00:00Z' },
      { tipo: 'radar', workflow: 'radar-horario.yml', desde: '2026-10-18T02:38:00Z' },
    ]);
  });

  it('el resto de horas, solo el radar (si no se ha lanzado en 45 min)', () => {
    expect(tareas(new Date('2026-10-18T14:23:00Z'))).toEqual([
      { tipo: 'radar', workflow: 'radar-horario.yml', desde: '2026-10-18T13:38:00Z' },
    ]);
  });
});

describe('disparar', () => {
  it('sin token no llama a GitHub y lo dice', async () => {
    const llamadas = simularGitHub(sinRecientes);
    expect(await disparar(undefined, new Date('2026-10-18T14:23:00Z'))).toEqual([
      { tipo: 'radar', lanzado: false, error: 'falta el secreto DISPARO_TOKEN' },
    ]);
    expect(llamadas).toHaveLength(0);
  });

  it('si no hay ejecuciones recientes, lanza el workflow en main con el token', async () => {
    const llamadas = simularGitHub(sinRecientes);
    expect(await disparar(TOKEN, new Date('2026-10-18T14:23:00Z'))).toEqual([
      { tipo: 'radar', lanzado: true },
    ]);
    expect(llamadas).toHaveLength(2);
    const [mirar, lanzar] = llamadas as [Llamada, Llamada];
    const consulta = new URL(mirar.url);
    expect(consulta.pathname).toBe(
      '/repos/jornnnn/all-open-project/actions/workflows/radar-horario.yml/runs',
    );
    expect(consulta.searchParams.get('created')).toBe('>=2026-10-18T13:38:00Z');
    expect(lanzar.metodo).toBe('POST');
    expect(lanzar.url).toBe(
      'https://api.github.com/repos/jornnnn/all-open-project/actions/workflows/radar-horario.yml/dispatches',
    );
    expect(JSON.parse(lanzar.cuerpo ?? '{}')).toEqual({ ref: 'main' });
    for (const llamada of llamadas) {
      expect(llamada.cabeceras.get('authorization')).toBe(`Bearer ${TOKEN}`);
      expect(llamada.cabeceras.get('user-agent')).toBeTruthy();
    }
  });

  it('si ya hay una ejecución reciente (a mano, por ejemplo), no la repite', async () => {
    const llamadas = simularGitHub(() => Response.json({ total_count: 1, workflow_runs: [{}] }));
    expect(await disparar(TOKEN, new Date('2026-10-18T14:23:00Z'))).toEqual([
      { tipo: 'radar', lanzado: false, motivo: 'reciente' },
    ]);
    expect(llamadas.every((l) => l.metodo === 'GET')).toBe(true);
  });

  it('si GitHub falla con el robot, el radar se lanza igual', async () => {
    simularGitHub((url, metodo) =>
      url.pathname.includes('robot-diario.yml')
        ? new Response('Bad credentials', { status: 401 })
        : sinRecientes(url, metodo),
    );
    expect(await disparar(TOKEN, new Date('2026-10-18T03:23:00Z'))).toEqual([
      {
        tipo: 'diario',
        lanzado: false,
        error: 'GitHub respondió 401 al mirar las ejecuciones recientes',
      },
      { tipo: 'radar', lanzado: true },
    ]);
  });
});

describe('cron del Worker', () => {
  it('lanza el radar a los :23', async () => {
    const llamadas = simularGitHub(sinRecientes);
    const controlador = createScheduledController({
      scheduledTime: new Date('2026-10-18T14:23:00Z'),
      cron: '23 * * * *',
    });
    const ctx = createExecutionContext();
    await worker.scheduled(controlador, { ...env, DISPARO_TOKEN: TOKEN }, ctx);
    await waitOnExecutionContext(ctx);
    expect(llamadas.filter((l) => l.metodo === 'POST')).toHaveLength(1);
  });

  it('lo que no puede lanzar queda en /estado como una ejecución fallida', async () => {
    simularGitHub(() => new Response('Bad credentials', { status: 401 }));
    await lanzarLoQueToca({ ...env, DISPARO_TOKEN: TOKEN }, new Date(Date.now() - 60_000));
    const respuesta = await pedir('/api/v1/estado', { clave: null });
    const datos = (await respuesta.json()) as EstadoRobot;
    expect(datos.radar.salud).toBe('error');
    expect(datos.radar.mensaje).toContain(
      'No se ha podido lanzar en GitHub Actions: GitHub respondió 401',
    );
  });
});
