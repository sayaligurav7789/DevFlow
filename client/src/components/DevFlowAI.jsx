import { useEffect, useRef, useState } from 'react';
import { useWorkspaces } from '../context/WorkspaceContext.jsx';
import { aiApi, collaborationApi } from '../lib/endpoints.js';
import { Button, Icon } from './ui/index.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const STARTERS = [
  'Summarize this workspace.',
  'Which tasks are overdue?',
  'What should the team focus on next?',
];

export function DevFlowAI() {
  const { current } = useWorkspaces();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('chat');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [documents, setDocuments] = useState([]);
  const [docsBusy, setDocsBusy] = useState(false);
  const [indexing, setIndexing] = useState('');
  const bottomRef = useRef(null);
  const workspaceId = current?.id;

  useEffect(() => {
    setMessages([]);
    setError('');
  }, [workspaceId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  async function loadDocuments() {
    if (!workspaceId) return;
    setDocsBusy(true);
    try {
      const [all, indexed] = await Promise.all([
        collaborationApi.documents(workspaceId),
        aiApi.documents(workspaceId),
      ]);
      const indexedMap = new Map(indexed.documents.map((doc) => [doc.documentId, doc]));
      setDocuments((all.documents || []).map((doc) => ({ ...doc, indexed: indexedMap.get(doc.id) || null })));
    } catch (e) {
      setError(e.message);
    } finally {
      setDocsBusy(false);
    }
  }

  useEffect(() => {
    if (open && tab === 'knowledge') loadDocuments();
    // load once when the knowledge tab is opened; refresh button is available
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, workspaceId]);

  async function sendMessage(value = input) {
    const message = value.trim();
    if (!message || busy || !workspaceId) return;
    const prior = messages;
    setMessages((items) => [...items, { role: 'user', content: message }]);
    setInput('');
    setBusy(true);
    setError('');
    try {
      const result = await aiApi.chat(workspaceId, {
        message,
        history: prior.slice(-8).map(({ role, content }) => ({ role, content })),
      });
      setMessages((items) => [...items, { role: 'assistant', content: result.answer, sources: result.sources || [] }]);
    } catch (e) {
      setError(e.message || 'Unable to contact DevFlow AI.');
    } finally {
      setBusy(false);
    }
  }

  async function indexDocument(document) {
    setIndexing(document.id);
    setError('');
    try {
      await aiApi.indexDocument(workspaceId, document.id);
      await loadDocuments();
    } catch (e) {
      setError(e.message);
    } finally {
      setIndexing('');
    }
  }

  if (!workspaceId) return null;

  return (
    <>
      {open && (
        <section className="fixed bottom-20 right-4 z-[90] flex h-[min(680px,calc(100dvh-7rem))] w-[min(430px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_20px_70px_rgba(0,0,0,.28)]" aria-label="DevFlow AI assistant">
          <header className="flex items-center justify-between border-b border-line bg-raised/60 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-fg"><Icon name="message" className="size-5" /></span>
              <div>
                <h2 className="text-sm font-semibold text-fg">DevFlow AI</h2>
                <p className="text-[11px] text-muted">Workspace-aware assistant</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md p-2 text-muted hover:bg-hover" aria-label="Close assistant"><Icon name="close" /></button>
          </header>

          <div className="flex gap-1 border-b border-line px-3 py-2">
            <button type="button" onClick={() => setTab('chat')} className={`rounded-md px-3 py-1.5 text-xs font-medium ${tab === 'chat' ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover'}`}>Chat</button>
            <button type="button" onClick={() => setTab('knowledge')} className={`rounded-md px-3 py-1.5 text-xs font-medium ${tab === 'knowledge' ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover'}`}>Knowledge base</button>
          </div>

          {tab === 'chat' ? (
            <>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                {!messages.length && (
                  <div className="py-5">
                    <p className="text-base font-semibold text-fg">How can I help with {current?.name || 'your workspace'}?</p>
                    <p className="mt-1 text-xs leading-5 text-muted">Ask about projects, tasks, deadlines, discussions, or indexed documents.</p>
                    <div className="mt-5 space-y-2">
                      {STARTERS.map((starter) => <button key={starter} type="button" onClick={() => sendMessage(starter)} className="block w-full rounded-lg border border-line px-3 py-2.5 text-left text-xs text-fg hover:bg-hover">{starter}</button>)}
                    </div>
                  </div>
                )}
                {messages.map((message, index) => (
                  <div key={`${index}-${message.role}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[90%] rounded-xl px-3.5 py-3 ${message.role === 'user' ? 'bg-accent text-accent-fg' : 'border border-line bg-raised text-fg'}`}>
                      <div className="devflow-markdown text-xs leading-5">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({ children }) => (
                              <p className="mb-2 last:mb-0">{children}</p>
                            ),
                            strong: ({ children }) => (
                              <strong className="font-bold text-fg">{children}</strong>
                            ),
                            em: ({ children }) => (
                              <em className="italic">{children}</em>
                            ),
                            ul: ({ children }) => (
                              <ul className="my-2 ml-4 list-disc space-y-1">{children}</ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="my-2 ml-4 list-decimal space-y-1">{children}</ol>
                            ),
                            li: ({ children }) => (
                              <li className="pl-1">{children}</li>
                            ),
                            h1: ({ children }) => (
                              <h1 className="mb-2 text-base font-bold">{children}</h1>
                            ),
                            h2: ({ children }) => (
                              <h2 className="mb-2 text-sm font-bold">{children}</h2>
                            ),
                            h3: ({ children }) => (
                              <h3 className="mb-1 text-xs font-bold">{children}</h3>
                            ),
                            code: ({ children, className }) => {
                              const isBlock = Boolean(className);

                              return isBlock ? (
                                <code className="block overflow-x-auto rounded-lg bg-canvas p-3 font-mono text-[11px]">
                                  {children}
                                </code>
                              ) : (
                                <code className="rounded bg-canvas px-1 py-0.5 font-mono text-[11px]">
                                  {children}
                                </code>
                              );
                            },
                            pre: ({ children }) => (
                              <pre className="my-2 overflow-x-auto rounded-lg border border-line bg-canvas">
                                {children}
                              </pre>
                            ),
                            blockquote: ({ children }) => (
                              <blockquote className="my-2 border-l-2 border-accent pl-3 text-muted">
                                {children}
                              </blockquote>
                            ),
                          }}
                        >
                          {message.content || ''}
                        </ReactMarkdown>
                      </div>
                      {!!message.sources?.length && <div className="mt-3 border-t border-line/70 pt-2"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Sources</p>{message.sources.map((source, i) => <p key={`${source.documentId}-${i}`} className="text-[11px] text-muted">{i + 1}. {source.fileName}</p>)}</div>}
                    </div>
                  </div>
                ))}
                {busy && <div className="text-xs text-muted">DevFlow AI is thinking…</div>}
                <div ref={bottomRef} />
              </div>
              {error && <p role="alert" className="mx-3 mb-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
              <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="flex items-end gap-2 border-t border-line p-3">
                <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} rows={2} maxLength={3000} placeholder="Ask about your workspace…" className="max-h-28 min-h-10 flex-1 resize-none rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-fg outline-none placeholder:text-faint focus:border-accent" />
                <Button type="submit" variant="primary" disabled={!input.trim() || busy} icon="send">Send</Button>
              </form>
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mb-3 flex items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-fg">Workspace documents</h3><p className="mt-1 text-[11px] text-muted">Index PDF, DOCX, TXT and Markdown files so AI can answer from their contents.</p></div><Button size="sm" variant="secondary" icon="refresh" onClick={loadDocuments} loading={docsBusy}>Refresh</Button></div>
              {error && <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
              {docsBusy ? <p className="py-6 text-center text-xs text-muted">Loading documents…</p> : documents.length ? <div className="space-y-2">{documents.map((doc) => <div key={doc.id} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3"><div className="min-w-0"><p className="truncate text-xs font-medium text-fg">{doc.fileName}</p><p className="mt-1 text-[10px] text-muted">{doc.indexed?.chunks ? `${doc.indexed.chunks} chunks indexed` : 'Not indexed'}</p></div><Button size="sm" variant={doc.indexed?.chunks ? 'secondary' : 'primary'} loading={indexing === doc.id} disabled={Boolean(indexing)} onClick={() => indexDocument(doc)}>{doc.indexed?.chunks ? 'Re-index' : 'Index'}</Button></div>)}</div> : <p className="py-8 text-center text-xs text-muted">No documents uploaded to this workspace yet.</p>}
              <p className="mt-4 text-[10px] leading-4 text-muted">
                Supports PDF, DOCX, TXT and Markdown documents.
                Scanned PDFs require OCR. Documents remain private to workspace members.
              </p>
            </div>
          )}
        </section>
      )}
      <button type="button" onClick={() => setOpen((value) => !value)} aria-label={open ? 'Close DevFlow AI' : 'Open DevFlow AI'} className="fixed bottom-5 right-5 z-[91] flex h-14 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg shadow-lg transition-transform hover:scale-[1.03]">
        <Icon name={open ? 'close' : 'message'} className="size-5" />{open ? 'Close' : 'Ask AI'}
      </button>
    </>
  );
}
