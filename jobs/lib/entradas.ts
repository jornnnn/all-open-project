// Proyectos que el robot diario añade a la semilla: los que propuso el radar (regla de entrada,
// packages/core/src/candidatos.ts) y aceptó una persona en la página de revisión.

import type { EntradaSemilla } from './catalogo.ts';
import type { Aceptado } from './worker.ts';

/** Entradas de la semilla para los candidatos aceptados que aún no están en ella. */
export function entradasDelRadar(
  semilla: readonly EntradaSemilla[],
  aceptados: readonly Aceptado[],
): EntradaSemilla[] {
  const enSemilla = new Set(semilla.map((e) => e.repo.toLowerCase()));
  const vistos = new Set<string>();
  const entradas: EntradaSemilla[] = [];
  for (const a of aceptados) {
    const clave = a.repo.toLowerCase();
    // Sin tema no puede tener ficha; tampoco se repite lo que ya está en la semilla.
    if (!a.temas || a.temas.length === 0 || enSemilla.has(clave) || vistos.has(clave)) continue;
    vistos.add(clave);
    entradas.push({ repo: a.repo, temas: a.temas, origen: ['radar'] });
  }
  return entradas.sort((a, b) => (a.repo.toLowerCase() < b.repo.toLowerCase() ? -1 : 1));
}
