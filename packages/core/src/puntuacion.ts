import type { Estado } from './tipos.ts';

// Puntuación v1, de 0 a 100, comparada dentro de cada tema. La explicación pública está en
// docs/metodologia.md: si cambias algo aquí, cámbialo también allí.

/** Peso de cada apartado sobre 100. */
export const PESOS_PUNTUACION = { popularidad: 30, impulso: 20, salud: 30, uso: 20 } as const;

/** Puntos que se restan al total. */
export const PENALIZACIONES = { archivado: 30, 'sin-actividad': 20, 'sin-licencia': 15 } as const;
export type Penalizacion = keyof typeof PENALIZACIONES;

/** Con menos días entre fotos, el impulso no cuenta: un solo día de noticias lo deformaría. */
export const DIAS_MINIMOS_IMPULSO = 7;
/** Ventana del impulso: estrellas ganadas en los últimos 30 días. */
export const DIAS_IMPULSO = 30;
/** Si un tema tiene menos proyectos, cada uno se compara con toda su área. */
export const MINIMO_POR_GRUPO = 10;
/** Las issues solo cuentan con al menos estas, entre abiertas y cerradas. */
export const MINIMO_ISSUES = 10;

export interface DatosPuntuacion {
  /** Clave única del proyecto (propietario/repo). */
  clave: string;
  /** Subtemas; el primero es el principal. */
  temas: readonly string[];
  /** Área del tema principal. */
  area: string;
  estado: Estado;
  archivado: boolean;
  /** La licencia está comprobada como «sin-licencia». */
  sinLicencia: boolean;
  estrellas: number;
  forks: number;
  /** Estrellas ganadas al día en los últimos 30 días; null si aún no hay fotos suficientes. */
  estrellasPorDia: number | null;
  /** Días desde el último cambio en la rama principal. */
  diasSinCambios: number;
  /** Días desde la última versión publicada en GitHub; null si no publica versiones. */
  diasDesdeVersion: number | null;
  issuesAbiertas: number | null;
  issuesCerradas: number | null;
  /** Descargas al día de la última versión; null si no tiene archivos para descargar. */
  descargasPorDia: number | null;
}

export interface Puntuacion {
  /** De 0 a 100. */
  total: number;
  /** Cada apartado, de 0 a 100. Si es null, no hay datos y su peso se reparte entre los demás. */
  popularidad: number;
  impulso: number | null;
  salud: number;
  uso: number | null;
  penalizaciones: Penalizacion[];
  /** Tema, o área si el tema es pequeño, con el que se compara el proyecto. */
  grupo: string;
}

/**
 * Calcula la puntuación de todos los proyectos a la vez, porque es relativa: cada uno se compara
 * con los demás proyectos de su tema principal (los que tienen ese tema en cualquier posición).
 *
 * - Popularidad (30): percentil de estrellas (70 %) y de forks (30 %) dentro del tema.
 * - Impulso (20): percentil de las estrellas ganadas al día en los últimos 30 días.
 * - Salud (30): media de actividad (último cambio), versiones (última publicada) e issues
 *   (proporción de cerradas). Las que no tienen datos no cuentan.
 * - Uso real (20): percentil de las descargas al día de la última versión.
 *
 * Después se restan las penalizaciones: archivado, más de 12 meses sin cambios y sin licencia.
 */
export function calcularPuntuaciones(
  proyectos: readonly DatosPuntuacion[],
): Map<string, Puntuacion> {
  const grupos = new Map<string, DatosPuntuacion[]>();
  const anadir = (grupo: string, proyecto: DatosPuntuacion) => {
    const lista = grupos.get(grupo) ?? [];
    lista.push(proyecto);
    grupos.set(grupo, lista);
  };
  for (const proyecto of proyectos) {
    for (const tema of new Set(proyecto.temas)) anadir(`tema:${tema}`, proyecto);
    anadir(`area:${proyecto.area}`, proyecto);
  }

  const metricas = new Map<string, Metricas>();
  const metricasDe = (grupo: string): Metricas => {
    const existentes = metricas.get(grupo);
    if (existentes) return existentes;
    const miembros = grupos.get(grupo) ?? [];
    const nuevas: Metricas = {
      estrellas: ordenar(miembros.map((p) => p.estrellas)),
      forks: ordenar(miembros.map((p) => p.forks)),
      impulso: ordenar(
        miembros.flatMap((p) => (p.estrellasPorDia === null ? [] : [p.estrellasPorDia])),
      ),
      uso: ordenar(
        miembros.flatMap((p) => (p.descargasPorDia === null ? [] : [p.descargasPorDia])),
      ),
    };
    metricas.set(grupo, nuevas);
    return nuevas;
  };

  const resultado = new Map<string, Puntuacion>();
  for (const proyecto of proyectos) {
    const principal = proyecto.temas[0];
    const delTema = principal === undefined ? 0 : (grupos.get(`tema:${principal}`)?.length ?? 0);
    const grupo =
      principal !== undefined && delTema >= MINIMO_POR_GRUPO
        ? `tema:${principal}`
        : `area:${proyecto.area}`;
    const m = metricasDe(grupo);

    const popularidad =
      0.7 * percentil(m.estrellas, proyecto.estrellas) + 0.3 * percentil(m.forks, proyecto.forks);
    const impulso =
      proyecto.estrellasPorDia === null ? null : percentil(m.impulso, proyecto.estrellasPorDia);
    const uso =
      proyecto.descargasPorDia === null ? null : percentil(m.uso, proyecto.descargasPorDia);
    const salud = calcularSalud(proyecto);

    const partes: [valor: number | null, peso: number][] = [
      [popularidad, PESOS_PUNTUACION.popularidad],
      [impulso, PESOS_PUNTUACION.impulso],
      [salud, PESOS_PUNTUACION.salud],
      [uso, PESOS_PUNTUACION.uso],
    ];
    let suma = 0;
    let pesos = 0;
    for (const [valor, peso] of partes) {
      if (valor === null) continue;
      suma += valor * peso;
      pesos += peso;
    }

    const penalizaciones: Penalizacion[] = [];
    if (proyecto.archivado) penalizaciones.push('archivado');
    else if (proyecto.estado === 'abandonado') penalizaciones.push('sin-actividad');
    if (proyecto.sinLicencia) penalizaciones.push('sin-licencia');
    const resta = penalizaciones.reduce((total, p) => total + PENALIZACIONES[p], 0);

    resultado.set(proyecto.clave, {
      total: Math.max(0, Math.min(100, Math.round((100 * suma) / pesos - resta))),
      popularidad: aCien(popularidad),
      impulso: impulso === null ? null : aCien(impulso),
      salud: aCien(salud),
      uso: uso === null ? null : aCien(uso),
      penalizaciones,
      grupo: grupo.slice(grupo.indexOf(':') + 1),
    });
  }
  return resultado;
}

interface Metricas {
  estrellas: number[];
  forks: number[];
  impulso: number[];
  uso: number[];
}

/**
 * Salud de 0 a 1: media de lo que se puede medir.
 * - Actividad: 1 con cambios en los últimos 30 días, y baja en línea recta hasta 0 al año.
 * - Versiones: 1 con una versión en los últimos 90 días, y baja hasta 0 a los dos años.
 * - Issues: proporción de cerradas, si hay al menos 10.
 * Un proyecto terminado (lo decide una persona) no pierde puntos por no tener cambios.
 */
export function calcularSalud(
  datos: Pick<
    DatosPuntuacion,
    'estado' | 'diasSinCambios' | 'diasDesdeVersion' | 'issuesAbiertas' | 'issuesCerradas'
  >,
): number {
  const terminado = datos.estado === 'terminado';
  const partes: number[] = [terminado ? 1 : lineal(datos.diasSinCambios, 30, 365)];
  if (datos.diasDesdeVersion !== null) {
    partes.push(terminado ? 1 : lineal(datos.diasDesdeVersion, 90, 730));
  }
  const abiertas = datos.issuesAbiertas ?? 0;
  const cerradas = datos.issuesCerradas ?? 0;
  if (datos.issuesAbiertas !== null && abiertas + cerradas >= MINIMO_ISSUES) {
    partes.push(cerradas / (abiertas + cerradas));
  }
  return partes.reduce((a, b) => a + b, 0) / partes.length;
}

/** 1 hasta `lleno` días, 0 desde `cero` días y en línea recta entre medias. */
function lineal(dias: number, lleno: number, cero: number): number {
  if (dias <= lleno) return 1;
  if (dias >= cero) return 0;
  return (cero - dias) / (cero - lleno);
}

/**
 * Percentil de un valor en una lista ordenada: la parte de la lista que queda por debajo, contando
 * los empates como medio. Va de 0 a 1 sin llegar nunca a los extremos; con un solo valor es 0,5.
 */
export function percentil(ordenados: readonly number[], valor: number): number {
  if (ordenados.length === 0) return 0.5;
  const menores = primeraPosicion(ordenados, (v) => v >= valor);
  const hastaIguales = primeraPosicion(ordenados, (v) => v > valor);
  return (menores + (hastaIguales - menores) / 2) / ordenados.length;
}

/** Búsqueda binaria: primera posición donde se cumple la condición (la lista va de menor a mayor). */
function primeraPosicion(ordenados: readonly number[], cumple: (valor: number) => boolean): number {
  let bajo = 0;
  let alto = ordenados.length;
  while (bajo < alto) {
    const medio = (bajo + alto) >> 1;
    if (cumple(ordenados[medio] as number)) alto = medio;
    else bajo = medio + 1;
  }
  return bajo;
}

const ordenar = (valores: number[]) => valores.sort((a, b) => a - b);
const aCien = (valor: number) => Math.round(valor * 100);
