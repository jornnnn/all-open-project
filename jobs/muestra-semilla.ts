// Muestra para revisar data/semilla.generada.json: una tabla de proyectos al azar, repartidos entre
// áreas, y (con --temas) la lista de áreas y subtemas con cuántos proyectos tiene cada uno.
// Uso: pnpm --filter @aop/jobs run muestra -- [--cuantos 20] [--semilla 2026] [--temas]

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { CategoriaLicencia, Estado } from '@aop/core';
import { cargarDatos, DIR_DATOS } from './lib/datos.ts';
import type { ProyectoSemilla } from './lib/seleccion.ts';

const { values } = parseArgs({
  options: {
    cuantos: { type: 'string', default: '20' },
    semilla: { type: 'string', default: '2026' },
    temas: { type: 'boolean', default: false },
  },
});

const LICENCIAS: Record<CategoriaLicencia, string> = {
  'open-source': 'Open source',
  'con-limites': 'Con límites',
  otra: 'Otra (revisar)',
  'sin-licencia': 'Sin licencia',
};
const ORIGENES: Record<string, string> = { busqueda: 'búsqueda', alta: 'alta manual' };
const ESTADOS: Record<Estado, string> = {
  vivo: 'Vivo',
  lento: 'Lento',
  abandonado: 'Abandonado',
  terminado: 'Terminado',
};

const { taxonomia } = await cargarDatos();
const archivo = JSON.parse(await readFile(resolve(DIR_DATOS, 'semilla.generada.json'), 'utf8')) as {
  generado: string;
  proyectos: ProyectoSemilla[];
};
const { proyectos } = archivo;

const subtemas = new Map(
  taxonomia.areas.flatMap((area) => area.subtemas.map((s) => [s.id, { ...s, area }] as const)),
);
const cifra = (n: number) => new Intl.NumberFormat('es-ES', { useGrouping: 'always' }).format(n);
const corto = (texto: string | null, max: number) =>
  !texto ? '—' : texto.length > max ? `${texto.slice(0, max - 1).trimEnd()}…` : texto;
const celda = (texto: string) => texto.replaceAll('|', '\\|').replaceAll('\n', ' ');

if (values.temas) {
  console.log(`| Área | Subtema | Proyectos | Como tema principal |`);
  console.log('|---|---|--:|--:|');
  for (const area of taxonomia.areas) {
    for (const subtema of area.subtemas) {
      const total = proyectos.filter((p) => p.temas.includes(subtema.id)).length;
      const principal = proyectos.filter((p) => p.temas[0] === subtema.id).length;
      console.log(`| ${area.nombre.es} | ${subtema.nombre.es} | ${total} | ${principal} |`);
    }
  }
  process.exit(0);
}

// Generador pseudoaleatorio con semilla (mulberry32): la misma semilla da la misma muestra.
let estado = Number(values.semilla) >>> 0;
const azar = () => {
  estado = (estado + 0x6d2b79f5) >>> 0;
  let t = estado;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Reparto por áreas, por turnos, en el orden de la taxonomía.
const porArea = new Map(taxonomia.areas.map((a) => [a.id, [] as ProyectoSemilla[]]));
for (const p of proyectos) porArea.get(subtemas.get(p.temas[0] ?? '')?.area.id ?? '')?.push(p);
const muestra: ProyectoSemilla[] = [];
const cuantos = Math.min(Number(values.cuantos), proyectos.length);
while (muestra.length < cuantos) {
  for (const grupo of porArea.values()) {
    if (muestra.length >= cuantos || grupo.length === 0) continue;
    muestra.push(...grupo.splice(Math.floor(azar() * grupo.length), 1));
  }
}

console.log(
  `Muestra de ${cuantos} de ${cifra(proyectos.length)} proyectos (datos de ${archivo.generado.slice(0, 10)})\n`,
);
console.log(
  '| # | Proyecto | Qué dice ser | Tema principal | Estrellas | Licencia | Estado | Origen |',
);
console.log('|--:|---|---|---|--:|---|---|---|');
muestra.forEach((p, i) => {
  const subtema = subtemas.get(p.temas[0] ?? '');
  const tema = subtema ? `${subtema.area.nombre.es} › ${subtema.nombre.es}` : '—';
  const licencia = `${LICENCIAS[p.categoria_licencia]}${p.licencia && p.licencia !== 'NOASSERTION' ? ` (${p.licencia})` : ''}`;
  const origen = p.origen.map((o) =>
    o.startsWith('alternativa:') ? `alternativa a ${o.slice(12)}` : (ORIGENES[o] ?? o),
  );
  const filas = [
    String(i + 1),
    `[${p.repo}](https://github.com/${p.repo})`,
    celda(corto(p.descripcion, 70)),
    tema,
    cifra(p.estrellas),
    licencia,
    ESTADOS[p.estado],
    origen.join(', '),
  ];
  console.log(`| ${filas.join(' | ')} |`);
});
