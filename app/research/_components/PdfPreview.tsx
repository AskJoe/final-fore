'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFWorker, RenderTask } from 'pdfjs-dist';

const zoomLevels = [75, 100, 125, 150, 200, 300];

export default function PdfPreview({ url, isWorkbook, onError }: { url: string; isWorkbook: boolean; onError: (message: string) => void }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(isWorkbook ? 100 : 0);
  const [width, setWidth] = useState(0);
  const [rendered, setRendered] = useState('');
  const stage = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = `${page}:${zoom}:${width}`;

  useEffect(() => {
    const controller = new AbortController();
    let thread: Worker | undefined;
    let worker: PDFWorker | undefined;
    let loadingTask: PDFDocumentLoadingTask | undefined;

    async function open() {
      try {
        const [pdfjs, response] = await Promise.all([import('pdfjs-dist'), fetch(url, { signal: controller.signal })]);
        if (!response.ok) {
          const details = await response.json().catch(() => null);
          if (!controller.signal.aborted) onError(typeof details?.error === 'string' ? details.error : 'Could not open this preview.');
          return;
        }
        const data = await response.arrayBuffer();
        if (controller.signal.aborted) return;
        thread = new Worker(new URL('./pdf-preview.worker.ts', import.meta.url), { type: 'module' });
        thread.onerror = () => onError('Could not render this PDF.');
        worker = pdfjs.PDFWorker.create({ port: thread });
        loadingTask = pdfjs.getDocument({ data, worker, enableXfa: false });
        const document = await loadingTask.promise;
        if (!controller.signal.aborted) setPdf(document);
      } catch {
        if (!controller.signal.aborted) onError('Could not open this preview.');
      }
    }

    void open();
    return () => {
      controller.abort();
      function disposeWorker() {
        worker?.destroy();
        thread?.terminate();
      }
      if (loadingTask) void loadingTask.destroy().then(disposeWorker, disposeWorker);
      else disposeWorker();
    };
  }, [url, onError]);

  useEffect(() => {
    const container = stage.current!;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!pdf || !canvas || !width) return;
    let active = true;
    let task: RenderTask | undefined;
    async function draw() {
      try {
        const pdfPage = await pdf!.getPage(page);
        if (!active) return;
        const natural = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: zoom ? zoom / 100 : Math.min(1.5, width / natural.width) });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(viewport.width, viewport.height));
        canvas!.width = Math.max(1, Math.floor(viewport.width * pixelRatio));
        canvas!.height = Math.max(1, Math.floor(viewport.height * pixelRatio));
        canvas!.style.width = `${viewport.width}px`;
        canvas!.style.height = `${viewport.height}px`;
        task = pdfPage.render({ canvas: canvas!, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
        await task.promise;
        if (active) setRendered(view);
      } catch {
        if (active) onError('Could not render this PDF page.');
      }
    }
    void draw();
    return () => { active = false; task?.cancel(); };
  }, [pdf, page, width, zoom, view, onError]);

  function goToPage(number: number) {
    stage.current?.scrollTo({ top: 0, left: 0 });
    setPage(number);
  }

  return (
    <>
      {pdf && <div className="research-document-controls">
        <button onClick={() => goToPage(page - 1)} disabled={page === 1}>Previous</button>
        <span aria-live="polite">Page {page} of {pdf.numPages}</span>
        <button onClick={() => goToPage(page + 1)} disabled={page === pdf.numPages}>Next</button>
        <select aria-label="PDF zoom" value={zoom} onChange={event => setZoom(Number(event.target.value))}>
          <option value={0}>Fit width</option>
          {zoomLevels.map(level => <option key={level} value={level}>{level}%</option>)}
        </select>
      </div>}
      {!rendered && <p className="research-file-message" role="status">Opening preview…</p>}
      <div ref={stage} className="research-pdf-stage" tabIndex={0} role="region" aria-label="PDF viewer" aria-busy={rendered !== view}>
        <canvas ref={canvasRef} role="img" aria-label={`PDF page ${page}`} hidden={!rendered} />
      </div>
    </>
  );
}
