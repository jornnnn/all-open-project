// Radar horario: lo que se está haciendo viral, con cifras reales, y la cola de posibles copias.
//
// Cada hora (GitHub Actions, .github/workflows/radar-horario.yml, a las :23):
// 1. Pistas: la hora anterior de GH Archive (repos con 2 o más estrellas en su muestra).
// 2. Búsqueda: repos creados en los últimos 2, 7 y 30 días con muchas estrellas.
// 3. Seguimiento: las estrellas de todo el catálogo y de los candidatos (una sola fila por hora en
//    D1) y el historial oficial de estrellas por día de los que más suben, para su ritmo habitual.
// 4. «En auge», decisiones sobre los candidatos (entran en el catálogo, siguen o se dejan) y
//    posibles copias de los 500 proyectos más populares.
// 5. Lo guarda en D1 a través del Worker. Nada se publica: las copias esperan a que una persona
//    las revise en la página de revisión.
//
// Uso: pnpm radar                    necesita WORKER_URL e INGEST_KEY
//      pnpm radar -- --sin-copias    sin buscar copias (más rápido)

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  type ArchivoDescarga,
  type EvidenciaCopia,
  esDescargaEjecutable,
  esquemaExportacion,
  evaluarCopia,
  type Observacion,
} from '@aop/core';
import { cargarDatos } from './lib/datos.ts';
import { RUTA_EXPORTACION } from './lib/exportar.ts';
import { type HoraDeGharchive, leerHora, nombreDeHora } from './lib/gharchive.ts';
import {
  buscarParaRadar,
  crearCliente,
  type DiaDelHistorial,
  diaDeGithub,
  enParalelo,
  inicioDelDiaDeGithub,
  obtenerDetallesCopia,
  obtenerEstrellas,
  obtenerHistorialDeEstrellas,
  obtenerReposRadar,
  obtenerTokenDelRobot,
  type RepoRadar,
} from './lib/github.ts';
import {
  anotarCopiaMirada,
  anotarEncontrados,
  anotarRitmo,
  type Candidato,
  claveDeHora,
  decidir,
  elegirOriginales,
  evaluarAuges,
  type HoraGuardada,
  type Medida,
  type Memoria,
  medir,
  memoriaVacia,
  montarTendencias,
  necesitaRitmo,
  observacionDeHoy,
  observacionesDeLaMemoria,
  olvidarRitmosViejos,
  originalesParecidos,
  type ProyectoRadar,
  proyeccion24h,
  RADAR,
  recortarVigilados,
  tocaMirarCopia,
  turnoDeCopias,
} from './lib/radar.ts';
import { type CambiosDelRadar, crearClienteWorker, type EstadoDelRadar } from './lib/worker.ts';

const { values: opciones } = parseArgs({
  options: { 'sin-copias': { type: 'boolean', default: false } },
});

const HORA_MS = 3_600_000;
const DIA_MS = 86_400_000;
/** Avisos que se guardan con la ejecución; el resto solo se cuenta. */
const AVISOS_GUARDADOS = 100;

const ahora = new Date();
const momento = ahora.toISOString();
const dia = (fecha: Date) => fecha.toISOString().slice(0, 10);
const { GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_REPOSITORY, GITHUB_SERVER_URL } = process.env;
const id = GITHUB_RUN_ID
  ? `gh-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT ?? '1'}`
  : `radar-local-${momento}`;
const enlace =
  GITHUB_RUN_ID && GITHUB_REPOSITORY
    ? {
        enlace: `${GITHUB_SERVER_URL ?? 'https://github.com'}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`,
      }
    : {};

const { WORKER_URL, INGEST_KEY } = process.env;
if (!WORKER_URL || !INGEST_KEY) {
  console.error(
    'Faltan WORKER_URL e INGEST_KEY: el radar guarda sus datos en D1 a través del Worker.',
  );
  process.exit(1);
}
const worker = crearClienteWorker(WORKER_URL, INGEST_KEY);

const avisos: string[] = [];
const segundos = () => Math.round((Date.now() - ahora.getTime()) / 1000);

// Si el Worker no responde ni para empezar, no hay dónde apuntar el fallo: el workflow falla y
// GitHub avisa por correo.
const estado = await worker.radarEstado(claveDeHora(new Date(ahora.getTime() - 26 * HORA_MS)));
const anteriorFallo =
  estado.ultima !== null &&
  (estado.ultima.estado === 'error' ||
    (estado.ultima.estado === 'en-curso' &&
      Date.parse(estado.ultima.inicio) < ahora.getTime() - HORA_MS));

try {
  await worker.ejecucion({ id, tipo: 'radar', estado: 'en-curso', inicio: momento, ...enlace });
  const resumen = await ejecutar(estado);
  await worker.ejecucion({
    id,
    tipo: 'radar',
    estado: 'ok',
    inicio: momento,
    fin: new Date().toISOString(),
    proyectos: resumen.seguidos,
    avisos: avisos.slice(0, AVISOS_GUARDADOS),
    resumen: { ...resumen, avisos: avisos.length, duracion_s: segundos() },
    ...enlace,
  });
  console.log(`Hecho en ${segundos()} s.`);
} catch (error) {
  const mensaje = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${mensaje}`);
  try {
    await worker.ejecucion({
      id,
      tipo: 'radar',
      estado: 'error',
      inicio: momento,
      fin: new Date().toISOString(),
      errores: [mensaje],
      avisos: avisos.slice(0, AVISOS_GUARDADOS),
      ...enlace,
    });
  } catch (otro) {
    console.error(`Tampoco se pudo guardar el error en el Worker: ${otro}`);
    process.exit(1);
  }
  // Un fallo suelto (GitHub tarda, GH Archive no responde) queda en /estado y se reintenta en una
  // hora. Si falla dos veces seguidas, el workflow falla y GitHub avisa por correo.
  if (anteriorFallo) process.exit(1);
  console.log(`::warning::El radar ha fallado (${mensaje}); si vuelve a fallar, avisará.`);
}

async function ejecutar(estado: EstadoDelRadar) {
  // 1. Datos de partida: catálogo (datos abiertos del robot diario), exclusiones y memoria.
  const exportacion = esquemaExportacion.parse(
    JSON.parse(await readFile(RUTA_EXPORTACION, 'utf8')),
  );
  const catalogo: ProyectoRadar[] = exportacion.proyectos.map((p) => ({
    id: p.id,
    repo: p.repo,
    estrellas: p.estrellas,
    creado: p.creado,
    descripcion: p.descripcion,
    sistemas: p.sistemas,
    tieneDescargas: p.sistemas.length > 0 || (p.version?.descargas ?? 0) > 0,
  }));
  const enCatalogo = new Set(catalogo.map((p) => p.id));
  const { taxonomia, semilla, editorial } = await cargarDatos();
  const excluidos = new Set(
    [
      ...semilla.excluir.map((e) => e.repo),
      ...editorial.correcciones.filter((c) => c.tipo === 'excluir').map((c) => c.repo),
    ].map((r) => r.toLowerCase()),
  );
  const memoria: Memoria = esMemoria(estado.radar.memoria) ? estado.radar.memoria : memoriaVacia();
  const conocidos = new Map(estado.candidatos.map((c) => [c.id, c]));
  const alertas = new Map(estado.alertas.map(([, repoId, estadoAlerta]) => [repoId, estadoAlerta]));
  const hoy = diaDeGithub(ahora);
  console.log(
    `Radar ${momento}: catálogo de ${catalogo.length} (foto del ${exportacion.fecha}), ${conocidos.size} candidatos, día de GitHub ${hoy}`,
  );

  const { token, tipo } = await obtenerTokenDelRobot((texto) => avisos.push(texto));
  // Nunca coincide con el robot diario (mismo grupo en Actions), así que usa casi el mismo ritmo
  // que él: GitHub frenó al token personal a 90 s de respuesta por minuto y al de Actions, a ~31.
  const cliente = crearCliente(token, {
    pausaMs: 200,
    presupuestoPorMinutoMs: tipo === 'actions' ? 25_000 : 70_000,
  });

  // 2. Pistas de GH Archive: la hora anterior, si no se ha leído ya.
  const horaGha = nombreDeHora(new Date(ahora.getTime() - HORA_MS));
  let gharchive: HoraDeGharchive | null = null;
  if (memoria.gharchive !== horaGha) {
    try {
      gharchive = await leerHora(horaGha);
      if (gharchive) memoria.gharchive = horaGha;
      else avisos.push(`GH Archive aún no ha publicado la hora ${horaGha}`);
    } catch (error) {
      avisos.push(`GH Archive no ha respondido: ${(error as Error).message}`);
    }
  }
  console.log(
    `  GH Archive ${horaGha}: ${gharchive ? `${gharchive.eventos} eventos, ${gharchive.estrellas} estrellas, ${gharchive.pistas.length} pistas` : 'sin leer'} (${segundos()} s)`,
  );

  // 3. Búsqueda de repos nuevos con muchas estrellas.
  const encontrados: { repo: RepoRadar; fuente: string }[] = [];
  const busquedas: Record<string, number> = {};
  for (const b of RADAR.busquedas) {
    const desde = dia(new Date(ahora.getTime() - b.dias * DIA_MS));
    const r = await buscarParaRadar(
      cliente,
      `created:>=${desde} stars:>=${b.estrellas} sort:stars-desc`,
      b.maximo,
    );
    busquedas[b.fuente] = r.repos.length;
    for (const repo of r.repos) encontrados.push({ repo, fuente: b.fuente });
  }
  // Las pistas que no están en el catálogo ni se vigilan ya, con sus datos de verdad.
  const pistasNuevas = (gharchive?.pistas ?? []).filter(
    (p) => !enCatalogo.has(p.id) && !conocidos.has(p.id),
  );
  if (pistasNuevas.length > 0) {
    const datos = await obtenerReposRadar(
      cliente,
      pistasNuevas.map((p) => p.repo),
    );
    for (const repo of datos.values()) {
      if (repo && repo.estrellas >= RADAR.estrellasPista)
        encontrados.push({ repo, fuente: 'gharchive' });
    }
  }
  const cambiosCandidatos = new Map<number, Candidato>();
  for (const c of anotarEncontrados(encontrados, enCatalogo, conocidos, excluidos, ahora)) {
    cambiosCandidatos.set(c.id, c);
    conocidos.set(c.id, c);
  }
  console.log(
    `  Búsqueda: ${Object.entries(busquedas)
      .map(([f, n]) => `${f} ${n}`)
      .join(
        ', ',
      )}; pistas nuevas ${pistasNuevas.length}; ${cambiosCandidatos.size} candidatos nuevos o con fuente nueva (${segundos()} s)`,
  );

  // 4. Seguimiento: estrellas de todo el catálogo y de los candidatos que no están en él.
  const vigiladosCandidatos = [...conocidos.values()].filter(
    (c) => c.estado !== 'descartado' && !enCatalogo.has(c.id),
  );
  const nombres = [...catalogo.map((p) => p.repo), ...vigiladosCandidatos.map((c) => c.repo)];
  const { estrellas: actuales, fallidos } = await obtenerEstrellas(cliente, nombres, {
    alProgresar: (hechos) =>
      process.stdout.write(`\r  Estrellas: ${hechos}/${nombres.length} (${segundos()} s)`),
  });
  process.stdout.write('\n');
  if (fallidos.size > 0) avisos.push(`${fallidos.size} repos no se han podido leer esta hora`);
  const blob: Record<string, number> = {};
  const vigilados: Omit<Medida, 'ganadas' | 'desde' | 'horas'>[] = [];
  const porId = new Map<number, ProyectoRadar | Candidato>();
  for (const p of catalogo) porId.set(p.id, p);
  for (const c of vigiladosCandidatos) porId.set(c.id, c);
  for (const nombre of nombres) {
    const a = actuales.get(nombre);
    if (!a || blob[String(a.id)] !== undefined) continue;
    const origen = porId.get(a.id);
    if (!origen) continue; // Otro repo con ese nombre (lo borraron y crearon otro): no es el vigilado.
    blob[String(a.id)] = a.estrellas;
    const candidato = 'detectado' in origen ? origen : null;
    vigilados.push({
      id: a.id,
      repo: a.repo,
      estrellas: a.estrellas,
      creado: candidato
        ? (candidato.creado ?? candidato.detectado)
        : (origen as ProyectoRadar).creado,
      enCatalogo: enCatalogo.has(a.id),
      descripcion: candidato
        ? (candidato.datos?.descripcion ?? null)
        : (origen as ProyectoRadar).descripcion,
    });
  }

  // 5. Estrellas de las últimas 24 horas guardadas y medida de lo ganado en 24 h.
  const limite = ahora.getTime() - 25 * HORA_MS;
  const horasPedidas = estado.horas.filter(([, m]) => Date.parse(m) >= limite).map(([h]) => h);
  const horas: HoraGuardada[] = [];
  await enParalelo(horasPedidas, 4, async (h) => {
    const guardada = await worker.radarHora(h);
    if (guardada) horas.push(guardada);
  });
  horas.sort((a, b) => (a.momento < b.momento ? -1 : 1));
  // Otras observaciones: la foto del robot diario y, más abajo, el historial oficial de hoy.
  const otras = new Map<number, Observacion[]>(
    catalogo.map((p) => [p.id, [{ momento: exportacion.generado, estrellas: p.estrellas }]]),
  );
  // Y las estrellas al empezar el día de GitHub de los que ya se miraron hoy (en la memoria).
  const hoyInicio = inicioDelDiaDeGithub(hoy).toISOString();
  for (const [idRepo, o] of observacionesDeLaMemoria(memoria, hoy, hoyInicio)) {
    otras.set(idRepo, [...(otras.get(idRepo) ?? []), o]);
  }
  let medidas = medir(vigilados, horas, otras, ahora);
  console.log(
    `  Seguimiento: ${vigilados.length} repos, ${horas.length} horas guardadas de las últimas 24 (${segundos()} s)`,
  );

  // 6. Historial oficial de estrellas por día: ritmo habitual de los que suben y decisiones sobre
  //    los candidatos (una vez al día cada uno).
  const historiales = new Map<number, DiaDelHistorial[]>();
  const pedirHistorial = async (idRepo: number, repo: string) => {
    if (historiales.has(idRepo)) return historiales.get(idRepo) ?? null;
    if (historiales.size >= RADAR.historialesPorEjecucion) return null;
    try {
      const h = await obtenerHistorialDeEstrellas(cliente, repo);
      if (h) historiales.set(idRepo, h);
      return h;
    } catch (error) {
      avisos.push(`${repo}: no se ha podido leer su historial (${(error as Error).message})`);
      return null;
    }
  };
  // Primero los que más suben (a su ritmo de ahora); después, lo que aún no se puede medir: los
  // candidatos antes que el catálogo (en la primera hora, sin fotos propias, todo el catálogo está así).
  const prioridad = (m: Medida) =>
    m.ganadas === null ? (m.enCatalogo ? -2 : -1) : proyeccion24h(m);
  const sinRitmo = medidas
    .filter((m) => necesitaRitmo(m, memoria, hoy))
    .sort((a, b) => prioridad(b) - prioridad(a));
  await enParalelo(sinRitmo, 3, async (m) => {
    const h = await pedirHistorial(m.id, m.repo);
    if (!h) return;
    const deHoy = observacionDeHoy(h, hoy, hoyInicio, m.estrellas);
    anotarRitmo(memoria, m.id, h, hoy, diaDeGithub(new Date(m.creado)), deHoy?.estrellas ?? null);
    if (deHoy) otras.set(m.id, [...(otras.get(m.id) ?? []), deHoy]);
  });
  olvidarRitmosViejos(memoria, hoy);
  // Con el historial de hoy se puede medir ya lo que acaba de empezar a vigilarse.
  medidas = medir(vigilados, horas, otras, ahora);

  const originales = elegirOriginales(catalogo);
  const pareceCopia = (c: { id: number; repo: string }) =>
    originalesParecidos(c.repo, originales).length > 0 && alertas.get(c.id) !== 'descartada';
  const medidaDe = new Map(medidas.map((m) => [m.id, m]));
  const porDecidir = vigiladosCandidatos
    .filter(
      (c) =>
        c.estado === 'vigilando' && c.datos?.decidido !== hoy && c.datos?.persona === undefined,
    )
    .sort((a, b) => (medidaDe.get(b.id)?.estrellas ?? 0) - (medidaDe.get(a.id)?.estrellas ?? 0));
  const decisiones: Record<string, number> = { entra: 0, sigue: 0, descartar: 0 };
  for (const c of porDecidir) {
    const m = medidaDe.get(c.id);
    if (!m) continue;
    const h = await pedirHistorial(c.id, m.repo);
    if (!h) continue;
    const { candidato, decision } = decidir(c, h, {
      taxonomia,
      hoy,
      diaDeCreacion: diaDeGithub(new Date(c.creado ?? c.detectado)),
      diaDeDeteccion: diaDeGithub(new Date(c.detectado)),
      excluido: excluidos.has(c.repo.toLowerCase()) || alertas.get(c.id) === 'publicada',
      posibleCopia: pareceCopia(c),
      estrellas: m.estrellas,
      ahora,
    });
    decisiones[decision.decision] = (decisiones[decision.decision] ?? 0) + 1;
    cambiosCandidatos.set(c.id, candidato);
    conocidos.set(c.id, candidato);
    if (decision.decision === 'entra') {
      console.log(`  Se propone para el catálogo: ${c.repo} (${decision.motivo})`);
    }
  }
  // Tope de candidatos vigilados: si hay demasiados, se dejan los de menos estrellas.
  const estrellasDe = new Map(medidas.map((m) => [m.id, m.estrellas]));
  for (const c of recortarVigilados([...conocidos.values()], estrellasDe, ahora)) {
    decisiones.descartar = (decisiones.descartar ?? 0) + 1;
    cambiosCandidatos.set(c.id, c);
    conocidos.set(c.id, c);
  }
  console.log(
    `  Historiales: ${historiales.size}; decisiones: ${decisiones.entra} propuestos, ${decisiones.sigue} siguen, ${decisiones.descartar} se dejan (${segundos()} s)`,
  );

  // 7. En auge. Fuera de las tendencias: lo que tiene una alerta de copia y lo nuevo que se llama
  //    como un proyecto famoso, hasta que una persona lo revise.
  const excluir = new Set<number>();
  for (const [repoId, estadoAlerta] of alertas)
    if (estadoAlerta !== 'descartada') excluir.add(repoId);
  for (const c of conocidos.values())
    if (!enCatalogo.has(c.id) && pareceCopia(c)) excluir.add(c.id);
  const { enAuge, cambios } = evaluarAuges(medidas, memoria, hoy, ahora, excluir);
  for (const c of cambios) {
    console.log(`  ${c.hasta ? 'Sale de' : 'Entra en'} auge: ${c.repo} ${JSON.stringify(c.datos)}`);
  }

  // 8. Posibles copias de los 500 más populares.
  const nuevasAlertas: NonNullable<CambiosDelRadar['alertas']> = [];
  let revisadosCopias = 0;
  if (!opciones['sin-copias']) {
    const sospechosos = new Map<number, RepoRadar>();
    const reciente = new Date(ahora.getTime() - 90 * DIA_MS).toISOString();
    const anotar = (repo: RepoRadar) => {
      if (enCatalogo.has(repo.id) || alertas.has(repo.id) || repo.esFork) return;
      // Las copias son recientes por definición, y lo ya mirado no se repite si no ha subido.
      if (repo.creado < reciente || !tocaMirarCopia(memoria, repo.id, repo.estrellas, ahora))
        return;
      if (originalesParecidos(repo.repo, originales).length > 0) sospechosos.set(repo.id, repo);
    };
    for (const { repo } of encontrados) anotar(repo);
    const desde = dia(new Date(ahora.getTime() - 90 * DIA_MS));
    for (const original of turnoDeCopias(originales, memoria)) {
      const nombre = original.repo.split('/')[1] ?? '';
      // La búsqueda de GitHub admite 30 consultas por minuto: se espacian.
      await new Promise((resolver) => setTimeout(resolver, 1500));
      try {
        const r = await buscarParaRadar(
          cliente,
          `${nombre} in:name created:>=${desde} sort:stars-desc`,
          30,
        );
        for (const repo of r.repos) anotar(repo);
      } catch (error) {
        avisos.push(
          `No se ha podido buscar copias de ${original.repo}: ${(error as Error).message}`,
        );
      }
    }
    const aMirar = [...sospechosos.values()]
      .sort((a, b) => b.estrellas - a.estrellas)
      .slice(0, RADAR.detallesPorEjecucion);
    const detalles = await obtenerDetallesCopia(
      cliente,
      aMirar.map((r) => r.repo),
    );
    for (const repo of aMirar) {
      const d = detalles.get(repo.repo);
      if (!d || d.esFork) continue;
      revisadosCopias++;
      anotarCopiaMirada(memoria, d.id, d.estrellas, ahora);
      const descargas: ArchivoDescarga[] = [
        ...d.version.map((a) => ({ nombre: a.nombre, descargas: a.descargas })),
        ...d.raiz.filter(esDescargaEjecutable).map((nombre) => ({ nombre, descargas: null })),
      ];
      let mejor: { evidencia: EvidenciaCopia; original: ProyectoRadar } | null = null;
      for (const { original } of originalesParecidos(d.repo, originales)) {
        const r = evaluarCopia(
          {
            id: d.id,
            repo: d.repo,
            descripcion: d.descripcion,
            lenguaje: repo.lenguaje,
            creado: d.creado,
            estrellas: d.estrellas,
            commits: d.commits,
            esFork: d.esFork,
            ganadas24h: medidaDe.get(d.id)?.ganadas ?? null,
            horasMedidas: medidaDe.get(d.id)?.horas ?? null,
            descargas,
          },
          original,
          ahora,
        );
        if (r?.alerta && (!mejor || original.estrellas > mejor.original.estrellas)) {
          mejor = { evidencia: r.evidencia, original };
        }
      }
      if (mejor) {
        nuevasAlertas.push({
          repo: d.repo,
          repo_id: d.id,
          original_id: mejor.original.id,
          evidencia: mejor.evidencia,
        });
        alertas.set(d.id, 'pendiente');
        console.log(`  Posible copia: ${d.repo} de ${mejor.original.repo}`);
      }
    }
    console.log(
      `  Copias: ${sospechosos.size} con nombre parecido, ${revisadosCopias} miradas a fondo, ${nuevasAlertas.length} a revisión (${segundos()} s)`,
    );
  }

  // 9. Tendencias y todo lo que cambia, en una sola petición.
  const tendencias = montarTendencias({ medidas, enAuge, memoria, horas, ahora, excluir });
  const purgar = memoria.purga !== dia(ahora);
  if (purgar) memoria.purga = dia(ahora);
  const guardado = await worker.radarGuardar({
    hora: { hora: claveDeHora(ahora), momento, repos: Object.keys(blob).length, estrellas: blob },
    borrar_horas_antes_de: claveDeHora(new Date(ahora.getTime() - RADAR.horasGuardadas * HORA_MS)),
    candidatos: [...cambiosCandidatos.values()],
    radar: { memoria, tendencias },
    auge: cambios,
    alertas: nuevasAlertas,
    ...(purgar
      ? {
          purgar_descartados_antes_de: dia(
            new Date(ahora.getTime() - RADAR.diasDescartados * DIA_MS),
          ),
        }
      : {}),
  });
  console.log(
    `  D1: ${guardado.filas_escritas} filas escritas, ${guardado.filas_leidas} leídas (${segundos()} s)`,
  );

  const porEstado = (e: Candidato['estado']) =>
    [...conocidos.values()].filter((c) => c.estado === e).length;
  const resumen = {
    seguidos: vigilados.length,
    catalogo: catalogo.length,
    en_auge: enAuge.map((a) => ({
      repo: a.repo,
      ganadas_24h: a.ganadas,
      ritmo: a.ritmo,
      desde: a.enAugeDesde,
    })),
    entran_en_auge: cambios.filter((c) => c.hasta === null).map((c) => c.repo),
    salen_de_auge: cambios.filter((c) => c.hasta !== null).map((c) => c.repo),
    candidatos: {
      vigilando: porEstado('vigilando'),
      propuestos: porEstado('propuesto'),
      aceptados: porEstado('aceptado'),
      cambios: cambiosCandidatos.size,
      decisiones,
    },
    pistas: gharchive
      ? {
          hora: gharchive.hora,
          eventos: gharchive.eventos,
          estrellas: gharchive.estrellas,
          pistas: gharchive.pistas.length,
          lineas_rotas: gharchive.rotas,
        }
      : null,
    busquedas,
    copias: { revisados: revisadosCopias, nuevas: nuevasAlertas.map((a) => a.repo) },
    github: {
      token: tipo,
      historiales: historiales.size,
      fallidos: fallidos.size,
      frenazos: cliente.frenos().veces,
      puntos_que_quedan: cliente.restantes(),
    },
    d1: { ...guardado, horas_leidas: horas.length },
  };
  console.log(JSON.stringify(resumen, null, 2));
  return resumen;
}

function esMemoria(valor: unknown): valor is Memoria {
  return (
    typeof valor === 'object' && valor !== null && (valor as { version?: unknown }).version === 1
  );
}
