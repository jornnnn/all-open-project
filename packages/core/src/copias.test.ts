import { describe, expect, it } from 'vitest';
import {
  descargasQueNoOfrece,
  distanciaDeEdicion,
  esDescargaEjecutable,
  evaluarCopia,
  horasDeLaMedida,
  motivosDeCopia,
  normalizarNombre,
  type Original,
  parecidoDeNombre,
  type Sospechoso,
} from './copias.ts';

describe('parecidoDeNombre', () => {
  it('no distingue mayúsculas ni separadores', () => {
    expect(normalizarNombre('Claude_Code-2')).toBe('claudecode2');
    expect(parecidoDeNombre('Ollama', 'ollama')).toEqual({ tipo: 'igual' });
  });

  it('reconoce los añadidos típicos de las copias, por delante o por detrás', () => {
    expect(parecidoDeNombre('rea-cn', 'rea')).toEqual({ tipo: 'con-anadido', anadidos: ['cn'] });
    expect(parecidoDeNombre('FreeClaudeCode', 'claude-code')).toEqual({
      tipo: 'con-anadido',
      anadidos: ['free'],
    });
    expect(parecidoDeNombre('REA-Desktop-x64', 'rea')).toMatchObject({ tipo: 'con-anadido' });
    expect(parecidoDeNombre('ollama-win64', 'ollama')).toEqual({
      tipo: 'con-anadido',
      anadidos: ['win64'],
    });
  });

  it('no confunde palabras que solo empiezan igual', () => {
    expect(parecidoDeNombre('reality-restaged', 'rea')).toBeNull();
    expect(parecidoDeNombre('real-api-pricing', 'rea')).toBeNull();
    expect(parecidoDeNombre('claude-code-mods', 'claude-code')).toBeNull();
    expect(parecidoDeNombre('ComfyUI_MiniMaxH3_Director', 'ComfyUI')).toBeNull();
  });

  it('reconoce una letra cambiada en nombres largos que empiezan igual', () => {
    expect(parecidoDeNombre('olllama', 'ollama')).toEqual({ tipo: 'casi-igual', distancia: 1 });
    expect(parecidoDeNombre('comfyiu', 'comfyui')).toEqual({ tipo: 'casi-igual', distancia: 1 });
    // «llama» es otra palabra: no empieza igual que «ollama».
    expect(parecidoDeNombre('llama', 'ollama')).toBeNull();
    // En nombres cortos, una letra de diferencia es casi siempre otra palabra.
    expect(parecidoDeNombre('bum', 'bun')).toBeNull();
  });

  it('los nombres genéricos o muy cortos no sirven para buscar copias', () => {
    expect(parecidoDeNombre('core', 'core')).toBeNull();
    expect(parecidoDeNombre('go', 'go')).toBeNull();
    expect(parecidoDeNombre('ui-pro', 'ui')).toBeNull();
  });

  it('distancia de edición con transposiciones', () => {
    expect(distanciaDeEdicion('ollama', 'ollama')).toBe(0);
    expect(distanciaDeEdicion('ollama', 'olalma')).toBe(1);
    expect(distanciaDeEdicion('kitten', 'sitting')).toBe(3);
  });
});

describe('descargas', () => {
  it('cuenta programas y comprimidos, no sumas de control ni firmas', () => {
    expect(esDescargaEjecutable('FreeClaude-v1.4.0.zip')).toBe(true);
    expect(esDescargaEjecutable('Setup.exe')).toBe(true);
    expect(esDescargaEjecutable('app.apk')).toBe(true);
    expect(esDescargaEjecutable('SHA256SUMS.txt')).toBe(false);
    expect(esDescargaEjecutable('app.zip.sha256')).toBe(false);
    expect(esDescargaEjecutable('latest.yml')).toBe(false);
    expect(esDescargaEjecutable('README.md')).toBe(false);
  });

  it('solo cuentan las que el original no ofrece', () => {
    const descargas = [
      { nombre: 'App-Setup.exe', descargas: 10 },
      { nombre: 'App.dmg', descargas: 5 },
      { nombre: 'App.zip', descargas: 7 },
      { nombre: 'SHA256SUMS', descargas: 1 },
    ];
    // El original tiene instalador de Windows: solo el de Mac es nuevo (y el .zip no, porque
    // el original ya publica archivos).
    expect(
      descargasQueNoOfrece(descargas, { sistemas: ['windows'], tieneDescargas: true }).map(
        (a) => a.nombre,
      ),
    ).toEqual(['App.dmg']);
    // El original no publica nada: todo es nuevo.
    expect(
      descargasQueNoOfrece(descargas, { sistemas: [], tieneDescargas: false }).map((a) => a.nombre),
    ).toEqual(['App-Setup.exe', 'App.dmg', 'App.zip']);
  });
});

const ahora = new Date('2026-10-17T12:00:00Z');

const claudeCode: Original = {
  id: 1,
  repo: 'anthropics/claude-code',
  descripcion: 'Claude Code is an agentic coding tool that lives in your terminal',
  estrellas: 120_000,
  sistemas: [],
  tieneDescargas: false,
};

/** Caso real (17-oct-2026): un .zip con 1.603 descargas, cuando Claude Code no ofrece ninguna. */
const freeClaude: Sospechoso = {
  id: 2,
  repo: 'kolevans/FreeClaudeCode',
  descripcion: 'Free Claude Code stack in one UI',
  lenguaje: 'TypeScript',
  creado: '2026-08-11T12:00:00Z',
  estrellas: 103,
  commits: 18,
  esFork: false,
  ganadas24h: null,
  horasMedidas: null,
  descargas: [{ nombre: 'FreeClaude-v1.4.0.zip', descargas: 1603 }],
};

describe('evaluarCopia', () => {
  it('nombre parecido + reciente + pocos cambios + descargas que el original no ofrece → revisión', () => {
    const r = evaluarCopia(freeClaude, claudeCode, ahora);
    expect(r?.alerta).toBe(true);
    expect(r?.evidencia.senales).toEqual({
      reciente: true,
      pocos_cambios: true,
      estrellas_de_golpe: false,
      descargas_que_el_original_no_ofrece: [{ nombre: 'FreeClaude-v1.4.0.zip', descargas: 1603 }],
    });
    expect(r?.evidencia.sospechoso.dias).toBe(67);
  });

  it('estrellas de golpe también bastan, sin descargas', () => {
    const r = evaluarCopia(
      {
        ...freeClaude,
        repo: 'otro/claude-code-pro',
        descargas: [],
        creado: '2026-10-11T12:00:00Z',
        estrellas: 386,
      },
      claudeCode,
      ahora,
    );
    expect(r?.alerta).toBe(true);
    expect(r?.evidencia.senales.estrellas_de_golpe).toBe(true);
  });

  it('hace falta todo: con muchos commits o siendo antiguo no va a revisión', () => {
    expect(evaluarCopia({ ...freeClaude, commits: 900 }, claudeCode, ahora)?.alerta).toBe(false);
    expect(
      evaluarCopia({ ...freeClaude, creado: '2025-01-01T00:00:00Z' }, claudeCode, ahora)?.alerta,
    ).toBe(false);
    expect(evaluarCopia({ ...freeClaude, descargas: [] }, claudeCode, ahora)?.alerta).toBe(false);
    expect(evaluarCopia({ ...freeClaude, esFork: true }, claudeCode, ahora)?.alerta).toBe(false);
  });

  it('sin código ni descargas (apuntes) o casi sin visitas no va a revisión', () => {
    // Caso real: «justxor/Linux-», una chuleta de comandos con 1.095 estrellas en 24 días.
    const apuntes = {
      ...freeClaude,
      lenguaje: null,
      descargas: [],
      estrellas: 1095,
      creado: '2026-09-23T12:00:00Z',
    };
    expect(evaluarCopia(apuntes, claudeCode, ahora)?.alerta).toBe(false);
    // Sin código pero con un .zip para descargar, sí.
    expect(evaluarCopia({ ...freeClaude, lenguaje: null }, claudeCode, ahora)?.alerta).toBe(true);
    // 3 estrellas y 12 descargas: casi nadie lo ve.
    const pequeno = {
      ...freeClaude,
      estrellas: 3,
      descargas: [{ nombre: 'gui.dmg', descargas: 12 }],
    };
    expect(evaluarCopia(pequeno, claudeCode, ahora)?.alerta).toBe(false);
  });

  it('los nombres de lenguajes y plataformas no cuentan', () => {
    expect(parecidoDeNombre('Linux-', 'linux')).toBeNull();
    expect(parecidoDeNombre('node', 'node')).toBeNull();
  });

  it('el mismo dueño o un nombre distinto no son copias', () => {
    expect(
      evaluarCopia({ ...freeClaude, repo: 'anthropics/claude-code-pro' }, claudeCode, ahora),
    ).toBeNull();
    expect(
      evaluarCopia({ ...freeClaude, repo: 'kolevans/mi-editor' }, claudeCode, ahora),
    ).toBeNull();
  });

  it('dice cuántas horas abarca la medida de las estrellas', () => {
    const r = evaluarCopia(
      { ...freeClaude, descargas: [], ganadas24h: 120, horasMedidas: 3.2 },
      claudeCode,
      ahora,
    );
    expect(r?.alerta).toBe(true);
    expect(r && motivosDeCopia(r.evidencia)).toContain(
      'Sus estrellas suben de golpe: 120 en las últimas 3 horas.',
    );
    expect(horasDeLaMedida(24)).toBe('las últimas 24 horas');
    expect(horasDeLaMedida(0.4)).toBe('la última hora');
  });

  it('explica los motivos en frases para quien revisa', () => {
    const r = evaluarCopia(freeClaude, claudeCode, ahora);
    expect(r && motivosDeCopia(r.evidencia)).toEqual([
      'Se llama como anthropics/claude-code con un añadido típico de las copias: «FreeClaudeCode» = «claude-code» + «free».',
      'Es nuevo: se creó hace 67 días.',
      'Tiene muy pocos cambios: 18 commits en su rama principal.',
      'Ofrece descargas, y el original no ofrece ninguna: FreeClaude-v1.4.0.zip (1603 descargas).',
    ]);
  });
});
