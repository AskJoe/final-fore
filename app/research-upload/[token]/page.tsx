import type { Metadata } from 'next';
import { researchAdmin, researchWritesEnabled } from '@/lib/research/config';
import { ResearchUploads, publicFile } from '@/lib/research/uploads';
import UploadClient from '../UploadClient';
import { UploadBrand } from '../UploadLayout';
import '../upload.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Upload research · Final Fore',robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function UploadPage({params}:{params:Promise<{token:string}>}){
  const {token}=await params;
  if(!researchWritesEnabled())return <main className="rep-upload"><UploadBrand/><h1>Upload research</h1><p>Research uploads are not enabled yet.</p></main>;
  try{
    const uploads=new ResearchUploads(researchAdmin()),portal=await uploads.portal(token),files=(await uploads.files(portal)).map(publicFile);
    return <UploadClient token={token} firmName={portal.manifest.firmName} media={portal.manifest.media} deadline={portal.manifest.deadline} markets={portal.manifest.displayMarkets??portal.manifest.markets} initialFiles={files} initialState={portal.portalState} storageUrl={process.env.NEXT_PUBLIC_SUPABASE_URL!} preview={portal.mode==='preview'}/>;
  }catch{return <main className="rep-upload"><UploadBrand/><h1>Upload research</h1><p>This upload link is not available. Contact Final Fore for a current link.</p></main>;}
}
