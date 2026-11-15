/** Honor explicit processing deadlines without treating time in the queue as a failed file. */
export function uploadStatus<S extends string>(file:{state:S;error:string|null;check_deadline?:string|null;updated_at?:string},now=Date.now()):{state:S|'failed';error:string|null}{
 // Queue age is not a verification timeout. Only an explicit processing deadline can expire.
 const deadline=file.check_deadline?Date.parse(file.check_deadline):Infinity;
 if(file.state==='checking'&&deadline<=now)return {state:'failed',error:'Upload verification timed out. Please upload this file again.'};
 return {state:file.state,error:file.error};
}

type FileStatus<S extends string = string> = {
 state: S;
 source: string;
 error: string | null;
 check_deadline?: string | null;
};

export function isStoredFileAvailable(file: Pick<FileStatus, 'source' | 'state'>) {
 // Older portal finalizers used Checking to record that Storage had received the upload.
 return file.state === 'ready' || (file.source === 'portal' && file.state === 'checking');
}

export function storedFileStatus<S extends string>(file: FileStatus<S>): {state: S | 'ready' | 'failed'; error: string | null} {
 if (isStoredFileAvailable(file)) return {state: 'ready', error: null};
 return uploadStatus(file);
}
