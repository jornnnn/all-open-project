import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { type EstadoRobot, proximaEjecucion } from '../src/estado.ts';
import { pedir, vaciarTablas } from './ayudantes.ts';

beforeEach(vaciarTablas);

const haceHoras = (horas: number) => new Date(Date.now() - horas * 3_600_000).toISOString();

async function ejecucion(datos: Record<string, unknown>) {
  const respuesta = await pedir('/ingest/ejecucion', { cuerpo: { tipo: 'diario', ...datos } });
  expect(respuesta.status).toBe(200);
}

async function estado(): Promise<EstadoRobot> {
  const respuesta = await pedir('/api/v1/estado', { clave: null });
  expect(respuesta.status).toBe(200);
  return respuesta.json();
}

describe('GET /api/v1/estado', () => {
  it('sin ejecuciones lo dice, y es público', async () => {
    const respuesta = await pedir('/api/v1/estado', { clave: null });
    expect(respuesta.headers.get('access-control-allow-origin')).toBe('*');
    expect(((await respuesta.json()) as EstadoRobot).salud).toBe('sin-datos');
  });

  it('con una ejecución correcta reciente, todo bien', async () => {
    await ejecucion({
      id: 'a',
      estado: 'ok',
      inicio: haceHoras(2),
      fin: haceHoras(1.9),
      proyectos: 3000,
    });
    const datos = await estado();
    expect(datos.salud).toBe('ok');
    expect(datos.ultima_ejecucion).toMatchObject({
      id: 'a',
      proyectos: 3000,
      errores: [],
      avisos: 0,
    });
    expect(datos.ultima_ejecucion?.duracion_s).toBe(360);
  });

  it('distingue una ejecución en curso de una que se ha quedado colgada', async () => {
    await ejecucion({ id: 'a', estado: 'en-curso', inicio: haceHoras(0.2) });
    expect((await estado()).salud).toBe('en-curso');
    await vaciarTablas();
    await ejecucion({ id: 'b', estado: 'en-curso', inicio: haceHoras(3) });
    const colgada = await estado();
    expect(colgada.salud).toBe('error');
    expect(colgada.mensaje).toContain('no terminó');
  });

  it('si la última falló, lo dice con el primer error, aunque la anterior fuera bien', async () => {
    await ejecucion({ id: 'a', estado: 'ok', inicio: haceHoras(25), fin: haceHoras(24.9) });
    await ejecucion({
      id: 'b',
      estado: 'error',
      inicio: haceHoras(1),
      fin: haceHoras(0.9),
      errores: ['GitHub respondió 502 tras 6 intentos'],
    });
    const datos = await estado();
    expect(datos.salud).toBe('error');
    expect(datos.mensaje).toContain('GitHub respondió 502');
    expect(datos.ultima_correcta?.id).toBe('a');
  });

  it('si la última correcta es de hace más de 26 horas, va con retraso', async () => {
    await ejecucion({ id: 'a', estado: 'ok', inicio: haceHoras(30), fin: haceHoras(29.9) });
    expect((await estado()).salud).toBe('atrasado');
  });
});

describe('GET /estado', () => {
  it('enseña la última ejecución y escapa el texto de los avisos', async () => {
    await ejecucion({
      id: 'a',
      estado: 'ok',
      inicio: haceHoras(2),
      fin: haceHoras(1.9),
      proyectos: 12987,
      avisos: ['<script>alert(1)</script> ya no existe'],
      enlace: 'https://github.com/jornnnn/all-open-project/actions/runs/1',
      resumen: { por_licencia: { 'open-source': 2400, otra: 9 }, d1: { filas_escritas: 6000 } },
    });
    const respuesta = await pedir('/estado', { clave: null });
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get('content-type')).toContain('text/html');
    expect(respuesta.headers.get('x-robots-tag')).toBe('noindex');
    const html = await respuesta.text();
    expect(html).toContain('Todo bien');
    expect(html).toContain('Correcta');
    expect(html).toContain('2400 open source · 9 otra (por revisar)');
    expect(html).toContain('Filas escritas en D1');
    // En español, los números de cuatro cifras van sin punto (2987) y los de cinco, con él.
    expect(html).toContain('12.987');
    expect(html).toContain('Avisos (1)');
    expect(html).toContain('ver la ejecución');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&#60;script&#62;');
  });

  it('funciona sin ninguna ejecución', async () => {
    const html = await (await pedir('/estado', { clave: null })).text();
    expect(html).toContain('Sin datos');
  });
});

describe('proximaEjecucion', () => {
  it('es hoy a las 03:23 UTC si aún no ha pasado, y si no, mañana', () => {
    expect(proximaEjecucion(new Date('2026-10-17T01:00:00Z')).toISOString()).toBe(
      '2026-10-17T03:23:00.000Z',
    );
    expect(proximaEjecucion(new Date('2026-10-17T03:23:00Z')).toISOString()).toBe(
      '2026-10-18T03:23:00.000Z',
    );
    expect(proximaEjecucion(new Date('2026-12-31T22:00:00Z')).toISOString()).toBe(
      '2027-01-01T03:23:00.000Z',
    );
  });
});

describe('Rutas', () => {
  it('la raíz se presenta y lo que no existe da 404', async () => {
    expect((await pedir('/', { clave: null })).status).toBe(200);
    expect((await pedir('/no-existe', { clave: null })).status).toBe(404);
    // /ingest nunca es público
    expect(
      (await pedir('/ingest/historial?desde=2026-01-01&hasta=2026-01-02', { clave: null })).status,
    ).toBe(401);
    expect(env.DB).toBeDefined();
  });
});

describe('Radar en /estado', () => {
  async function radar(datos: Record<string, unknown>) {
    const respuesta = await pedir('/ingest/ejecucion', { cuerpo: { tipo: 'radar', ...datos } });
    expect(respuesta.status).toBe(200);
  }

  it('sin ejecuciones del radar lo dice, sin tocar la salud del robot diario', async () => {
    await ejecucion({ id: 'a', estado: 'ok', inicio: haceHoras(2), fin: haceHoras(1.9) });
    const datos = await estado();
    expect(datos.salud).toBe('ok');
    expect(datos.radar).toMatchObject({ salud: 'sin-datos', alertas_pendientes: 0, en_auge: null });
  });

  it('va con retraso si no ha ido bien en las últimas 3 horas, y con error si falló', async () => {
    await radar({ id: 'r1', estado: 'ok', inicio: haceHoras(0.5), fin: haceHoras(0.45) });
    expect((await estado()).radar.salud).toBe('ok');
    await vaciarTablas();
    await radar({ id: 'r2', estado: 'ok', inicio: haceHoras(4), fin: haceHoras(3.9) });
    expect((await estado()).radar.salud).toBe('atrasado');
    await radar({
      id: 'r3',
      estado: 'error',
      inicio: haceHoras(1),
      fin: haceHoras(0.9),
      errores: ['GH Archive no responde'],
    });
    const datos = await estado();
    expect(datos.radar.salud).toBe('error');
    expect(datos.radar.mensaje).toContain('GH Archive no responde');
    // El robot diario no se entera: sigue sin datos.
    expect(datos.salud).toBe('sin-datos');
  });

  it('cuenta las alertas pendientes y lo que está en auge, y lo enseña en la página', async () => {
    await radar({
      id: 'r1',
      estado: 'ok',
      inicio: haceHoras(0.5),
      fin: haceHoras(0.45),
      resumen: { seguidos: 3412, candidatos: { vigilando: 250 }, d1: { filas_escritas: 31 } },
    });
    await pedir('/ingest/radar/guardar', {
      cuerpo: { radar: { tendencias: { en_auge: [{ repo: 'a/b' }, { repo: 'c/d' }], suben: [] } } },
    });
    const datos = await estado();
    expect(datos.radar).toMatchObject({ salud: 'ok', en_auge: 2, alertas_pendientes: 0 });
    const html = await (await pedir('/estado', { clave: null })).text();
    expect(html).toContain('Radar horario');
    expect(html).toContain('3412');
    expect(html).toContain('En auge ahora');
    expect(html).toContain('Posibles copias por revisar');
  });
});
