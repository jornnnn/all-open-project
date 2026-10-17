-- Lote de proyectos que manda el robot, guardado solo mientras dura la petición. Así el JSON viaja
-- a D1 una sola vez y las demás consultas lo leen de aquí: enviarlo cuatro veces costaba al Worker
-- 24-36 ms de CPU por lote, y el plan gratuito permite 10 ms (medido el 17-oct-2026).
-- La misma petición lo borra al terminar. La comprobación json_valid rechaza un JSON roto.
CREATE TABLE ingesta_lotes (
  id TEXT PRIMARY KEY,
  datos TEXT NOT NULL CHECK (json_valid(datos))
);
