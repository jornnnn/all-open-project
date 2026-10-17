// Datos abiertos: data/export/proyectos.json (CC BY 4.0), con la foto del día de todo el catálogo.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { type Exportacion, esquemaExportacion } from '@aop/core';
import { DIR_DATOS } from './datos.ts';

export const RUTA_EXPORTACION = resolve(DIR_DATOS, 'export/proyectos.json');

/**
 * JSON con la cabecera legible y un proyecto por línea: así el commit de cada día enseña en git
 * qué ha cambiado en cada proyecto.
 */
export function textoDeExportacion(exportacion: Exportacion): string {
  const { proyectos, ...cabecera } = exportacion;
  const inicio = JSON.stringify(cabecera, null, 2).slice(0, -2);
  const lineas = proyectos.map((p) => `    ${JSON.stringify(p)}`).join(',\n');
  return `${inicio},\n  "proyectos": [\n${lineas}\n  ]\n}\n`;
}

/** Valida y escribe los datos abiertos. */
export async function escribirExportacion(
  exportacion: Exportacion,
  ruta: string = RUTA_EXPORTACION,
): Promise<void> {
  const validada = esquemaExportacion.parse(exportacion);
  await mkdir(dirname(ruta), { recursive: true });
  await writeFile(ruta, textoDeExportacion(validada));
}
