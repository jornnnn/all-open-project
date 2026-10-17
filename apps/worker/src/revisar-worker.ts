// Entrada del Worker de revisión (wrangler.revisar.jsonc). Va en su propio archivo porque Cloudflare
// trata como Worker todo lo que exporta la entrada, y src/revisar.ts exporta también sus consultas.

import { revisar } from './revisar.ts';

export default revisar;
