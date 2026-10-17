// Datos del día anterior (data/export/proyectos.json, que el robot publica cada noche) para lo que
// no hace falta pedir a GitHub todos los días: los topics. Son lo más caro de pedir (el 40 % del
// tiempo de la consulta diaria) y casi nunca cambian, así que cada proyecto los renueva una vez por
// semana, por turnos, y los nuevos el primer día.

import { readFile } from 'node:fs/promises';
import { esquemaExportacion } from '@aop/core';
import { RUTA_EXPORTACION } from './exportar.ts';

/** Cada proyecto renueva sus topics una vez cada estos días. */
export const DIAS_POR_TURNO = 7;

export interface DatosAnteriores {
  /** Día de la exportación anterior; null si no la hay o no se puede leer. */
  fecha: string | null;
  /** Topics por id de GitHub. */
  topics: Map<number, string[]>;
}

/** Lee la exportación anterior. Si no existe o no cumple el formato, se pedirá todo a GitHub. */
export async function leerAnterior(ruta: string = RUTA_EXPORTACION): Promise<DatosAnteriores> {
  try {
    const datos = esquemaExportacion.parse(JSON.parse(await readFile(ruta, 'utf8')));
    return { fecha: datos.fecha, topics: new Map(datos.proyectos.map((p) => [p.id, p.topics])) };
  } catch {
    return { fecha: null, topics: new Map() };
  }
}

/** ¿Le toca renovar sus topics este día? A cada proyecto, uno de cada siete, según su id. */
export function leTocaHoy(id: number, fecha: string): boolean {
  const dia = Math.floor(Date.parse(`${fecha}T00:00:00Z`) / 86_400_000);
  return (id + dia) % DIAS_POR_TURNO === 0;
}
