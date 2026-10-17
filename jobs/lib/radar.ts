// Lógica pura del radar horario: candidatos nuevos, «en auge», decisiones sobre los candidatos,
// coincidencias con posibles copias y las tendencias de la API. Sin red ni archivos.

import {
  asignarTemas,
  COPIAS,
  type Decision,
  type DiaDeEstrellas,
  decidirCandidato,
  detectarListaOCurso,
  evaluarAuge,
  ganadasEn24h,
  type Observacion,
  type Parecido,
  parecidoDeNombre,
  ritmoHabitual,
  type SistemaInstalable,
  sumarDias,
  type Taxonomia,
} from '@aop/core';
import type { RepoRadar } from './github.ts';

export const RADAR = {
  /** Búsquedas de repos nuevos con muchas estrellas (API de búsqueda de GitHub). */
  busquedas: [
    { fuente: 'busqueda-2d', dias: 2, estrellas: 20, maximo: 50 },
    { fuente: 'busqueda-7d', dias: 7, estrellas: 50, maximo: 100 },
    { fuente: 'busqueda-30d', dias: 30, estrellas: 200, maximo: 100 },
  ],
  /** Una pista de GH Archive pasa a candidato si tiene al menos estas estrellas. */
  estrellasPista: 100,
  /** Horas de estrellas que se guardan (14 días). */
  horasGuardadas: 14 * 24,
  /** El ritmo habitual solo se pide de quien ha ganado esto en 24 h: con menos no puede estar en auge. */
  ganadasParaRitmo: 50,
  /** Historiales de estrellas que se piden como mucho en cada ejecución. */
  historialesPorEjecucion: 150,
  /** Originales cuyo nombre se busca en cada ejecución: los 500 en unas 24 horas. */
  originalesPorEjecucion: 21,
  /** Posibles copias que se miran a fondo como mucho en cada ejecución. */
  detallesPorEjecucion: 60,
  /** Una posible copia ya mirada no se vuelve a mirar en estos días… */
  diasCopiaRevisada: 7,
  /** …salvo que gane estas estrellas desde entonces. */
  estrellasParaVolverAMirar: 50,
  /** Los que más suben que salen en la API. */
  suben: 50,
  /** Los candidatos descartados por el radar se borran pasados estos días. */
  diasDescartados: 30,
  /**
   * Como mucho, estos candidatos vigilados a la vez: así la lectura de cada hora no crece sin fin
   * (D1 no devuelve textos de más de 2 MB). Si hay más, se dejan los que menos estrellas tienen.
   */
  maximoVigilados: 1000,
  /** Las descripciones se guardan recortadas a estos caracteres. */
  maximoDescripcion: 300,
} as const;

/** Un proyecto del catálogo tal como lo necesita el radar (de data/export/proyectos.json). */
export interface ProyectoRadar {
  id: number;
  repo: string;
  estrellas: number;
  creado: string;
  descripcion: string | null;
  sistemas: SistemaInstalable[];
  tieneDescargas: boolean;
}

/**
 * vigilando: se sigue cada hora; propuesto: cumple la regla de entrada y espera a que una persona
 * lo confirme; aceptado: está en el catálogo; descartado: ya no se vigila.
 */
export type EstadoCandidato = 'vigilando' | 'propuesto' | 'aceptado' | 'descartado';

export interface DatosDeCandidato {
  descripcion: string | null;
  lenguaje: string | null;
  licencia: string | null;
  topics: string[];
  forks: number;
  esFork: boolean;
  archivado: boolean;
  espejo: boolean;
  /** Subtemas que le tocan por sus topics. */
  temas?: string[];
  /** Sus nombres en español, para la página de revisión. */
  nombres_de_temas?: string[];
  /** Por qué sigue, entra o se deja (lo último que se decidió). */
  motivo?: string;
  /** Día de GitHub de la última decisión: se decide una vez al día. */
  decidido?: string;
  /** Lo decidió una persona en la página de revisión: el radar no lo toca. */
  persona?: unknown;
}

/** Un candidato tal como está en D1 (tabla candidates). */
export interface Candidato {
  id: number;
  repo: string;
  /** Dónde se ha visto y cuándo por primera vez: {fuente: momento}. */
  fuentes: Record<string, string>;
  estado: EstadoCandidato;
  estrellas: number | null;
  creado: string | null;
  detectado: string;
  actualizado: string;
  datos: DatosDeCandidato | null;
}

/** Lo que el radar recuerda de una hora para la siguiente (clave «memoria» de la tabla radar). */
export interface Memoria {
  version: 1;
  /** Última hora de GH Archive leída (AAAA-MM-DD-H). */
  gharchive: string | null;
  /** Por dónde va la búsqueda de copias en la lista de originales. */
  copias: number;
  /**
   * Ritmo habitual por id: [día de GitHub en que se calculó, estrellas al día, días usados y
   * estrellas que tenía al empezar ese día (null si el historial no lo dejaba saber)]. Esas
   * estrellas sirven de observación todo el día, para medir lo ganado en 24 h desde el principio.
   */
  ritmos: Record<string, [string, number, number, (number | null)?]>;
  /** Lo que está en auge ahora, por id. */
  auge: Record<string, { desde: string; repo: string; maximo: number }>;
  /** Último día (UTC) en que se borraron los candidatos descartados. */
  purga: string | null;
  /** Posibles copias ya miradas a fondo sin alerta, por id: [día (UTC), estrellas entonces]. */
  copiasMiradas?: Record<string, [string, number]>;
}

export function memoriaVacia(): Memoria {
  return {
    version: 1,
    gharchive: null,
    copias: 0,
    ritmos: {},
    auge: {},
    purga: null,
    copiasMiradas: {},
  };
}

/** Hora (UTC) con la que se guardan las estrellas: AAAA-MM-DDTHH. */
export const claveDeHora = (momento: Date) => momento.toISOString().slice(0, 13);

const clave = (repo: string) => repo.toLowerCase();

function datosDe(repo: RepoRadar): DatosDeCandidato {
  return {
    descripcion: repo.descripcion?.slice(0, RADAR.maximoDescripcion) ?? null,
    lenguaje: repo.lenguaje,
    licencia: repo.licencia,
    topics: repo.topics,
    forks: repo.forks,
    esFork: repo.esFork,
    archivado: repo.archivado,
    espejo: repo.espejo,
  };
}

/** ¿Merece la pena vigilarlo? Los forks, archivados, espejos, listas y cursos no. */
export function esVigilable(repo: RepoRadar): boolean {
  if (repo.esFork || repo.archivado || repo.espejo) return false;
  const lista = detectarListaOCurso({
    nombre: repo.repo.split('/')[1] ?? repo.repo,
    descripcion: repo.descripcion,
    topics: repo.topics,
    lenguaje: repo.lenguaje,
  });
  return lista === null;
}

/**
 * Candidatos nuevos y fuentes nuevas de los que ya se vigilan. Solo devuelve lo que cambia (para
 * gastar pocas escrituras en D1). Los que están en el catálogo, excluidos o descartados no entran.
 */
export function anotarEncontrados(
  encontrados: readonly { repo: RepoRadar; fuente: string }[],
  catalogo: ReadonlySet<number>,
  conocidos: ReadonlyMap<number, Candidato>,
  excluidos: ReadonlySet<string>,
  ahora: Date,
): Candidato[] {
  const momento = ahora.toISOString();
  const cambios = new Map<number, Candidato>();
  for (const { repo, fuente } of encontrados) {
    if (catalogo.has(repo.id) || excluidos.has(clave(repo.repo)) || !esVigilable(repo)) continue;
    const previo = cambios.get(repo.id) ?? conocidos.get(repo.id);
    if (previo && previo.estado !== 'vigilando') continue;
    if (previo) {
      if (previo.fuentes[fuente]) continue;
      cambios.set(repo.id, {
        ...previo,
        repo: repo.repo,
        fuentes: { ...previo.fuentes, [fuente]: momento },
        estrellas: repo.estrellas,
        actualizado: momento,
        datos: { ...previo.datos, ...datosDe(repo) },
      });
      continue;
    }
    cambios.set(repo.id, {
      id: repo.id,
      repo: repo.repo,
      fuentes: { [fuente]: momento },
      estado: 'vigilando',
      estrellas: repo.estrellas,
      creado: repo.creado,
      detectado: momento,
      actualizado: momento,
      datos: datosDe(repo),
    });
  }
  return [...cambios.values()];
}

/** Estrellas de todo lo vigilado en una hora guardada. */
export interface HoraGuardada {
  hora: string;
  momento: string;
  estrellas: Record<string, number>;
}

/** Observaciones de un repo en las horas guardadas, más otras (la foto del robot diario…). */
export function observacionesDe(
  id: number,
  horas: readonly HoraGuardada[],
  otras: readonly Observacion[] = [],
): Observacion[] {
  const lista: Observacion[] = [];
  for (const h of horas) {
    const estrellas = h.estrellas[String(id)];
    if (estrellas !== undefined) lista.push({ momento: h.momento, estrellas });
  }
  return [...lista, ...otras];
}

/**
 * Lo que dice el historial oficial de GitHub de hoy, como una observación más: las estrellas que
 * tenía al empezar el día de GitHub. Sirve para medir en cuanto se descubre un repo, sin esperar a
 * tener fotos propias. Nunca exagera: el día de hoy empezó hace menos de 24 h, así que esas
 * estrellas son al menos las que tenía hace 24 h.
 */
export function observacionDeHoy(
  dias: readonly DiaDeEstrellas[],
  hoy: string,
  inicioDeHoy: string,
  estrellasAhora: number,
): Observacion | null {
  const deHoy = dias.find((d) => d.dia === hoy);
  if (!deHoy || deHoy.estrellas > estrellasAhora) return null;
  return { momento: inicioDeHoy, estrellas: estrellasAhora - deHoy.estrellas };
}

/** Lo que se sabe de un repo vigilado en esta hora. */
export interface Medida {
  id: number;
  repo: string;
  estrellas: number;
  creado: string;
  enCatalogo: boolean;
  descripcion: string | null;
  /** Estrellas ganadas en las últimas 24 h (cota inferior) y desde cuándo; null si no se sabe. */
  ganadas: number | null;
  desde: Observacion | null;
  horas: number | null;
}

/** Mide las estrellas ganadas en 24 h de cada repo vigilado. */
export function medir(
  vigilados: readonly Omit<Medida, 'ganadas' | 'desde' | 'horas'>[],
  horas: readonly HoraGuardada[],
  otras: ReadonlyMap<number, readonly Observacion[]>,
  ahora: Date,
): Medida[] {
  const momento = ahora.toISOString();
  return vigilados.map((v) => {
    const g = ganadasEn24h(
      { momento, estrellas: v.estrellas },
      observacionesDe(v.id, horas, otras.get(v.id)),
      v.creado,
    );
    return { ...v, ganadas: g?.ganadas ?? null, desde: g?.desde ?? null, horas: g?.horas ?? null };
  });
}

/**
 * ¿Hace falta pedir hoy su historial? Para saber su ritmo habitual, si ha ganado bastante en 24 h,
 * o para poder medirlo ya, si aún no se puede (acaba de empezar a vigilarse).
 */
export function necesitaRitmo(m: Medida, memoria: Memoria, hoy: string): boolean {
  if (m.ganadas !== null && proyeccion24h(m) < RADAR.ganadasParaRitmo) return false;
  return memoria.ritmos[String(m.id)]?.[0] !== hoy;
}

/**
 * Lo que ganaría en 24 h a su ritmo de ahora. Si se vigila desde hace pocas horas, lo ganado en esas
 * horas se queda corto: así se pide antes su historial (con las estrellas al empezar el día).
 */
export function proyeccion24h(m: Medida): number {
  if (m.ganadas === null) return 0;
  if (m.horas === null || m.horas >= 24) return m.ganadas;
  return (m.ganadas / Math.max(1, m.horas)) * 24;
}

/** ¿Hay que mirar a fondo esta posible copia? No si ya se miró hace poco y no ha subido. */
export function tocaMirarCopia(
  memoria: Memoria,
  id: number,
  estrellas: number,
  ahora: Date,
): boolean {
  const mirada = memoria.copiasMiradas?.[String(id)];
  if (!mirada) return true;
  const dias = (ahora.getTime() - Date.parse(`${mirada[0]}T00:00:00Z`)) / 86_400_000;
  return (
    dias >= RADAR.diasCopiaRevisada || estrellas >= mirada[1] + RADAR.estrellasParaVolverAMirar
  );
}

/** Apunta que se ha mirado a fondo una posible copia (y olvida las de hace más de una semana). */
export function anotarCopiaMirada(
  memoria: Memoria,
  id: number,
  estrellas: number,
  ahora: Date,
): void {
  const miradas = memoria.copiasMiradas ?? {};
  const limite = new Date(ahora.getTime() - RADAR.diasCopiaRevisada * 86_400_000)
    .toISOString()
    .slice(0, 10);
  for (const [clave, [dia]] of Object.entries(miradas)) if (dia < limite) delete miradas[clave];
  miradas[String(id)] = [ahora.toISOString().slice(0, 10), estrellas];
  memoria.copiasMiradas = miradas;
}

/** Anota el ritmo habitual calculado con el historial de GitHub. */
export function anotarRitmo(
  memoria: Memoria,
  id: number,
  dias: readonly DiaDeEstrellas[],
  hoy: string,
  diaDeCreacion: string,
  estrellasAlEmpezarElDia: number | null = null,
): void {
  const r = ritmoHabitual(dias, hoy, diaDeCreacion);
  memoria.ritmos[String(id)] = [hoy, r.ritmo, r.dias, estrellasAlEmpezarElDia];
}

/**
 * Observaciones guardadas en la memoria: las estrellas al empezar el día de GitHub de hoy, de cada
 * repo cuyo historial se leyó hoy. Así se sigue midiendo desde ahí en las horas siguientes.
 */
export function observacionesDeLaMemoria(
  memoria: Memoria,
  hoy: string,
  inicioDeHoy: string,
): Map<number, Observacion> {
  const resultado = new Map<number, Observacion>();
  for (const [id, [dia, , , estrellas]] of Object.entries(memoria.ritmos)) {
    if (dia === hoy && typeof estrellas === 'number') {
      resultado.set(Number(id), { momento: inicioDeHoy, estrellas });
    }
  }
  return resultado;
}

/** Olvida los ritmos de hace más de dos días (de repos que ya no suben). */
export function olvidarRitmosViejos(memoria: Memoria, hoy: string): void {
  for (const [id, [dia]] of Object.entries(memoria.ritmos)) {
    if (dia < sumarDias(hoy, -2)) delete memoria.ritmos[id];
  }
}

export interface EnAuge extends Medida {
  ganadas: number;
  ritmo: number;
  diasRitmo: number;
  veces: number | null;
  umbral: number;
  /** Desde cuándo está en auge. */
  enAugeDesde: string;
}

export interface CambioDeAuge {
  repo_id: number;
  desde: string;
  hasta: string | null;
  repo: string;
  datos: Record<string, unknown>;
}

/**
 * Qué está en auge ahora. Actualiza la memoria y devuelve los cambios para el registro: quién entra
 * (con sus cifras) y quién sale. Lo que no se ha podido medir esta hora se queda como estaba.
 */
export function evaluarAuges(
  medidas: readonly Medida[],
  memoria: Memoria,
  hoy: string,
  ahora: Date,
  excluir: ReadonlySet<number>,
): { enAuge: EnAuge[]; cambios: CambioDeAuge[] } {
  const momento = ahora.toISOString();
  const enAuge: EnAuge[] = [];
  const cambios: CambioDeAuge[] = [];
  const medidos = new Set<string>();
  for (const m of medidas) {
    const id = String(m.id);
    const ritmo = memoria.ritmos[id];
    const estaba = memoria.auge[id];
    if (m.ganadas === null || !ritmo || ritmo[0] !== hoy || excluir.has(m.id)) {
      // Sin datos para decidir: si estaba en auge, sigue (hasta que se pueda medir).
      if (estaba && !excluir.has(m.id)) medidos.add(id);
      continue;
    }
    medidos.add(id);
    const e = evaluarAuge(m.ganadas, ritmo[1], estaba !== undefined);
    if (e.enAuge) {
      const desde = estaba?.desde ?? momento;
      if (!estaba) {
        cambios.push({
          repo_id: m.id,
          desde,
          hasta: null,
          repo: m.repo,
          datos: {
            ganadas_24h: m.ganadas,
            ritmo_habitual: ritmo[1],
            veces: e.veces,
            umbral: e.umbral,
            estrellas: m.estrellas,
            medido_desde: m.desde,
            en_catalogo: m.enCatalogo,
          },
        });
      }
      memoria.auge[id] = {
        desde,
        repo: m.repo,
        maximo: Math.max(estaba?.maximo ?? 0, m.ganadas),
      };
      enAuge.push({
        ...m,
        ganadas: m.ganadas,
        ritmo: ritmo[1],
        diasRitmo: ritmo[2],
        veces: e.veces,
        umbral: e.umbral,
        enAugeDesde: desde,
      });
    } else if (estaba) {
      cambios.push(salida(m.id, estaba, momento, m.ganadas));
      delete memoria.auge[id];
    }
  }
  // Lo que estaba en auge y ya no se vigila (o se ha excluido) sale.
  for (const [id, estaba] of Object.entries(memoria.auge)) {
    if (medidos.has(id)) continue;
    cambios.push(salida(Number(id), estaba, momento, null));
    delete memoria.auge[id];
  }
  enAuge.sort((a, b) => b.ganadas - a.ganadas || a.id - b.id);
  return { enAuge, cambios };
}

function salida(
  id: number,
  estaba: Memoria['auge'][string],
  momento: string,
  ganadas: number | null,
): CambioDeAuge {
  return {
    repo_id: id,
    desde: estaba.desde,
    hasta: momento,
    repo: estaba.repo,
    datos: { maximo_24h: estaba.maximo, ganadas_al_salir: ganadas },
  };
}

/** Lo que el radar sabe de un candidato para decidir si entra en el catálogo. */
export interface DecisionCandidato {
  candidato: Candidato;
  decision: Decision;
}

/**
 * Decide qué pasa con un candidato hoy, con su historial de GitHub. Solo devuelve el candidato
 * cambiado si su estado o su motivo cambian (para no gastar escrituras).
 */
export function decidir(
  c: Candidato,
  dias: readonly DiaDeEstrellas[],
  {
    taxonomia,
    hoy,
    diaDeCreacion,
    diaDeDeteccion,
    excluido,
    posibleCopia,
    estrellas,
    ahora,
  }: {
    taxonomia: Taxonomia;
    hoy: string;
    diaDeCreacion: string;
    diaDeDeteccion: string;
    excluido: boolean;
    posibleCopia: boolean;
    estrellas: number;
    ahora: Date;
  },
): DecisionCandidato {
  const d = c.datos;
  const temas = asignarTemas(d?.topics ?? [], taxonomia).map((t) => t.subtema);
  const nombres = new Map(
    taxonomia.areas.flatMap((a) => a.subtemas).map((s) => [s.id, s.nombre.es] as const),
  );
  const decision = decidirCandidato({
    estrellas,
    forks: d?.forks ?? 0,
    esFork: d?.esFork ?? false,
    archivado: d?.archivado ?? false,
    espejo: d?.espejo ?? false,
    lista: detectarListaOCurso({
      nombre: c.repo.split('/')[1] ?? c.repo,
      descripcion: d?.descripcion ?? null,
      topics: d?.topics ?? [],
      lenguaje: d?.lenguaje ?? null,
    }),
    temas,
    excluido,
    posibleCopia,
    dias,
    hoy,
    diaDeCreacion,
    diaDeDeteccion,
  });
  // Si cumple la regla, se propone: entra en el catálogo cuando una persona lo confirma.
  const estado: EstadoCandidato =
    decision.decision === 'entra'
      ? 'propuesto'
      : decision.decision === 'descartar'
        ? 'descartado'
        : 'vigilando';
  return {
    decision,
    candidato: {
      ...c,
      estado,
      estrellas,
      actualizado: ahora.toISOString(),
      datos: {
        ...(d ?? {
          descripcion: null,
          lenguaje: null,
          licencia: null,
          topics: [],
          forks: 0,
          esFork: false,
          archivado: false,
          espejo: false,
        }),
        temas,
        nombres_de_temas: temas.map((t) => nombres.get(t) ?? t),
        motivo: decision.motivo,
        decidido: hoy,
      },
    },
  };
}

/**
 * Si hay más candidatos vigilados que el máximo, deja los que menos estrellas tienen (nunca los
 * detectados en el último día, que aún no han tenido tiempo de subir).
 */
export function recortarVigilados(
  candidatos: readonly Candidato[],
  estrellas: ReadonlyMap<number, number>,
  ahora: Date,
): Candidato[] {
  const vigilando = candidatos.filter((c) => c.estado === 'vigilando');
  const sobran = vigilando.length - RADAR.maximoVigilados;
  if (sobran <= 0) return [];
  const ayer = new Date(ahora.getTime() - 86_400_000).toISOString();
  const momento = ahora.toISOString();
  return vigilando
    .filter((c) => c.detectado < ayer)
    .sort(
      (a, b) =>
        (estrellas.get(a.id) ?? a.estrellas ?? 0) - (estrellas.get(b.id) ?? b.estrellas ?? 0) ||
        a.id - b.id,
    )
    .slice(0, sobran)
    .map((c) => ({
      ...c,
      estado: 'descartado' as const,
      actualizado: momento,
      datos: c.datos
        ? {
            ...c.datos,
            motivo: 'hay demasiados candidatos: se dejan los que menos estrellas tienen',
          }
        : null,
    }));
}

// --- Copias -----------------------------------------------------------------------------------

/** Los originales que se vigilan: los 500 proyectos con más estrellas del catálogo. */
export function elegirOriginales(catalogo: readonly ProyectoRadar[]): ProyectoRadar[] {
  return [...catalogo]
    .sort((a, b) => b.estrellas - a.estrellas || a.id - b.id)
    .slice(0, COPIAS.originales);
}

/** Originales a los que se parece un nombre, con cómo se parece. */
export function originalesParecidos(
  repo: string,
  originales: readonly ProyectoRadar[],
): { original: ProyectoRadar; parecido: Parecido }[] {
  const dueno = repo.split('/')[0]?.toLowerCase();
  const nombre = repo.split('/')[1] ?? '';
  const resultado: { original: ProyectoRadar; parecido: Parecido }[] = [];
  for (const original of originales) {
    if (original.repo.split('/')[0]?.toLowerCase() === dueno) continue;
    const parecido = parecidoDeNombre(nombre, original.repo.split('/')[1] ?? '');
    if (parecido) resultado.push({ original, parecido });
  }
  return resultado;
}

/** La siguiente tanda de originales cuyo nombre se busca, dando la vuelta a la lista. */
export function turnoDeCopias(
  originales: readonly ProyectoRadar[],
  memoria: Memoria,
): ProyectoRadar[] {
  if (originales.length === 0) return [];
  const inicio = memoria.copias % originales.length;
  const tanda = Array.from(
    { length: Math.min(RADAR.originalesPorEjecucion, originales.length) },
    (_, i) => originales[(inicio + i) % originales.length] as ProyectoRadar,
  );
  memoria.copias = (inicio + tanda.length) % originales.length;
  return tanda;
}

// --- Tendencias -------------------------------------------------------------------------------

export interface FilaTendencia {
  id: number;
  repo: string;
  descripcion: string | null;
  en_catalogo: boolean;
  creado: string;
  estrellas: number;
  ganadas_24h: number;
  /** Desde qué momento y con cuántas estrellas se mide (para poder comprobarlo). */
  medido_desde: Observacion | null;
  horas_medidas: number | null;
  ritmo_habitual: number | null;
  veces: number | null;
  en_auge_desde: string | null;
  /** Estrellas en cada hora de las últimas 24 (para dibujar la subida). */
  serie: [string, number][];
}

/** Tendencias para la API pública: lo que está en auge y lo que más sube en 24 h. */
export function montarTendencias({
  medidas,
  enAuge,
  memoria,
  horas,
  ahora,
  excluir,
}: {
  medidas: readonly Medida[];
  enAuge: readonly EnAuge[];
  memoria: Memoria;
  horas: readonly HoraGuardada[];
  ahora: Date;
  excluir: ReadonlySet<number>;
}) {
  const momento = ahora.toISOString();
  const serie = (m: Medida): [string, number][] => [
    ...observacionesDe(m.id, horas).map((o): [string, number] => [o.momento, o.estrellas]),
    [momento, m.estrellas],
  ];
  const fila = (m: Medida, auge?: EnAuge): FilaTendencia => {
    const ritmo = memoria.ritmos[String(m.id)];
    return {
      id: m.id,
      repo: m.repo,
      descripcion: m.descripcion,
      en_catalogo: m.enCatalogo,
      creado: m.creado,
      estrellas: m.estrellas,
      ganadas_24h: m.ganadas ?? 0,
      medido_desde: m.desde,
      horas_medidas: m.horas,
      ritmo_habitual: ritmo ? ritmo[1] : null,
      veces: auge?.veces ?? null,
      en_auge_desde: auge?.enAugeDesde ?? null,
      serie: auge ? serie(m) : [],
    };
  };
  const suben = medidas
    .filter((m) => m.ganadas !== null && m.ganadas > 0 && !excluir.has(m.id))
    .sort((a, b) => (b.ganadas ?? 0) - (a.ganadas ?? 0) || a.id - b.id)
    .slice(0, RADAR.suben);
  return {
    version: 1,
    actualizado: momento,
    fuente: 'API de GitHub (estrellas cada hora e historial oficial de estrellas por día)',
    licencia: 'CC BY 4.0',
    regla: {
      en_auge: 'Gana en 24 h al menos 100 estrellas y más de 5 veces su ritmo habitual',
      ritmo_habitual: 'Media de estrellas al día de los 7 días completos anteriores a ayer',
      metodologia: 'https://github.com/jornnnn/all-open-project/blob/main/docs/metodologia.md',
    },
    en_auge: enAuge.map((a) => fila(a, a)),
    suben: suben.map((m) => fila(m)),
  };
}
