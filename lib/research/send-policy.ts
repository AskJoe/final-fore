import { InputError } from '../domain/types';
import type { MailPayload } from './delivery';

export const researchTestOnly=()=>process.env.FINAL_FORE_RESEARCH_TEST_ONLY==='1';

/** Addresses must be entered explicitly; never derive these from a vendor record. */
export function testEmailAddresses(raw:unknown):string[]{
  if(typeof raw!=='string'||raw.length>3000)throw new InputError('Enter 1–10 test email addresses.');
  const parts=raw.split(/[,;\n]/).map(s=>s.trim().toLowerCase()).filter(Boolean);
  if(!parts.length||parts.length>10||parts.some(s=>! /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(s)))throw new InputError('Enter valid test email addresses, separated by commas.');
  return [...new Set(parts)];
}

/** Runs again immediately before Resend, including for old queued jobs and relays. */
export function providerPayload(payload:MailPayload,testOnly:boolean,identity:string):Omit<MailPayload,'testRecipients'>{
  const {testRecipients,...mail}=payload;
  if(testOnly){
    if(!testRecipients?.length)throw new InputError('Test mode blocked a non-test email.');
    const allowed=testEmailAddresses(testRecipients.join(','));
    if(mail.to.length!==allowed.length||mail.to.some(a=>!allowed.includes(a))||new Set(mail.to).size!==allowed.length||mail.cc?.length||'bcc' in mail)throw new InputError('Test mode blocked recipients that were not entered for this test.');
    if(mail.from!==identity||mail.replyTo!==identity)throw new InputError('Test email From and Reply-To must be Sarah’s configured address.');
  }
  return mail;
}
