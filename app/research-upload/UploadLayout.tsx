import type {ReactNode,ChangeEventHandler} from 'react';
export function UploadBrand({children}:{children?:ReactNode}){
  return <header className="rep-brand"><img src="/brand/final-fore-media.png" alt="Final Fore Media" width="1080" height="242"/>{children&&<span>{children}</span>}</header>;
}
export function UploadLayout({firmName,media,deadline,title,fileCount,note,search,onSearch,closed,notice,children}:{firmName:string;media:string;deadline:string;title:string;fileCount:number;note?:ReactNode;search:string;onSearch:(value:string)=>void;closed?:boolean;notice?:string;children:ReactNode}){
  return <main className="rep-upload"><UploadBrand>{firmName} · {media==='broadcast-tv'?'TV':'Radio'}{deadline?' · Due '+deadline:''}</UploadBrand><div className="rep-title"><h1>{title}</h1><span>{fileCount} files received</span></div>{note&&<p className="rep-preview-note">{note}</p>}<div className="rep-toolbar"><input aria-label="Find market" placeholder="Find market" value={search} onChange={e=>onSearch(e.target.value)}/>{closed&&<span>Collection closed</span>}</div>{notice&&<p role="status" className="rep-error">{notice}</p>}{children}</main>;
}
export function UploadMarket({name,disabled,onChoose,children}:{name:string;disabled:boolean;onChoose?:ChangeEventHandler<HTMLInputElement>;children?:ReactNode}){
  return <section className="rep-market"><div className="rep-market-line"><h2>{name}</h2><label className="rep-upload-button">Upload<input aria-label={'Upload files for '+name} type="file" multiple accept=".pdf,.xls,.xlsx,.csv,.doc,.docx,.ppt,.pptx,.txt,.png,.jpg,.jpeg" disabled={disabled} onChange={onChoose}/></label></div><div className="rep-files">{children}</div></section>;
}
