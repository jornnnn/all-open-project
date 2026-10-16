// Herramienta para mantener data/taxonomia.yaml: cuántos repos tiene un topic y cuáles son los primeros.
// Uso: pnpm --filter @aop/jobs run explorar -- photo-editor image-editor [--top 5] [--estrellas 100]

import { parseArgs } from 'node:util';
import { sumarMeses } from '@aop/core';
import { buscarRepos, crearCliente, obtenerToken } from './lib/github.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    top: { type: 'string', default: '5' },
    estrellas: { type: 'string', default: '100' },
    meses: { type: 'string', default: '12' },
  },
});

if (positionals.length === 0) {
  console.error('Indica uno o más topics. Ej.: explorar-topics.ts photo-editor image-editor');
  process.exit(1);
}

const desde = sumarMeses(new Date(), -Number(values.meses)).toISOString().slice(0, 10);
const filtros = `fork:false archived:false stars:>=${values.estrellas} pushed:>=${desde} sort:stars-desc`;
const cliente = crearCliente(await obtenerToken(), { pausaMs: 500 });
const consultas = positionals.map((topic) => `topic:${topic} ${filtros}`);
const resultados = await buscarRepos(cliente, consultas, Number(values.top));

positionals.forEach((topic, i) => {
  const resultado = resultados.get(consultas[i] ?? '');
  const primeros = (resultado?.repos ?? []).map((r) => `${r.repo} (${r.estrellas})`).join(', ');
  console.log(`${topic.padEnd(32)} ${String(resultado?.total ?? 0).padStart(6)}  ${primeros}`);
});
