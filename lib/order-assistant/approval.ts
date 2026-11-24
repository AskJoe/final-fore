import { createHmac,timingSafeEqual } from 'node:crypto';
import { check } from '../domain/types';
export function approvalToken(key:string,userId:string,contextId:string,hash:string,now=Date.now()){
  const expires=Math.floor(now/1000)+600;
  const signature=createHmac('sha256',key).update(JSON.stringify(['ff-market-approval-v1',userId,contextId,hash,expires])).digest('hex');
  return expires+'.'+signature;
}
export function verifyApproval(token:unknown,key:string,userId:string,contextId:string,hash:string,now=Date.now()){
  check(typeof token==='string'&&/^\d{10}\.[0-9a-f]{64}$/.test(token),'Apply the proposal using its review control.');
  const [raw,signature]=token.split('.'),expires=Number(raw);
  check(expires>=Math.floor(now/1000)&&expires<=Math.floor(now/1000)+600,'The review expired. Refresh this proposal.');
  const expected=createHmac('sha256',key).update(JSON.stringify(['ff-market-approval-v1',userId,contextId,hash,expires])).digest('hex');
  check(timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex')),'Approve the exact reviewed proposal.');
}
