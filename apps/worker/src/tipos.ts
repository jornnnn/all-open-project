/** Lo que el Worker recibe de Cloudflare: la base de datos y la clave del robot. */
export interface Entorno {
  DB: D1Database;
  /** Clave que comparte con el robot (secreto). Sin ella, /ingest no acepta nada. */
  INGEST_KEY?: string;
}

export interface Contexto {
  Bindings: Entorno;
}
