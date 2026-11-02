import { useEffect, useMemo, useRef, useState } from 'react';
import { collaborationApi } from '../lib/endpoints.js';
import { useWorkspaces } from '../context/WorkspaceContext.jsx';
import { Button, Notice } from '../components/ui/index.js';
import { Icon } from '../components/ui/Icon.jsx';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = '.pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.pptx';
const formatSize = (bytes = 0) => bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB`
  : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const extensionOf = (name = '') => name.split('.').pop()?.toLowerCase() || 'file';
const fileTypeLabel = (name) => extensionOf(name).toUpperCase();
const fileTypeStyle = (name) => {
  const ext = extensionOf(name);
  if (ext === 'pdf') return 'bg-red-500/10 text-red-400';
  if (['doc', 'docx', 'txt', 'md'].includes(ext)) return 'bg-blue-500/10 text-blue-400';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'bg-emerald-500/10 text-emerald-400';
  if (['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext)) return 'bg-violet-500/10 text-violet-400';
  if (['ppt', 'pptx'].includes(ext)) return 'bg-orange-500/10 text-orange-400';
  return 'bg-raised text-muted';
};

function DocumentTypeIcon({ fileName }) {
  const ext = extensionOf(fileName);
  const iconConfig = {
    pdf: { label: 'PDF', color: '#EF4444', background: 'bg-red-500/10', glyph: 'M5 10.5h6M5 7.5h3.5M5 13h4M4 2.5h5l3 3v8H4zM9 2.5v3h3' },
    doc: { label: 'W', color: '#3B82F6', background: 'bg-blue-500/10', glyph: 'M3.5 2.5h6l3 3v8h-9zM9.5 2.5v3h3M5.5 8l1 4 1.5-3 1.5 3 1-4' },
    docx: { label: 'W', color: '#3B82F6', background: 'bg-blue-500/10', glyph: 'M3.5 2.5h6l3 3v8h-9zM9.5 2.5v3h3M5.5 8l1 4 1.5-3 1.5 3 1-4' },
    txt: { label: 'TXT', color: '#94A3B8', background: 'bg-slate-500/10', glyph: 'M3.5 2.5h9v11h-9zM5.5 6h5M5.5 8.5h5M5.5 11h3' },
    md: { label: 'MD', color: '#94A3B8', background: 'bg-slate-500/10', glyph: 'M3.5 2.5h9v11h-9zM5.5 6h5M5.5 8.5h3M5.5 11h4' },
    xls: { label: 'X', color: '#16A34A', background: 'bg-emerald-500/10', glyph: 'M3.5 2.5h9v11h-9zM6 6l4 5M10 6l-4 5M5.5 4.5h5' },
    xlsx: { label: 'X', color: '#16A34A', background: 'bg-emerald-500/10', glyph: 'M3.5 2.5h9v11h-9zM6 6l4 5M10 6l-4 5M5.5 4.5h5' },
    csv: { label: 'CSV', color: '#16A34A', background: 'bg-emerald-500/10', glyph: 'M3.5 2.5h9v11h-9zM5.5 5.5h5M5.5 8h5M5.5 10.5h5' },
    ppt: { label: 'P', color: '#F97316', background: 'bg-orange-500/10', glyph: 'M3.5 2.5h9v11h-9zM6 11V5.5h2a1.5 1.5 0 0 1 0 3H6' },
    pptx: { label: 'P', color: '#F97316', background: 'bg-orange-500/10', glyph: 'M3.5 2.5h9v11h-9zM6 11V5.5h2a1.5 1.5 0 0 1 0 3H6' },
    png: { label: 'IMG', color: '#A78BFA', background: 'bg-violet-500/10', glyph: 'M3 3.5h10v9H3zM4.5 10l2.5-2.5 2 2 1.5-1.5 2.5 2.5M10.5 5.5h.01' },
    jpg: { label: 'IMG', color: '#A78BFA', background: 'bg-violet-500/10', glyph: 'M3 3.5h10v9H3zM4.5 10l2.5-2.5 2 2 1.5-1.5 2.5 2.5M10.5 5.5h.01' },
    jpeg: { label: 'IMG', color: '#A78BFA', background: 'bg-violet-500/10', glyph: 'M3 3.5h10v9H3zM4.5 10l2.5-2.5 2 2 1.5-1.5 2.5 2.5M10.5 5.5h.01' },
    webp: { label: 'IMG', color: '#A78BFA', background: 'bg-violet-500/10', glyph: 'M3 3.5h10v9H3zM4.5 10l2.5-2.5 2 2 1.5-1.5 2.5 2.5M10.5 5.5h.01' },
  };
  const config = iconConfig[ext] ?? { label: 'FILE', color: '#94A3B8', background: 'bg-slate-500/10', glyph: 'M4 1.5h5l3 3V14H4zM9 1.5V5h3' };

  return (
    <div className={`flex size-14 shrink-0 items-center justify-center rounded-xl ${config.background}`}>
      <svg viewBox="0 0 16 16" className="size-10" fill="none" stroke={config.color} strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" aria-label={`${config.label} file`} role="img">
        <path d={config.glyph} />
      </svg>
    </div>
  );
}

function DocumentCard({ doc, workspaceId, onDelete }) {
  const downloadUrl = collaborationApi.downloadDocument(workspaceId, doc.id);

  return (
    <article className="group flex min-h-[218px] flex-col rounded-xl border border-line bg-panel p-4 transition duration-150 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <DocumentTypeIcon fileName={doc.fileName} />
        <span className="rounded-md bg-raised px-2 py-1 text-[10px] font-semibold text-muted">{fileTypeLabel(doc.fileName)}</span>
      </div>

      <div className="mt-4 min-w-0 flex-1">
        <h2 className="line-clamp-2 break-words text-sm font-semibold leading-5 text-fg" title={doc.fileName}>{doc.fileName}</h2>
        <p className="mt-2 truncate text-xs text-muted" title={doc.projectName || 'Workspace'}>
          {doc.projectName || 'Workspace document'}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-fg">{formatSize(doc.fileSize)}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted">{doc.uploadedBy || 'Former member'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <a
            className="text-xs font-semibold text-accent hover:underline"
            href={downloadUrl}
            download={doc.fileName}
            aria-label={`Download ${doc.fileName}`}
          >Download</a>
          <button
            type="button"
            onClick={() => onDelete(doc.id)}
            className="text-xs text-muted transition-colors hover:text-danger"
            aria-label={`Delete ${doc.fileName}`}
          >Delete</button>
        </div>
      </div>
    </article>
  );
}

export function DocumentsPage() {
  const { current } = useWorkspaces();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const inputRef = useRef(null);

  async function load() {
    if (!current?.id) return;
    setLoading(true);
    setError('');
    try {
      const data = await collaborationApi.documents(current.id);
      setDocuments(data.documents ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [current?.id]);

  async function upload(file) {
    if (!file || !current?.id) return;
    if (file.size > MAX_BYTES) {
      setError('Files must be 5 MB or smaller.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read this file.'));
        reader.readAsDataURL(file);
      });
      await collaborationApi.uploadDocument(current.id, {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        data,
      });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this document permanently?')) return;
    try {
      await collaborationApi.deleteDocument(current.id, id);
      setDocuments((items) => items.filter((item) => item.id !== id));
    } catch (e) {
      setError(e.message);
    }
  }

  const visible = useMemo(() => documents.filter((doc) =>
    `${doc.fileName} ${doc.projectName ?? ''} ${doc.uploadedBy ?? ''}`
      .toLowerCase().includes(search.trim().toLowerCase())), [documents, search]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Icon name="file" className="size-5" />
            </span>
            <h1 className="text-xl font-semibold tracking-tight text-fg">Documents</h1>
          </div>
          <p className="mt-2 text-sm text-muted">
            Shared files for {current?.name ?? 'this workspace'}.
          </p>
        </div>

        <div className="flex gap-2">
          <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          <Button onClick={() => inputRef.current?.click()} loading={busy}>
            <span className="inline-flex items-center gap-2">
              <Icon name="plus" />Upload document
            </span>
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">PDF, text, Markdown, images, DOCX, XLSX and PPTX · Maximum 5 MB per file.</p>
        <div className="flex items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents..."
            aria-label="Search documents"
            className="h-10 w-full min-w-[220px] max-w-sm rounded-lg border border-line bg-panel px-3 text-sm text-fg outline-none focus:border-accent"
          />
          <span className="whitespace-nowrap text-xs text-muted">{visible.length} {visible.length === 1 ? 'file' : 'files'}</span>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {loading ? (
        <div className="rounded-xl border border-line bg-panel p-12 text-center text-sm text-muted">Loading documents…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-panel px-6 py-16 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-raised text-muted"><Icon name="file" className="size-7" /></div>
          <p className="mt-4 font-medium text-fg">{search ? 'No matching documents' : 'No documents yet'}</p>
          <p className="mt-1 text-sm text-muted">Upload project specifications, reports, designs or meeting notes.</p>
          {!search && <Button className="mt-4" onClick={() => inputRef.current?.click()} loading={busy}>Upload your first document</Button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((doc) => (
            <DocumentCard key={doc.id} doc={doc} workspaceId={current.id} onDelete={remove} />
          ))}
        </div>
      )}
    </div>
  );
}
