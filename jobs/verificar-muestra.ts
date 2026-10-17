// Comprueba que D1 dice lo mismo que GitHub: toma proyectos al azar y compara sus cifras con la API
// REST de GitHub (un camino distinto del que usa el robot, que es GraphQL).
// - Estrellas: como mucho un 1 % de diferencia (cambian a lo largo del día).
// - Fechas: exactas. Si en GitHub son posteriores a la foto, es que el proyecto cambió después y
//   también vale (se indica).
//
// Uso: pnpm --filter @aop/jobs run verificar            D1 de Cloudflare (necesita wrangler login)
//      pnpm --filter @aop/jobs run verificar -- --local D1 local de wrangler dev
//      … -- --muestra 50                                otro tamaño de muestra

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { crearCliente, obtenerToken } from './lib/github.ts';

const { values: opciones } = parseArgs({
  options: {
    local: { type: 'boolean', default: false },
    muestra: { type: 'string', default: '20' },
  },
});
const DIR_WORKER = resolve(import.meta.dirname, '../apps/worker');
const WRANGLER = resolve(DIR_WORKER, 'node_modules/wrangler/bin/wrangler.js');
const MARGEN_ESTRELLAS = 0.01;

/** Consulta D1 con wrangler (sin pasar por el código del Worker). */
function consultarD1<T>(sql: string): T[] {
  const r = spawnSync(
    process.execPath,
    [
      WRANGLER,
      'd1',
      'execute',
      'DB',
      opciones.local ? '--local' : '--remote',
      '--json',
      '--command',
      sql,
    ],
    { cwd: DIR_WORKER, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`wrangler falló: ${r.stderr || r.stdout}`);
  const salida = JSON.parse(r.stdout) as { results: T[] }[];
  return salida[0]?.results ?? [];
}

interface Fila {
  repo: string;
  estrellas: number;
  creado: string;
  ultimo_push: string | null;
  ultimo_cambio: string;
  archivado: number;
  version: string | null;
  version_fecha: string | null;
  actualizado: string;
  foto_fecha: string;
  foto_estrellas: number;
}

const [totales] = consultarD1<{ activos: number; ultimo_dia: string; fotos_ultimo_dia: number }>(
  `SELECT (SELECT count(*) FROM projects WHERE activo = 1) AS activos,
          (SELECT max(fecha) FROM snapshots) AS ultimo_dia,
          (SELECT count(*) FROM snapshots WHERE fecha = (SELECT max(fecha) FROM snapshots)) AS fotos_ultimo_dia`,
);
console.log(
  `D1 (${opciones.local ? 'local' : 'Cloudflare'}): ${totales?.activos} proyectos activos; ${totales?.fotos_ultimo_dia} fotos del ${totales?.ultimo_dia}.`,
);

const filas = consultarD1<Fila>(
  `SELECT p.repo, p.estrellas, p.creado, p.ultimo_push, p.ultimo_cambio, p.archivado, p.version,
          p.version_fecha, p.actualizado, s.fecha AS foto_fecha, s.estrellas AS foto_estrellas
   FROM projects AS p
   JOIN snapshots AS s ON s.project_id = p.id
     AND s.fecha = (SELECT max(fecha) FROM snapshots WHERE project_id = p.id)
   WHERE p.activo = 1
   ORDER BY random() LIMIT ${Number(opciones.muestra)}`,
);

const cliente = crearCliente(await obtenerToken(), { pausaMs: 200 });
interface RepoRest {
  full_name: string;
  stargazers_count: number;
  created_at: string;
  pushed_at: string;
  archived: boolean;
  default_branch: string;
}

let fallos = 0;
const lineas: string[] = [];
for (const fila of filas) {
  const gh = await cliente.rest<RepoRest>(`/repos/${fila.repo}`);
  if (!gh) {
    fallos++;
    lineas.push(`✗ ${fila.repo}: ya no existe en GitHub`);
    continue;
  }
  const commit = await cliente.rest<{ commit: { committer: { date: string } } }>(
    `/repos/${gh.full_name}/commits/${encodeURIComponent(gh.default_branch)}`,
  );
  const version = await cliente.rest<{ tag_name: string; published_at: string }>(
    `/repos/${gh.full_name}/releases/latest`,
  );

  const problemas: string[] = [];
  const notas: string[] = [];
  const diferencia =
    Math.abs(gh.stargazers_count - fila.estrellas) / Math.max(1, gh.stargazers_count);
  if (diferencia > MARGEN_ESTRELLAS)
    problemas.push(`estrellas ${fila.estrellas} ≠ ${gh.stargazers_count}`);
  if (fila.foto_estrellas !== fila.estrellas)
    problemas.push('la foto del día no coincide con la ficha');
  if (fila.creado !== gh.created_at) problemas.push(`creado ${fila.creado} ≠ ${gh.created_at}`);
  if (Boolean(fila.archivado) !== gh.archived) problemas.push('archivado distinto');

  // Una fecha posterior en GitHub significa que el proyecto cambió después de la foto.
  const comparar = (nombre: string, nuestra: string | null, suya: string | null) => {
    if (nuestra === suya) return;
    if (suya !== null && (nuestra === null || suya > nuestra) && suya > fila.actualizado) {
      notas.push(`${nombre} cambió después de la foto`);
      return;
    }
    problemas.push(`${nombre} ${nuestra} ≠ ${suya}`);
  };
  comparar('último cambio', fila.ultimo_cambio, commit?.commit.committer.date ?? null);
  comparar('último push', fila.ultimo_push, gh.pushed_at);
  comparar('versión', fila.version_fecha, version?.published_at ?? null);

  if (problemas.length > 0) fallos++;
  const signo = problemas.length > 0 ? '✗' : '✓';
  const estrellas = `${fila.estrellas} / ${gh.stargazers_count} (${(diferencia * 100).toFixed(2)} %)`;
  const fechas = `fechas (creado, último cambio${version ? ', versión' : ''})`;
  const resultado =
    problemas.length > 0 ? `diferencias: ${problemas.join('; ')}` : `${fechas} iguales`;
  const despues = notas.length > 0 ? ` (${notas.join('; ')})` : '';
  lineas.push(
    `${signo} ${fila.repo.padEnd(42)} estrellas ${estrellas.padEnd(28)} ${resultado}${despues}`,
  );
}
console.log(lineas.join('\n'));
console.log(
  fallos === 0
    ? `\nLos ${filas.length} proyectos de la muestra coinciden con GitHub.`
    : `\n${fallos} de ${filas.length} proyectos no coinciden.`,
);
process.exit(fallos === 0 ? 0 : 1);
