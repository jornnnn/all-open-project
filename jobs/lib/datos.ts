// Lee y valida los datos editoriales de data/.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type DatosEditoriales,
  esquemaAlternativas,
  esquemaEditorial,
  esquemaSemilla,
  esquemaTaxonomia,
  revisarDatos,
} from '@aop/core';
import { parse } from 'yaml';
import { z } from 'zod';

z.config(z.locales.es());

export const DIR_DATOS = resolve(import.meta.dirname, '../../data');

const ARCHIVOS = {
  taxonomia: ['taxonomia.yaml', esquemaTaxonomia],
  alternativas: ['alternativas.yaml', esquemaAlternativas],
  semilla: ['semilla.yaml', esquemaSemilla],
  editorial: ['editorial.yaml', esquemaEditorial],
} as const;

async function leer<T>(dir: string, archivo: string, esquema: z.ZodType<T>): Promise<T> {
  const texto = await readFile(resolve(dir, archivo), 'utf8');
  let bruto: unknown;
  try {
    bruto = parse(texto);
  } catch (error) {
    throw new Error(`${archivo} no es YAML válido: ${(error as Error).message}`);
  }
  const resultado = esquema.safeParse(bruto);
  if (!resultado.success) {
    throw new Error(`${archivo} no cumple el formato:\n${z.prettifyError(resultado.error)}`);
  }
  return resultado.data;
}

/** Lee los cuatro archivos, los valida y comprueba que encajan entre sí. Falla con un mensaje claro. */
export async function cargarDatos(dir: string = DIR_DATOS): Promise<DatosEditoriales> {
  const { taxonomia, alternativas, semilla, editorial } = ARCHIVOS;
  const datos: DatosEditoriales = {
    taxonomia: await leer(dir, taxonomia[0], taxonomia[1]),
    alternativas: await leer(dir, alternativas[0], alternativas[1]),
    semilla: await leer(dir, semilla[0], semilla[1]),
    editorial: await leer(dir, editorial[0], editorial[1]),
  };
  const errores = revisarDatos(datos);
  if (errores.length > 0) {
    throw new Error(`Los datos de data/ no encajan entre sí:\n- ${errores.join('\n- ')}`);
  }
  return datos;
}
