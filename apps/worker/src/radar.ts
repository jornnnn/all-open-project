// Radar horario (Fase C): lo que lee y guarda el radar en /ingest/radar, y las tendencias públicas.
//
// Como en la ingesta diaria, el Worker no lee el JSON: lo pasa tal cual a D1 una sola vez
// (ingesta_lotes) y SQLite lo recorre con json_each. Las respuestas también las monta SQLite en
// JSON, y el Worker solo las junta. Así cada petición gasta muy poca CPU (10 ms en el plan gratuito).
//
// Escrituras: la cuenta tiene 100.000 filas escritas al día para todas sus bases. El radar guarda
// una fila por hora con las estrellas de todo lo que vigila (hourly) y, del resto, solo lo que cambia.

import { Hono } from 'hono';
import { SQL_BORRAR_LOTE, SQL_GUARDAR_LOTE } from './ingesta.ts';
import type { Contexto } from './tipos.ts';

/** Lo que trae el lote guardado (?1) en la ruta indicada, un elemento por fila (en `value`). */
const del = (ruta: string) =>
  `json_each((SELECT datos FROM ingesta_lotes WHERE id = ?1), '${ruta}')`;
/** Un campo suelto del lote guardado (?1). */
const campo = (ruta: string) =>
  `(SELECT json_extract(datos, '${ruta}') FROM ingesta_lotes WHERE id = ?1)`;

/** Todos los candidatos. De los descartados por el radar no hace falta su ficha, solo saber cuáles son. */
export const SQL_CANDIDATOS = `SELECT coalesce(json_group_array(json_object(
  'id', id, 'repo', repo, 'fuentes', json(fuentes), 'estado', estado, 'estrellas', estrellas,
  'creado', creado, 'detectado', detectado, 'actualizado', actualizado,
  'datos', CASE WHEN estado = 'descartado' AND json_extract(datos, '$.persona') IS NULL
    THEN NULL ELSE json(datos) END
)), '[]') AS datos FROM candidates`;

/** Alertas que ya existen (para no repetirlas): [tipo, repo_id, estado]. */
export const SQL_ALERTAS = `SELECT coalesce(json_group_array(json_array(tipo, repo_id, estado)), '[]')
  AS datos FROM alerts`;

/** Memoria y tendencias del radar: {clave: valor}. */
export const SQL_RADAR = `SELECT coalesce(json_group_object(clave, json(valor)), '{}') AS datos FROM radar`;

/** Horas guardadas desde ?1 (AAAA-MM-DDTHH): [hora, momento, repos], de la más antigua a la última. */
export const SQL_HORAS = `SELECT coalesce(json_group_array(json_array(hora, momento, repos)), '[]') AS datos
FROM (SELECT hora, momento, repos FROM hourly WHERE hora >= ?1 ORDER BY hora)`;

/** Última ejecución del radar, para saber si la anterior falló. */
export const SQL_ULTIMA_DEL_RADAR = `SELECT json_object('id', id, 'estado', estado, 'inicio', inicio, 'fin', fin)
  AS datos FROM runs WHERE tipo = 'radar' ORDER BY inicio DESC LIMIT 1`;

/** Las estrellas de una hora. */
export const SQL_HORA = 'SELECT momento, repos, estrellas FROM hourly WHERE hora = ?1';

/** Candidatos que han entrado en el catálogo: el robot diario los añade a la semilla. */
export const SQL_ACEPTADOS = `SELECT coalesce(json_group_array(json_object(
  'id', id, 'repo', repo, 'temas', json_extract(datos, '$.temas')
)), '[]') AS datos FROM candidates WHERE estado = 'aceptado'`;

/** Las estrellas de esta hora. Si el radar se repite en la misma hora, se sustituyen. */
export const SQL_GUARDAR_HORA = `INSERT INTO hourly (hora, momento, repos, estrellas)
SELECT json_extract(datos, '$.hora.hora'), json_extract(datos, '$.hora.momento'),
  json_extract(datos, '$.hora.repos'), json_extract(datos, '$.hora.estrellas')
FROM ingesta_lotes WHERE id = ?1 AND json_type(datos, '$.hora') = 'object'
ON CONFLICT (hora) DO UPDATE SET
  momento = excluded.momento, repos = excluded.repos, estrellas = excluded.estrellas`;

/** Las horas de hace más de 14 días se borran (el radar dice desde cuándo). */
export const SQL_BORRAR_HORAS = `DELETE FROM hourly WHERE hora < ${campo('$.borrar_horas_antes_de')}`;

/** Si otro candidato tenía el nombre de uno del lote (lo borraron y crearon otro igual), se libera. */
export const SQL_LIBERAR_CANDIDATOS = `UPDATE candidates SET repo = repo || '#' || id
WHERE repo IN (SELECT json_extract(value, '$.repo') FROM ${del('$.candidatos')})
  AND id NOT IN (SELECT json_extract(value, '$.id') FROM ${del('$.candidatos')})`;

/**
 * Alta o cambio de candidatos. La fecha de detección no cambia nunca, y lo que ha decidido una
 * persona en la página de revisión (datos.persona) no lo toca el radar.
 */
export const SQL_CANDIDATOS_GUARDAR = `INSERT INTO candidates (
  id, repo, fuentes, estado, estrellas, creado, detectado, actualizado, datos
)
SELECT
  json_extract(value, '$.id'), json_extract(value, '$.repo'), json_extract(value, '$.fuentes'),
  json_extract(value, '$.estado'), json_extract(value, '$.estrellas'),
  json_extract(value, '$.creado'), json_extract(value, '$.detectado'),
  json_extract(value, '$.actualizado'), json_extract(value, '$.datos')
FROM ${del('$.candidatos')}
WHERE true
ON CONFLICT (id) DO UPDATE SET
  repo = excluded.repo, fuentes = excluded.fuentes, estado = excluded.estado,
  estrellas = excluded.estrellas, creado = excluded.creado, actualizado = excluded.actualizado,
  datos = excluded.datos
WHERE candidates.datos IS NULL OR json_extract(candidates.datos, '$.persona') IS NULL`;

/** Memoria y tendencias del radar. */
export const SQL_RADAR_GUARDAR = `INSERT INTO radar (clave, valor, actualizado)
SELECT key, value, ?2 FROM ${del('$.radar')}
WHERE true
ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor, actualizado = excluded.actualizado`;

/** Registro «en auge»: entradas nuevas y salidas. */
export const SQL_AUGE_GUARDAR = `INSERT INTO auge (repo_id, desde, hasta, repo, datos)
SELECT json_extract(value, '$.repo_id'), json_extract(value, '$.desde'), json_extract(value, '$.hasta'),
  json_extract(value, '$.repo'), json_extract(value, '$.datos')
FROM ${del('$.auge')}
WHERE true
ON CONFLICT (repo_id, desde) DO UPDATE SET
  hasta = excluded.hasta, repo = excluded.repo, datos = excluded.datos`;

/**
 * Posibles copias nuevas. Entran siempre como «pendiente» y, si ya hay una alerta de ese repo, no
 * se toca: el radar no puede publicar ni reabrir nada. Solo una persona, en la página de revisión.
 */
export const SQL_ALERTAS_GUARDAR = `INSERT INTO alerts (
  tipo, repo, repo_id, original_id, evidencia, estado, creada
)
SELECT 'posible-copia', json_extract(value, '$.repo'), json_extract(value, '$.repo_id'),
  json_extract(value, '$.original_id'), json_extract(value, '$.evidencia'), 'pendiente', ?2
FROM ${del('$.alertas')}
WHERE true
ON CONFLICT (tipo, repo_id) DO NOTHING`;

/** Los candidatos que descartó el radar hace tiempo se borran (no los que decidió una persona). */
export const SQL_PURGAR_CANDIDATOS = `DELETE FROM candidates
WHERE estado = 'descartado' AND actualizado < ${campo('$.purgar_descartados_antes_de')}
  AND (datos IS NULL OR json_extract(datos, '$.persona') IS NULL)`;

/** Tendencias para la API pública. */
export const SQL_TENDENCIAS = `SELECT valor FROM radar WHERE clave = 'tendencias'`;

const HORA = /^\d{4}-\d{2}-\d{2}T\d{2}$/;
const JSON_UTF8 = { 'content-type': 'application/json; charset=utf-8' };

function medir(resultados: readonly D1Result[]) {
  return {
    filas_escritas: resultados.reduce((t, r) => t + (r.meta.rows_written ?? 0), 0),
    filas_leidas: resultados.reduce((t, r) => t + (r.meta.rows_read ?? 0), 0),
  };
}

/** Rutas del radar dentro de /ingest (con su clave y su límite de tamaño). */
export const radar = new Hono<Contexto>();

/** Todo lo que el radar necesita al empezar, en una sola petición: ?desde=AAAA-MM-DDTHH. */
radar.get('/estado', async (c) => {
  const desde = c.req.query('desde');
  if (!desde || !HORA.test(desde)) return c.json({ error: 'Falta ?desde=AAAA-MM-DDTHH' }, 400);
  const db = c.env.DB;
  const [candidatos, alertas, memoria, horas, ultima] = await db.batch<{ datos: string | null }>([
    db.prepare(SQL_CANDIDATOS),
    db.prepare(SQL_ALERTAS),
    db.prepare(SQL_RADAR),
    db.prepare(SQL_HORAS).bind(desde),
    db.prepare(SQL_ULTIMA_DEL_RADAR),
  ]);
  const uno = (r: D1Result<{ datos: string | null }> | undefined, vacio: string) =>
    r?.results[0]?.datos ?? vacio;
  return c.body(
    `{"candidatos":${uno(candidatos, '[]')},"alertas":${uno(alertas, '[]')},"radar":${uno(memoria, '{}')},"horas":${uno(horas, '[]')},"ultima":${uno(ultima, 'null')}}`,
    200,
    JSON_UTF8,
  );
});

/** Las estrellas de una hora: {hora, momento, repos, estrellas: {id: estrellas}}. */
radar.get('/hora/:hora', async (c) => {
  const hora = c.req.param('hora');
  if (!HORA.test(hora)) return c.json({ error: 'La hora va como AAAA-MM-DDTHH' }, 400);
  const fila = await c.env.DB.prepare(SQL_HORA)
    .bind(hora)
    .first<{ momento: string; repos: number; estrellas: string }>();
  if (!fila) return c.json({ error: 'No hay datos de esa hora' }, 404);
  return c.body(
    `{"hora":${JSON.stringify(hora)},"momento":${JSON.stringify(fila.momento)},"repos":${fila.repos},"estrellas":${fila.estrellas}}`,
    200,
    JSON_UTF8,
  );
});

/** Candidatos aceptados, para el robot diario. */
radar.get('/aceptados', async (c) => {
  const fila = await c.env.DB.prepare(SQL_ACEPTADOS).first<{ datos: string }>();
  return c.body(fila?.datos ?? '[]', 200, JSON_UTF8);
});

/** Lo que ha cambiado en esta hora, todo en una transacción. */
radar.post('/guardar', async (c) => {
  const db = c.env.DB;
  const lote = crypto.randomUUID();
  const ahora = new Date().toISOString();
  const resultados = await db.batch([
    db.prepare(SQL_GUARDAR_LOTE).bind(lote, await c.req.text()),
    db.prepare(SQL_GUARDAR_HORA).bind(lote),
    db.prepare(SQL_BORRAR_HORAS).bind(lote),
    db.prepare(SQL_LIBERAR_CANDIDATOS).bind(lote),
    db.prepare(SQL_CANDIDATOS_GUARDAR).bind(lote),
    db.prepare(SQL_RADAR_GUARDAR).bind(lote, ahora),
    db.prepare(SQL_AUGE_GUARDAR).bind(lote),
    db.prepare(SQL_ALERTAS_GUARDAR).bind(lote, ahora),
    db.prepare(SQL_PURGAR_CANDIDATOS).bind(lote),
    db.prepare(SQL_BORRAR_LOTE).bind(lote),
  ]);
  return c.json({ ok: true, ...medir(resultados) });
});

// --- API pública ------------------------------------------------------------------------------

export const tendencias = new Hono<Contexto>();

/** Lo que está en auge y lo que más sube, según el radar de la última hora. */
tendencias.get('/api/v1/tendencias', async (c) => {
  const fila = await c.env.DB.prepare(SQL_TENDENCIAS).first<{ valor: string }>();
  return c.body(fila?.valor ?? '{"actualizado":null,"en_auge":[],"suben":[]}', 200, {
    ...JSON_UTF8,
    'cache-control': 'public, max-age=300',
    'access-control-allow-origin': '*',
  });
});
