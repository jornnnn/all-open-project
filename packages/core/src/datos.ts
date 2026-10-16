// Esquemas de los datos editoriales de data/ (taxonomía, alternativas, semilla y editorial).
// Solo validan objetos ya leídos: cada programa lee los archivos a su manera.

import { z } from 'zod';
import { CATEGORIAS_LICENCIA, PUBLICOS } from './tipos.ts';

const id = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'usa minúsculas, números y guiones (ej.: edicion-de-fotos)');
const topic = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,49}$/, 'no es un topic de GitHub (minúsculas, números y guiones)');
const repo = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/,
    'usa el formato propietario/repo',
  );
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'usa el formato AAAA-MM-DD');
const texto = z.string().trim().min(1);
const entero = z.number().int().nonnegative();
const bilingue = z.strictObject({ es: texto, en: texto });

// --- taxonomia.yaml -------------------------------------------------------------------------

export const esquemaSubtema = z.strictObject({
  id,
  slug_en: id,
  nombre: bilingue,
  publico: z.enum(PUBLICOS),
  topics: z.array(topic).min(1),
});

export const esquemaArea = z.strictObject({
  id,
  slug_en: id,
  nombre: bilingue,
  /** Icono de Lucide, como en la maqueta. */
  icono: texto,
  /** Tono del color del área (0-360), como en la maqueta. */
  tono: z.number().int().min(0).max(360),
  /** Aparece entre las tareas de la portada. */
  portada: z.boolean().default(false),
  subtemas: z.array(esquemaSubtema).min(1),
});

export const esquemaTaxonomia = z.strictObject({
  version: z.literal(1),
  areas: z.array(esquemaArea).min(1),
});

// --- alternativas.yaml ----------------------------------------------------------------------

export const esquemaPrograma = z.strictObject({
  /** Identificador y dirección en español: /alternativas-a/{id}. */
  id,
  /** Dirección en inglés si cambia: /en/alternatives-to/{slug_en}. */
  slug_en: id.optional(),
  nombre: texto,
  /** Nombre en inglés si cambia (Google Fotos → Google Photos). */
  nombre_en: texto.optional(),
  subtemas: z.array(id).min(1),
  alternativas: z.array(repo).min(1),
});

export const esquemaAlternativas = z.strictObject({
  version: z.literal(1),
  programas: z.array(esquemaPrograma).min(1),
});

// --- semilla.yaml ---------------------------------------------------------------------------

export const esquemaSemilla = z.strictObject({
  version: z.literal(1),
  ajustes: z.strictObject({
    objetivo: entero,
    minimo: entero,
    maximo: entero,
    estrellas_minimas: entero,
    meses_sin_actividad: entero,
    antiguedad_minima_dias: entero,
    /** Proyectos que entran como mínimo de cada subtema; el resto, por popularidad. */
    cupo_por_subtema: z.number().int().min(1),
    resultados_por_busqueda: z.number().int().min(1).max(100),
  }),
  /** Búsquedas extra para un subtema, además de sus topics. */
  busquedas: z.array(z.strictObject({ subtema: id, consultas: z.array(texto).min(1) })).default([]),
  /** Proyectos que entran siempre. */
  altas: z.array(z.strictObject({ repo, subtemas: z.array(id).min(1), motivo: texto })).default([]),
  /** Proyectos que no entran en la semilla aunque salgan en las búsquedas. */
  excluir: z.array(z.strictObject({ repo, motivo: texto })).default([]),
});

// --- editorial.yaml -------------------------------------------------------------------------

const comunes = { repo, motivo: texto, fecha };

export const esquemaCorreccion = z.discriminatedUnion('tipo', [
  z.strictObject({ tipo: z.literal('estado'), valor: z.literal('terminado'), ...comunes }),
  z.strictObject({ tipo: z.literal('licencia'), valor: z.enum(CATEGORIAS_LICENCIA), ...comunes }),
  z.strictObject({ tipo: z.literal('temas'), valor: z.array(id).min(1), ...comunes }),
  z.strictObject({ tipo: z.literal('publico'), valor: z.enum(PUBLICOS), ...comunes }),
  z.strictObject({ tipo: z.literal('oficial'), valor: z.boolean(), ...comunes }),
  z.strictObject({ tipo: z.literal('excluir'), ...comunes }),
]);

export const esquemaEditorial = z.strictObject({
  version: z.literal(1),
  correcciones: z.array(esquemaCorreccion),
});

export type Subtema = z.infer<typeof esquemaSubtema>;
export type Area = z.infer<typeof esquemaArea>;
export type Taxonomia = z.infer<typeof esquemaTaxonomia>;
export type Programa = z.infer<typeof esquemaPrograma>;
export type Alternativas = z.infer<typeof esquemaAlternativas>;
export type Semilla = z.infer<typeof esquemaSemilla>;
export type Correccion = z.infer<typeof esquemaCorreccion>;
export type Editorial = z.infer<typeof esquemaEditorial>;

export interface DatosEditoriales {
  taxonomia: Taxonomia;
  alternativas: Alternativas;
  semilla: Semilla;
  editorial: Editorial;
}

/** Busca los valores repetidos de una lista (sin distinguir mayúsculas si se pide). */
function repetidos(valores: readonly string[], sinMayusculas = false): string[] {
  const vistos = new Set<string>();
  const resultado = new Set<string>();
  for (const valor of valores) {
    const clave = sinMayusculas ? valor.toLowerCase() : valor;
    if (vistos.has(clave)) resultado.add(valor);
    vistos.add(clave);
  }
  return [...resultado];
}

/**
 * Comprueba lo que los esquemas no ven solos: identificadores únicos, topics sin repetir
 * y referencias entre archivos. Devuelve la lista de errores (vacía si todo está bien).
 */
export function revisarDatos(datos: DatosEditoriales): string[] {
  const { taxonomia, alternativas, semilla, editorial } = datos;
  const errores: string[] = [];

  const subtemas = taxonomia.areas.flatMap((area) => area.subtemas);
  const temas = [...taxonomia.areas, ...subtemas];
  for (const valor of repetidos(temas.map((t) => t.id))) {
    errores.push(`taxonomia.yaml: el identificador «${valor}» está repetido`);
  }
  for (const valor of repetidos(temas.map((t) => t.slug_en))) {
    errores.push(`taxonomia.yaml: el slug_en «${valor}» está repetido`);
  }
  const subtemaDeTopic = new Map<string, string>();
  for (const subtema of subtemas) {
    for (const valor of repetidos(subtema.topics)) {
      errores.push(`taxonomia.yaml: «${subtema.id}» repite el topic «${valor}»`);
    }
    for (const t of new Set(subtema.topics)) {
      const otro = subtemaDeTopic.get(t);
      if (otro !== undefined && otro !== subtema.id) {
        errores.push(`taxonomia.yaml: el topic «${t}» está en «${otro}» y en «${subtema.id}»`);
      }
      subtemaDeTopic.set(t, subtema.id);
    }
  }

  const idsDeSubtemas = new Set(subtemas.map((s) => s.id));
  const comprobarSubtemas = (archivo: string, donde: string, lista: readonly string[]) => {
    for (const s of lista) {
      if (!idsDeSubtemas.has(s))
        errores.push(`${archivo}: ${donde} usa el subtema «${s}», que no existe`);
    }
  };

  const programas = alternativas.programas;
  for (const valor of repetidos(programas.map((p) => p.id))) {
    errores.push(`alternativas.yaml: el programa «${valor}» está repetido`);
  }
  for (const valor of repetidos(programas.map((p) => p.slug_en ?? p.id))) {
    errores.push(`alternativas.yaml: la dirección en inglés «${valor}» está repetida`);
  }
  for (const programa of programas) {
    comprobarSubtemas('alternativas.yaml', `«${programa.id}»`, programa.subtemas);
    for (const valor of repetidos(programa.alternativas, true)) {
      errores.push(`alternativas.yaml: «${programa.id}» repite la alternativa «${valor}»`);
    }
  }

  const { ajustes } = semilla;
  if (!(ajustes.minimo <= ajustes.objetivo && ajustes.objetivo <= ajustes.maximo)) {
    errores.push('semilla.yaml: hace falta minimo ≤ objetivo ≤ maximo');
  }
  for (const busqueda of semilla.busquedas) {
    comprobarSubtemas('semilla.yaml', 'una búsqueda', [busqueda.subtema]);
  }
  for (const alta of semilla.altas) {
    comprobarSubtemas('semilla.yaml', `el alta «${alta.repo}»`, alta.subtemas);
  }
  for (const valor of repetidos(
    semilla.altas.map((a) => a.repo),
    true,
  )) {
    errores.push(`semilla.yaml: el alta «${valor}» está repetida`);
  }
  const excluidos = new Set(semilla.excluir.map((e) => e.repo.toLowerCase()));
  for (const alta of semilla.altas) {
    if (excluidos.has(alta.repo.toLowerCase())) {
      errores.push(`semilla.yaml: «${alta.repo}» está a la vez en altas y en excluir`);
    }
  }

  for (const correccion of editorial.correcciones) {
    if (correccion.tipo === 'temas') {
      comprobarSubtemas(
        'editorial.yaml',
        `la corrección de «${correccion.repo}»`,
        correccion.valor,
      );
    }
  }
  for (const valor of repetidos(
    editorial.correcciones.map((c) => `${c.repo.toLowerCase()} (${c.tipo})`),
  )) {
    errores.push(`editorial.yaml: la corrección ${valor} está repetida`);
  }

  return errores;
}
