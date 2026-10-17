import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { contarConsultas, pedir, proyecto, vaciarTablas } from './ayudantes.ts';

beforeEach(vaciarTablas);

const fila = async <T>(sql: string, ...valores: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...valores)
    .first<T>();

function candidato(id: number, cambios: Record<string, unknown> = {}) {
  return {
    id,
    repo: `nuevo/repo-${id}`,
    fuentes: { 'busqueda-7d': '2026-10-17T10:23:00Z' },
    estado: 'vigilando',
    estrellas: 300 + id,
    creado: '2026-10-12T08:00:00Z',
    detectado: '2026-10-17T10:23:00Z',
    actualizado: '2026-10-17T10:23:00Z',
    datos: { descripcion: 'Un programa nuevo', topics: ['photo-editor'] },
    ...cambios,
  };
}

function alerta(repoId: number, originalId: number, cambios: Record<string, unknown> = {}) {
  return {
    repo: `falso/copia-${repoId}`,
    repo_id: repoId,
    original_id: originalId,
    evidencia: { nombre: { tipo: 'igual' }, senales: { reciente: true } },
    ...cambios,
  };
}

async function guardar(cuerpo: Record<string, unknown>) {
  const respuesta = await pedir('/ingest/radar/guardar', { cuerpo });
  expect(respuesta.status).toBe(200);
  return (await respuesta.json()) as { ok: boolean; filas_escritas: number };
}

async function estado() {
  const respuesta = await pedir('/ingest/radar/estado?desde=2026-10-01T00');
  expect(respuesta.status).toBe(200);
  return (await respuesta.json()) as {
    candidatos: Record<string, unknown>[];
    alertas: [string, number, string][];
    radar: Record<string, unknown>;
    horas: [string, string, number][];
    ultima: Record<string, unknown> | null;
  };
}

const hora = (h: string, estrellas: Record<string, number>) => ({
  hora: h,
  momento: `${h}:25:00Z`,
  repos: Object.keys(estrellas).length,
  estrellas,
});

describe('/ingest/radar: acceso', () => {
  it('sin la clave no deja leer ni guardar nada', async () => {
    expect((await pedir('/ingest/radar/estado?desde=2026-10-01T00', { clave: null })).status).toBe(
      401,
    );
    expect((await pedir('/ingest/radar/guardar', { cuerpo: {}, clave: null })).status).toBe(401);
    expect((await pedir('/ingest/radar/aceptados', { clave: 'otra' })).status).toBe(401);
  });
});

describe('POST /ingest/radar/guardar', () => {
  it('guarda la hora, los candidatos, la memoria y el registro en auge, y los devuelve', async () => {
    const r = await guardar({
      hora: hora('2026-10-17T10', { '1': 500, '2': 90 }),
      candidatos: [candidato(1), candidato(2)],
      radar: { memoria: { version: 1, gharchive: '2026-10-17-09' }, tendencias: { en_auge: [] } },
      auge: [
        {
          repo_id: 1,
          desde: '2026-10-17T10:25:00Z',
          hasta: null,
          repo: 'nuevo/repo-1',
          datos: { ganadas: 400 },
        },
      ],
    });
    // 1 hora (+1 de su índice) + 2 candidatos (+2 del índice por nombre) + 2 claves (+2) + 1 auge, más
    // el lote que entra y sale.
    expect(r.filas_escritas).toBeLessThan(20);

    const e = await estado();
    expect(e.horas).toEqual([['2026-10-17T10', '2026-10-17T10:25:00Z', 2]]);
    expect(e.candidatos.map((c) => c.id).sort()).toEqual([1, 2]);
    expect(e.candidatos[0]).toMatchObject({
      estado: 'vigilando',
      fuentes: { 'busqueda-7d': '2026-10-17T10:23:00Z' },
    });
    expect(e.radar).toEqual({
      memoria: { version: 1, gharchive: '2026-10-17-09' },
      tendencias: { en_auge: [] },
    });
    expect(await fila('SELECT count(*) AS n FROM ingesta_lotes')).toEqual({ n: 0 });

    const h = await pedir('/ingest/radar/hora/2026-10-17T10');
    expect(await h.json()).toEqual(hora('2026-10-17T10', { '1': 500, '2': 90 }));
    expect((await pedir('/ingest/radar/hora/2026-10-17T11')).status).toBe(404);
    expect((await pedir('/ingest/radar/hora/ayer')).status).toBe(400);
  });

  it('si el radar repite la hora, la sustituye; y borra las horas antiguas', async () => {
    await guardar({ hora: hora('2026-10-01T00', { '1': 1 }) });
    await guardar({ hora: hora('2026-10-17T10', { '1': 5 }) });
    await guardar({
      hora: hora('2026-10-17T10', { '1': 7 }),
      borrar_horas_antes_de: '2026-10-03T10',
    });
    const e = await estado();
    expect(e.horas.map((h) => h[0])).toEqual(['2026-10-17T10']);
    expect(await (await pedir('/ingest/radar/hora/2026-10-17T10')).json()).toMatchObject({
      estrellas: { '1': 7 },
    });
  });

  it('al actualizar un candidato no cambia cuándo se detectó', async () => {
    await guardar({ candidatos: [candidato(1)] });
    await guardar({
      candidatos: [
        candidato(1, {
          estado: 'aceptado',
          detectado: '2026-10-20T00:00:00Z',
          actualizado: '2026-10-20T00:00:00Z',
          datos: { temas: ['edicion-de-fotos'] },
        }),
      ],
    });
    expect(await fila('SELECT estado, detectado, datos FROM candidates WHERE id = 1')).toEqual({
      estado: 'aceptado',
      detectado: '2026-10-17T10:23:00Z',
      datos: '{"temas":["edicion-de-fotos"]}',
    });
    const aceptados = await (await pedir('/ingest/radar/aceptados')).json();
    expect(aceptados).toEqual([{ id: 1, repo: 'nuevo/repo-1', temas: ['edicion-de-fotos'] }]);
  });

  it('lo que decidió una persona no lo cambia el radar', async () => {
    await guardar({
      candidatos: [
        candidato(1, { estado: 'descartado', datos: { persona: { decision: 'sacar' } } }),
      ],
    });
    await guardar({ candidatos: [candidato(1, { estado: 'aceptado', datos: { temas: ['x'] } })] });
    expect(await fila('SELECT estado FROM candidates WHERE id = 1')).toEqual({
      estado: 'descartado',
    });
  });

  it('si otro candidato tenía ese nombre, lo libera', async () => {
    await guardar({ candidatos: [candidato(1, { repo: 'ana/editor' })] });
    await guardar({ candidatos: [candidato(2, { repo: 'Ana/Editor' })] });
    expect(await fila('SELECT repo FROM candidates WHERE id = 1')).toEqual({
      repo: 'ana/editor#1',
    });
    expect(await fila('SELECT repo FROM candidates WHERE id = 2')).toEqual({ repo: 'Ana/Editor' });
  });

  it('las alertas entran siempre como pendientes y una alerta existente no se toca', async () => {
    await pedir('/ingest/proyectos?fecha=2026-10-17', { cuerpo: [proyecto(1)] });
    await guardar({ alertas: [alerta(99, 1, { estado: 'publicada' })] });
    expect(await fila('SELECT estado, repo, original_id FROM alerts')).toEqual({
      estado: 'pendiente',
      repo: 'falso/copia-99',
      original_id: 1,
    });
    await env.DB.prepare(`UPDATE alerts SET estado = 'descartada'`).run();
    await guardar({ alertas: [alerta(99, 1, { evidencia: { otra: true } })] });
    expect(await fila('SELECT count(*) AS n, estado FROM alerts')).toEqual({
      n: 1,
      estado: 'descartada',
    });
    expect((await estado()).alertas).toEqual([['posible-copia', 99, 'descartada']]);
  });

  it('borra los candidatos descartados por el radar hace tiempo, no los que decidió una persona', async () => {
    await guardar({
      candidatos: [
        candidato(1, { estado: 'descartado', actualizado: '2026-09-01T00:00:00Z' }),
        candidato(2, {
          estado: 'descartado',
          actualizado: '2026-09-01T00:00:00Z',
          datos: { persona: { decision: 'sacar' } },
        }),
        candidato(3, { estado: 'descartado', actualizado: '2026-10-16T00:00:00Z' }),
      ],
    });
    await guardar({ purgar_descartados_antes_de: '2026-09-17' });
    const ids = (
      await env.DB.prepare('SELECT id FROM candidates ORDER BY id').all<{ id: number }>()
    ).results;
    expect(ids.map((x) => x.id)).toEqual([2, 3]);
  });

  it('todo en una sola petición con pocas consultas, y si algo falla no guarda nada', async () => {
    const { db, cuenta } = contarConsultas(env.DB);
    const r = await pedir('/ingest/radar/guardar', {
      cuerpo: { hora: hora('2026-10-17T10', { '1': 1 }), candidatos: [candidato(1)] },
      entorno: { DB: db },
    });
    expect(r.status).toBe(200);
    expect(cuenta.consultas).toBe(10);
    // Un candidato sin nombre rompe la transacción: no queda ni la hora.
    const mal = await pedir('/ingest/radar/guardar', {
      cuerpo: {
        hora: hora('2026-10-17T11', { '1': 1 }),
        candidatos: [candidato(5, { repo: null })],
      },
    });
    expect(mal.status).toBe(400);
    expect(await fila(`SELECT count(*) AS n FROM hourly WHERE hora = '2026-10-17T11'`)).toEqual({
      n: 0,
    });
  });
});

describe('GET /api/v1/tendencias', () => {
  it('es público y, sin datos, devuelve listas vacías', async () => {
    const r = await pedir('/api/v1/tendencias', { clave: null });
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(await r.json()).toEqual({ actualizado: null, en_auge: [], suben: [] });
  });

  it('devuelve las tendencias que guardó el radar', async () => {
    const tendencias = {
      actualizado: '2026-10-17T10:25:00Z',
      en_auge: [{ repo: 'a/b', ganadas_24h: 500 }],
      suben: [],
    };
    await guardar({ radar: { tendencias } });
    expect(await (await pedir('/api/v1/tendencias', { clave: null })).json()).toEqual(tendencias);
  });
});
