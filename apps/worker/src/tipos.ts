/** Lo que el Worker recibe de Cloudflare: la base de datos y sus secretos. */
export interface Entorno {
  DB: D1Database;
  /** Clave que comparte con el robot (secreto). Sin ella, /ingest no acepta nada. */
  INGEST_KEY?: string;
  /**
   * Solo en el Worker de revisión: correos que pueden revisar alertas, separados por comas
   * (secreto, para no publicar correos en el repositorio). Sin él, la revisión no abre.
   */
  REVISORES?: string;
}

export interface Contexto {
  Bindings: Entorno;
}
