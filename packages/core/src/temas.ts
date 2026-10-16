import type { Taxonomia } from './datos.ts';

export interface TemaAsignado {
  area: string;
  subtema: string;
  /** Topics del repositorio que han llevado a este subtema. */
  coincidencias: string[];
}

interface EntradaIndice {
  area: string;
  subtema: string;
  /** Posición del subtema en la taxonomía, para desempatar. */
  orden: number;
}

const indices = new WeakMap<Taxonomia, ReadonlyMap<string, EntradaIndice>>();

function indiceDeTopics(taxonomia: Taxonomia): ReadonlyMap<string, EntradaIndice> {
  const existente = indices.get(taxonomia);
  if (existente) return existente;

  const indice = new Map<string, EntradaIndice>();
  let orden = 0;
  for (const area of taxonomia.areas) {
    for (const subtema of area.subtemas) {
      for (const topic of subtema.topics) {
        if (!indice.has(topic)) indice.set(topic, { area: area.id, subtema: subtema.id, orden });
      }
      orden++;
    }
  }
  indices.set(taxonomia, indice);
  return indice;
}

/** GitHub guarda los topics en minúsculas; así también aceptamos los escritos a mano. */
export function normalizarTopic(topic: string): string {
  return topic.trim().toLowerCase();
}

/**
 * Asigna subtemas a un repositorio según sus topics de GitHub.
 * Ordena por número de coincidencias y, si empatan, por el orden de la taxonomía.
 * El primero es el tema principal.
 */
export function asignarTemas(topics: readonly string[], taxonomia: Taxonomia): TemaAsignado[] {
  const indice = indiceDeTopics(taxonomia);
  const porSubtema = new Map<string, TemaAsignado & { orden: number }>();

  for (const topic of topics.map(normalizarTopic)) {
    const entrada = indice.get(topic);
    if (!entrada) continue;
    const asignado = porSubtema.get(entrada.subtema) ?? {
      area: entrada.area,
      subtema: entrada.subtema,
      coincidencias: [],
      orden: entrada.orden,
    };
    if (!asignado.coincidencias.includes(topic)) asignado.coincidencias.push(topic);
    porSubtema.set(entrada.subtema, asignado);
  }

  return [...porSubtema.values()]
    .sort((a, b) => b.coincidencias.length - a.coincidencias.length || a.orden - b.orden)
    .map(({ area, subtema, coincidencias }) => ({ area, subtema, coincidencias }));
}
