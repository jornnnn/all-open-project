import { env } from 'cloudflare:test';
import app from '../src/index.ts';
import type { Entorno } from '../src/tipos.ts';

export const CLAVE = 'clave-de-prueba';

/** Un proyecto como los que manda el robot (formato de data/export/proyectos.json). */
export function proyecto(id: number, cambios: Record<string, unknown> = {}) {
  return {
    id,
    repo: `ana/proyecto-${id}`,
    descripcion: `Editor de fotos número ${id}`,
    web: null,
    lenguaje: 'Rust',
    topics: ['photo-editor', 'image'],
    temas: ['edicion-de-fotos', 'dibujo-y-diseno'],
    area: 'fotos',
    publico: 'usar',
    estrellas: 1000 + id,
    forks: 10,
    issues_abiertas: 3,
    issues_cerradas: 40,
    creado: '2020-01-01T00:00:00Z',
    ultimo_push: '2026-10-15T08:00:00Z',
    ultimo_cambio: '2026-10-15T07:59:00Z',
    archivado: false,
    estado: 'vivo',
    licencia_github: 'MIT',
    licencia: 'open-source',
    licencias: ['MIT'],
    licencia_motivo: null,
    organizacion_verificada: true,
    oficial: null,
    version: { nombre: 'v1.0.0', fecha: '2026-09-01T00:00:00Z', descargas: 1234 },
    instaladores: { windows: ['visor.exe'], mac: [], linux: [], android: [] },
    sistemas: ['windows'],
    estrellas_por_dia: null,
    puntuacion: 70,
    puntuacion_detalle: {
      popularidad: 60,
      impulso: null,
      salud: 90,
      uso: null,
      penalizaciones: [],
      grupo: 'edicion-de-fotos',
    },
    origen: ['busqueda'],
    ...cambios,
  };
}

interface Opciones {
  metodo?: string;
  cuerpo?: unknown;
  clave?: string | null;
  entorno?: Partial<Entorno>;
}

/** Llama al Worker como lo haría el robot (con la clave) o un visitante (clave: null). */
export async function pedir(
  ruta: string,
  { metodo, cuerpo, clave = CLAVE, entorno }: Opciones = {},
) {
  const cabeceras = new Headers();
  if (clave !== null) cabeceras.set('authorization', `Bearer ${clave}`);
  const init: RequestInit = {
    method: metodo ?? (cuerpo === undefined ? 'GET' : 'POST'),
    headers: cabeceras,
  };
  if (cuerpo !== undefined) {
    init.body = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    cabeceras.set('content-type', 'application/json');
  }
  return app.fetch(new Request(`https://worker.test${ruta}`, init), { ...env, ...entorno });
}

export async function vaciarTablas() {
  await env.DB.batch(
    [
      'snapshots',
      'texts',
      'alerts',
      'projects',
      'runs',
      'hourly',
      'candidates',
      'radar',
      'auge',
      'ingesta_lotes',
    ].map((tabla) => env.DB.prepare(`DELETE FROM ${tabla}`)),
  );
}

/** Envuelve D1 para contar cuántas consultas hace el Worker en una petición. */
export function contarConsultas(db: D1Database) {
  const cuenta = { consultas: 0 };
  const reales = new WeakMap<object, D1PreparedStatement>();
  const envolver = (sentencia: D1PreparedStatement): D1PreparedStatement => {
    const sustituta = new Proxy(sentencia, {
      get(objetivo, propiedad, receptor) {
        if (propiedad === 'bind') {
          return (...valores: unknown[]) => envolver(objetivo.bind(...valores));
        }
        if (
          propiedad === 'run' ||
          propiedad === 'first' ||
          propiedad === 'all' ||
          propiedad === 'raw'
        ) {
          return (...argumentos: unknown[]) => {
            cuenta.consultas++;
            const metodo = objetivo[propiedad] as (...a: unknown[]) => unknown;
            return metodo.apply(objetivo, argumentos);
          };
        }
        return Reflect.get(objetivo, propiedad, receptor);
      },
    });
    reales.set(sustituta, sentencia);
    return sustituta;
  };
  const envuelta = {
    prepare: (sql: string) => envolver(db.prepare(sql)),
    batch: (sentencias: D1PreparedStatement[]) => {
      cuenta.consultas += sentencias.length;
      return db.batch(sentencias.map((s) => reales.get(s) ?? s));
    },
  } as unknown as D1Database;
  return { db: envuelta, cuenta };
}
