import { describe, expect, it } from 'vitest';
import { contarEstrellas, nombreDeHora } from './gharchive.ts';

const evento = (type: string, id: number, name: string) =>
  JSON.stringify({ type, repo: { id, name } });

describe('GH Archive', () => {
  it('nombra cada hora como GH Archive, sin cero delante de la hora', () => {
    expect(nombreDeHora(new Date('2026-10-17T09:59:00Z'))).toBe('2026-10-17-9');
    expect(nombreDeHora(new Date('2026-10-17T23:00:00Z'))).toBe('2026-10-17-23');
  });

  it('cuenta las estrellas de cada repo y se queda con los que tienen 2 o más', async () => {
    const lineas = [
      evento('WatchEvent', 1, 'morluto/rea'),
      evento('WatchEvent', 1, 'morluto/rea'),
      evento('WatchEvent', 1, 'morluto/rea'),
      evento('WatchEvent', 2, 'ana/editor'),
      evento('WatchEvent', 3, 'luis/notas'),
      evento('WatchEvent', 3, 'luis/notas'),
      evento('PushEvent', 2, 'ana/editor'),
      evento('ForkEvent', 2, 'ana/editor'),
    ];
    expect(await contarEstrellas('2026-10-17-9', lineas)).toEqual({
      hora: '2026-10-17-9',
      eventos: 8,
      estrellas: 6,
      rotas: 0,
      pistas: [
        { id: 1, repo: 'morluto/rea', estrellas: 3 },
        { id: 3, repo: 'luis/notas', estrellas: 2 },
      ],
    });
  });

  it('se salta las líneas cortadas, como las que trae a veces GH Archive', async () => {
    const r = await contarEstrellas('h', [
      evento('WatchEvent', 1, 'a/b'),
      '{"type":"WatchEvent","repo":{"id":1,"na',
      '',
      evento('WatchEvent', 1, 'a/b'),
    ]);
    expect(r.rotas).toBe(1);
    expect(r.eventos).toBe(2);
    expect(r.pistas).toEqual([{ id: 1, repo: 'a/b', estrellas: 2 }]);
  });
});
