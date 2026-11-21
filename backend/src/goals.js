// The extension's shared goal helpers (redaction, query validation, intent schema) loaded into the backend,
// so the browser and the server enforce exactly the same rules.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const G = require('../../extension/src/shared/goals.js');

export const { redact, safety, cleanQuery, validateIntent, planSearch, youtubeResultsUrl, LANGS } = G;
export default G;
