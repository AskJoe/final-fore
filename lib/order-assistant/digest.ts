import { createHash } from 'node:crypto';
import { canonicalJson } from '../domain/json';
export { canonicalJson } from '../domain/json';
/** JSONB preserves array order, but not object insertion order. */
export function canonicalDigest(value:unknown){return createHash('sha256').update(canonicalJson(value)).digest('hex');}
