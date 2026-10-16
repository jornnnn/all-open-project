import { LICENCIAS_LIBRES } from './licencias-spdx.ts';
import type { CategoriaLicencia } from './tipos.ts';

/**
 * Licencias que dejan ver el código pero limitan su uso. Prefijos de identificadores SPDX,
 * en minúsculas. Ojo: `bsl-1.0` es la licencia Boost (open source); la de límites es `busl-1.1`.
 */
const PREFIJOS_CON_LIMITES = [
  'busl-', // Business Source License
  'sspl-', // Server Side Public License
  'elastic-', // Elastic License
  'polyform-', // PolyForm (no comercial, pequeña empresa…)
  'fsl-', // Functional Source License
  'sul-', // Sustainable Use License
  'cc-by-nc', // Creative Commons no comercial
  'cc-by-nd', // Creative Commons sin obras derivadas
  'hippocratic-', // limita los usos permitidos
];

/** Identificadores exactos con límites: la licencia JSON prohíbe usos «malvados». */
const EXACTAS_CON_LIMITES = new Set(['json']);

/**
 * Clasifica el identificador SPDX que da GitHub (`licenseInfo.spdxId`):
 * - sin identificador → sin licencia. Ojo: GitHub solo mira la raíz del repo, y hay proyectos con
 *   la licencia en otra carpeta (TuxGuitar, por ejemplo). Antes de publicar «sin licencia», quien
 *   llame debe comprobar que no hay ningún archivo de licencia en el repo;
 * - `NOASSERTION` (GitHub ve una licencia, pero no sabe cuál) → otra;
 * - aprobada por la OSI o libre según la FSF → open source;
 * - de la lista de límites → con límites;
 * - cualquier otra → otra, para revisarla a mano.
 */
export function clasificarLicencia(spdx: string | null | undefined): CategoriaLicencia {
  const id = spdx?.trim().toLowerCase();
  if (!id || id === 'none') return 'sin-licencia';
  if (id === 'noassertion') return 'otra';
  if (LICENCIAS_LIBRES.has(id)) return 'open-source';
  if (EXACTAS_CON_LIMITES.has(id) || PREFIJOS_CON_LIMITES.some((p) => id.startsWith(p))) {
    return 'con-limites';
  }
  return 'otra';
}
