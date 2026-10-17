// «En auge» y tendencias: lo que calcula el radar cada hora. La explicación pública está en
// docs/metodologia.md: si cambias algo aquí, cámbialo también allí.
//
// Las cifras salen de dos fuentes oficiales de GitHub:
// - las estrellas de cada repo, que el radar lee cada hora (sus «observaciones»);
// - el historial de estrellas por día (/repos/{o}/{r}/stargazers/history), para el ritmo habitual.
// Desde julio de 2026 GitHub no deja ver quién dio cada estrella ni cuándo, así que la hora exacta
// de cada estrella no se puede saber: por eso todo se calcula con cotas que nunca exageran.

/** Para entrar «en auge», un proyecto gana en 24 h al menos estas estrellas… */
export const AUGE_MINIMO = 100;
/** …y más de estas veces su ritmo habitual. */
export const AUGE_VECES = 5;
/** Sigue en auge mientras no baje de esta parte de su umbral, para que no entre y salga cada hora. */
export const AUGE_PERMANENCIA = 0.8;
/** Días completos con los que se calcula el ritmo habitual (sin contar ayer ni hoy). */
export const DIAS_RITMO = 7;

const HORA_MS = 3_600_000;
const DIA_MS = 86_400_000;

/** Estrellas de un repo en un momento (ISO 8601). */
export interface Observacion {
  momento: string;
  estrellas: number;
}

export interface Ganadas24h {
  /** Estrellas ganadas en las últimas 24 h: igual o menos que las reales, nunca más. */
  ganadas: number;
  /** Observación de partida: la primera desde hace 24 h (o la creación del repo, con 0). */
  desde: Observacion;
  /** Horas entre la observación de partida y la actual. */
  horas: number;
}

/**
 * Estrellas ganadas en las últimas 24 h, sin exagerar nunca. Las estrellas casi nunca bajan, así
 * que las que tenía el repo hace 24 h son como mucho las de la primera observación posterior: con
 * ella sale una cifra igual o menor que la real. Si el repo se creó en las últimas 24 h, parte de
 * cero. Devuelve null si no hay ninguna observación desde hace 24 h (aún no se puede medir).
 */
export function ganadasEn24h(
  actual: Observacion,
  observaciones: readonly Observacion[],
  creado: string,
): Ganadas24h | null {
  const ahora = Date.parse(actual.momento);
  const limite = ahora - 24 * HORA_MS;
  let desde: Observacion | null =
    Date.parse(creado) >= limite ? { momento: creado, estrellas: 0 } : null;
  if (desde === null) {
    for (const o of observaciones) {
      const t = Date.parse(o.momento);
      if (t < limite || t >= ahora) continue;
      if (desde === null || t < Date.parse(desde.momento)) desde = o;
    }
  }
  if (desde === null) return null;
  return {
    ganadas: Math.max(0, actual.estrellas - desde.estrellas),
    desde,
    horas: redondear((ahora - Date.parse(desde.momento)) / HORA_MS, 1),
  };
}

/** Estrellas que ganó un repo un día, en el calendario del historial de GitHub (AAAA-MM-DD). */
export interface DiaDeEstrellas {
  dia: string;
  estrellas: number;
}

/** Suma (o resta) días a una fecha AAAA-MM-DD. */
export function sumarDias(dia: string, dias: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);
}

export interface RitmoHabitual {
  /** Estrellas al día de media. */
  ritmo: number;
  /** Días con los que se ha calculado (0 si el repo es demasiado nuevo: su ritmo es 0). */
  dias: number;
}

/**
 * Ritmo habitual: estrellas al día de media en los 7 días completos anteriores a ayer. Ni ayer ni
 * hoy cuentan, para que un despegue no suba su propio listón. En un repo más joven, cuentan los
 * días que tenga, sin el de su creación (que está a medias); si no tiene ninguno, su ritmo es 0.
 */
export function ritmoHabitual(
  dias: readonly DiaDeEstrellas[],
  hoy: string,
  diaDeCreacion: string,
): RitmoHabitual {
  const primero = sumarDias(hoy, -(DIAS_RITMO + 1));
  const ultimo = sumarDias(hoy, -2);
  const validos = dias.filter((d) => d.dia >= primero && d.dia <= ultimo && d.dia > diaDeCreacion);
  if (validos.length === 0) return { ritmo: 0, dias: 0 };
  const total = validos.reduce((suma, d) => suma + d.estrellas, 0);
  return { ritmo: redondear(total / validos.length, 2), dias: validos.length };
}

export interface EvaluacionAuge {
  enAuge: boolean;
  /** Estrellas en 24 h a partir de las que entra: 100 o 5 veces su ritmo, lo que sea mayor. */
  umbral: number;
  /** Cuántas veces su ritmo habitual ha ganado; null si su ritmo es 0 (un repo recién nacido). */
  veces: number | null;
}

/**
 * «En auge»: en 24 h gana al menos 100 estrellas y más de 5 veces su ritmo habitual. Si ya lo
 * estaba, sigue mientras no baje del 80 % de su umbral.
 */
export function evaluarAuge(ganadas: number, ritmo: number, estaba = false): EvaluacionAuge {
  const umbral = Math.max(AUGE_MINIMO, AUGE_VECES * ritmo);
  const entra = ganadas >= AUGE_MINIMO && ganadas > AUGE_VECES * ritmo;
  const sigue = ganadas >= AUGE_PERMANENCIA * umbral;
  return {
    enAuge: estaba ? sigue : entra,
    umbral: redondear(umbral, 1),
    veces: ritmo > 0 ? redondear(ganadas / ritmo, 1) : null,
  };
}

function redondear(valor: number, decimales: number): number {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}
