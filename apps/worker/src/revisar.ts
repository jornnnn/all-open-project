// Página de revisión: las posibles copias falsas y los proyectos nuevos que el radar propone para el
// catálogo. Es otro Worker (wrangler.revisar.jsonc, entrada en src/revisar-worker.ts), con la misma
// base de datos, protegido entero con Cloudflare Access: el Worker público no tiene estas rutas.
//
// Ninguna alerta se publica sin que una persona la apruebe aquí. La página no abre si:
// - la petición no ha pasado por Cloudflare Access (ctx.access lo pone Cloudflare, no se puede
//   falsificar desde fuera);
// - o el correo de quien entra no está en REVISORES (un secreto, para no publicar correos).

// Solo la parte de las copias: así el Worker no carga todo el núcleo (listas de licencias, zod…).
import { type EvidenciaCopia, horasDeLaMedida, motivosDeCopia } from '@aop/core/copias';
import { Hono } from 'hono';
import type { Contexto } from './tipos.ts';

type ContextoRevision = Contexto & { Variables: { revisor: string; correo: string } };

export const SQL_PENDIENTES = `SELECT id, repo, creada, evidencia FROM alerts
WHERE estado = 'pendiente' ORDER BY creada DESC LIMIT 50`;
export const SQL_REVISADAS = `SELECT id, repo, estado, revisada, nota, evidencia FROM alerts
WHERE estado != 'pendiente' ORDER BY revisada DESC LIMIT 10`;
export const SQL_PROPUESTOS = `SELECT id, repo, estrellas, creado, actualizado, datos FROM candidates
WHERE estado = 'propuesto' ORDER BY estrellas DESC LIMIT 50`;
export const SQL_ENTRADOS = `SELECT id, repo, estrellas, creado, actualizado, datos FROM candidates
WHERE estado = 'aceptado' ORDER BY actualizado DESC LIMIT 20`;
export const SQL_SIN_TEMA = `SELECT id, repo, estrellas, actualizado FROM candidates
WHERE estado = 'descartado' AND json_extract(datos, '$.motivo') LIKE '%añadirlo a mano%'
ORDER BY actualizado DESC LIMIT 20`;
/** Solo cambia una alerta pendiente: lo ya revisado no se puede volver a decidir aquí. */
export const SQL_DECIDIR = `UPDATE alerts SET estado = ?2, revisada = ?3, revisada_por = ?4, nota = ?5
WHERE id = ?1 AND estado = 'pendiente'`;
/**
 * Decisión de una persona sobre un candidato (?3: aceptar, rechazar o sacar): pasa a ?4 si estaba
 * en ?5. Queda en datos.persona, y el radar ya no lo vuelve a cambiar.
 */
export const SQL_DECIDIR_CANDIDATO = `UPDATE candidates SET estado = ?4, actualizado = ?2,
  datos = json_set(coalesce(datos, '{}'), '$.persona', json_object('decision', ?3, 'fecha', ?2))
WHERE id = ?1 AND estado = ?5`;

/** Qué hace cada botón con un candidato: [estado en el que tiene que estar, estado al que pasa]. */
const DECISIONES_CANDIDATO = {
  aceptar: ['propuesto', 'aceptado'],
  rechazar: ['propuesto', 'descartado'],
  sacar: ['aceptado', 'descartado'],
} as const;

const CABECERAS = {
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
};

export const revisar = new Hono<ContextoRevision>();

revisar.use('*', async (c, next) => {
  await next();
  // Copia de la respuesta, por si sus cabeceras no se pueden cambiar (las de una redirección).
  c.res = new Response(c.res.body, c.res);
  for (const [nombre, valor] of Object.entries(CABECERAS)) c.res.headers.set(nombre, valor);
});

/** Quién revisa: solo con Cloudflare Access y con el correo en REVISORES. */
revisar.use('*', async (c, next) => {
  // El tipo de Hono no incluye ctx.access; el de Cloudflare (ExecutionContext), sí.
  const access = (c.executionCtx as unknown as ExecutionContext).access;
  if (!access) {
    return c.html(aviso('Esta página solo se abre a través de Cloudflare Access.'), 403);
  }
  const permitidos = (c.env.REVISORES ?? '')
    .split(',')
    .map((correo) => correo.trim().toLowerCase())
    .filter(Boolean);
  if (permitidos.length === 0) {
    return c.html(aviso('Falta decir quién puede revisar (el secreto REVISORES).'), 503);
  }
  const correo = (await access.getIdentity())?.email?.toLowerCase();
  if (!correo || !permitidos.includes(correo)) {
    return c.html(aviso('Tu cuenta no puede revisar alertas.'), 403);
  }
  c.set('correo', correo);
  // En la base de datos no se guarda el correo, solo una huella: basta para saber quién decidió.
  c.set('revisor', `persona:${(await huella(correo)).slice(0, 12)}`);
  return next();
});

/** Los formularios solo valen desde esta misma página (protección contra CSRF). */
revisar.use('*', async (c, next) => {
  if (c.req.method === 'POST') {
    const origen = c.req.header('origin');
    const sitio = c.req.header('sec-fetch-site');
    if (origen !== new URL(c.req.url).origin || (sitio !== undefined && sitio !== 'same-origin')) {
      return c.html(aviso('Ese envío no viene de esta página.'), 403);
    }
  }
  return next();
});

revisar.get('/', async (c) => {
  const db = c.env.DB;
  const [pendientes, revisadas, propuestos, entrados, sinTema] = await db.batch<
    Record<string, unknown>
  >([
    db.prepare(SQL_PENDIENTES),
    db.prepare(SQL_REVISADAS),
    db.prepare(SQL_PROPUESTOS),
    db.prepare(SQL_ENTRADOS),
    db.prepare(SQL_SIN_TEMA),
  ]);
  return c.html(
    pagina({
      correo: c.get('correo'),
      hecho: c.req.query('hecho') ?? null,
      pendientes: (pendientes?.results ?? []) as unknown as FilaAlerta[],
      revisadas: (revisadas?.results ?? []) as unknown as FilaRevisada[],
      propuestos: (propuestos?.results ?? []) as unknown as FilaCandidato[],
      entrados: (entrados?.results ?? []) as unknown as FilaCandidato[],
      sinTema: (sinTema?.results ?? []) as unknown as FilaCandidato[],
      ahora: new Date(),
    }),
  );
});

revisar.post('/alertas/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const formulario = await c.req.parseBody();
  const decision = formulario.decision;
  const nota = typeof formulario.nota === 'string' ? formulario.nota.trim().slice(0, 500) : '';
  if (!Number.isInteger(id) || (decision !== 'publicar' && decision !== 'descartar')) {
    return c.html(aviso('Decisión no válida.'), 400);
  }
  const estado = decision === 'publicar' ? 'publicada' : 'descartada';
  const r = await c.env.DB.prepare(SQL_DECIDIR)
    .bind(id, estado, new Date().toISOString(), c.get('revisor'), nota || null)
    .run();
  return c.redirect(`/?hecho=${r.meta.changes > 0 ? estado : 'ya-revisada'}`, 303);
});

revisar.post('/candidatos/:id/:decision', async (c) => {
  const id = Number(c.req.param('id'));
  const decision = c.req.param('decision');
  if (!Number.isInteger(id) || !(decision in DECISIONES_CANDIDATO)) {
    return c.html(aviso('Decisión no válida.'), 400);
  }
  const [desde, hasta] = DECISIONES_CANDIDATO[decision as keyof typeof DECISIONES_CANDIDATO];
  const r = await c.env.DB.prepare(SQL_DECIDIR_CANDIDATO)
    .bind(id, new Date().toISOString(), decision, hasta, desde)
    .run();
  return c.redirect(`/?hecho=${r.meta.changes > 0 ? decision : 'ya-decidido'}`, 303);
});

revisar.notFound((c) => c.html(aviso('Esta página no existe.'), 404));
revisar.onError((error, c) => {
  console.error(error);
  return c.html(aviso('Ha fallado algo al leer o guardar. Vuelve a intentarlo.'), 500);
});

export default revisar;

async function huella(texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- Página -----------------------------------------------------------------------------------

interface FilaAlerta {
  id: number;
  repo: string;
  creada: string;
  evidencia: string;
}
interface FilaRevisada extends FilaAlerta {
  estado: 'publicada' | 'descartada';
  revisada: string | null;
  nota: string | null;
}
interface FilaCandidato {
  id: number;
  repo: string;
  estrellas: number | null;
  creado?: string | null;
  actualizado: string;
  datos?: string | null;
}

interface DatosFila {
  descripcion?: string | null;
  lenguaje?: string | null;
  licencia?: string | null;
  forks?: number;
  temas?: string[];
  /** Nombre en español de cada tema (lo pone el radar, que tiene la taxonomía). */
  nombres_de_temas?: string[];
  motivo?: string;
}

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const numero = (n: number) => n.toLocaleString('es-ES');

function hace(iso: string, ahora: Date): string {
  const minutos = Math.max(0, Math.round((ahora.getTime() - Date.parse(iso)) / 60_000));
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 48) return `hace ${horas} h`;
  return `hace ${Math.round(horas / 24)} días`;
}

/** Enlace a GitHub. Al sospechoso, sin pasar datos de esta página y sin darle valor para buscadores. */
function enlace(repo: string): string {
  const url = `https://github.com/${repo.split('/').map(encodeURIComponent).join('/')}`;
  return `<a href="${escapar(url)}" target="_blank" rel="noopener noreferrer nofollow">${escapar(repo)}</a>`;
}

function descargas(lista: EvidenciaCopia['sospechoso']['descargas']): string {
  if (lista.length === 0) return 'ninguna';
  return lista
    .map((a) =>
      escapar(a.descargas === null ? a.nombre : `${a.nombre} (${numero(a.descargas)} descargas)`),
    )
    .join(', ');
}

function tarjeta(fila: FilaAlerta, ahora: Date): string {
  const e = JSON.parse(fila.evidencia) as EvidenciaCopia;
  const o = e.original;
  const s = e.sospechoso;
  const sistemas = o.sistemas.length > 0 ? o.sistemas.join(', ') : 'ninguno';
  return `<article class="tarjeta">
  <p class="etiqueta">Posible copia · detectada ${hace(fila.creada, ahora)}</p>
  <h2>¿Es ${escapar(s.repo)} una copia de ${escapar(o.repo)}?</h2>
  <div class="columnas">
    <div><h3>Original</h3><ul>
      <li>${enlace(o.repo)}</li>
      <li>${numero(o.estrellas)} estrellas</li>
      <li>Instaladores: ${escapar(sistemas)}${o.tiene_descargas ? '' : ' (no publica descargas)'}</li>
      <li class="suave">${escapar(o.descripcion ?? 'Sin descripción')}</li>
    </ul></div>
    <div><h3>Sospechoso <span class="peligro">no descargues nada</span></h3><ul>
      <li>${enlace(s.repo)}</li>
      <li>${numero(s.estrellas)} estrellas${s.ganadas_24h === null ? '' : ` (${numero(s.ganadas_24h)} en ${horasDeLaMedida(s.horas_medidas ?? null)})`}</li>
      <li>Creado hace ${numero(Math.floor(s.dias))} días · ${numero(s.commits)} commits</li>
      <li>Descargas: ${descargas(s.descargas)}</li>
      <li class="suave">${escapar(s.descripcion ?? 'Sin descripción')}</li>
    </ul></div>
  </div>
  <h3>Por qué ha saltado</h3>
  <ul>${motivosDeCopia(e)
    .map((m) => `<li>${escapar(m)}</li>`)
    .join('')}</ul>
  <form method="post" action="/alertas/${fila.id}">
    <label>Nota (opcional) <input name="nota" maxlength="500" autocomplete="off"></label>
    <div class="botones">
      <button name="decision" value="publicar" class="si">Sí, es una copia: aprobar el aviso</button>
      <button name="decision" value="descartar">No es una copia: descartar</button>
    </div>
  </form>
</article>`;
}

const HECHO: Record<string, string> = {
  publicada: 'Aviso aprobado. Saldrá en la web cuando esté lista.',
  descartada: 'Alerta descartada. Ese repo no volverá a saltar.',
  'ya-revisada': 'Esa alerta ya estaba revisada: no se ha cambiado nada.',
  aceptar: 'Proyecto aceptado. Entrará en el catálogo esta noche, con el robot diario.',
  rechazar: 'Proyecto rechazado. El radar no lo volverá a proponer.',
  sacar: 'Proyecto sacado del catálogo. Desaparecerá esta noche, con el robot diario.',
  'ya-decidido': 'Ese proyecto ya estaba decidido: no se ha cambiado nada.',
};

function propuesto(f: FilaCandidato, ahora: Date): string {
  const d = f.datos ? (JSON.parse(f.datos) as DatosFila) : {};
  const datos = [
    f.estrellas === null ? null : `${numero(f.estrellas)} estrellas`,
    d.forks === undefined ? null : `${numero(d.forks)} forks`,
    f.creado ? `creado ${hace(f.creado, ahora)}` : null,
    d.lenguaje ?? null,
    d.licencia ? `licencia ${d.licencia}` : 'sin licencia reconocida',
  ].filter(Boolean);
  return `<article class="tarjeta">
  <h2>${enlace(f.repo)}</h2>
  <p>${escapar(d.descripcion ?? 'Sin descripción')}</p>
  <p class="suave">${escapar(datos.join(' · '))} · Tema: ${escapar(d.nombres_de_temas?.[0] ?? d.temas?.[0] ?? '—')}</p>
  <div class="botones">
    <form method="post" action="/candidatos/${f.id}/aceptar"><button class="si-catalogo">Que entre en el catálogo</button></form>
    <form method="post" action="/candidatos/${f.id}/rechazar"><button>Que no entre</button></form>
  </div>
</article>`;
}

const ESTILO = `:root { color-scheme: light dark; --fondo: #0b0d10; --texto: #e7e9ee; --suave: #9aa3b2; --borde: #252a33;
    --tarjeta: #12151a; --marca: #3ecf8e; --peligro: #f2555a; font-family: system-ui, sans-serif; }
  @media (prefers-color-scheme: light) { :root { --fondo: #fbfbfc; --texto: #14171c; --suave: #5b6472; --borde: #e3e6ea; --tarjeta: #fff; } }
  body { margin: 0; background: var(--fondo); color: var(--texto); line-height: 1.5; }
  main { max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; } h2 { font-size: 1.1rem; margin: 4px 0 12px; } h3 { font-size: .95rem; margin: 12px 0 4px; }
  .suave { color: var(--suave); } .etiqueta { margin: 0; color: var(--suave); font-size: .85rem; }
  .tarjeta { background: var(--tarjeta); border: 1px solid var(--borde); border-radius: 12px; padding: 16px 20px; margin: 16px 0; }
  .columnas { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
  ul { padding-left: 20px; margin: 4px 0; } li { margin: 2px 0; word-break: break-word; }
  .peligro { color: var(--peligro); font-weight: 600; font-size: .8rem; margin-left: 6px; }
  form { margin-top: 12px; } label { display: block; color: var(--suave); font-size: .9rem; }
  input { display: block; width: 100%; box-sizing: border-box; margin-top: 4px; padding: 8px; border-radius: 8px; border: 1px solid var(--borde); background: var(--fondo); color: var(--texto); }
  .botones { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--borde); background: var(--fondo); color: var(--texto); cursor: pointer; }
  button.si { background: var(--peligro); border-color: var(--peligro); color: #fff; font-weight: 600; }
  button.si-catalogo { background: var(--marca); border-color: var(--marca); color: #0b0d10; font-weight: 600; }
  .botones form { margin: 0; }
  h2.seccion { margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--borde); }
  .hecho { border-left: 3px solid var(--marca); padding: 8px 12px; background: var(--tarjeta); }
  table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--borde); vertical-align: top; }
  th { color: var(--suave); font-weight: 500; } a { color: inherit; }`;

function aviso(texto: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><link rel="icon" href="data:,"><title>Revisión · All Open Project</title><style>${ESTILO}</style></head><body><main><h1>Revisión</h1><p>${escapar(texto)}</p></main></body></html>`;
}

function pagina(d: {
  correo: string;
  hecho: string | null;
  pendientes: FilaAlerta[];
  revisadas: FilaRevisada[];
  propuestos: FilaCandidato[];
  entrados: FilaCandidato[];
  sinTema: FilaCandidato[];
  ahora: Date;
}): string {
  const hecho = d.hecho && HECHO[d.hecho] ? `<p class="hecho">${HECHO[d.hecho]}</p>` : '';
  const pendientes =
    d.pendientes.length === 0
      ? '<p class="suave">No hay ninguna posible copia esperando. El radar avisa aquí cuando encuentra una.</p>'
      : d.pendientes.map((f) => tarjeta(f, d.ahora)).join('');
  const revisadas =
    d.revisadas.length === 0
      ? ''
      : `<h2>Revisadas hace poco</h2><table><tr><th>Repo</th><th>Decisión</th><th>Cuándo</th><th>Nota</th></tr>${d.revisadas
          .map(
            (f) =>
              `<tr><td>${escapar(f.repo)}</td><td>${f.estado === 'publicada' ? 'Es una copia' : 'Descartada'}</td><td>${f.revisada ? hace(f.revisada, d.ahora) : '—'}</td><td>${escapar(f.nota ?? '')}</td></tr>`,
          )
          .join('')}</table>`;
  const propuestos =
    d.propuestos.length === 0
      ? '<p class="suave">No hay ningún proyecto nuevo esperando.</p>'
      : d.propuestos.map((f) => propuesto(f, d.ahora)).join('');
  const entrados =
    d.entrados.length === 0
      ? ''
      : `<h2>Entraron en el catálogo por el radar</h2><p class="suave">Los que aceptaste. Si alguno no debería estar, sácalo.</p><table><tr><th>Proyecto</th><th>Estrellas</th><th>Tema</th><th></th></tr>${d.entrados
          .map((f) => {
            const datos = f.datos ? (JSON.parse(f.datos) as DatosFila) : {};
            return `<tr><td>${enlace(f.repo)}</td><td>${f.estrellas === null ? '—' : numero(f.estrellas)}</td><td>${escapar(datos.nombres_de_temas?.[0] ?? datos.temas?.[0] ?? '—')}</td><td><form method="post" action="/candidatos/${f.id}/sacar"><button>Sacar del catálogo</button></form></td></tr>`;
          })
          .join('')}</table>`;
  const sinTema =
    d.sinTema.length === 0
      ? ''
      : `<h2>Cumplen la regla, pero no tienen tema</h2><p class="suave">Sus topics no encajan en ningún tema. Para que entren hay que darles uno a mano.</p><ul>${d.sinTema
          .map(
            (f) =>
              `<li>${enlace(f.repo)}${f.estrellas === null ? '' : ` · ${numero(f.estrellas)} estrellas`}</li>`,
          )
          .join('')}</ul>`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" href="data:,">
<title>Revisión · All Open Project</title>
<style>${ESTILO}</style>
</head>
<body>
<main>
  <h1>Revisión</h1>
  <p class="suave">Has entrado como ${escapar(d.correo)}. Nada se publica sin que lo apruebes aquí. Antes de decidir, abre los dos repos y compáralos (sin descargar nada del sospechoso).</p>
  ${hecho}
  <h2>Posibles copias por revisar (${d.pendientes.length})</h2>
  ${pendientes}
  ${revisadas}
  <h2 class="seccion">Proponemos que entren en el catálogo (${d.propuestos.length})</h2>
  <p class="suave">Proyectos nuevos que cumplen la regla: al menos 500 estrellas y 7 días seguidos ganando 10 o más cada día. Entran cuando tú lo confirmas. Di que no a lo que no sea un programa útil o use servicios de otros sin permiso.</p>
  ${propuestos}
  ${entrados}
  ${sinTema}
</main>
</body>
</html>`;
}
