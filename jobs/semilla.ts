// Genera data/semilla.generada.json: la lista inicial de unos 3.000 proyectos, para revisar.
// Solo lee de GitHub; no guarda nada en ninguna base de datos.
// Uso: pnpm semilla            (con «-- --cache» reutiliza las búsquedas de las últimas 24 horas)

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  calcularEstado,
  detectarListaOCurso,
  MESES_LENTO,
  type MotivoLista,
  sumarMeses,
} from '@aop/core';
import { cargarDatos, DIR_DATOS } from './lib/datos.ts';
import {
  buscarRepos,
  crearCliente,
  obtenerDatosActuales,
  obtenerRepos,
  obtenerToken,
  type RepoGithub,
  type ResultadoBusqueda,
} from './lib/github.ts';
import {
  clave,
  comparar,
  construirProyecto,
  elegirProyectos,
  type Origen,
  type ProyectoSemilla,
  ultimoCambio,
} from './lib/seleccion.ts';

const { values: opciones } = parseArgs({
  options: { cache: { type: 'boolean', default: false } },
});

const ahora = new Date();
const dia = (fecha: Date) => fecha.toISOString().slice(0, 10);
const { taxonomia, alternativas, semilla } = await cargarDatos();
const { ajustes } = semilla;

const activoDesde = dia(sumarMeses(ahora, -ajustes.meses_sin_actividad));
const creadoHasta = dia(new Date(ahora.getTime() - ajustes.antiguedad_minima_dias * 86_400_000));
const filtros = [
  'fork:false',
  'archived:false',
  `stars:>=${ajustes.estrellas_minimas}`,
  `pushed:>=${activoDesde}`,
  `created:<=${creadoHasta}`,
  'sort:stars-desc',
].join(' ');

// 1. Consultas de cada subtema: sus topics y las búsquedas extra de semilla.yaml.
const areaDeSubtema = new Map<string, string>();
const consultasPorSubtema = new Map<string, string[]>();
for (const area of taxonomia.areas) {
  for (const subtema of area.subtemas) {
    areaDeSubtema.set(subtema.id, area.id);
    const extra = semilla.busquedas
      .filter((b) => b.subtema === subtema.id)
      .flatMap((b) => b.consultas);
    const consultas = [...subtema.topics.map((t) => `topic:${t}`), ...extra];
    consultasPorSubtema.set(
      subtema.id,
      consultas.map((c) => `${c} ${filtros}`),
    );
  }
}

// 2. Búsquedas en GitHub (con caché opcional para no repetirlas mientras se ajusta la taxonomía).
const cliente = crearCliente(await obtenerToken());
let busquedasDeLaCache = 0;
const resultados = await buscar([...new Set([...consultasPorSubtema.values()].flat())]);

// 3. Candidatos de cada subtema, ordenados por estrellas y sin lo que no debe entrar.
const excluidos = new Set(semilla.excluir.map((e) => clave(e.repo)));
const repos = new Map<string, RepoGithub>();
const descartes = new Map<string, string>();

function motivoParaDescartar(repo: RepoGithub): string | null {
  if (excluidos.has(clave(repo.repo))) return 'excluido a mano';
  if (repo.esFork || repo.archivado) return 'fork o archivado';
  if (motivoDeLista(repo)) return 'lista o curso';
  if (repo.creado.slice(0, 10) > creadoHasta) return 'demasiado nuevo';
  const estado = calcularEstado({ archivado: false, ultimoCambio: ultimoCambio(repo) }, ahora);
  if (estado === 'abandonado') return 'abandonado';
  return null;
}

const listas = new Map<string, string[]>();
for (const [subtema, consultas] of consultasPorSubtema) {
  const candidatos = new Map<string, RepoGithub>();
  for (const consulta of consultas) {
    for (const repo of resultados.get(consulta)?.repos ?? []) {
      const k = clave(repo.repo);
      if (candidatos.has(k)) continue;
      const motivo = motivoParaDescartar(repo);
      if (motivo) {
        descartes.set(k, motivo);
        continue;
      }
      candidatos.set(k, repo);
      repos.set(k, repo);
    }
  }
  const ordenados = [...candidatos.values()].sort(
    (a, b) => b.estrellas - a.estrellas || comparar(clave(a.repo), clave(b.repo)),
  );
  listas.set(
    subtema,
    ordenados.map((r) => clave(r.repo)),
  );
}

// 4. Proyectos fijos: las alternativas y las altas, pedidos por su nombre.
const origenesPedidos = new Map<string, { nombre: string; origenes: Origen[] }>();
function anotar(nombre: string, origen: Origen) {
  const entrada = origenesPedidos.get(clave(nombre)) ?? { nombre, origenes: [] };
  entrada.origenes.push(origen);
  origenesPedidos.set(clave(nombre), entrada);
}
for (const programa of alternativas.programas) {
  for (const repo of programa.alternativas) {
    anotar(repo, { tipo: 'alternativa', programa: programa.id, subtemas: programa.subtemas });
  }
}
for (const alta of semilla.altas) anotar(alta.repo, { tipo: 'alta', subtemas: alta.subtemas });

const errores: string[] = [];
const avisos: string[] = [];
const fijos = new Set<string>();
const origenes = new Map<string, Origen[]>();
const pedidos = [...origenesPedidos.values()];
const encontrados = await obtenerRepos(
  cliente,
  pedidos.map((p) => p.nombre),
);

for (const { nombre, origenes: suyos } of pedidos) {
  const repo = encontrados.get(nombre);
  if (!repo) {
    errores.push(`${nombre}: no existe en GitHub`);
    continue;
  }
  const k = clave(repo.repo);
  if (k !== clave(nombre)) avisos.push(`${nombre} ahora se llama ${repo.repo}: actualiza el YAML`);
  if (excluidos.has(k)) {
    avisos.push(`${repo.repo} está en «excluir» y también en una lista fija: se excluye`);
    continue;
  }
  if (repo.esFork || repo.archivado) {
    errores.push(`${repo.repo}: es un fork o está archivado`);
    continue;
  }
  const lista = motivoDeLista(repo);
  if (lista === 'sin-codigo') {
    avisos.push(`${repo.repo}: GitHub no ve código (será un repo de empaquetado o documentación)`);
  } else if (lista) {
    avisos.push(`${repo.repo} parece una lista o un curso (por su ${lista}): revísalo`);
  }
  const estado = calcularEstado({ archivado: false, ultimoCambio: ultimoCambio(repo) }, ahora);
  if (estado === 'abandonado') {
    avisos.push(`${repo.repo} lleva más de ${MESES_LENTO} meses sin cambios`);
  }
  if (repo.creado.slice(0, 10) > creadoHasta) {
    avisos.push(
      `${repo.repo} tiene menos de ${ajustes.antiguedad_minima_dias} días: entra por estar en una lista fija`,
    );
  }
  fijos.add(k);
  repos.set(k, repo);
  origenes.set(k, [...(origenes.get(k) ?? []), ...suyos]);
  // Si las búsquedas lo habían apartado, manda la lista fija.
  descartes.delete(k);
}

// 5. Cupo mínimo por subtema y relleno por popularidad hasta el objetivo. Para los elegidos de las
//    búsquedas se piden los datos del momento (las búsquedas pueden ser de horas antes y la fecha del
//    último commit es lenta de pedir): si alguno ya no existe, se ha archivado, es un fork o está
//    abandonado, se aparta y se vuelve a elegir. Los fijos ya traen sus datos del momento.
const estrellas = new Map([...repos].map(([k, repo]) => [k, repo.estrellas]));
const elegir = () =>
  elegirProyectos(listas, fijos, estrellas, {
    cupo: ajustes.cupo_por_subtema,
    objetivo: ajustes.objetivo,
  });
const comprobados = new Set(fijos);
let seleccion = elegir();
for (;;) {
  const apartados = new Map<string, string>();
  const pendientes = [...seleccion.elegidos].filter((k) => !comprobados.has(k));
  if (pendientes.length > 0) {
    const nombres = pendientes.map((k) => repos.get(k)?.repo ?? k);
    const actuales = await obtenerDatosActuales(cliente, nombres, (hechas) =>
      process.stdout.write(`\r  Datos del momento: ${hechas}/${nombres.length}`),
    );
    process.stdout.write('\n');
    for (const k of pendientes) {
      comprobados.add(k);
      const repo = repos.get(k);
      const actual = repo ? actuales.get(repo.repo) : null;
      if (!repo || !actual) {
        apartados.set(k, 'ya no existe');
        continue;
      }
      repo.repo = actual.repo;
      repo.estrellas = actual.estrellas;
      repo.esFork = actual.esFork;
      repo.archivado = actual.archivado;
      repo.ultimoCommit = actual.ultimoCommit;
      if (repo.esFork || repo.archivado) apartados.set(k, 'fork o archivado');
    }
  }
  for (const k of seleccion.elegidos) {
    const repo = repos.get(k);
    if (!repo || fijos.has(k) || apartados.has(k)) continue;
    const estado = calcularEstado({ archivado: false, ultimoCambio: ultimoCambio(repo) }, ahora);
    if (estado === 'abandonado') apartados.set(k, 'abandonado');
  }
  if (apartados.size === 0) break;
  console.log(`  ${apartados.size} elegidos no cumplen al comprobarlos ahora: se apartan`);
  for (const [k, motivo] of apartados) descartes.set(k, motivo);
  for (const [subtema, lista] of listas) {
    listas.set(
      subtema,
      lista.filter((k) => !apartados.has(k)),
    );
  }
  seleccion = elegir();
}
const { elegidos, porPopularidad } = seleccion;
// Origen «busqueda»: el repo sale en las búsquedas de ese subtema y ha sido elegido.
for (const [subtema, lista] of listas) {
  for (const k of lista) {
    if (elegidos.has(k))
      origenes.set(k, [...(origenes.get(k) ?? []), { tipo: 'busqueda', subtema }]);
  }
}

const elegidosConDatos = [...elegidos].map((k) => {
  const repo = repos.get(k);
  if (!repo) throw new Error(`Falta el repo ${k}`);
  return { repo, origenes: origenes.get(k) ?? [] };
});
const proyectos: ProyectoSemilla[] = elegidosConDatos
  .map(({ repo, origenes: suyos }) => construirProyecto(repo, suyos, taxonomia, ahora))
  .sort((a, b) => comparar(clave(a.repo), clave(b.repo)));

// 6. Comprobaciones: el «Hecho cuando» de la Fase A, con los datos del momento.
if (proyectos.length < ajustes.minimo || proyectos.length > ajustes.maximo) {
  errores.push(
    `Salen ${proyectos.length} proyectos y deben ser entre ${ajustes.minimo} y ${ajustes.maximo}`,
  );
}
for (const { repo } of elegidosConDatos) {
  if (repo.esFork || repo.archivado) errores.push(`${repo.repo}: es un fork o está archivado`);
}
for (const p of proyectos) {
  if (p.temas.length === 0) errores.push(`${p.repo}: no tiene ningún tema`);
}
const nombres = proyectos.map((p) => clave(p.repo));
if (new Set(nombres).size !== nombres.length) errores.push('Hay repos repetidos');

// 7. Resumen y archivo.
const contar = (valores: readonly string[]) => {
  const cuenta: Record<string, number> = {};
  for (const v of valores) cuenta[v] = (cuenta[v] ?? 0) + 1;
  return Object.fromEntries(Object.entries(cuenta).sort((a, b) => b[1] - a[1]));
};
const resumen = {
  proyectos: proyectos.length,
  cupo_por_subtema: ajustes.cupo_por_subtema,
  por_popularidad: porPopularidad.size,
  por_area: contar(proyectos.map((p) => areaDeSubtema.get(p.temas[0] ?? '') ?? '?')),
  // Cada proyecto cuenta una vez por tipo de origen, aunque sea alternativa de varios programas.
  por_origen: contar(
    proyectos.flatMap((p) => [...new Set(p.origen.map((o) => o.split(':')[0] ?? o))]),
  ),
  por_licencia: contar(proyectos.map((p) => p.categoria_licencia)),
  por_estado: contar(proyectos.map((p) => p.estado)),
  descartados: contar([...descartes.values()]),
};

console.log(JSON.stringify(resumen, null, 2));
for (const aviso of avisos) console.warn(`Aviso: ${aviso}`);
if (errores.length > 0) {
  for (const error of errores) console.error(`Error: ${error}`);
  console.error('No se ha escrito data/semilla.generada.json.');
  process.exit(1);
}

const cabecera = {
  generado: ahora.toISOString(),
  fuente: 'API GraphQL de GitHub',
  licencia: 'CC BY 4.0',
  filtros_de_busqueda: filtros,
  // Si hay búsquedas de la caché (de hasta 24 h antes), sus topics y descripciones son de entonces;
  // las estrellas, el estado y si es fork o está archivado se comprueban siempre en el momento.
  busquedas_de_la_cache: busquedasDeLaCache,
  resumen,
  avisos,
};
const json = `${JSON.stringify(cabecera, null, 2).slice(0, -2)},\n  "proyectos": [\n${proyectos
  .map((p) => `    ${JSON.stringify(p)}`)
  .join(',\n')}\n  ]\n}\n`;
await writeFile(resolve(DIR_DATOS, 'semilla.generada.json'), json);
console.log(`Escrito data/semilla.generada.json con ${proyectos.length} proyectos.`);
console.log(`Puntos de la API de GitHub que quedan esta hora: ${cliente.restantes() ?? '?'}`);

// --- Ayudantes --------------------------------------------------------------------------------

function motivoDeLista(repo: RepoGithub): MotivoLista | null {
  return detectarListaOCurso({
    nombre: repo.repo.split('/')[1] ?? repo.repo,
    descripcion: repo.descripcion,
    topics: repo.topics,
    lenguaje: repo.lenguaje,
  });
}

async function buscar(consultas: string[]): Promise<Map<string, ResultadoBusqueda>> {
  const archivo = resolve(import.meta.dirname, '../.cache/semilla-busquedas.json');
  const guardadas = new Map<string, ResultadoBusqueda>();
  if (opciones.cache) {
    try {
      const edad = Date.now() - (await stat(archivo)).mtimeMs;
      if (edad < 24 * 3600 * 1000) {
        const entradas = JSON.parse(await readFile(archivo, 'utf8')) as [
          string,
          ResultadoBusqueda,
        ][];
        for (const [consulta, resultado] of entradas) guardadas.set(consulta, resultado);
      }
    } catch {
      // Sin caché todavía.
    }
  }
  const pendientes = consultas.filter((c) => !guardadas.has(c));
  busquedasDeLaCache = consultas.length - pendientes.length;
  console.log(`Búsquedas: ${consultas.length} (${consultas.length - pendientes.length} en caché)`);
  await mkdir(resolve(archivo, '..'), { recursive: true });
  // Por tramos, guardando la caché después de cada uno para no perder lo hecho si algo falla.
  for (let i = 0; i < pendientes.length; i += 40) {
    const tramo = pendientes.slice(i, i + 40);
    const nuevas = await buscarRepos(cliente, tramo, ajustes.resultados_por_busqueda, {
      alProgresar: (hechas) =>
        process.stdout.write(`\r  ${i + hechas}/${pendientes.length} búsquedas`),
    });
    for (const [consulta, resultado] of nuevas) guardadas.set(consulta, resultado);
    await writeFile(archivo, JSON.stringify([...guardadas]));
  }
  if (pendientes.length > 0) process.stdout.write('\n');
  return guardadas;
}
