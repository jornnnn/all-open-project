// Robot diario: la foto de cada noche de todo el catálogo.
//
// 1. Lee la semilla (data/semilla.generada.json) y las correcciones (data/editorial.yaml).
// 2. Pide a GitHub los datos de cada proyecto (GraphQL, lotes de 25, 3 a la vez). Los topics, que
//    son lo más caro, los renueva cada proyecto una vez por semana (lib/anterior.ts).
// 3. Revisa las licencias que GitHub no reconoce («otra» y «sin licencia»).
// 4. Calcula estado, licencia, instaladores y puntuación (packages/core).
// 5. Lo guarda en D1 a través del Worker (/ingest) y escribe data/export/proyectos.json.
// El commit de los datos abiertos lo hace el workflow (.github/workflows/robot-diario.yml).
//
// Uso: pnpm diario                     necesita WORKER_URL e INGEST_KEY
//      pnpm diario -- --sin-worker     prueba en local: no guarda nada en D1
//      pnpm diario -- --limite 50      solo los 50 primeros de la semilla
//      pnpm diario -- --sin-exportar   no escribe data/export/

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type ProyectoCatalogo, VERSION_EXPORTACION } from '@aop/core';
import { z } from 'zod';
import { leerAnterior, leTocaHoy, licenciaReutilizable } from './lib/anterior.ts';
import { construirCatalogo, type EntradaSemilla, licenciasPorRevisar } from './lib/catalogo.ts';
import { cargarDatos, DIR_DATOS } from './lib/datos.ts';
import { entradasDelRadar } from './lib/entradas.ts';
import { escribirExportacion } from './lib/exportar.ts';
import {
  crearCliente,
  obtenerReposDiario,
  obtenerTokenDelRobot,
  obtenerTopics,
} from './lib/github.ts';
import { cargarPlantillas, type RevisionLicencia, revisarLicencias } from './lib/licencias.ts';
import { type ClienteWorker, crearClienteWorker } from './lib/worker.ts';

const { values: opciones } = parseArgs({
  options: {
    'sin-worker': { type: 'boolean', default: false },
    'sin-exportar': { type: 'boolean', default: false },
    limite: { type: 'string' },
  },
});

/** Si faltan más repos de la semilla que esta parte, algo va mal (¿el token?): no se publica nada. */
const MAXIMO_QUE_FALTAN = 0.02;
/** Avisos que se guardan con la ejecución; el resto solo se cuenta. */
const AVISOS_GUARDADOS = 300;
const DIAS_DE_HISTORIAL = 30;
const METODOLOGIA = 'https://github.com/jornnnn/all-open-project/blob/main/docs/metodologia.md';

const inicio = new Date();
const fecha = inicio.toISOString().slice(0, 10);
const { GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_REPOSITORY, GITHUB_SERVER_URL } = process.env;
const id = GITHUB_RUN_ID
  ? `gh-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT ?? '1'}`
  : `local-${inicio.toISOString()}`;
const enlace =
  GITHUB_RUN_ID && GITHUB_REPOSITORY
    ? {
        enlace: `${GITHUB_SERVER_URL ?? 'https://github.com'}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`,
      }
    : {};

let worker: ClienteWorker | null = null;
if (!opciones['sin-worker']) {
  const { WORKER_URL, INGEST_KEY } = process.env;
  if (!WORKER_URL || !INGEST_KEY) {
    console.error(
      'Faltan WORKER_URL e INGEST_KEY. Para probar en local sin guardar, usa --sin-worker.',
    );
    process.exit(1);
  }
  worker = crearClienteWorker(WORKER_URL, INGEST_KEY);
}

const avisos: string[] = [];
const segundos = () => Math.round((Date.now() - inicio.getTime()) / 1000);
const contar = (valores: readonly string[]) => {
  const cuenta: Record<string, number> = {};
  for (const v of valores) cuenta[v] = (cuenta[v] ?? 0) + 1;
  return Object.fromEntries(Object.entries(cuenta).sort((a, b) => b[1] - a[1]));
};

try {
  await worker?.ejecucion({
    id,
    tipo: 'diario',
    estado: 'en-curso',
    inicio: inicio.toISOString(),
    ...enlace,
  });
  const { proyectos, resumen } = await ejecutar();
  await worker?.ejecucion({
    id,
    tipo: 'diario',
    estado: 'ok',
    inicio: inicio.toISOString(),
    fin: new Date().toISOString(),
    proyectos: proyectos.length,
    avisos: avisos.slice(0, AVISOS_GUARDADOS),
    resumen: { ...resumen, avisos: avisos.length, duracion_s: segundos() },
    ...enlace,
  });
  console.log(`Hecho en ${segundos()} s: ${proyectos.length} proyectos, ${avisos.length} avisos.`);
} catch (error) {
  const mensaje = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${mensaje}`);
  try {
    await worker?.ejecucion({
      id,
      tipo: 'diario',
      estado: 'error',
      inicio: inicio.toISOString(),
      fin: new Date().toISOString(),
      errores: [mensaje],
      avisos: avisos.slice(0, AVISOS_GUARDADOS),
      ...enlace,
    });
  } catch (otro) {
    console.error(`Tampoco se pudo guardar el error en el Worker: ${otro}`);
  }
  process.exit(1);
}

async function ejecutar(): Promise<{
  proyectos: ProyectoCatalogo[];
  resumen: Record<string, unknown>;
}> {
  // 1. Datos de partida.
  const { taxonomia, editorial } = await cargarDatos();
  const semilla = await leerSemilla();
  // Los proyectos nuevos que propuso el radar y aceptó una persona entran con origen «radar».
  const delRadar = worker ? entradasDelRadar(semilla, await worker.aceptados()) : [];
  const todas = [...semilla, ...delRadar];
  const limite = opciones.limite === undefined ? todas.length : Number(opciones.limite);
  const entradas = todas.slice(0, limite);
  console.log(
    `Semilla: ${entradas.length} proyectos, ${delRadar.length} del radar (${fecha}, ejecución ${id})`,
  );

  // 2. GitHub.
  // Ritmo medido el 17-oct-2026: con el token de Actions, GitHub frenó a 75, 60, 48 y 38 s de
  // respuesta por minuto, y no a 31; con un token personal, una sola vez a 90. Cada frenazo cuesta
  // 60 s parado y baja el ritmo un 20 %, así que se empieza por debajo de esos límites.
  const { token, tipo } = await obtenerTokenDelRobot((texto) => avisos.push(texto));
  const cliente = crearCliente(token, {
    pausaMs: 300,
    presupuestoPorMinutoMs: tipo === 'actions' ? 30_000 : 75_000,
  });
  console.log(
    `  Token: ${tipo === 'actions' ? 'el automático de Actions (ritmo lento)' : 'personal de solo lectura'}`,
  );
  const { repos, fallidos } = await obtenerReposDiario(
    cliente,
    entradas.map((e) => e.repo),
    {
      alProgresar: (hechos) =>
        process.stdout.write(`\r  GitHub: ${hechos}/${entradas.length} repos (${segundos()} s)`),
    },
  );
  process.stdout.write('\n');
  const noEncontrados = [...repos.values()].filter((r) => r === null).length;
  const faltan = noEncontrados + fallidos.size;
  if (faltan > entradas.length * MAXIMO_QUE_FALTAN) {
    throw new Error(
      `GitHub no ha dado ${faltan} de ${entradas.length} repos (${noEncontrados} no encontrados, ${fallidos.size} fallidos): no se publica nada`,
    );
  }
  for (const [repo, motivo] of fallidos) {
    avisos.push(`${repo}: GitHub no lo ha servido hoy (${motivo}); se queda con los datos de ayer`);
  }

  // 2b. Topics: los nuevos y los que tienen turno hoy se piden; el resto, los de ayer.
  const anterior = await leerAnterior();
  const leidos = [...repos.values()].filter((r) => r !== null);
  const pedir = leidos.filter((r) => !anterior.topics.has(r.id) || leTocaHoy(r.id, fecha));
  const nuevos = await obtenerTopics(
    cliente,
    pedir.map((r) => r.repo),
  );
  let sinTopics = 0;
  for (const repo of leidos) {
    const topics = nuevos.get(repo.repo) ?? anterior.topics.get(repo.id);
    if (topics) repo.topics = topics;
    else sinTopics++;
  }
  if (sinTopics > 0)
    avisos.push(`${sinTopics} proyectos se quedan hoy sin topics (GitHub no los dio)`);
  console.log(
    `  Topics: ${nuevos.size} renovados, ${leidos.length - pedir.length} del ${anterior.fecha ?? '—'} (${segundos()} s)`,
  );

  // 3. Licencias que GitHub no reconoce: se revisan las de turno, las nuevas y aquellas en las que
  //    GitHub dice algo distinto que ayer; el resto conserva la revisión de ayer.
  const revisiones = new Map<string, RevisionLicencia>();
  const pendientes = licenciasPorRevisar(entradas, repos, editorial).filter(({ repo: nombre }) => {
    const repo = repos.get(nombre);
    const previa = repo
      ? licenciaReutilizable(anterior.licencias.get(repo.id), repo.id, repo.licencia, fecha)
      : null;
    if (previa?.motivo) {
      revisiones.set(nombre, {
        categoria: previa.categoria,
        licencias: previa.licencias,
        motivo: previa.motivo,
      });
    }
    return !previa;
  });
  const reutilizadas = revisiones.size;
  try {
    const nuevas = await revisarLicencias(cliente, pendientes, await cargarPlantillas());
    for (const [nombre, revision] of nuevas) revisiones.set(nombre, revision);
  } catch (error) {
    avisos.push(`Hoy no se han podido revisar las licencias: ${(error as Error).message}`);
  }
  console.log(
    `  Licencias: ${revisiones.size - reutilizadas} revisadas hoy y ${reutilizadas} del ${anterior.fecha ?? '—'} (${segundos()} s)`,
  );

  // 4. Fichas, con el impulso desde la foto de hace 30 días.
  const desde = new Date(inicio.getTime() - DIAS_DE_HISTORIAL * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const referencias = worker ? await worker.historial(desde, fecha) : new Map();
  const catalogo = construirCatalogo({
    semilla: entradas,
    repos,
    licencias: revisiones,
    referencias,
    taxonomia,
    editorial,
    ahora: inicio,
  });
  avisos.push(...catalogo.avisos);
  if (catalogo.errores.length > 0) {
    throw new Error(
      `${catalogo.errores.length} fichas con errores, no se publica nada: ${catalogo.errores.slice(0, 5).join(' | ')}`,
    );
  }
  const { proyectos } = catalogo;

  // 5. D1 y datos abiertos.
  let d1: Record<string, unknown> = { guardado: false };
  if (worker) {
    const medida = await worker.proyectos(fecha, proyectos);
    let bajas = 0;
    if (fallidos.size === 0) {
      bajas = (await worker.cierre(proyectos.map((p) => p.id))).bajas;
    } else {
      avisos.push(`Hoy no se da de baja ningún proyecto porque ${fallidos.size} repos han fallado`);
    }
    d1 = { guardado: true, ...medida, bajas };
    console.log(
      `  D1: ${medida.lotes} lotes, ${medida.filas_escritas} filas escritas, ${medida.filas_leidas} leídas, ${bajas} bajas (${segundos()} s)`,
    );
  }

  const revisadas = [...revisiones.values()].map((r) => r.categoria);
  const publico = {
    proyectos: proyectos.length,
    por_estado: contar(proyectos.map((p) => p.estado)),
    por_licencia: contar(proyectos.map((p) => p.licencia)),
    por_area: contar(proyectos.map((p) => p.area)),
    por_sistema: contar(proyectos.flatMap((p) => p.sistemas)),
    con_impulso: proyectos.filter((p) => p.estrellas_por_dia !== null).length,
    licencias_revisadas: { total: revisadas.length, ...contar(revisadas) },
  };
  const resumen = {
    ...publico,
    excluidos: catalogo.excluidos.length,
    desaparecidos: catalogo.desaparecidos.length,
    github: {
      pedidos: entradas.length,
      no_encontrados: noEncontrados,
      fallidos: fallidos.size,
      token: tipo,
      topics_renovados: nuevos.size,
      licencias_revisadas_hoy: revisiones.size - reutilizadas,
      frenazos: cliente.frenos().veces,
      ritmo_final_s_por_minuto: (cliente.frenos().presupuestoPorMinutoMs ?? 0) / 1000,
      puntos_que_quedan: cliente.restantes(),
    },
    d1,
  };

  if (!opciones['sin-exportar']) {
    await escribirExportacion({
      version: VERSION_EXPORTACION,
      generado: inicio.toISOString(),
      fecha,
      fuente: 'API GraphQL y REST de GitHub',
      licencia: 'CC BY 4.0',
      metodologia: METODOLOGIA,
      resumen: publico,
      proyectos,
    });
    console.log(`  Escrito data/export/proyectos.json (${segundos()} s)`);
  }
  console.log(JSON.stringify(resumen, null, 2));
  return { proyectos, resumen };
}

async function leerSemilla(): Promise<EntradaSemilla[]> {
  const esquema = z.object({
    proyectos: z.array(
      z.object({
        repo: z.string(),
        temas: z.array(z.string()).min(1),
        origen: z.array(z.string()),
      }),
    ),
  });
  const texto = await readFile(resolve(DIR_DATOS, 'semilla.generada.json'), 'utf8');
  return esquema.parse(JSON.parse(texto)).proyectos;
}
