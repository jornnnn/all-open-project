// Ficha de cada proyecto tal como la guarda el robot cada día: en D1 y en los datos abiertos
// (data/export/proyectos.json). El robot la valida con este esquema antes de publicarla.

import { z } from 'zod';
import { PENALIZACIONES, type Penalizacion } from './puntuacion.ts';
import { CATEGORIAS_LICENCIA, ESTADOS, PUBLICOS, SISTEMAS_INSTALABLES } from './tipos.ts';

/** Versión del formato de los datos abiertos. Si cambia de forma incompatible, se sube. */
export const VERSION_EXPORTACION = 1;

const momento = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, 'fecha y hora ISO 8601 en UTC');
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'usa el formato AAAA-MM-DD');
const entero = z.number().int().nonnegative();
const deCero = z.number().int().min(0).max(100);
const archivos = z.array(z.string().min(1));

export const esquemaProyectoCatalogo = z.strictObject({
  /** Identificador numérico de GitHub: no cambia aunque renombren el repo. */
  id: z.number().int().positive(),
  /** propietario/repo, como se llama hoy en GitHub. */
  repo: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/),
  descripcion: z.string().nullable(),
  web: z.string().nullable(),
  lenguaje: z.string().nullable(),
  topics: z.array(z.string()),
  /** Subtemas de la taxonomía; el primero es el principal. */
  temas: z.array(z.string()).min(1),
  area: z.string(),
  publico: z.enum(PUBLICOS),
  estrellas: entero,
  forks: entero,
  /** null si el repo tiene las issues desactivadas. */
  issues_abiertas: entero.nullable(),
  issues_cerradas: entero.nullable(),
  creado: momento,
  ultimo_push: momento.nullable(),
  /** Último commit de la rama principal (si no lo hay, el último push). */
  ultimo_cambio: momento,
  archivado: z.boolean(),
  estado: z.enum(ESTADOS),
  /** Identificador SPDX que da GitHub; NOASSERTION si no sabe cuál es. */
  licencia_github: z.string().nullable(),
  licencia: z.enum(CATEGORIAS_LICENCIA),
  /** Licencias reconocidas (SPDX o nombre). */
  licencias: z.array(z.string()),
  /** Cómo se ha decidido la licencia cuando no basta con lo que dice GitHub. */
  licencia_motivo: z.string().nullable(),
  /** El dueño es una organización verificada por GitHub; null si es una persona. */
  organizacion_verificada: z.boolean().nullable(),
  /** Oficial o no según data/editorial.yaml; null mientras nadie lo ha comprobado. */
  oficial: z.boolean().nullable(),
  /** Última versión publicada en GitHub. */
  version: z
    .strictObject({
      nombre: z.string(),
      fecha: momento,
      /** Descargas de sus archivos, sin contar sumas de control ni firmas. */
      descargas: entero,
    })
    .nullable(),
  /** Instaladores de la última versión por sistema (como mucho 10 nombres de archivo por sistema). */
  instaladores: z.strictObject({
    windows: archivos,
    mac: archivos,
    linux: archivos,
    android: archivos,
  }),
  sistemas: z.array(z.enum(SISTEMAS_INSTALABLES)),
  /** Estrellas ganadas al día en los últimos 30 días; null hasta tener 7 días de fotos. */
  estrellas_por_dia: z.number().nullable(),
  puntuacion: deCero,
  puntuacion_detalle: z.strictObject({
    popularidad: deCero,
    impulso: deCero.nullable(),
    salud: deCero,
    uso: deCero.nullable(),
    penalizaciones: z.array(
      z.enum(Object.keys(PENALIZACIONES) as [Penalizacion, ...Penalizacion[]]),
    ),
    grupo: z.string(),
  }),
  /** De dónde sale en la semilla: busqueda, alta o alternativa:<programa>. */
  origen: z.array(z.string()),
});

export type ProyectoCatalogo = z.infer<typeof esquemaProyectoCatalogo>;

export const esquemaExportacion = z.strictObject({
  version: z.literal(VERSION_EXPORTACION),
  /** Momento en que el robot leyó los datos de GitHub. */
  generado: momento,
  /** Día de la foto (UTC). */
  fecha: dia,
  fuente: z.string(),
  licencia: z.literal('CC BY 4.0'),
  metodologia: z.string(),
  resumen: z.record(z.string(), z.unknown()),
  proyectos: z.array(esquemaProyectoCatalogo),
});

export type Exportacion = z.infer<typeof esquemaExportacion>;
