-- Fase C: radar horario, tendencias y posibles copias.
--
-- La cuenta de Cloudflare tiene 100.000 filas escritas al día para todas sus bases de datos, y otros
-- proyectos de la cuenta ya gastan unas 80.000 (medido el 17-oct-2026). Por eso el radar escribe poco: una
-- fila por hora con las estrellas de todo lo que vigila, en vez de una fila por repo y hora.

-- hourly se creó en 0001 sin llegar a usarse (estaba vacía): se rehace con una fila por hora.
DROP TABLE hourly;
CREATE TABLE hourly (
  -- Hora de la lectura en UTC (AAAA-MM-DDTHH). Si el radar se repite en la misma hora, se sustituye.
  hora TEXT PRIMARY KEY,
  -- Momento exacto en que se leyeron las estrellas.
  momento TEXT NOT NULL,
  repos INTEGER NOT NULL CHECK (repos >= 0),
  -- {"<id de GitHub>": estrellas, …} de todo lo que vigila el radar.
  estrellas TEXT NOT NULL CHECK (json_valid(estrellas) AND json_type(estrellas) = 'object')
);

-- candidates también se creó en 0001 sin usarse (vacía): se rehace con el estado «propuesto». El
-- radar propone los que cumplen la regla de entrada y una persona confirma cada uno en la página de
-- revisión; solo los «aceptado» entran en el catálogo. Lo que decide una persona queda en
-- datos.persona y el radar ya no lo cambia.
DROP TABLE candidates;
CREATE TABLE candidates (
  id INTEGER PRIMARY KEY,
  repo TEXT NOT NULL COLLATE NOCASE UNIQUE,
  fuentes TEXT NOT NULL CHECK (json_valid(fuentes)),
  estado TEXT NOT NULL DEFAULT 'vigilando'
    CHECK (estado IN ('vigilando', 'propuesto', 'aceptado', 'descartado')),
  estrellas INTEGER CHECK (estrellas >= 0),
  creado TEXT,
  detectado TEXT NOT NULL,
  actualizado TEXT NOT NULL,
  datos TEXT CHECK (datos IS NULL OR json_valid(datos))
);

-- Lo que el radar guarda de una hora para la siguiente: las tendencias que sirve la API (clave
-- «tendencias») y su memoria interna (clave «memoria»).
CREATE TABLE radar (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL CHECK (json_valid(valor)),
  actualizado TEXT NOT NULL
);

-- Cada vez que un proyecto entra «en auge», y cuándo sale: el registro para comprobar el radar.
CREATE TABLE auge (
  repo_id INTEGER NOT NULL,
  desde TEXT NOT NULL,
  hasta TEXT,
  repo TEXT NOT NULL,
  datos TEXT NOT NULL CHECK (json_valid(datos)),
  PRIMARY KEY (repo_id, desde)
) WITHOUT ROWID;

-- Una sola alerta por repo sospechoso y tipo: si una persona la descarta, no vuelve a saltar.
CREATE UNIQUE INDEX alerts_por_repo ON alerts (tipo, repo_id);
