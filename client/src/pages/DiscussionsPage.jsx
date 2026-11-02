import { useEffect, useMemo, useState } from 'react';
import { collaborationApi } from '../lib/endpoints.js';
import { useWorkspaces } from '../context/WorkspaceContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { Avatar, Button, Icon, IconButton, Notice } from '../components/ui/index.js';

const stamp = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};
const sameId = (a, b) => String(a ?? '') === String(b ?? '');

function DiscussionCard({ item, user, replies, expanded, replyText, replyBusy, onLike, onToggleReplies, onReplyText, onReply, onDelete }) {
  const ownPost = sameId(item.authorId, user?.id);
  return (
    <article className="group rounded-xl border border-line bg-panel p-4 transition duration-150 hover:border-line-strong sm:p-5">
      <div className="flex items-start gap-3">
        <Avatar name={item.authorName} id={item.authorId} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-fg">{item.authorName || 'Former member'}</span>
            {ownPost && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">You</span>}
            <span className="text-xs text-muted">· {stamp(item.createdAt)}</span>
          </div>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-fg">{item.body}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onLike(item)} aria-pressed={Boolean(item.likedByMe)} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${item.likedByMe ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-fg'}`}>
              <span aria-hidden="true">{item.likedByMe ? '♥' : '♡'}</span> {item.reactionCount ?? 0} {item.reactionCount === 1 ? 'Like' : 'Likes'}
            </button>
            <button type="button" onClick={() => onToggleReplies(item.id)} aria-expanded={Boolean(expanded)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-fg">
              <Icon name="message-square" className="size-3.5" /> {item.replyCount ?? 0} {item.replyCount === 1 ? 'Reply' : 'Replies'}
            </button>
            {ownPost && <button type="button" onClick={() => onDelete(item.id)} className="ml-auto h-8 rounded-lg px-2.5 text-xs text-muted transition-colors hover:bg-danger-soft hover:text-danger">Delete</button>}
          </div>
          {expanded && (
            <div className="mt-4 space-y-4 rounded-xl border border-line bg-canvas/60 p-3 sm:p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Conversation</p>
                <span className="text-[11px] text-muted">{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
              </div>
              {replies.length === 0 ? (
                <p className="py-2 text-xs text-muted">No replies yet. Start the conversation.</p>
              ) : (
                <div className="space-y-4">
                  {replies.map((reply) => (
                    <div key={reply.id} className="flex gap-2.5">
                      <Avatar name={reply.authorName} id={reply.authorId} size="sm" />
                      <div className="min-w-0 flex-1 rounded-lg bg-panel px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-x-2">
                          <span className="text-xs font-semibold text-fg">{reply.authorName || 'Former member'}</span>
                          <span className="text-[10px] text-muted">{stamp(reply.createdAt)}</span>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-5 text-fg">{reply.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <form onSubmit={(event) => onReply(event, item.id)} className="flex items-end gap-2">
                <Avatar name={user?.displayName || user?.name} id={user?.id} size="sm" />
                <div className="min-w-0 flex-1">
                  <label className="sr-only" htmlFor={`reply-${item.id}`}>Write a reply</label>
                  <textarea id={`reply-${item.id}`} rows={1} maxLength={5000} value={replyText} onChange={(event) => onReplyText(item.id, event.target.value)} placeholder="Write a thoughtful reply…" className="min-h-10 w-full resize-y rounded-lg border border-line bg-panel px-3 py-2.5 text-sm text-fg outline-none transition focus:border-accent" />
                </div>
                <Button type="submit" size="sm" loading={replyBusy} disabled={!replyText.trim() || replyBusy} icon="send">Reply</Button>
              </form>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function DiscussionsPage() {
  const { current } = useWorkspaces();
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [body, setBody] = useState('');
  const [replies, setReplies] = useState({});
  const [replyText, setReplyText] = useState({});
  const [expanded, setExpanded] = useState({});
  const [replyBusy, setReplyBusy] = useState({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [composerOpen, setComposerOpen] = useState(false);

  async function load() {
    if (!current?.id) { setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const data = await collaborationApi.discussions(current.id);
      setItems(data.discussions ?? []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    setItems([]); setReplies({}); setExpanded({}); setReplyText({});
    load();
  }, [current?.id]);

  async function post(event) {
    event.preventDefault();
    if (!body.trim() || !current?.id) return;
    setBusy(true); setError('');
    try {
      const data = await collaborationApi.createDiscussion(current.id, { body: body.trim() });
      setItems((old) => [data.discussion, ...old]);
      setBody(''); setComposerOpen(false); setFilter('all'); setSearch('');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function showReplies(id) {
    const next = !expanded[id];
    setExpanded((old) => ({ ...old, [id]: next }));
    if (next && !Object.prototype.hasOwnProperty.call(replies, id)) {
      try {
        const data = await collaborationApi.replies(current.id, id);
        setReplies((old) => ({ ...old, [id]: data.replies ?? [] }));
      } catch (e) { setError(e.message); }
    }
  }

  async function reply(event, id) {
    event.preventDefault();
    const text = replyText[id]?.trim();
    if (!text || replyBusy[id]) return;
    setReplyBusy((old) => ({ ...old, [id]: true }));
    try {
      const data = await collaborationApi.createReply(current.id, id, { body: text });
      setReplies((old) => ({ ...old, [id]: [...(old[id] ?? []), data.reply] }));
      setReplyText((old) => ({ ...old, [id]: '' }));
      setItems((old) => old.map((item) => sameId(item.id, id) ? { ...item, replyCount: (item.replyCount ?? 0) + 1 } : item));
    } catch (e) { setError(e.message); }
    finally { setReplyBusy((old) => ({ ...old, [id]: false })); }
  }

  async function like(item) {
    try {
      const data = await collaborationApi.toggleReaction(current.id, item.id);
      setItems((old) => old.map((x) => sameId(x.id, item.id) ? { ...x, likedByMe: data.liked, reactionCount: data.reactionCount } : x));
    } catch (e) { setError(e.message); }
  }

  async function remove(id) {
    if (!window.confirm('Delete this discussion and its replies? This cannot be undone.')) return;
    try {
      await collaborationApi.deleteDiscussion(current.id, id);
      setItems((old) => old.filter((x) => !sameId(x.id, id)));
      setReplies((old) => { const next = { ...old }; delete next[id]; return next; });
    } catch (e) { setError(e.message); }
  }

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items
      .filter((item) => {
        if (filter === 'mine' && !sameId(item.authorId, user?.id)) return false;
        if (filter === 'unanswered' && (item.replyCount ?? 0) > 0) return false;
        return !query || `${item.body} ${item.authorName}`.toLowerCase().includes(query);
      })
      .sort((a, b) => sort === 'oldest' ? new Date(a.createdAt) - new Date(b.createdAt) : new Date(b.createdAt) - new Date(a.createdAt));
  }, [items, filter, search, sort, user?.id]);

  const mineCount = items.filter((item) => sameId(item.authorId, user?.id)).length;
  const unansweredCount = items.filter((item) => (item.replyCount ?? 0) === 0).length;

  return (
    <div className="mx-auto w-full max-w-[1100px] mx-auto space-y-6 pb-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent"><Icon name="messages-square" className="size-5" /></span>
            <h1 className="text-xl font-semibold tracking-tight text-fg">Discussions</h1>
          </div>
          <p className="mt-2 text-sm text-muted">Share updates, ask questions and collaborate with {current?.name ?? 'your workspace'}.</p>
        </div>
        <Button icon="plus" onClick={() => setComposerOpen((value) => !value)}>{composerOpen ? 'Close composer' : 'Start discussion'}</Button>
      </header>

      {error && <Notice tone="error" className="flex items-center justify-between">{error} <button type="button" onClick={() => setError('')} className="ml-3 text-xs font-semibold">Dismiss</button></Notice>}

      {composerOpen && (
        <form onSubmit={post} className="anim-pop rounded-2xl border border-accent/30 bg-panel p-4 shadow-sm sm:p-5">
          <div className="flex items-start gap-3">
            <Avatar name={user?.displayName || user?.name} id={user?.id} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="discussion-body" className="text-sm font-semibold text-fg">Start a discussion</label>
                <span className={`text-[11px] tabular-nums ${body.length > 4800 ? 'text-warning' : 'text-muted'}`}>{body.length}/5000</span>
              </div>
              <textarea autoFocus id="discussion-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={4} placeholder="What's happening? Share an update, ask a question, or celebrate a win…" className="mt-3 w-full resize-y rounded-xl border border-line bg-canvas p-3.5 text-sm leading-6 text-fg outline-none transition placeholder:text-faint focus:border-accent" />
              <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] text-muted">Tip: Keep your team in the loop with clear, actionable updates.</p>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" onClick={() => { setComposerOpen(false); setBody(''); }}>Cancel</Button>
                  <Button type="submit" icon="send" loading={busy} disabled={!body.trim() || busy}>Publish discussion</Button>
                </div>
              </div>
            </div>
          </div>
        </form>
      )}

      <section className="rounded-xl border border-line bg-panel p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-canvas p-1">
            {[
              ['all', 'All discussions', items.length],
              ['mine', 'My posts', mineCount],
              ['unanswered', 'Unanswered', unansweredCount],
            ].map(([value, label, count]) => (
              <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-md px-3 py-2 text-xs font-medium transition-colors ${filter === value ? 'bg-active text-fg shadow-sm' : 'text-muted hover:text-fg'}`} aria-pressed={filter === value}>
                {label} <span className="ml-1 text-[10px] opacity-70">{count}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1 sm:w-64">
              <Icon name="search" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search discussions…" aria-label="Search discussions" className="h-9 w-full rounded-lg border border-line bg-canvas pl-9 pr-3 text-sm text-fg outline-none focus:border-accent" />
            </div>
            <label className="sr-only" htmlFor="discussion-sort">Sort discussions</label>
            <select id="discussion-sort" value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 rounded-lg border border-line bg-canvas px-3 text-xs text-fg outline-none focus:border-accent">
              <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
            </select>
            <IconButton icon="refresh-cw" label="Refresh discussions" onClick={load} disabled={loading} />
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between">
        <div><h2 className="text-sm font-semibold text-fg">Workspace conversation</h2><p className="mt-0.5 text-xs text-muted">{visibleItems.length} {visibleItems.length === 1 ? 'discussion' : 'discussions'} shown</p></div>
        {items.length > 0 && <span className="text-[11px] text-muted">Latest updates from your team</span>}
      </div>

      {loading ? (
        <div className="space-y-3" aria-label="Loading discussions">
          {[1, 2].map((n) => <div key={n} className="h-36 animate-pulse rounded-xl border border-line bg-panel" />)}
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-panel px-6 py-14 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent"><Icon name={search ? 'search-x' : 'messages-square'} className="size-6" /></span>
          <h3 className="mt-4 text-sm font-semibold text-fg">{search || filter !== 'all' ? 'No matching discussions' : 'Your team conversation starts here'}</h3>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-muted">{search || filter !== 'all' ? 'Try a different search or switch the filter to see more posts.' : 'Share a project update, ask for feedback, or post a question for your workspace.'}</p>
          {search || filter !== 'all' ? <Button className="mt-4" variant="secondary" size="sm" onClick={() => { setSearch(''); setFilter('all'); }}>Clear filters</Button> : <Button className="mt-4" size="sm" icon="plus" onClick={() => setComposerOpen(true)}>Start the first discussion</Button>}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleItems.map((item) => (
            <DiscussionCard
              key={item.id}
              item={item}
              user={user}
              replies={replies[item.id] ?? []}
              expanded={expanded[item.id]}
              replyText={replyText[item.id] ?? ''}
              replyBusy={replyBusy[item.id]}
              onLike={like}
              onToggleReplies={showReplies}
              onReplyText={(id, value) => setReplyText((old) => ({ ...old, [id]: value }))}
              onReply={reply}
              onDelete={remove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
