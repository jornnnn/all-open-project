// Candidatos del radar: repos que aún no están en el catálogo. Aquí se decide si entran, si se
// siguen vigilando o si se dejan. La explicación pública está en docs/metodologia.md.

import type { MotivoLista } from './listas.ts';
import { type DiaDeEstrellas, sumarDias } from './tendencias.ts';

/** Regla de entrada al catálogo. */
export const ENTRADA = {
  /** Estrellas mínimas. */
  estrellas: 500,
  /** Días completos seguidos (hasta ayer) ganando estrellas… */
  dias: 7,
  /** …con al menos estas cada día. */
  estrellasAlDia: 10,
  /** Las estrellas compradas no suelen traer forks: al menos 1 fork por cada 100 estrellas. */
  forksPorEstrella: 0.01,
} as const;

/** Cuándo se deja de vigilar un candidato. */
export const SEGUIMIENTO = {
  /** Días desde que se detectó: si no ha entrado en este tiempo, se deja. */
  diasMaximos: 30,
  /** A partir de estos días desde que se detectó, se deja si se ha parado… */
  diasAntesDeParar: 7,
  /** …es decir, si en los 3 últimos días completos no suma estas estrellas. */
  estrellasEn3Dias: 10,
} as const;

export interface DatosCandidato {
  estrellas: number;
  forks: number;
  esFork: boolean;
  archivado: boolean;
  espejo: boolean;
  /** Si parece una lista, un curso o no tiene código (detectarListaOCurso). */
  lista: MotivoLista | null;
  /** Subtemas que le tocan por sus topics (el primero es el principal). */
  temas: readonly string[];
  /** Excluido a mano (semilla.yaml o editorial.yaml). */
  excluido: boolean;
  /** Se llama como uno de los proyectos más populares y nadie lo ha revisado aún. */
  posibleCopia: boolean;
  /** Estrellas por día según el historial de GitHub (calendario de GitHub). */
  dias: readonly DiaDeEstrellas[];
  /** Hoy, en el mismo calendario. */
  hoy: string;
  diaDeCreacion: string;
  diaDeDeteccion: string;
}

export type Decision =
  | { decision: 'entra'; temas: string[]; motivo: string }
  | { decision: 'sigue'; motivo: string }
  | { decision: 'descartar'; motivo: string };

const LISTAS: Record<MotivoLista, string> = {
  'sin-codigo': 'no tiene código',
  topic: 'es una lista o un curso',
  nombre: 'es una lista o un curso',
  descripcion: 'es una lista o un curso',
};

/** Días entre dos fechas AAAA-MM-DD. */
const diasEntre = (desde: string, hasta: string) =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);

/**
 * Entra en el catálogo si tiene al menos 500 estrellas, lleva 7 días completos seguidos ganando
 * 10 o más cada día (sin contar el de su creación), tiene al menos 1 fork por cada 100 estrellas,
 * le toca algún tema por sus topics y no es una posible copia sin revisar. Se deja si no es un
 * programa (fork, archivado, espejo, lista, curso o sin código), si está excluido a mano, si en
 * 30 días no ha entrado o si se ha parado.
 */
export function decidirCandidato(d: DatosCandidato): Decision {
  if (d.excluido) return { decision: 'descartar', motivo: 'excluido a mano' };
  if (d.esFork) return { decision: 'descartar', motivo: 'es un fork' };
  if (d.archivado) return { decision: 'descartar', motivo: 'está archivado' };
  if (d.espejo) return { decision: 'descartar', motivo: 'es un espejo de otro repo' };
  if (d.lista) return { decision: 'descartar', motivo: LISTAS[d.lista] };

  const porDia = new Map(d.dias.map((x) => [x.dia, x.estrellas]));
  const ultimos = Array.from({ length: ENTRADA.dias }, (_, i) => sumarDias(d.hoy, -1 - i));
  const crece = ultimos.every(
    (dia) => dia > d.diaDeCreacion && (porDia.get(dia) ?? 0) >= ENTRADA.estrellasAlDia,
  );
  const faltan: string[] = [];
  if (d.estrellas < ENTRADA.estrellas) faltan.push(`tiene menos de ${ENTRADA.estrellas} estrellas`);
  if (!crece)
    faltan.push(
      `aún no lleva ${ENTRADA.dias} días seguidos ganando ${ENTRADA.estrellasAlDia} o más`,
    );
  if (d.forks < d.estrellas * ENTRADA.forksPorEstrella)
    faltan.push('tiene muy pocos forks para sus estrellas');
  if (d.posibleCopia) faltan.push('se llama como un proyecto famoso: espera a la revisión');
  if (d.temas.length === 0) faltan.push('sus topics no encajan en ningún tema');

  if (faltan.length === 0) {
    return {
      decision: 'entra',
      temas: [...d.temas],
      motivo: `${ENTRADA.estrellas}+ estrellas y ${ENTRADA.dias} días seguidos ganando ${ENTRADA.estrellasAlDia} o más`,
    };
  }

  const vigilado = diasEntre(d.diaDeDeteccion, d.hoy);
  if (vigilado > SEGUIMIENTO.diasMaximos) {
    // Si lo único que falta es el tema, el proyecto vale: se avisa para añadirlo a mano.
    const soloTema = faltan.length === 1 && d.temas.length === 0;
    return {
      decision: 'descartar',
      motivo: soloTema
        ? 'cumple la regla, pero sus topics no encajan en ningún tema: hay que añadirlo a mano'
        : `en ${SEGUIMIENTO.diasMaximos} días no ha entrado (${faltan.join('; ')})`,
    };
  }
  if (vigilado >= SEGUIMIENTO.diasAntesDeParar) {
    const tres = [1, 2, 3].map((i) => porDia.get(sumarDias(d.hoy, -i)) ?? 0);
    if (tres.reduce((a, b) => a + b, 0) < SEGUIMIENTO.estrellasEn3Dias) {
      return { decision: 'descartar', motivo: 'se ha parado: casi no gana estrellas' };
    }
  }
  return { decision: 'sigue', motivo: faltan.join('; ') };
}
