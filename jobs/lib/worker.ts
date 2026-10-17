// Cliente del Worker para el robot: envía los datos a /ingest con la clave compartida.

import type { ProyectoCatalogo } from '@aop/core';
import type { Referencia } from './catalogo.ts';

/**
 * Tamaño máximo de cada envío de proyectos. El plan gratuito da al Worker 10 ms de CPU por
 * petición; medido el 17-oct-2026 en Cloudflare: 8-9 ms con lotes de 450 KB, 3-4 ms con 250 KB y
 * 1-2 ms con 150 KB. Con 200 KB queda margen aunque el Worker arranque en frío.
 */
export const LOTE_MAXIMO_BYTES = 200_000;

export interface DatosEjecucion {
  id: string;
  tipo: 'diario';
  estado: 'en-curso' | 'ok' | 'error';
  inicio: string;
  fin?: string;
  proyectos?: number;
  errores?: string[];
  avisos?: string[];
  resumen?: Record<string, unknown>;
  enlace?: string;
}

export interface Medida {
  lotes: number;
  filas_escritas: number;
  filas_leidas: number;
}

export interface ClienteWorker {
  ejecucion(datos: DatosEjecucion): Promise<void>;
  /** Foto más antigua de cada proyecto activo entre `desde` y `hasta` (sin incluir `hasta`). */
  historial(desde: string, hasta: string): Promise<Map<number, Referencia>>;
  proyectos(fecha: string, proyectos: readonly ProyectoCatalogo[]): Promise<Medida>;
  /** Da de baja los proyectos activos que no estén en la lista. */
  cierre(ids: readonly number[]): Promise<{ bajas: number }>;
}

const dormir = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

/**
 * Parte una lista en arrays JSON que no pasan de `maximo` bytes (UTF-8). Falla si un solo elemento
 * ya los pasa, porque D1 no lo aceptaría.
 */
export function trocearPorTamano<T>(elementos: readonly T[], maximo: number): string[] {
  const lotes: string[] = [];
  let actual: string[] = [];
  let bytes = 2; // los corchetes
  for (const elemento of elementos) {
    const json = JSON.stringify(elemento);
    const tamano = Buffer.byteLength(json, 'utf8');
    if (tamano + 2 > maximo)
      throw new Error(`Un elemento ocupa ${tamano} bytes y el máximo es ${maximo}`);
    if (actual.length > 0 && bytes + 1 + tamano > maximo) {
      lotes.push(`[${actual.join(',')}]`);
      actual = [];
      bytes = 2;
    }
    bytes += (actual.length > 0 ? 1 : 0) + tamano;
    actual.push(json);
  }
  if (actual.length > 0) lotes.push(`[${actual.join(',')}]`);
  return lotes;
}

export function crearClienteWorker(
  url: string,
  clave: string,
  { reintentos = 3, esperaMs = 2000 }: { reintentos?: number; esperaMs?: number } = {},
): ClienteWorker {
  const base = url.replace(/\/+$/, '');

  async function pedir<T>(ruta: string, cuerpo?: string): Promise<T> {
    for (let intento = 0; ; intento++) {
      let respuesta: Response;
      try {
        respuesta = await fetch(`${base}${ruta}`, {
          method: cuerpo === undefined ? 'GET' : 'POST',
          headers: {
            authorization: `Bearer ${clave}`,
            'content-type': 'application/json',
            'user-agent': 'all-open-project-robot',
          },
          ...(cuerpo === undefined ? {} : { body: cuerpo }),
        });
      } catch (error) {
        if (intento >= reintentos)
          throw new Error(`No se pudo llamar al Worker (${ruta}): ${error}`);
        await dormir(esperaMs * 2 ** intento);
        continue;
      }
      if ((respuesta.status >= 500 || respuesta.status === 429) && intento < reintentos) {
        await dormir(esperaMs * 2 ** intento);
        continue;
      }
      const texto = await respuesta.text();
      if (!respuesta.ok) {
        let detalle = texto.slice(0, 500);
        try {
          detalle = (JSON.parse(texto) as { error?: string }).error ?? detalle;
        } catch {
          // No es JSON: se deja el texto.
        }
        throw new Error(`El Worker respondió ${respuesta.status} en ${ruta}: ${detalle}`);
      }
      return JSON.parse(texto) as T;
    }
  }

  return {
    async ejecucion(datos) {
      await pedir('/ingest/ejecucion', JSON.stringify(datos));
    },
    async historial(desde, hasta) {
      const filas = await pedir<[number, string, number][]>(
        `/ingest/historial?desde=${desde}&hasta=${hasta}`,
      );
      return new Map(filas.map(([id, fecha, estrellas]) => [id, { fecha, estrellas }]));
    },
    async proyectos(fecha, proyectos) {
      const medida: Medida = { lotes: 0, filas_escritas: 0, filas_leidas: 0 };
      for (const lote of trocearPorTamano(proyectos, LOTE_MAXIMO_BYTES)) {
        const r = await pedir<{ filas_escritas: number; filas_leidas: number }>(
          `/ingest/proyectos?fecha=${fecha}`,
          lote,
        );
        medida.lotes++;
        medida.filas_escritas += r.filas_escritas;
        medida.filas_leidas += r.filas_leidas;
      }
      return medida;
    },
    async cierre(ids) {
      return pedir<{ bajas: number }>('/ingest/cierre', JSON.stringify(ids));
    },
  };
}
