import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import revisar from '../src/revisar.ts';
import type { Entorno } from '../src/tipos.ts';
import { pedir, proyecto, vaciarTablas } from './ayudantes.ts';

beforeEach(vaciarTablas);

const ORIGEN = 'https://revisar.test';

interface Opciones {
  metodo?: string;
  formulario?: Record<string, string>;
  /** Correo que da Cloudflare Access; null si la petición no pasó por Access. */
  correo?: string | null;
  origen?: string | null;
  entorno?: Partial<Entorno>;
}

/** Llama al Worker de revisión como si la petición hubiera pasado (o no) por Cloudflare Access. */
async function abrir(
  ruta: string,
  { metodo, formulario, correo = 'Ana@Example.com', origen = ORIGEN, entorno }: Opciones = {},
) {
  const cabeceras = new Headers();
  const init: RequestInit = { method: metodo ?? (formulario ? 'POST' : 'GET'), headers: cabeceras };
  if (formulario) {
    init.body = new URLSearchParams(formulario).toString();
    cabeceras.set('content-type', 'application/x-www-form-urlencoded');
  }
  if (origen !== null) cabeceras.set('origin', origen);
  const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
    ...(correo === null
      ? {}
      : { access: { aud: 'prueba', getIdentity: async () => ({ email: correo }) } }),
  };
  return revisar.fetch(
    new Request(`${ORIGEN}${ruta}`, init),
    { ...env, REVISORES: 'otra@example.com, ana@example.com', ...entorno },
    ctx as unknown as ExecutionContext,
  );
}

const evidencia = {
  original: {
    id: 1,
    repo: 'ana/proyecto-1',
    descripcion: 'Editor de fotos',
    estrellas: 50_000,
    sistemas: ['windows'],
    tiene_descargas: true,
  },
  sospechoso: {
    id: 99,
    repo: 'falso/proyecto-1-mac',
    descripcion: '<b>Descarga</b> gratis',
    creado: '2026-10-10T00:00:00Z',
    dias: 7,
    estrellas: 900,
    ganadas_24h: 300,
    commits: 2,
    descargas: [{ nombre: 'Proyecto-mac.dmg', descargas: 120 }],
  },
  nombre: { tipo: 'con-anadido', anadidos: ['mac'] },
  senales: {
    reciente: true,
    pocos_cambios: true,
    estrellas_de_golpe: true,
    descargas_que_el_original_no_ofrece: [{ nombre: 'Proyecto-mac.dmg', descargas: 120 }],
  },
  comprobado: '2026-10-17T10:00:00Z',
};

async function prepararAlerta() {
  await pedir('/ingest/proyectos?fecha=2026-10-17', { cuerpo: [proyecto(1)] });
  await pedir('/ingest/radar/guardar', {
    cuerpo: { alertas: [{ repo: 'falso/proyecto-1-mac', repo_id: 99, original_id: 1, evidencia }] },
  });
  const fila = await env.DB.prepare('SELECT id FROM alerts').first<{ id: number }>();
  return fila?.id ?? -1;
}

describe('Worker de revisión: quién entra', () => {
  it('sin Cloudflare Access no abre', async () => {
    const r = await abrir('/', { correo: null });
    expect(r.status).toBe(403);
    expect(await r.text()).toContain('Cloudflare Access');
  });

  it('sin la lista de revisores no abre', async () => {
    expect((await abrir('/', { entorno: { REVISORES: '' } })).status).toBe(503);
  });

  it('con un correo que no está en la lista no abre', async () => {
    expect((await abrir('/', { correo: 'intruso@example.com' })).status).toBe(403);
  });

  it('con un revisor abre, sin dejar que la metan en otra página ni se guarde en caché', async () => {
    const r = await abrir('/');
    expect(r.status).toBe(200);
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(await r.text()).toContain('No hay ninguna posible copia esperando');
  });
});

describe('Worker de revisión: alertas', () => {
  it('enseña cada alerta con sus pruebas y escapa lo que viene de GitHub', async () => {
    await prepararAlerta();
    const html = await (await abrir('/')).text();
    expect(html).toContain('¿Es falso/proyecto-1-mac una copia de ana/proyecto-1?');
    expect(html).toContain(
      'Ofrece descargas para un sistema que el original no tiene: Proyecto-mac.dmg (120 descargas).',
    );
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).not.toContain('<b>Descarga</b>');
    expect(html).toContain('&#60;b&#62;Descarga');
  });

  it('una persona la aprueba; queda una huella, no su correo, y no se puede volver a decidir', async () => {
    const id = await prepararAlerta();
    const r = await abrir(`/alertas/${id}`, {
      formulario: { decision: 'publicar', nota: 'Copia clara' },
    });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/?hecho=publicada');
    const fila = await env.DB.prepare('SELECT estado, revisada_por, nota FROM alerts').first<
      Record<string, string>
    >();
    expect(fila).toMatchObject({ estado: 'publicada', nota: 'Copia clara' });
    expect(fila?.revisada_por).toMatch(/^persona:[0-9a-f]{12}$/);
    expect(fila?.revisada_por).not.toContain('ana');

    const otra = await abrir(`/alertas/${id}`, { formulario: { decision: 'descartar' } });
    expect(otra.headers.get('location')).toBe('/?hecho=ya-revisada');
    expect((await env.DB.prepare('SELECT estado FROM alerts').first())?.estado).toBe('publicada');
  });

  it('un envío desde otra web o sin decisión válida no cambia nada', async () => {
    const id = await prepararAlerta();
    expect(
      (
        await abrir(`/alertas/${id}`, {
          formulario: { decision: 'publicar' },
          origen: 'https://malo.example',
        })
      ).status,
    ).toBe(403);
    expect(
      (await abrir(`/alertas/${id}`, { formulario: { decision: 'publicar' }, origen: null }))
        .status,
    ).toBe(403);
    expect((await abrir(`/alertas/${id}`, { formulario: { decision: 'borrar' } })).status).toBe(
      400,
    );
    expect((await env.DB.prepare('SELECT estado FROM alerts').first())?.estado).toBe('pendiente');
  });
});

describe('Worker de revisión: proyectos nuevos para el catálogo', () => {
  const candidato = {
    id: 7,
    repo: 'nuevo/editor',
    fuentes: { 'busqueda-7d': '2026-10-10T00:00:00Z' },
    estado: 'propuesto',
    estrellas: 900,
    creado: '2026-10-01T00:00:00Z',
    detectado: '2026-10-02T00:00:00Z',
    actualizado: '2026-10-17T00:00:00Z',
    datos: { descripcion: 'Editor de fotos', temas: ['edicion-de-fotos'], forks: 40 },
  };

  it('el radar propone y una persona acepta; el radar ya no lo cambia', async () => {
    await pedir('/ingest/radar/guardar', { cuerpo: { candidatos: [candidato] } });
    const html = await (await abrir('/')).text();
    expect(html).toContain('Proponemos que entren en el catálogo (1)');
    expect(html).toContain('Que entre en el catálogo');
    // Propuesto aún no está en el catálogo.
    expect(await (await pedir('/ingest/radar/aceptados')).json()).toEqual([]);

    const r = await abrir('/candidatos/7/aceptar', { formulario: {} });
    expect(r.headers.get('location')).toBe('/?hecho=aceptar');
    expect(await (await pedir('/ingest/radar/aceptados')).json()).toEqual([
      { id: 7, repo: 'nuevo/editor', temas: ['edicion-de-fotos'] },
    ]);
    // El radar vuelve a mandarlo como vigilado: no cambia lo que decidió la persona.
    await pedir('/ingest/radar/guardar', {
      cuerpo: { candidatos: [{ ...candidato, estado: 'vigilando' }] },
    });
    expect((await env.DB.prepare('SELECT estado FROM candidates').first())?.estado).toBe(
      'aceptado',
    );
  });

  it('se puede rechazar una propuesta, o sacar del catálogo lo que se aceptó', async () => {
    await pedir('/ingest/radar/guardar', {
      cuerpo: {
        candidatos: [candidato, { ...candidato, id: 8, repo: 'nuevo/otro', estado: 'aceptado' }],
      },
    });
    const decidir = async (ruta: string) =>
      (await abrir(ruta, { formulario: {} })).headers.get('location');
    expect(await decidir('/candidatos/7/rechazar')).toBe('/?hecho=rechazar');
    expect(await decidir('/candidatos/8/sacar')).toBe('/?hecho=sacar');
    // Sacar algo que no estaba aceptado no hace nada.
    expect(await decidir('/candidatos/7/sacar')).toBe('/?hecho=ya-decidido');
    const filas = (
      await env.DB.prepare('SELECT id, estado, datos FROM candidates ORDER BY id').all<
        Record<string, string>
      >()
    ).results;
    expect(filas.map((f) => f.estado)).toEqual(['descartado', 'descartado']);
    expect(JSON.parse(filas[0]?.datos ?? '{}')).toMatchObject({
      persona: { decision: 'rechazar' },
    });
    expect(JSON.parse(filas[1]?.datos ?? '{}')).toMatchObject({ persona: { decision: 'sacar' } });
    expect((await abrir('/candidatos/7/borrar', { formulario: {} })).status).toBe(400);
  });
});
