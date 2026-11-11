import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
export const newToken=()=>randomBytes(32).toString('hex');
export const hashToken=(value:string)=>createHash('sha256').update(value).digest('hex');
export function seal(value:unknown,key:Buffer):string {
  if(key.length!==32)throw new Error('Research encryption requires a 32-byte key.');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from('final-fore-research-v1'));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return ['v1',iv.toString('hex'),cipher.getAuthTag().toString('hex'),encrypted.toString('hex')].join('.');
}
export function unseal<T>(boxed:string,key:Buffer):T {
  const parts=boxed.split('.');
  if(parts.length!==4||parts[0]!=='v1'||parts[1].length!==24||parts[2].length!==32||parts.slice(1).some(s=>!s||s.length%2||!/^[a-f0-9]+$/.test(s)))throw new Error('Invalid encrypted research data.');
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(parts[1],'hex'));
  decipher.setAAD(Buffer.from('final-fore-research-v1'));decipher.setAuthTag(Buffer.from(parts[2],'hex'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[3],'hex')),decipher.final()]).toString('utf8')) as T;
}
