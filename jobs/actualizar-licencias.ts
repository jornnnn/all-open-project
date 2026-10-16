// Regenera packages/core/src/licencias-spdx.ts a partir de la lista oficial de SPDX.
// Uso: pnpm --filter @aop/jobs run licencias

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const URL_LISTA =
  'https://raw.githubusercontent.com/spdx/license-list-data/main/json/licenses.json';
const DESTINO = resolve(import.meta.dirname, '../packages/core/src/licencias-spdx.ts');

interface LicenciaSpdx {
  licenseId: string;
  isOsiApproved?: boolean;
  isFsfLibre?: boolean;
}

interface ListaSpdx {
  licenseListVersion: string;
  releaseDate: string;
  licenses: LicenciaSpdx[];
}

const respuesta = await fetch(URL_LISTA);
if (!respuesta.ok) {
  throw new Error(`No se pudo descargar la lista SPDX: HTTP ${respuesta.status}`);
}
const lista = (await respuesta.json()) as ListaSpdx;

const libres = lista.licenses
  .filter((l) => l.isOsiApproved === true || l.isFsfLibre === true)
  .map((l) => l.licenseId.toLowerCase())
  .sort();

if (libres.length < 150) {
  throw new Error(`La lista parece incompleta: solo ${libres.length} licencias libres.`);
}

const contenido = `// Generado por jobs/actualizar-licencias.ts. No lo edites a mano.
// Fuente: ${URL_LISTA}
// Lista SPDX ${lista.licenseListVersion} (${lista.releaseDate.slice(0, 10)}).
// Incluye los identificadores aprobados por la OSI o libres según la FSF, también los antiguos
// que aún usa GitHub (por ejemplo, GPL-3.0). Van en minúsculas.

export const VERSION_LISTA_SPDX = '${lista.licenseListVersion}';

export const LICENCIAS_LIBRES: ReadonlySet<string> = new Set([
${libres.map((id) => `  '${id}',`).join('\n')}
]);
`;

await writeFile(DESTINO, contenido);
console.log(
  `Lista SPDX ${lista.licenseListVersion}: ${libres.length} licencias libres en ${DESTINO}`,
);
