// Regenera, a partir de la lista oficial de SPDX:
// - packages/core/src/licencias-spdx.ts: qué identificadores son licencias libres;
// - jobs/licencias/*.txt: los textos oficiales con los que el robot compara los archivos de
//   licencia que GitHub no reconoce (las plantillas de PLANTILLAS_NECESARIAS).
// Uso: pnpm --filter @aop/jobs run licencias

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PLANTILLAS_NECESARIAS } from '@aop/core';

const URL_DATOS = 'https://raw.githubusercontent.com/spdx/license-list-data';
const URL_LISTA = `${URL_DATOS}/main/json/licenses.json`;
const DESTINO = resolve(import.meta.dirname, '../packages/core/src/licencias-spdx.ts');
const DIR_PLANTILLAS = resolve(import.meta.dirname, 'licencias');

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

// Textos oficiales de la misma versión de la lista.
await mkdir(DIR_PLANTILLAS, { recursive: true });
const necesarias = new Set(PLANTILLAS_NECESARIAS);
for (const archivo of await readdir(DIR_PLANTILLAS)) {
  if (archivo.endsWith('.txt') && !necesarias.has(archivo.slice(0, -4))) {
    await rm(resolve(DIR_PLANTILLAS, archivo));
  }
}
for (const id of necesarias) {
  if (!libres.includes(id.toLowerCase())) {
    throw new Error(
      `La plantilla ${id} ya no es libre en la lista SPDX: revisa licencias-texto.ts`,
    );
  }
  const url = `${URL_DATOS}/v${lista.licenseListVersion}/text/${id}.txt`;
  const texto = await fetch(url);
  if (!texto.ok) throw new Error(`No se pudo descargar ${url}: HTTP ${texto.status}`);
  await writeFile(
    resolve(DIR_PLANTILLAS, `${id}.txt`),
    (await texto.text()).replace(/\r\n/g, '\n'),
  );
}
await writeFile(
  resolve(DIR_PLANTILLAS, 'README.md'),
  `# Plantillas de licencias

Textos oficiales de la [lista de licencias de SPDX](https://spdx.org/licenses/) ${lista.licenseListVersion}, tal cual. El robot los compara con los archivos de licencia que GitHub no reconoce (ver \`packages/core/src/licencias-texto.ts\`).

Se generan con \`pnpm --filter @aop/jobs run licencias\`. No los edites a mano.
`,
);
console.log(`${necesarias.size} plantillas en ${DIR_PLANTILLAS}`);
