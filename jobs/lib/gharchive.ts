// GH Archive (https://www.gharchive.org): un archivo por hora con una muestra de la actividad
// pública de GitHub. Comprobado el 17-oct-2026: ~5.600 eventos y ~400 estrellas por hora en todo
// GitHub, cuando REA ganaba ~790 estrellas a la hora y en la muestra salían 15 (un 2 %). Por eso es
// solo una pista para encontrar lo que se dispara: las cifras salen siempre de la API de GitHub.
//
// Algunas horas traen líneas cortadas (2 en la hora 2026-10-17-8): se saltan.

import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import type { ReadableStream as StreamWeb } from 'node:stream/web';
import { createGunzip } from 'node:zlib';

export const URL_GHARCHIVE = 'https://data.gharchive.org';
/** Un repo es pista si en la muestra de una hora tiene al menos estas estrellas. */
export const ESTRELLAS_PISTA = 2;

/** Nombre del archivo de la hora que empieza en `momento` (UTC): 2026-10-17-9 (sin cero delante). */
export function nombreDeHora(momento: Date): string {
  return `${momento.toISOString().slice(0, 10)}-${momento.getUTCHours()}`;
}

export interface Pista {
  /** Id de GitHub del repo. */
  id: number;
  repo: string;
  /** Estrellas en la muestra (no son todas las que ganó). */
  estrellas: number;
}

export interface HoraDeGharchive {
  hora: string;
  eventos: number;
  /** Estrellas (WatchEvent) en la muestra. */
  estrellas: number;
  /** Líneas que no se han podido leer. */
  rotas: number;
  /** Repos con al menos ESTRELLAS_PISTA estrellas en la muestra, de más a menos. */
  pistas: Pista[];
}

/** Cuenta las estrellas de cada repo en las líneas de una hora (JSON, una por línea). */
export async function contarEstrellas(
  hora: string,
  lineas: AsyncIterable<string> | Iterable<string>,
): Promise<HoraDeGharchive> {
  const porRepo = new Map<number, Pista>();
  let eventos = 0;
  let estrellas = 0;
  let rotas = 0;
  for await (const linea of lineas) {
    if (!linea.trim()) continue;
    let evento: { type?: string; repo?: { id?: number; name?: string } };
    try {
      evento = JSON.parse(linea);
    } catch {
      rotas++;
      continue;
    }
    eventos++;
    if (evento.type !== 'WatchEvent') continue;
    estrellas++;
    const id = evento.repo?.id;
    const repo = evento.repo?.name;
    if (typeof id !== 'number' || typeof repo !== 'string') continue;
    const pista = porRepo.get(id) ?? { id, repo, estrellas: 0 };
    pista.estrellas++;
    porRepo.set(id, pista);
  }
  const pistas = [...porRepo.values()]
    .filter((p) => p.estrellas >= ESTRELLAS_PISTA)
    .sort((a, b) => b.estrellas - a.estrellas || a.id - b.id);
  return { hora, eventos, estrellas, rotas, pistas };
}

/**
 * Descarga y lee una hora de GH Archive (unos 7 MB comprimidos). Devuelve null si aún no está
 * publicada (suele tardar unos minutos después de la hora).
 */
export async function leerHora(hora: string): Promise<HoraDeGharchive | null> {
  const respuesta = await fetch(`${URL_GHARCHIVE}/${hora}.json.gz`, {
    headers: { 'user-agent': 'all-open-project-radar' },
    signal: AbortSignal.timeout(120_000),
  });
  if (respuesta.status === 404) return null;
  if (!respuesta.ok || !respuesta.body) {
    throw new Error(`GH Archive respondió ${respuesta.status} con la hora ${hora}`);
  }
  const datos = Readable.fromWeb(respuesta.body as StreamWeb<Uint8Array>).pipe(createGunzip());
  return contarEstrellas(
    hora,
    createInterface({ input: datos, crlfDelay: Number.POSITIVE_INFINITY }),
  );
}
