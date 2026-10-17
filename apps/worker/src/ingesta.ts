// Recibe los datos del robot. Todo va protegido con INGEST_KEY.
//
// El plan gratuito da 10 ms de CPU por petición y 50 consultas a D1. Por eso el Worker no lee el
// JSON: lo pasa tal cual a D1 y SQLite lo recorre con json_each, escribiendo todas las filas en una
// sola consulta. El lote viaja a D1 una sola vez (se guarda un momento en ingesta_lotes y las
// demás consultas lo leen de ahí): enviarlo una vez por consulta costaba 24-36 ms de CPU por lote.
// Cada petición hace como mucho 6 consultas, lleve 10 proyectos o 3.000.

import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import type { Contexto } from './tipos.ts';

/** Tamaño máximo de cada envío. El robot manda lotes más pequeños (ver jobs/lib/worker.ts). */
export const MAXIMO_CUERPO = 4 * 1024 * 1024;
/** Si una baja de proyectos afecta a más de esta parte del catálogo, se para por si es un error. */
export const MAXIMO_BAJAS = 0.1;

/** Guarda el lote recibido (?1 es su id y ?2 el JSON). */
export const SQL_GUARDAR_LOTE = 'INSERT INTO ingesta_lotes (id, datos) VALUES (?1, ?2)';
/** Borra el lote al terminar la petición. */
export const SQL_BORRAR_LOTE = 'DELETE FROM ingesta_lotes WHERE id = ?1';
/** Los proyectos del lote guardado, uno por fila (en `value`). */
const PROYECTOS_DEL_LOTE = 'json_each((SELECT datos FROM ingesta_lotes WHERE id = ?1))';

/**
 * Libera el nombre de proyectos dados de baja si otro repo lo usa ahora (lo borraron y crearon otro
 * con el mismo nombre). Solo escribe si pasa.
 */
export const SQL_LIBERAR_NOMBRES = `UPDATE projects SET repo = repo || '#' || id
WHERE activo = 0
  AND repo IN (SELECT json_extract(value, '$.repo') FROM ${PROYECTOS_DEL_LOTE})
  AND id NOT IN (SELECT json_extract(value, '$.id') FROM ${PROYECTOS_DEL_LOTE})`;

/**
 * Alta o actualización de todos los proyectos del lote. No toca el nombre (repo) para no reescribir
 * su índice cada noche: los cambios de nombre van aparte, en SQL_RENOMBRES.
 */
export const SQL_PROYECTOS = `INSERT INTO projects (
  id, repo, activo, descripcion, web, lenguaje, topics, temas, tema, area, publico,
  estrellas, forks, issues_abiertas, issues_cerradas, creado, ultimo_push, ultimo_cambio,
  archivado, estado, licencia_github, licencia, licencias, licencia_motivo,
  organizacion_verificada, oficial, version, version_fecha, descargas, instaladores, sistemas,
  estrellas_por_dia, puntuacion, puntuacion_detalle, origen, alta, actualizado
)
SELECT
  json_extract(p, '$.id'), json_extract(p, '$.repo'), 1,
  json_extract(p, '$.descripcion'), json_extract(p, '$.web'), json_extract(p, '$.lenguaje'),
  json_extract(p, '$.topics'), json_extract(p, '$.temas'), json_extract(p, '$.temas[0]'),
  json_extract(p, '$.area'), json_extract(p, '$.publico'),
  json_extract(p, '$.estrellas'), json_extract(p, '$.forks'),
  json_extract(p, '$.issues_abiertas'), json_extract(p, '$.issues_cerradas'),
  json_extract(p, '$.creado'), json_extract(p, '$.ultimo_push'), json_extract(p, '$.ultimo_cambio'),
  json_extract(p, '$.archivado'), json_extract(p, '$.estado'),
  json_extract(p, '$.licencia_github'), json_extract(p, '$.licencia'),
  json_extract(p, '$.licencias'), json_extract(p, '$.licencia_motivo'),
  json_extract(p, '$.organizacion_verificada'), json_extract(p, '$.oficial'),
  json_extract(p, '$.version.nombre'), json_extract(p, '$.version.fecha'),
  json_extract(p, '$.version.descargas'),
  json_extract(p, '$.instaladores'), json_extract(p, '$.sistemas'),
  json_extract(p, '$.estrellas_por_dia'), json_extract(p, '$.puntuacion'),
  json_extract(p, '$.puntuacion_detalle'), json_extract(p, '$.origen'),
  ?2, ?3
FROM (SELECT value AS p FROM ${PROYECTOS_DEL_LOTE})
WHERE true
ON CONFLICT (id) DO UPDATE SET
  activo = 1,
  descripcion = excluded.descripcion, web = excluded.web, lenguaje = excluded.lenguaje,
  topics = excluded.topics, temas = excluded.temas, tema = excluded.tema, area = excluded.area,
  publico = excluded.publico, estrellas = excluded.estrellas, forks = excluded.forks,
  issues_abiertas = excluded.issues_abiertas, issues_cerradas = excluded.issues_cerradas,
  creado = excluded.creado, ultimo_push = excluded.ultimo_push,
  ultimo_cambio = excluded.ultimo_cambio, archivado = excluded.archivado,
  estado = excluded.estado, licencia_github = excluded.licencia_github,
  licencia = excluded.licencia, licencias = excluded.licencias,
  licencia_motivo = excluded.licencia_motivo,
  organizacion_verificada = excluded.organizacion_verificada, oficial = excluded.oficial,
  version = excluded.version, version_fecha = excluded.version_fecha,
  descargas = excluded.descargas, instaladores = excluded.instaladores,
  sistemas = excluded.sistemas, estrellas_por_dia = excluded.estrellas_por_dia,
  puntuacion = excluded.puntuacion, puntuacion_detalle = excluded.puntuacion_detalle,
  origen = excluded.origen, actualizado = excluded.actualizado`;

/** Cambios de nombre (también los de mayúsculas). Solo escribe los que han cambiado. */
export const SQL_RENOMBRES = `UPDATE projects SET repo = j.repo
FROM (
  SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.repo') AS repo
  FROM ${PROYECTOS_DEL_LOTE}
) AS j
WHERE projects.id = j.id AND projects.repo != j.repo COLLATE BINARY`;

/** Foto del día de cada proyecto. Si el robot repite el día, la foto se sustituye. */
export const SQL_FOTOS = `INSERT INTO snapshots (
  project_id, fecha, estrellas, forks, issues_abiertas, descargas, puntuacion, estado
)
SELECT
  json_extract(value, '$.id'), ?2, json_extract(value, '$.estrellas'),
  json_extract(value, '$.forks'), json_extract(value, '$.issues_abiertas'),
  json_extract(value, '$.version.descargas'), json_extract(value, '$.puntuacion'),
  json_extract(value, '$.estado')
FROM ${PROYECTOS_DEL_LOTE}
WHERE true
ON CONFLICT (project_id, fecha) DO UPDATE SET
  estrellas = excluded.estrellas, forks = excluded.forks,
  issues_abiertas = excluded.issues_abiertas, descargas = excluded.descargas,
  puntuacion = excluded.puntuacion, estado = excluded.estado`;

/** Cuántos proyectos activos hay y cuántos se darían de baja. */
export const SQL_CUENTA_BAJAS = `SELECT
  (SELECT COUNT(*) FROM projects WHERE activo = 1) AS activos,
  (SELECT COUNT(*) FROM projects
    WHERE activo = 1 AND id NOT IN (SELECT value FROM json_each(?1))) AS bajas`;

/** Da de baja los proyectos que ya no están en el catálogo (se guarda su historial). */
export const SQL_BAJAS = `UPDATE projects SET activo = 0
WHERE activo = 1 AND id NOT IN (SELECT value FROM json_each(?1))`;

/**
 * Para el impulso: la foto más antigua de cada proyecto activo entre dos días (sin incluir el
 * último). La devuelve SQLite ya en JSON, [[id, fecha, estrellas], …], para que el Worker no la lea.
 */
export const SQL_HISTORIAL = `SELECT coalesce(json_group_array(json_array(p.id, s.fecha, s.estrellas)), '[]') AS datos
FROM projects AS p
JOIN snapshots AS s ON s.project_id = p.id AND s.fecha = (
  SELECT min(fecha) FROM snapshots WHERE project_id = p.id AND fecha >= ?1 AND fecha < ?2
)
WHERE p.activo = 1`;

/** Alta o actualización de una ejecución del robot. */
export const SQL_EJECUCION = `INSERT INTO runs (
  id, tipo, estado, inicio, fin, proyectos, errores, avisos, resumen, enlace
)
VALUES (
  json_extract(?1, '$.id'), json_extract(?1, '$.tipo'), json_extract(?1, '$.estado'),
  json_extract(?1, '$.inicio'), json_extract(?1, '$.fin'), json_extract(?1, '$.proyectos'),
  coalesce(json_extract(?1, '$.errores'), '[]'), coalesce(json_extract(?1, '$.avisos'), '[]'),
  json_extract(?1, '$.resumen'), json_extract(?1, '$.enlace')
)
ON CONFLICT (id) DO UPDATE SET
  estado = excluded.estado, fin = excluded.fin, proyectos = excluded.proyectos,
  errores = excluded.errores, avisos = excluded.avisos, resumen = excluded.resumen,
  enlace = coalesce(excluded.enlace, runs.enlace)`;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Errores de los datos (no del servidor): se devuelven como 400 para que el robot vea el motivo. */
const ERROR_DE_DATOS =
  /constraint failed|malformed JSON|datatype mismatch|too big|SQLITE_TOOBIG|no such column/i;

interface Medida {
  filas_escritas: number;
  filas_leidas: number;
}

function medir(resultados: readonly D1Result[]): Medida {
  return {
    filas_escritas: resultados.reduce((t, r) => t + (r.meta.rows_written ?? 0), 0),
    filas_leidas: resultados.reduce((t, r) => t + (r.meta.rows_read ?? 0), 0),
  };
}

export const ingesta = new Hono<Contexto>();

ingesta.use('*', async (c, next) => {
  const clave = c.env.INGEST_KEY;
  if (!clave) return c.json({ error: 'El Worker no tiene configurada la clave INGEST_KEY' }, 503);
  // bearerAuth compara la clave en tiempo constante.
  return bearerAuth<Contexto>({ token: clave })(c, next);
});

ingesta.use(
  '*',
  bodyLimit({
    maxSize: MAXIMO_CUERPO,
    onError: (c) => c.json({ error: `El envío supera ${MAXIMO_CUERPO} bytes` }, 413),
  }),
);

ingesta.onError((error, c) => {
  // La clave que falta o no coincide (401) la responde bearerAuth tal cual.
  if (error instanceof HTTPException) return error.getResponse();
  if (ERROR_DE_DATOS.test(error.message)) return c.json({ error: error.message }, 400);
  console.error(error);
  return c.json({ error: 'Error interno al guardar los datos' }, 500);
});

ingesta.post('/ejecucion', async (c) => {
  const resultado = await c.env.DB.prepare(SQL_EJECUCION)
    .bind(await c.req.text())
    .run();
  return c.json({ ok: true, ...medir([resultado]) });
});

/** Proyectos del día en un lote: ?fecha=AAAA-MM-DD y, en el cuerpo, la lista en JSON. */
ingesta.post('/proyectos', async (c) => {
  const fecha = c.req.query('fecha');
  if (!fecha || !FECHA.test(fecha)) {
    return c.json({ error: 'Falta la fecha de la foto (?fecha=AAAA-MM-DD)' }, 400);
  }
  const db = c.env.DB;
  const lote = crypto.randomUUID();
  // Todo en una transacción: si algo falla, no queda nada a medias (ni el lote guardado).
  const resultados = await db.batch([
    db.prepare(SQL_GUARDAR_LOTE).bind(lote, await c.req.text()),
    db.prepare(SQL_LIBERAR_NOMBRES).bind(lote),
    db.prepare(SQL_PROYECTOS).bind(lote, fecha, new Date().toISOString()),
    db.prepare(SQL_RENOMBRES).bind(lote),
    db.prepare(SQL_FOTOS).bind(lote, fecha),
    db.prepare(SQL_BORRAR_LOTE).bind(lote),
  ]);
  // Sin contar proyectos con meta.changes: D1 suma ahí lo que escriben los disparadores del buscador.
  return c.json({ ok: true, ...medir(resultados) });
});

/**
 * Cierre: da de baja los proyectos activos que no están en la lista de ids del cuerpo. Si son más
 * del 10 % del catálogo, se niega (podría ser un fallo del robot) salvo con ?forzar=1.
 */
ingesta.post('/cierre', async (c) => {
  const cuerpo = await c.req.text();
  const db = c.env.DB;
  const cuenta = await db
    .prepare(SQL_CUENTA_BAJAS)
    .bind(cuerpo)
    .first<{ activos: number; bajas: number }>();
  const activos = cuenta?.activos ?? 0;
  const bajas = cuenta?.bajas ?? 0;
  if (bajas > activos * MAXIMO_BAJAS && c.req.query('forzar') !== '1') {
    return c.json(
      {
        error: `Se darían de baja ${bajas} de ${activos} proyectos; si es correcto, usa ?forzar=1`,
      },
      409,
    );
  }
  const resultado = await db.prepare(SQL_BAJAS).bind(cuerpo).run();
  return c.json({ ok: true, bajas: resultado.meta.changes, ...medir([resultado]) });
});

/** Fotos de referencia para el impulso: ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD (sin incluir hasta). */
ingesta.get('/historial', async (c) => {
  const desde = c.req.query('desde');
  const hasta = c.req.query('hasta');
  if (!desde || !hasta || !FECHA.test(desde) || !FECHA.test(hasta)) {
    return c.json({ error: 'Faltan las fechas (?desde=AAAA-MM-DD&hasta=AAAA-MM-DD)' }, 400);
  }
  const fila = await c.env.DB.prepare(SQL_HISTORIAL).bind(desde, hasta).first<{ datos: string }>();
  return c.body(fila?.datos ?? '[]', 200, { 'content-type': 'application/json; charset=utf-8' });
});
