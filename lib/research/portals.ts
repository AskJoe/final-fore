import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { InputError } from '../domain/types';
import { hashToken } from './secrets';
import type { ResearchManifest } from './requests';
import type { Recipient } from './types';
export type PortalRecord={id:string;portalState:'open'|'closed'|'revoked';mode:'live'|'preview';manifest:ResearchManifest;recipient:Recipient};
export interface PortalRepository {find(tokenHash:string):Promise<PortalRecord|null>;}
export const MAX_FILE_SIZE=100*1024*1024;
export const FILE_TYPES:Record<string,string>={pdf:'application/pdf',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',csv:'text/csv',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',txt:'text/plain',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'};
export async function authorizePortal(token:string,repo:PortalRepository,write=false):Promise<PortalRecord>{
  if(!/^[a-f0-9]{64}$/.test(token))throw new InputError('This upload link is not available.');
  const portal=await repo.find(hashToken(token));
  if(!portal||portal.portalState==='revoked')throw new InputError('This upload link is not available.');
  if(write&&portal.portalState!=='open')throw new InputError('This research collection is closed.');
  return portal;
}
export type UploadInput={marketId:string;name:string;size:number;sha256:string;contentType:string};
export function validateUpload(raw:unknown,portal:PortalRecord):UploadInput{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new InputError('Choose a file to upload.');
  const v=raw as Record<string,unknown>;
  if(Object.keys(v).some(k=>!['marketId','name','size','sha256'].includes(k)))throw new InputError('Unknown upload field. Market ownership is fixed by the template.');
  if(typeof v.marketId!=='string'||!portal.manifest.markets.some(m=>m.marketId===v.marketId))throw new InputError('Choose a market from this research request.');
  if(typeof v.name!=='string'||!v.name.trim()||v.name.length>240||/[\x00-\x1f\x7f/\\]/.test(v.name))throw new InputError('Use a valid filename.');
  const extension=v.name.split('.').pop()!.toLowerCase(),contentType=FILE_TYPES[extension];
  if(!contentType)throw new InputError('Upload a PDF, spreadsheet, document, presentation, text file, PNG or JPG.');
  if(!Number.isSafeInteger(v.size)||Number(v.size)<=0||Number(v.size)>MAX_FILE_SIZE)throw new InputError('Files must be between 1 byte and 100 MiB.');
  if(typeof v.sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.sha256))throw new InputError('Unable to verify this file. Choose it again.');
  return {marketId:v.marketId,name:v.name.trim(),size:Number(v.size),sha256:v.sha256,contentType};
}
export async function validateUploadedDocument(bytes:Buffer,metadata:Omit<UploadInput,'marketId'>):Promise<void>{
  if(bytes.length!==metadata.size||bytes.length>MAX_FILE_SIZE)throw new InputError('Uploaded file size does not match.');
  if(createHash('sha256').update(bytes).digest('hex')!==metadata.sha256)throw new InputError('Uploaded file hash does not match. Choose the file again.');
  const extension=metadata.name.split('.').pop()!.toLowerCase();
  if(FILE_TYPES[extension]!==metadata.contentType)throw new InputError('This file format is not allowed.');
  if(['txt','csv'].includes(extension)){
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if(text.includes('\0')||/<\s*(?:html|script|svg|!doctype\s+html)\b/i.test(text))throw new InputError('This file format is not allowed.');
  }else{
    const type=await fileTypeFromBuffer(bytes);
    const legacy=['xls','doc','ppt'].includes(extension)&&type?.ext==='cfb';
    if(!legacy&&type?.mime!==metadata.contentType)throw new InputError('The file format does not match its extension.');
    // Macro-bearing Office documents remain unsupported, including legacy OLE files.
    if(bytes.includes(Buffer.from('vbaProject.bin'))||bytes.includes(Buffer.from('_VBA_PROJECT'))||bytes.includes(Buffer.from('_VBA_PROJECT','utf16le')))throw new InputError('Macro-enabled documents are not supported.');
  }
}
export async function verifyUploadedFile(bytes:Buffer,metadata:Omit<UploadInput,'marketId'>,scan:(bytes:Buffer)=>Promise<boolean>):Promise<'ready'|'held'>{
  await validateUploadedDocument(bytes,metadata);
  return await scan(bytes)?'ready':'held';
}
