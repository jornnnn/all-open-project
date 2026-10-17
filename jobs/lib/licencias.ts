// Revisa las licencias que GitHub no sabe decir: «otra» (NOASSERTION) y «sin licencia».
//
// - «otra»: lee los archivos de licencia de la raíz (y de LICENSES/, como en REUSE) y los compara
//   con los textos oficiales (packages/core/src/licencias-texto.ts).
// - «sin licencia»: GitHub solo mira la raíz, así que antes de publicarlo se busca en todo el repo.
//   Si hay archivos de licencia en la raíz con otro nombre (gpl-3.0.txt, EULA.txt…), se leen; si
//   solo los hay en subcarpetas que no son de terceros, queda como «otra» para revisarla a mano.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type CategoriaLicencia,
  clasificarTextosDeLicencia,
  esArchivoDeLicencia,
  esRutaDeTerceros,
  PLANTILLAS_NECESARIAS,
  type PlantillasPreparadas,
  prepararPlantillas,
} from '@aop/core';
import {
  type ClienteGithub,
  claveArchivo,
  enParalelo,
  obtenerArbol,
  obtenerEntradas,
  obtenerTextos,
  type PeticionArchivo,
} from './github.ts';

const DIR_PLANTILLAS = resolve(import.meta.dirname, '../licencias');
/** Con más archivos de licencia que estos, se revisa a mano. */
const MAXIMO_ARCHIVOS = 12;
/** Carpeta de la raíz con una licencia por archivo (REUSE usa LICENSES/). */
const CARPETA_DE_LICENCIAS = /^licen[cs]es?$/i;
/** Dentro de esa carpeta: textos (.txt, .md) o archivos sin extensión. */
const TEXTO_DE_CARPETA = /\.(txt|md)$|^[^.]+$/i;

export interface RevisionLicencia {
  categoria: CategoriaLicencia;
  licencias: string[];
  motivo: string;
}

export async function cargarPlantillas(): Promise<PlantillasPreparadas> {
  const plantillas = await Promise.all(
    PLANTILLAS_NECESARIAS.map(async (id) => ({
      id,
      texto: await readFile(resolve(DIR_PLANTILLAS, `${id}.txt`), 'utf8'),
    })),
  );
  return prepararPlantillas(plantillas);
}

const otra = (motivo: string): RevisionLicencia => ({ categoria: 'otra', licencias: [], motivo });

/** Revisa la licencia de cada repo pendiente. Devuelve una revisión para cada uno. */
export async function revisarLicencias(
  cliente: ClienteGithub,
  pendientes: ReadonlyArray<{ repo: string; categoria: 'otra' | 'sin-licencia' }>,
  plantillas: PlantillasPreparadas,
): Promise<Map<string, RevisionLicencia>> {
  const resultado = new Map<string, RevisionLicencia>();
  const archivosPorRepo = new Map<string, PeticionArchivo[]>();

  // 1. «otra»: archivos de licencia de la raíz y de LICENSES/.
  const otras = pendientes.filter((p) => p.categoria === 'otra').map((p) => p.repo);
  const raices = await obtenerEntradas(
    cliente,
    otras.map((repo) => ({ repo, ruta: '' })),
  );
  const carpetas: PeticionArchivo[] = [];
  for (const repo of otras) {
    const entradas = raices.get(claveArchivo({ repo, ruta: '' })) ?? [];
    archivosPorRepo.set(
      repo,
      entradas
        .filter((e) => e.tipo === 'blob' && esArchivoDeLicencia(e.nombre))
        .map((e) => ({ repo, ruta: e.nombre })),
    );
    for (const e of entradas) {
      if (e.tipo === 'tree' && CARPETA_DE_LICENCIAS.test(e.nombre)) {
        carpetas.push({ repo, ruta: e.nombre });
      }
    }
  }
  if (carpetas.length > 0) {
    const contenidos = await obtenerEntradas(cliente, carpetas);
    for (const carpeta of carpetas) {
      for (const e of contenidos.get(claveArchivo(carpeta)) ?? []) {
        if (e.tipo === 'blob' && TEXTO_DE_CARPETA.test(e.nombre)) {
          archivosPorRepo.get(carpeta.repo)?.push({
            repo: carpeta.repo,
            ruta: `${carpeta.ruta}/${e.nombre}`,
          });
        }
      }
    }
  }

  // 2. «sin licencia»: se busca en todo el repo.
  const sinLicencia = pendientes.filter((p) => p.categoria === 'sin-licencia').map((p) => p.repo);
  await enParalelo(sinLicencia, 3, async (repo) => {
    const arbol = await obtenerArbol(cliente, repo);
    if (!arbol) {
      resultado.set(
        repo,
        otra('No se pudo leer el contenido del repositorio para comprobar la licencia.'),
      );
      return;
    }
    const deLaRaiz = arbol.rutas.filter((ruta) => {
      const partes = ruta.split('/');
      return (
        (partes.length === 1 && esArchivoDeLicencia(ruta)) ||
        (partes.length === 2 &&
          CARPETA_DE_LICENCIAS.test(partes[0] ?? '') &&
          TEXTO_DE_CARPETA.test(partes[1] ?? ''))
      );
    });
    if (deLaRaiz.length > 0) {
      archivosPorRepo.set(
        repo,
        deLaRaiz.map((ruta) => ({ repo, ruta })),
      );
      return;
    }
    const enSubcarpetas = arbol.rutas.filter(
      (ruta) =>
        ruta.includes('/') &&
        esArchivoDeLicencia(ruta.slice(ruta.lastIndexOf('/') + 1)) &&
        !esRutaDeTerceros(ruta),
    );
    if (enSubcarpetas.length > 0) {
      const ejemplos = enSubcarpetas.slice(0, 3).join(', ');
      const mas = enSubcarpetas.length > 3 ? ` y ${enSubcarpetas.length - 3} más` : '';
      resultado.set(
        repo,
        otra(
          `GitHub no ve licencia, pero hay archivos de licencia en subcarpetas (${ejemplos}${mas}). Hay que revisarla a mano.`,
        ),
      );
    } else if (arbol.truncado) {
      resultado.set(
        repo,
        otra(
          'El repositorio es demasiado grande para comprobar que no tiene licencia. Hay que revisarlo a mano.',
        ),
      );
    } else {
      resultado.set(repo, {
        categoria: 'sin-licencia',
        licencias: [],
        motivo: `No hay ningún archivo de licencia en el repositorio (comprobados sus ${arbol.rutas.length} archivos).`,
      });
    }
  });

  // 3. Se leen los archivos encontrados y se clasifican.
  const peticiones = [...archivosPorRepo.values()].flatMap((archivos) =>
    archivos.length > MAXIMO_ARCHIVOS ? [] : archivos,
  );
  const textos = await obtenerTextos(cliente, peticiones);
  for (const [repo, archivos] of archivosPorRepo) {
    if (archivos.length === 0) {
      resultado.set(
        repo,
        otra(
          'GitHub ve una licencia, pero no hay archivos de licencia en la raíz. Hay que revisarla a mano.',
        ),
      );
      continue;
    }
    if (archivos.length > MAXIMO_ARCHIVOS) {
      resultado.set(
        repo,
        otra(`Tiene ${archivos.length} archivos de licencia. Hay que revisarla a mano.`),
      );
      continue;
    }
    const leidos = archivos.map((a) => ({ ruta: a.ruta, contenido: textos.get(claveArchivo(a)) }));
    const ilegible = leidos.find(
      (l) => !l.contenido || l.contenido.texto === null || l.contenido.truncado,
    );
    if (ilegible) {
      resultado.set(
        repo,
        otra(
          `No se pudo leer entero ${ilegible.ruta} (es muy grande o no es texto). Hay que revisarla a mano.`,
        ),
      );
      continue;
    }
    resultado.set(
      repo,
      clasificarTextosDeLicencia(
        leidos.map((l) => ({ ruta: l.ruta, texto: l.contenido?.texto ?? '' })),
        plantillas,
        repo,
      ),
    );
  }
  return resultado;
}
