import type { Estado } from './tipos.ts';

/** Con menos de estos meses sin cambios, el proyecto está vivo. */
export const MESES_VIVO = 3;
/** Hasta estos meses sin cambios está lento; con más, abandonado. */
export const MESES_LENTO = 12;

export interface DatosEstado {
  /** GitHub lo marca como archivado (solo lectura). */
  archivado: boolean;
  /** Fecha ISO 8601 del último cambio en la rama principal. */
  ultimoCambio: string;
  /** Una persona lo ha marcado como terminado en data/editorial.yaml. */
  terminado?: boolean;
}

/**
 * Calcula el estado de mantenimiento:
 * - terminado: lo decide una persona y manda sobre todo lo demás;
 * - abandonado: archivado o más de 12 meses sin cambios;
 * - lento: de 3 a 12 meses sin cambios;
 * - vivo: menos de 3 meses sin cambios.
 */
export function calcularEstado(datos: DatosEstado, ahora: Date): Estado {
  if (datos.terminado === true) return 'terminado';
  if (datos.archivado) return 'abandonado';

  const ultimo = new Date(datos.ultimoCambio);
  if (Number.isNaN(ultimo.getTime())) {
    throw new Error(`Fecha de último cambio no válida: «${datos.ultimoCambio}»`);
  }
  if (ahora < sumarMeses(ultimo, MESES_VIVO)) return 'vivo';
  if (ahora <= sumarMeses(ultimo, MESES_LENTO)) return 'lento';
  return 'abandonado';
}

/**
 * Suma (o resta, si es negativo) meses de calendario en UTC.
 * Si el día no existe en el mes de destino, usa el último día de ese mes (31 ene + 1 mes = 28 o 29 feb).
 */
export function sumarMeses(fecha: Date, meses: number): Date {
  const mesesTotales = fecha.getUTCMonth() + meses;
  const anio = fecha.getUTCFullYear() + Math.floor(mesesTotales / 12);
  const mes = ((mesesTotales % 12) + 12) % 12;
  const ultimoDiaDelMes = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const resultado = new Date(fecha.getTime());
  resultado.setUTCFullYear(anio, mes, Math.min(fecha.getUTCDate(), ultimoDiaDelMes));
  return resultado;
}
