import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SQL_BAJAS,
  SQL_BORRAR_LOTE,
  SQL_CUENTA_BAJAS,
  SQL_EJECUCION,
  SQL_FOTOS,
  SQL_GUARDAR_LOTE,
  SQL_HISTORIAL,
  SQL_LIBERAR_NOMBRES,
  SQL_PROYECTOS,
  SQL_RENOMBRES,
} from '../src/ingesta.ts';
import { contarConsultas, pedir, proyecto, vaciarTablas } from './ayudantes.ts';

beforeEach(vaciarTablas);

const contar = async (sql: string, ...valores: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...valores)
      .first<{ n: number }>()
  )?.n ?? -1;

async function enviar(proyectos: unknown[], fecha = '2026-10-17') {
  return pedir(`/ingest/proyectos?fecha=${fecha}`, { cuerpo: proyectos });
}

describe('/ingest: acceso', () => {
  it('sin la clave o con otra, no deja pasar', async () => {
    expect(
      (await pedir('/ingest/proyectos?fecha=2026-10-17', { cuerpo: [], clave: null })).status,
    ).toBe(401);
    expect(
      (await pedir('/ingest/proyectos?fecha=2026-10-17', { cuerpo: [], clave: 'otra' })).status,
    ).toBe(401);
    expect((await pedir('/ingest/proyectos?fecha=2026-10-17', { cuerpo: [] })).status).toBe(200);
  });

  it('si el Worker no tiene clave configurada, no acepta nada', async () => {
    const respuesta = await pedir('/ingest/proyectos?fecha=2026-10-17', {
      cuerpo: [],
      entorno: { INGEST_KEY: '' },
    });
    expect(respuesta.status).toBe(503);
  });
});

describe('POST /ingest/proyectos', () => {
  it('guarda cada proyecto y su foto del día, con los campos en su sitio', async () => {
    const respuesta = await enviar([proyecto(1), proyecto(2, { archivado: true, version: null })]);
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toMatchObject({ ok: true });
    expect(await contar('SELECT count(*) AS n FROM projects')).toBe(2);
    expect(await contar('SELECT count(*) AS n FROM snapshots')).toBe(2);

    const fila = await env.DB.prepare('SELECT * FROM projects WHERE id = 1').first();
    expect(fila).toMatchObject({
      repo: 'ana/proyecto-1',
      activo: 1,
      tema: 'edicion-de-fotos',
      temas: '["edicion-de-fotos","dibujo-y-diseno"]',
      archivado: 0,
      organizacion_verificada: 1,
      oficial: null,
      version: 'v1.0.0',
      version_fecha: '2026-09-01T00:00:00Z',
      descargas: 1234,
      sistemas: '["windows"]',
      alta: '2026-10-17',
    });
    expect(JSON.parse(String(fila?.instaladores))).toEqual({
      windows: ['visor.exe'],
      mac: [],
      linux: [],
      android: [],
    });
    const otra = await env.DB.prepare(
      'SELECT archivado, version, descargas FROM projects WHERE id = 2',
    ).first();
    expect(otra).toEqual({ archivado: 1, version: null, descargas: null });

    const foto = await env.DB.prepare('SELECT * FROM snapshots WHERE project_id = 1').first();
    expect(foto).toEqual({
      project_id: 1,
      fecha: '2026-10-17',
      estrellas: 1001,
      forks: 10,
      issues_abiertas: 3,
      descargas: 1234,
      puntuacion: 70,
      estado: 'vivo',
    });
  });

  it('si el robot repite el día, actualiza sin duplicar fotos ni cambiar el día de alta', async () => {
    await enviar([proyecto(1)]);
    await enviar([proyecto(1, { estrellas: 5000 })]);
    await enviar([proyecto(1, { estrellas: 5100 })], '2026-10-18');
    expect(await contar('SELECT count(*) AS n FROM snapshots WHERE project_id = 1')).toBe(2);
    const fila = await env.DB.prepare('SELECT estrellas, alta FROM projects WHERE id = 1').first();
    expect(fila).toEqual({ estrellas: 5100, alta: '2026-10-17' });
    const fotos = await env.DB.prepare(
      'SELECT fecha, estrellas FROM snapshots WHERE project_id = 1 ORDER BY fecha',
    ).all();
    expect(fotos.results).toEqual([
      { fecha: '2026-10-17', estrellas: 5000 },
      { fecha: '2026-10-18', estrellas: 5100 },
    ]);
  });

  it('sigue al proyecto aunque lo renombren (también si solo cambian las mayúsculas)', async () => {
    await enviar([proyecto(1)]);
    await enviar([proyecto(1, { repo: 'Ana/Nuevo-Nombre' })]);
    expect((await env.DB.prepare('SELECT repo FROM projects WHERE id = 1').first())?.repo).toBe(
      'Ana/Nuevo-Nombre',
    );
    await enviar([proyecto(1, { repo: 'ana/nuevo-nombre' })]);
    expect((await env.DB.prepare('SELECT repo FROM projects WHERE id = 1').first())?.repo).toBe(
      'ana/nuevo-nombre',
    );
  });

  it('si un repo nuevo usa el nombre de uno dado de baja, el antiguo deja libre el nombre', async () => {
    await enviar([proyecto(1, { repo: 'ana/visor' }), proyecto(2)]);
    await pedir('/ingest/cierre?forzar=1', { cuerpo: [2] });
    const respuesta = await enviar([proyecto(3, { repo: 'ana/visor' }), proyecto(2)]);
    expect(respuesta.status).toBe(200);
    const filas = await env.DB.prepare('SELECT id, repo, activo FROM projects ORDER BY id').all();
    expect(filas.results).toEqual([
      { id: 1, repo: 'ana/visor#1', activo: 0 },
      { id: 2, repo: 'ana/proyecto-2', activo: 1 },
      { id: 3, repo: 'ana/visor', activo: 1 },
    ]);
  });

  it('mantiene al día el índice de búsqueda solo cuando cambia el texto', async () => {
    const buscar = (texto: string) =>
      contar('SELECT count(*) AS n FROM fts_projects WHERE fts_projects MATCH ?', texto);
    await enviar([proyecto(1), proyecto(2, { descripcion: 'Reproductor de música' })]);
    expect(await buscar('fotos')).toBe(1);
    expect(await buscar('musica')).toBe(1); // sin tilde también encuentra «música»
    await enviar([
      proyecto(1, { descripcion: 'Visor de vídeos' }),
      proyecto(2, { descripcion: 'Reproductor de música' }),
    ]);
    expect(await buscar('fotos')).toBe(0);
    expect(await buscar('numero')).toBe(0);
    expect(await buscar('videos')).toBe(1);
    // Los topics también se buscan: «photo-editor» da «photo» y «editor».
    expect(await buscar('photo')).toBe(2);
    expect(await buscar('nuevo')).toBe(0);
    await enviar([proyecto(1, { repo: 'ana/nuevo-visor', descripcion: 'Visor de vídeos' })]);
    expect(await buscar('nuevo')).toBe(1);
  });

  it('rechaza datos que no cumplen el esquema sin dejar nada a medias', async () => {
    await enviar([proyecto(1)]);
    const respuesta = await enviar([
      proyecto(1, { estrellas: 9 }),
      proyecto(2, { estado: 'raro' }),
    ]);
    expect(respuesta.status).toBe(400);
    expect(((await respuesta.json()) as { error: string }).error).toMatch(
      /CHECK constraint failed/,
    );
    expect(await contar('SELECT count(*) AS n FROM projects')).toBe(1);
    expect(await contar('SELECT estrellas AS n FROM projects WHERE id = 1')).toBe(1001);
    expect(await contar('SELECT count(*) AS n FROM snapshots')).toBe(1);
    expect(await contar('SELECT count(*) AS n FROM ingesta_lotes')).toBe(0);
  });

  it('rechaza un JSON roto y una fecha que no es AAAA-MM-DD', async () => {
    expect(
      (await pedir('/ingest/proyectos?fecha=2026-10-17', { cuerpo: '[{"id": 1' })).status,
    ).toBe(400);
    expect((await enviar([proyecto(1)], '17-10-2026')).status).toBe(400);
    expect(await contar('SELECT count(*) AS n FROM projects')).toBe(0);
    expect(await contar('SELECT count(*) AS n FROM ingesta_lotes')).toBe(0);
  });

  it('el lote de paso se borra en la misma petición', async () => {
    expect((await enviar([proyecto(1), proyecto(2)])).status).toBe(200);
    expect(await contar('SELECT count(*) AS n FROM ingesta_lotes')).toBe(0);
  });

  it('respeta los límites del plan gratuito: 6 consultas por petición, lleve los proyectos que lleve', async () => {
    const lote = Array.from({ length: 2000 }, (_, i) =>
      proyecto(i + 1, { descripcion: null, topics: [], licencias: [], origen: [] }),
    );
    const { db, cuenta } = contarConsultas(env.DB);
    const respuesta = await pedir('/ingest/proyectos?fecha=2026-10-17', {
      cuerpo: lote,
      entorno: { DB: db },
    });
    expect(respuesta.status).toBe(200);
    expect(cuenta.consultas).toBe(6);
    expect(await contar('SELECT count(*) AS n FROM projects')).toBe(2000);
    expect(await contar('SELECT count(*) AS n FROM snapshots')).toBe(2000);
  });
});

describe('POST /ingest/cierre', () => {
  it('da de baja los que ya no están, sin borrar su historial', async () => {
    await enviar(Array.from({ length: 20 }, (_, i) => proyecto(i + 1)));
    const ids = Array.from({ length: 19 }, (_, i) => i + 1);
    const respuesta = await pedir('/ingest/cierre', { cuerpo: ids });
    expect(await respuesta.json()).toMatchObject({ ok: true, bajas: 1 });
    expect(await contar('SELECT activo AS n FROM projects WHERE id = 20')).toBe(0);
    expect(await contar('SELECT count(*) AS n FROM snapshots WHERE project_id = 20')).toBe(1);
  });

  it('se niega a dar de baja más del 10 % del catálogo salvo que se fuerce', async () => {
    await enviar(Array.from({ length: 20 }, (_, i) => proyecto(i + 1)));
    const respuesta = await pedir('/ingest/cierre', { cuerpo: [1, 2, 3] });
    expect(respuesta.status).toBe(409);
    expect(await contar('SELECT count(*) AS n FROM projects WHERE activo = 1')).toBe(20);
    expect((await pedir('/ingest/cierre?forzar=1', { cuerpo: [1, 2, 3] })).status).toBe(200);
    expect(await contar('SELECT count(*) AS n FROM projects WHERE activo = 1')).toBe(3);
  });

  it('un proyecto dado de baja vuelve a estar activo si reaparece', async () => {
    await enviar([proyecto(1), proyecto(2)]);
    await pedir('/ingest/cierre?forzar=1', { cuerpo: [1] });
    await enviar([proyecto(2)]);
    expect(await contar('SELECT activo AS n FROM projects WHERE id = 2')).toBe(1);
  });
});

describe('GET /ingest/historial', () => {
  it('devuelve la foto más antigua de cada proyecto dentro del periodo, sin contar el último día', async () => {
    await enviar([proyecto(1, { estrellas: 100 }), proyecto(2, { estrellas: 50 })], '2026-09-10');
    await enviar([proyecto(1, { estrellas: 200 }), proyecto(2, { estrellas: 60 })], '2026-09-20');
    await enviar([proyecto(1, { estrellas: 300 })], '2026-10-17');
    const respuesta = await pedir('/ingest/historial?desde=2026-09-17&hasta=2026-10-17');
    expect(respuesta.status).toBe(200);
    const datos = (await respuesta.json()) as [number, string, number][];
    expect(datos.sort((a, b) => a[0] - b[0])).toEqual([
      [1, '2026-09-20', 200],
      [2, '2026-09-20', 60],
    ]);
    const vacio = await pedir('/ingest/historial?desde=2026-10-18&hasta=2026-10-19');
    expect(await vacio.json()).toEqual([]);
    expect((await pedir('/ingest/historial?desde=ayer&hasta=hoy')).status).toBe(400);
  });
});

describe('POST /ingest/ejecucion', () => {
  it('guarda el comienzo y el final de una ejecución', async () => {
    const id = 'gh-123-1';
    await pedir('/ingest/ejecucion', {
      cuerpo: {
        id,
        tipo: 'diario',
        estado: 'en-curso',
        inicio: '2026-10-17T03:17:00Z',
        enlace: 'https://github.com/x',
      },
    });
    await pedir('/ingest/ejecucion', {
      cuerpo: {
        id,
        tipo: 'diario',
        estado: 'ok',
        inicio: '2026-10-17T03:17:00Z',
        fin: '2026-10-17T03:25:00Z',
        proyectos: 3000,
        avisos: ['a/b ya no existe'],
        resumen: { licencias: { 'open-source': 2500 } },
      },
    });
    const fila = await env.DB.prepare('SELECT * FROM runs WHERE id = ?').bind(id).first();
    expect(fila).toEqual({
      id,
      tipo: 'diario',
      estado: 'ok',
      inicio: '2026-10-17T03:17:00Z',
      fin: '2026-10-17T03:25:00Z',
      proyectos: 3000,
      errores: '[]',
      avisos: '["a/b ya no existe"]',
      resumen: '{"licencias":{"open-source":2500}}',
      enlace: 'https://github.com/x',
    });
  });
});

describe('Consultas SQL', () => {
  it('caben en los límites de D1: menos de 100 KB y menos de 100 parámetros', () => {
    const consultas = [
      SQL_GUARDAR_LOTE,
      SQL_BORRAR_LOTE,
      SQL_LIBERAR_NOMBRES,
      SQL_PROYECTOS,
      SQL_RENOMBRES,
      SQL_FOTOS,
      SQL_CUENTA_BAJAS,
      SQL_BAJAS,
      SQL_HISTORIAL,
      SQL_EJECUCION,
    ];
    for (const sql of consultas) {
      expect(new TextEncoder().encode(sql).length).toBeLessThan(100_000);
      const parametros = new Set(sql.match(/\?\d+/g) ?? []);
      expect(parametros.size).toBeLessThanOrEqual(3);
    }
  });
});
