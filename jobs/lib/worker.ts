// Cliente del Worker para el robot: envía los datos a /ingest con la clave compartida.

import type { ProyectoCatalogo } from '@aop/core';
import type { Referencia } from './catalogo.ts';
import type { CambioDeAuge, Candidato, HoraGuardada } from './radar.ts';

/**
 * Tamaño máximo de cada envío de proyectos. El plan gratuito da al Worker 10 ms de CPU por
 * petición; medido el 17-oct-2026 en Cloudflare: 8-9 ms con lotes de 450 KB, 3-4 ms con 250 KB y
 * 1-2 ms con 150 KB. Con 200 KB queda margen aunque el Worker arranque en frío.
 */
export const LOTE_MAXIMO_BYTES = 200_000;
/** Tiempo máximo de cada petición al Worker (las del robot tardan unos segundos). */
const TIEMPO_MAXIMO_MS = 120_000;

export interface DatosEjecucion {
  id: string;
  tipo: 'diario' | 'radar';
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

/** Lo que el radar lee al empezar (GET /ingest/radar/estado). */
export interface EstadoDelRadar {
  candidatos: Candidato[];
  /** [tipo, repo_id, estado] de cada alerta que ya existe. */
  alertas: [string, number, string][];
  /** Memoria y tendencias guardadas. */
  radar: { memoria?: unknown; tendencias?: unknown };
  /** [hora, momento, repos] de las horas guardadas desde la pedida. */
  horas: [string, string, number][];
  /** Última ejecución del radar. */
  ultima: {
    id: string;
    estado: 'en-curso' | 'ok' | 'error';
    inicio: string;
    fin: string | null;
  } | null;
}

/** Lo que guarda el radar al terminar (POST /ingest/radar/guardar). */
export interface CambiosDelRadar {
  hora?: HoraGuardada & { repos: number };
  borrar_horas_antes_de?: string;
  candidatos?: Candidato[];
  radar?: Record<string, unknown>;
  auge?: CambioDeAuge[];
  alertas?: { repo: string; repo_id: number; original_id: number; evidencia: unknown }[];
  purgar_descartados_antes_de?: string;
}

/** Candidato que ha entrado en el catálogo (para el robot diario). */
export interface Aceptado {
  id: number;
  repo: string;
  temas: string[] | null;
}

/** Tamaño máximo de lo que guarda el radar de una vez: el Worker lo pasa a D1 sin leerlo. */
export const RADAR_MAXIMO_BYTES = 1_500_000;

export interface ClienteWorker {
  ejecucion(datos: DatosEjecucion): Promise<void>;
  /** Estado del radar: candidatos, alertas, memoria y horas guardadas desde `desde` (AAAA-MM-DDTHH). */
  radarEstado(desde: string): Promise<EstadoDelRadar>;
  /** Estrellas guardadas de una hora; null si no hay. */
  radarHora(hora: string): Promise<HoraGuardada | null>;
  radarGuardar(cambios: CambiosDelRadar): Promise<{ filas_escritas: number; filas_leidas: number }>;
  /** Candidatos del radar que han entrado en el catálogo. */
  aceptados(): Promise<Aceptado[]>;
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

  async function pedir<T>(ruta: string, cuerpo?: string, { ausente = false } = {}): Promise<T> {
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
          // Si el Worker no contesta, mejor reintentar que quedarse esperando para siempre.
          signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
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
      if (ausente && respuesta.status === 404) return null as T;
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
    radarEstado(desde) {
      return pedir<EstadoDelRadar>(`/ingest/radar/estado?desde=${desde}`);
    },
    radarHora(hora) {
      return pedir<HoraGuardada | null>(`/ingest/radar/hora/${hora}`, undefined, { ausente: true });
    },
    async radarGuardar(cambios) {
      const cuerpo = JSON.stringify(cambios);
      const bytes = Buffer.byteLength(cuerpo, 'utf8');
      if (bytes > RADAR_MAXIMO_BYTES) {
        throw new Error(
          `Lo que guarda el radar ocupa ${bytes} bytes; el máximo es ${RADAR_MAXIMO_BYTES}`,
        );
      }
      return pedir<{ filas_escritas: number; filas_leidas: number }>(
        '/ingest/radar/guardar',
        cuerpo,
      );
    },
    async aceptados() {
      // Si el Worker aún no tiene el radar (se despliega aparte), el robot diario sigue sin él.
      return (
        (await pedir<Aceptado[] | null>('/ingest/radar/aceptados', undefined, { ausente: true })) ??
        []
      );
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
