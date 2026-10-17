-- Esquema inicial de D1 (Fase B). Tablas en inglés, como en el plan técnico; columnas con los
-- nombres del dominio en español, iguales que en data/export/proyectos.json.
--
-- Plan gratuito: 100.000 filas escritas al día para toda la cuenta, y cada índice cuenta como una
-- fila más en cada escritura que lo toca. Por eso hay pocos índices y el robot escribe solo lo que
-- cambia (ver apps/worker/src/ingesta.ts).

-- Proyectos del catálogo, con los datos de la última foto. El id es el de GitHub (databaseId):
-- no cambia aunque renombren o transfieran el repo.
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  repo TEXT NOT NULL COLLATE NOCASE UNIQUE,
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  descripcion TEXT,
  web TEXT,
  lenguaje TEXT,
  topics TEXT NOT NULL CHECK (json_valid(topics) AND json_type(topics) = 'array'),
  temas TEXT NOT NULL CHECK (json_valid(temas) AND json_array_length(temas) > 0),
  tema TEXT NOT NULL,
  area TEXT NOT NULL,
  publico TEXT NOT NULL CHECK (publico IN ('usar', 'programar')),
  estrellas INTEGER NOT NULL CHECK (estrellas >= 0),
  forks INTEGER NOT NULL CHECK (forks >= 0),
  issues_abiertas INTEGER CHECK (issues_abiertas >= 0),
  issues_cerradas INTEGER CHECK (issues_cerradas >= 0),
  creado TEXT NOT NULL,
  ultimo_push TEXT,
  ultimo_cambio TEXT NOT NULL,
  archivado INTEGER NOT NULL CHECK (archivado IN (0, 1)),
  estado TEXT NOT NULL CHECK (estado IN ('vivo', 'lento', 'abandonado', 'terminado')),
  licencia_github TEXT,
  licencia TEXT NOT NULL CHECK (licencia IN ('open-source', 'con-limites', 'otra', 'sin-licencia')),
  licencias TEXT NOT NULL CHECK (json_valid(licencias) AND json_type(licencias) = 'array'),
  licencia_motivo TEXT,
  organizacion_verificada INTEGER CHECK (organizacion_verificada IN (0, 1)),
  oficial INTEGER CHECK (oficial IN (0, 1)),
  version TEXT,
  version_fecha TEXT,
  descargas INTEGER CHECK (descargas >= 0),
  instaladores TEXT NOT NULL CHECK (json_valid(instaladores) AND json_type(instaladores) = 'object'),
  sistemas TEXT NOT NULL CHECK (json_valid(sistemas) AND json_type(sistemas) = 'array'),
  estrellas_por_dia REAL,
  puntuacion INTEGER NOT NULL CHECK (puntuacion BETWEEN 0 AND 100),
  puntuacion_detalle TEXT NOT NULL CHECK (json_valid(puntuacion_detalle)),
  origen TEXT NOT NULL CHECK (json_valid(origen) AND json_type(origen) = 'array'),
  -- Día (AAAA-MM-DD, UTC) de la primera foto y momento de la última.
  alta TEXT NOT NULL,
  actualizado TEXT NOT NULL
);

-- Historial: una foto por proyecto y día (UTC). Sin rowid, cada foto es una sola fila escrita.
CREATE TABLE snapshots (
  project_id INTEGER NOT NULL REFERENCES projects (id),
  fecha TEXT NOT NULL,
  estrellas INTEGER NOT NULL CHECK (estrellas >= 0),
  forks INTEGER NOT NULL CHECK (forks >= 0),
  issues_abiertas INTEGER,
  descargas INTEGER,
  puntuacion INTEGER NOT NULL CHECK (puntuacion BETWEEN 0 AND 100),
  estado TEXT NOT NULL,
  PRIMARY KEY (project_id, fecha)
) WITHOUT ROWID;

-- Radar (Fase C): estrellas por hora de candidatos y proyectos en auge, durante 14 días.
-- repo_id es el id de GitHub: puede que el repo aún no esté en projects.
CREATE TABLE hourly (
  repo_id INTEGER NOT NULL,
  hora TEXT NOT NULL,
  estrellas INTEGER NOT NULL CHECK (estrellas >= 0),
  PRIMARY KEY (repo_id, hora)
) WITHOUT ROWID;

-- Repos que detecta el radar antes de entrar en el catálogo, y de dónde vienen.
CREATE TABLE candidates (
  id INTEGER PRIMARY KEY,
  repo TEXT NOT NULL COLLATE NOCASE UNIQUE,
  fuentes TEXT NOT NULL CHECK (json_valid(fuentes)),
  estado TEXT NOT NULL DEFAULT 'vigilando' CHECK (estado IN ('vigilando', 'aceptado', 'descartado')),
  estrellas INTEGER CHECK (estrellas >= 0),
  creado TEXT,
  detectado TEXT NOT NULL,
  actualizado TEXT NOT NULL,
  datos TEXT CHECK (datos IS NULL OR json_valid(datos))
);

-- Alertas (posibles copias…). Ninguna se publica sin que una persona la apruebe.
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('posible-copia', 'otra')),
  repo TEXT NOT NULL,
  repo_id INTEGER,
  original_id INTEGER REFERENCES projects (id),
  evidencia TEXT NOT NULL CHECK (json_valid(evidencia)),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'publicada', 'descartada')),
  creada TEXT NOT NULL,
  revisada TEXT,
  revisada_por TEXT,
  nota TEXT
);
CREATE INDEX alerts_por_estado ON alerts (estado, creada);

-- Textos con IA (Fase D), en español e inglés.
CREATE TABLE texts (
  project_id INTEGER NOT NULL REFERENCES projects (id),
  idioma TEXT NOT NULL CHECK (idioma IN ('es', 'en')),
  frase TEXT NOT NULL,
  que_es TEXT NOT NULL,
  no_hace TEXT,
  modelo TEXT NOT NULL,
  generado TEXT NOT NULL,
  huella_readme TEXT,
  revisado INTEGER NOT NULL DEFAULT 0 CHECK (revisado IN (0, 1)),
  PRIMARY KEY (project_id, idioma)
);

-- Ejecuciones del robot: la salud que enseñan /estado y /api/v1/estado.
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('diario', 'radar')),
  estado TEXT NOT NULL CHECK (estado IN ('en-curso', 'ok', 'error')),
  inicio TEXT NOT NULL,
  fin TEXT,
  proyectos INTEGER,
  errores TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(errores)),
  avisos TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(avisos)),
  resumen TEXT CHECK (resumen IS NULL OR json_valid(resumen)),
  enlace TEXT
);
CREATE INDEX runs_por_tipo ON runs (tipo, inicio);

-- Búsqueda de texto sobre projects. Los disparadores la mantienen al día, y solo escriben cuando
-- cambia el texto, no cada noche por las estrellas.
CREATE VIRTUAL TABLE fts_projects USING fts5 (
  repo,
  descripcion,
  topics,
  content = 'projects',
  content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER projects_fts_alta AFTER INSERT ON projects BEGIN
  INSERT INTO fts_projects (rowid, repo, descripcion, topics)
  VALUES (new.id, new.repo, new.descripcion, new.topics);
END;

CREATE TRIGGER projects_fts_baja AFTER DELETE ON projects BEGIN
  INSERT INTO fts_projects (fts_projects, rowid, repo, descripcion, topics)
  VALUES ('delete', old.id, old.repo, old.descripcion, old.topics);
END;

CREATE TRIGGER projects_fts_cambio AFTER UPDATE OF repo, descripcion, topics ON projects
WHEN old.repo IS NOT new.repo COLLATE BINARY
  OR old.descripcion IS NOT new.descripcion
  OR old.topics IS NOT new.topics
BEGIN
  INSERT INTO fts_projects (fts_projects, rowid, repo, descripcion, topics)
  VALUES ('delete', old.id, old.repo, old.descripcion, old.topics);
  INSERT INTO fts_projects (rowid, repo, descripcion, topics)
  VALUES (new.id, new.repo, new.descripcion, new.topics);
END;
