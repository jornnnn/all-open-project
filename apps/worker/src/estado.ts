// Salud del robot: GET /api/v1/estado (JSON) y la página interna /estado.
// Solo lee las últimas filas de `runs` (por su índice), así que cuesta unas pocas filas leídas
// aunque la consulte mucha gente.

import { Hono } from 'hono';
import type { Contexto } from './tipos.ts';

/** Si la última ejecución correcta terminó hace más de estas horas, el robot va con retraso. */
export const HORAS_RETRASO = 26;
/** Una ejecución que lleva más de estas horas «en curso» se ha quedado colgada. */
export const HORAS_COLGADA = 2;
/** Hora (UTC) del cron de .github/workflows/robot-diario.yml. */
export const HORA_DEL_ROBOT = { horas: 3, minutos: 17 };
/** Avisos que se enseñan; el resto solo se cuentan. */
const AVISOS_VISIBLES = 30;

export type Salud = 'ok' | 'en-curso' | 'atrasado' | 'error' | 'sin-datos';

export interface Ejecucion {
  id: string;
  estado: 'en-curso' | 'ok' | 'error';
  inicio: string;
  fin: string | null;
  duracion_s: number | null;
  proyectos: number | null;
  errores: string[];
  avisos: number;
  primeros_avisos: string[];
  resumen: Record<string, unknown> | null;
  enlace: string | null;
}

export interface EstadoRobot {
  salud: Salud;
  mensaje: string;
  comprobado: string;
  proxima_ejecucion: string;
  ultima_ejecucion: Ejecucion | null;
  ultima_correcta: Ejecucion | null;
}

interface FilaEjecucion {
  id: string;
  estado: Ejecucion['estado'];
  inicio: string;
  fin: string | null;
  proyectos: number | null;
  errores: string;
  avisos: string;
  resumen: string | null;
  enlace: string | null;
}

const SQL_ULTIMA = `SELECT id, estado, inicio, fin, proyectos, errores, avisos, resumen, enlace
FROM runs WHERE tipo = 'diario' ORDER BY inicio DESC LIMIT 1`;
const SQL_ULTIMA_CORRECTA = `SELECT id, estado, inicio, fin, proyectos, errores, avisos, resumen, enlace
FROM runs WHERE tipo = 'diario' AND estado = 'ok' ORDER BY inicio DESC LIMIT 1`;

function leerFila(fila: FilaEjecucion | undefined): Ejecucion | null {
  if (!fila) return null;
  const avisos = JSON.parse(fila.avisos) as string[];
  const duracion =
    fila.fin === null ? null : Math.round((Date.parse(fila.fin) - Date.parse(fila.inicio)) / 1000);
  return {
    id: fila.id,
    estado: fila.estado,
    inicio: fila.inicio,
    fin: fila.fin,
    duracion_s: duracion,
    proyectos: fila.proyectos,
    errores: JSON.parse(fila.errores) as string[],
    avisos: avisos.length,
    primeros_avisos: avisos.slice(0, AVISOS_VISIBLES),
    resumen: fila.resumen === null ? null : (JSON.parse(fila.resumen) as Record<string, unknown>),
    enlace: fila.enlace,
  };
}

/** Próxima vez que GitHub Actions lanzará el robot (puede retrasarse unos minutos). */
export function proximaEjecucion(ahora: Date): Date {
  const hoy = new Date(
    Date.UTC(
      ahora.getUTCFullYear(),
      ahora.getUTCMonth(),
      ahora.getUTCDate(),
      HORA_DEL_ROBOT.horas,
      HORA_DEL_ROBOT.minutos,
    ),
  );
  return hoy > ahora ? hoy : new Date(hoy.getTime() + 24 * 3600 * 1000);
}

export async function leerEstado(db: D1Database, ahora: Date): Promise<EstadoRobot> {
  const [ultimas, correctas] = await db.batch<FilaEjecucion>([
    db.prepare(SQL_ULTIMA),
    db.prepare(SQL_ULTIMA_CORRECTA),
  ]);
  const ultima = leerFila(ultimas?.results[0]);
  const correcta = leerFila(correctas?.results[0]);
  const base = {
    comprobado: ahora.toISOString(),
    proxima_ejecucion: proximaEjecucion(ahora).toISOString(),
    ultima_ejecucion: ultima,
    ultima_correcta: correcta,
  };
  const horasDesde = (fecha: string) => (ahora.getTime() - Date.parse(fecha)) / 3_600_000;

  if (!ultima) return { ...base, salud: 'sin-datos', mensaje: 'El robot aún no se ha ejecutado.' };
  if (ultima.estado === 'en-curso') {
    if (horasDesde(ultima.inicio) <= HORAS_COLGADA) {
      return { ...base, salud: 'en-curso', mensaje: 'El robot se está ejecutando ahora.' };
    }
    return {
      ...base,
      salud: 'error',
      mensaje: `La última ejecución empezó hace ${Math.round(horasDesde(ultima.inicio))} h y no terminó.`,
    };
  }
  if (ultima.estado === 'error') {
    return {
      ...base,
      salud: 'error',
      mensaje: `La última ejecución falló: ${ultima.errores[0] ?? 'sin detalle'}`,
    };
  }
  const fin = correcta?.fin ?? correcta?.inicio;
  if (!fin || horasDesde(fin) > HORAS_RETRASO) {
    return {
      ...base,
      salud: 'atrasado',
      mensaje: `La última ejecución correcta terminó hace más de ${HORAS_RETRASO} h.`,
    };
  }
  return { ...base, salud: 'ok', mensaje: 'El robot funciona con normalidad.' };
}

export const estado = new Hono<Contexto>();

estado.get('/api/v1/estado', async (c) => {
  const datos = await leerEstado(c.env.DB, new Date());
  return c.json(datos, 200, {
    'cache-control': 'public, max-age=60',
    'access-control-allow-origin': '*',
    'x-robots-tag': 'noindex',
  });
});

estado.get('/estado', async (c) => {
  const datos = await leerEstado(c.env.DB, new Date());
  return c.html(paginaDeEstado(datos), 200, {
    'cache-control': 'public, max-age=60',
    'x-robots-tag': 'noindex',
  });
});

// --- Página -----------------------------------------------------------------------------------

const ETIQUETAS: Record<Salud, string> = {
  ok: 'Todo bien',
  'en-curso': 'Ejecutándose',
  atrasado: 'Con retraso',
  error: 'Con errores',
  'sin-datos': 'Sin datos',
};

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function fecha(iso: string | null, ahora: Date): string {
  if (!iso) return '—';
  const minutos = Math.round((ahora.getTime() - Date.parse(iso)) / 60_000);
  const hace =
    minutos < 0
      ? `dentro de ${horasYMinutos(-minutos)}`
      : minutos < 1
        ? 'ahora mismo'
        : `hace ${horasYMinutos(minutos)}`;
  return `${escapar(iso.replace('T', ' ').slice(0, 16))} UTC <span class="suave">(${hace})</span>`;
}

function horasYMinutos(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `${horas} h ${minutos % 60} min`;
  return `${Math.floor(horas / 24)} días`;
}

function duracion(segundos: number | null): string {
  if (segundos === null) return '—';
  return segundos < 60 ? `${segundos} s` : `${Math.floor(segundos / 60)} min ${segundos % 60} s`;
}

const ESTADOS_DE_EJECUCION: Record<Ejecucion['estado'], string> = {
  ok: 'Correcta',
  'en-curso': 'En curso',
  error: 'Con errores',
};

/** Nombres (singular y plural) para leer los recuentos del resumen que guarda el robot. */
const NOMBRES: Record<string, readonly [string, string]> = {
  'open-source': ['open source', 'open source'],
  'con-limites': ['con límites', 'con límites'],
  otra: ['otra (por revisar)', 'otra (por revisar)'],
  'sin-licencia': ['sin licencia', 'sin licencia'],
  vivo: ['vivo', 'vivos'],
  lento: ['lento', 'lentos'],
  abandonado: ['abandonado', 'abandonados'],
  terminado: ['terminado', 'terminados'],
};

const numero = (n: number) => n.toLocaleString('es-ES');

/** «2485 open source · 418 otra (por revisar)…» a partir de un recuento del resumen. */
function recuento(valor: unknown): string | null {
  if (typeof valor !== 'object' || valor === null) return null;
  const partes = Object.entries(valor)
    .filter((par): par is [string, number] => typeof par[1] === 'number')
    .map(([clave, n]) => {
      const [singular, plural] = NOMBRES[clave] ?? [clave, clave];
      return `${numero(n)} ${escapar(n === 1 ? singular : plural)}`;
    });
  return partes.length > 0 ? partes.join(' · ') : null;
}

function tablaDeEjecucion(titulo: string, e: Ejecucion | null, ahora: Date): string {
  if (!e) return `<section><h2>${titulo}</h2><p class="suave">Ninguna todavía.</p></section>`;
  const filas: [string, string | null][] = [
    ['Estado', ESTADOS_DE_EJECUCION[e.estado]],
    ['Empezó', fecha(e.inicio, ahora)],
    ['Terminó', fecha(e.fin, ahora)],
    ['Duración', duracion(e.duracion_s)],
    ['Proyectos', e.proyectos === null ? '—' : numero(e.proyectos)],
    ['Licencias', recuento(e.resumen?.por_licencia)],
    ['Estado de los proyectos', recuento(e.resumen?.por_estado)],
    ['Errores', String(e.errores.length)],
    ['Avisos', String(e.avisos)],
  ];
  const d1 = e.resumen?.d1 as { filas_escritas?: unknown } | undefined;
  if (typeof d1?.filas_escritas === 'number') {
    filas.push(['Filas escritas en D1', numero(d1.filas_escritas)]);
  }
  if (e.enlace?.startsWith('https://github.com/')) {
    filas.push(['En GitHub', `<a href="${escapar(e.enlace)}">ver la ejecución</a>`]);
  }
  return `<section><h2>${titulo}</h2><table>${filas
    .filter((fila): fila is [string, string] => fila[1] !== null)
    .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
    .join('')}</table></section>`;
}

function lista(titulo: string, elementos: readonly string[], total: number): string {
  if (total === 0) return '';
  const resto =
    total > elementos.length ? `<p class="suave">Y ${total - elementos.length} más.</p>` : '';
  return `<section><h2>${titulo} (${total})</h2><ul>${elementos
    .map((e) => `<li>${escapar(e)}</li>`)
    .join('')}</ul>${resto}</section>`;
}

export function paginaDeEstado(datos: EstadoRobot): string {
  const ahora = new Date(datos.comprobado);
  const ultima = datos.ultima_ejecucion;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" href="data:,">
<title>Estado del robot · All Open Project</title>
<style>
  :root { color-scheme: light dark; --fondo: #0b0d10; --texto: #e7e9ee; --suave: #9aa3b2; --borde: #252a33;
    --ok: #3ecf8e; --aviso: #f5a524; --error: #f2555a; font-family: system-ui, sans-serif; }
  @media (prefers-color-scheme: light) { :root { --fondo: #fbfbfc; --texto: #14171c; --suave: #5b6472; --borde: #e3e6ea; } }
  body { margin: 0; background: var(--fondo); color: var(--texto); line-height: 1.5; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; } h2 { font-size: 1.05rem; margin: 28px 0 8px; }
  .suave { color: var(--suave); } .salud { display: inline-flex; gap: 8px; align-items: center; padding: 6px 12px;
    border: 1px solid var(--borde); border-radius: 999px; font-weight: 600; margin: 16px 0 4px; }
  .punto { width: 10px; height: 10px; border-radius: 50%; background: var(--suave); }
  .ok .punto { background: var(--ok); } .en-curso .punto, .atrasado .punto { background: var(--aviso); }
  .error .punto { background: var(--error); }
  table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 6px 0; border-bottom: 1px solid var(--borde); vertical-align: top; }
  th { width: 34%; color: var(--suave); font-weight: 500; } ul { padding-left: 20px; } li { margin: 4px 0; word-break: break-word; }
  a { color: inherit; }
</style>
</head>
<body>
<main>
  <h1>Estado del robot diario</h1>
  <p class="suave">Cada noche guarda la foto de todo el catálogo. Página interna, sin datos personales.</p>
  <div class="salud ${datos.salud}"><span class="punto"></span>${ETIQUETAS[datos.salud]}</div>
  <p>${escapar(datos.mensaje)}</p>
  <p class="suave">Próxima ejecución prevista: ${fecha(datos.proxima_ejecucion, ahora)}.</p>
  ${tablaDeEjecucion('Última ejecución', ultima, ahora)}
  ${ultima ? lista('Errores', ultima.errores, ultima.errores.length) : ''}
  ${ultima ? lista('Avisos', ultima.primeros_avisos, ultima.avisos) : ''}
  ${datos.ultima_correcta && datos.ultima_correcta.id !== ultima?.id ? tablaDeEjecucion('Última ejecución correcta', datos.ultima_correcta, ahora) : ''}
  <p class="suave">Comprobado: ${fecha(datos.comprobado, ahora)} · <a href="/api/v1/estado">versión JSON</a></p>
</main>
</body>
</html>`;
}
