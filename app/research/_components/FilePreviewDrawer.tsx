'use client';

import { useEffect, useRef, useState } from 'react';
import { filePreviewKind } from '@/lib/research/file-preview';
import PdfPreview from './PdfPreview';

export type PreviewFile = { id: string; name: string; sender: string; market: string };

export default function FilePreviewDrawer({ file, onClose }: { file: PreviewFile; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const isWorkbook = filePreviewKind(file.name) === 'excel';
  const query = `id=${encodeURIComponent(file.id)}`;

  useEffect(() => {
    const element = dialog.current!;
    const trigger = document.activeElement;
    element.showModal();
    closeButton.current?.focus();
    return () => {
      element.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  function retry() {
    setError('');
    setAttempt(value => value + 1);
  }

  return (
    <dialog ref={dialog} className="research-template-drawer research-file-drawer" aria-labelledby="file-preview-title"
      onCancel={event => { event.preventDefault(); onClose(); }}>
      <header className="research-drawer-header">
        <div>
          <h2 id="file-preview-title">{file.name}</h2>
          <span>{file.market} · {file.sender}</span>
        </div>
        <div className="research-file-drawer-actions">
          <a className="research-button" href={`/api/research/files/download?${query}`} download>Download original</a>
          <button ref={closeButton} type="button" onClick={onClose}>Close</button>
        </div>
      </header>
      {error ? <div className="research-file-message" role="alert"><p>{error}</p><button onClick={retry}>Try again</button></div>
        : <PdfPreview key={attempt} url={`/api/research/files/preview?${query}`} isWorkbook={isWorkbook} onError={setError} />}
    </dialog>
  );
}
