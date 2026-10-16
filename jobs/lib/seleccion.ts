// Lógica pura de la semilla: qué repos entran y con qué temas. Sin red ni archivos, para poder probarla.

import {
  asignarTemas,
  type CategoriaLicencia,
  calcularEstado,
  clasificarLicencia,
  type Estado,
  type Taxonomia,
} from '@aop/core';
import type { RepoGithub } from './github.ts';

/** De dónde sale un proyecto de la semilla. */
export type Origen =
  | { tipo: 'busqueda'; subtema: string }
  | { tipo: 'alternativa'; programa: string; subtemas: readonly string[] }
  | { tipo: 'alta'; subtemas: readonly string[] };

export interface ProyectoSemilla {
  repo: string;
  /** Subtemas; el primero es el principal. */
  temas: string[];
  origen: string[];
  estrellas: number;
  lenguaje: string | null;
  licencia: string | null;
  categoria_licencia: CategoriaLicencia;
  estado: Estado;
  /** Fecha del último cambio en la rama principal (o del último push si no hay rama). */
  ultimo_cambio: string;
  creado: string;
  descripcion: string | null;
}

/** Clave para comparar repos sin distinguir mayúsculas, como hace GitHub. */
export const clave = (repo: string) => repo.toLowerCase();

/** Fecha del último cambio: el último commit de la rama principal; si no hay, el último push. */
export function ultimoCambio(repo: RepoGithub): string {
  return repo.ultimoCommit ?? repo.ultimoPush ?? repo.creado;
}

/** Orden por código de carácter: igual en cualquier sistema, a diferencia de localeCompare. */
export function comparar(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Elige los proyectos de la semilla, en este orden:
 * 1. los fijos (alternativas y altas);
 * 2. los `cupo` primeros de cada subtema (las listas ya vienen ordenadas por estrellas), para que
 *    ningún tema se quede vacío;
 * 3. hasta llegar al objetivo, los candidatos restantes con más estrellas, de cualquier subtema.
 */
export function elegirProyectos(
  listas: ReadonlyMap<string, readonly string[]>,
  fijos: ReadonlySet<string>,
  estrellas: ReadonlyMap<string, number>,
  { cupo, objetivo }: { cupo: number; objetivo: number },
): { elegidos: Set<string>; porPopularidad: Set<string> } {
  const elegidos = new Set(fijos);
  for (const lista of listas.values()) {
    for (const repo of lista.slice(0, cupo)) elegidos.add(repo);
  }

  const resto = [...new Set([...listas.values()].flat())]
    .filter((repo) => !elegidos.has(repo))
    .sort((a, b) => (estrellas.get(b) ?? 0) - (estrellas.get(a) ?? 0) || comparar(a, b));
  const porPopularidad = new Set<string>();
  for (const repo of resto) {
    if (elegidos.size >= objetivo) break;
    elegidos.add(repo);
    porPopularidad.add(repo);
  }
  return { elegidos, porPopularidad };
}

/**
 * Construye la entrada de la semilla. Orden de los temas: primero los que fija una persona (altas),
 * luego los de los topics (por coincidencias) y por último los de búsquedas y alternativas.
 */
export function construirProyecto(
  repo: RepoGithub,
  origenes: readonly Origen[],
  taxonomia: Taxonomia,
  ahora: Date,
): ProyectoSemilla {
  const temas = new Set<string>();
  for (const o of origenes) if (o.tipo === 'alta') for (const s of o.subtemas) temas.add(s);
  for (const t of asignarTemas(repo.topics, taxonomia)) temas.add(t.subtema);
  for (const o of origenes) {
    if (o.tipo === 'busqueda') temas.add(o.subtema);
    if (o.tipo === 'alternativa') for (const s of o.subtemas) temas.add(s);
  }

  const origen = new Set<string>();
  for (const o of origenes) {
    origen.add(o.tipo === 'alternativa' ? `alternativa:${o.programa}` : o.tipo);
  }

  const cambio = ultimoCambio(repo);
  return {
    repo: repo.repo,
    temas: [...temas],
    origen: [...origen].sort(),
    estrellas: repo.estrellas,
    lenguaje: repo.lenguaje,
    licencia: repo.licencia,
    categoria_licencia: clasificarLicencia(repo.licencia),
    estado: calcularEstado({ archivado: repo.archivado, ultimoCambio: cambio }, ahora),
    ultimo_cambio: cambio.slice(0, 10),
    creado: repo.creado.slice(0, 10),
    descripcion: repo.descripcion,
  };
}
