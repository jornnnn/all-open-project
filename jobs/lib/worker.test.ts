import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearClienteWorker, trocearPorTamano } from './worker.ts';

describe('trocearPorTamano', () => {
  it('reparte en arrays JSON válidos que no pasan del máximo, sin perder ni desordenar nada', () => {
    const elementos = Array.from({ length: 500 }, (_, i) => ({
      id: i,
      texto: 'ñandú '.repeat(i % 40),
    }));
    const maximo = 2000;
    const lotes = trocearPorTamano(elementos, maximo);
    expect(lotes.length).toBeGreaterThan(1);
    for (const lote of lotes) expect(Buffer.byteLength(lote, 'utf8')).toBeLessThanOrEqual(maximo);
    expect(lotes.flatMap((l) => JSON.parse(l) as unknown[])).toEqual(elementos);
  });

  it('cuenta los bytes de verdad (UTF-8), no los caracteres', () => {
    const elemento = { texto: 'é'.repeat(100) }; // 100 caracteres, 200 bytes
    expect(() => trocearPorTamano([elemento], 150)).toThrow(/ocupa/);
  });

  it('sin elementos no hay lotes', () => {
    expect(trocearPorTamano([], 100)).toEqual([]);
  });
});

describe('crearClienteWorker', () => {
  afterEach(() => vi.unstubAllGlobals());

  function servidor(respuestas: (() => Response)[]) {
    const llamadas: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        llamadas.push({ url, init });
        const siguiente = respuestas.shift();
        if (!siguiente) throw new Error('No hay más respuestas preparadas');
        return siguiente();
      }),
    );
    return llamadas;
  }
  const json =
    (cuerpo: unknown, status = 200) =>
    () =>
      new Response(JSON.stringify(cuerpo), { status });

  it('manda la clave y reintenta si el Worker falla un momento', async () => {
    const llamadas = servidor([json({ error: 'caído' }, 503), json({ ok: true })]);
    const worker = crearClienteWorker('https://worker.test/', 'secreta', { esperaMs: 1 });
    await worker.ejecucion({
      id: 'a',
      tipo: 'diario',
      estado: 'en-curso',
      inicio: '2026-10-17T03:17:00Z',
    });
    expect(llamadas).toHaveLength(2);
    expect(llamadas[0]?.url).toBe('https://worker.test/ingest/ejecucion');
    expect(new Headers(llamadas[0]?.init.headers).get('authorization')).toBe('Bearer secreta');
  });

  it('si el Worker rechaza los datos, da su motivo y no reintenta', async () => {
    const llamadas = servidor([json({ error: 'CHECK constraint failed: estado' }, 400)]);
    const worker = crearClienteWorker('https://worker.test', 'secreta', { esperaMs: 1 });
    await expect(worker.cierre([1, 2])).rejects.toThrow('CHECK constraint failed: estado');
    expect(llamadas).toHaveLength(1);
  });

  it('envía los proyectos en lotes y suma lo escrito', async () => {
    const proyecto = { id: 1, repo: 'a/b', descripcion: 'x'.repeat(300_000) }; // uno por lote
    const llamadas = servidor([
      json({ ok: true, filas_escritas: 10, filas_leidas: 3 }),
      json({ ok: true, filas_escritas: 7, filas_leidas: 2 }),
      json({ ok: true, filas_escritas: 5, filas_leidas: 1 }),
    ]);
    const worker = crearClienteWorker('https://worker.test', 'secreta');
    // biome-ignore lint/suspicious/noExplicitAny: proyectos de mentira, solo importa su tamaño
    const medida = await worker.proyectos('2026-10-17', [proyecto, proyecto, proyecto] as any);
    expect(medida).toEqual({ lotes: 3, filas_escritas: 22, filas_leidas: 6 });
    expect(llamadas.every((l) => l.url.endsWith('/ingest/proyectos?fecha=2026-10-17'))).toBe(true);
  });

  it('lee el historial como un mapa por id', async () => {
    servidor([json([[7, '2026-09-17', 1500]])]);
    const worker = crearClienteWorker('https://worker.test', 'secreta');
    const historial = await worker.historial('2026-09-17', '2026-10-17');
    expect(historial.get(7)).toEqual({ fecha: '2026-09-17', estrellas: 1500 });
  });
});
