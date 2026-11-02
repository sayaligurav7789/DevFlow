import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/ui/index.js';
import { useToast } from '../context/ToastContext.jsx';
import { integrationsApi, projectApi } from '../lib/endpoints.js';
import './IntegrationsPage.css';

const EVENTS = [
  ['task_assigned', 'Task assigned'],
  ['task_completed', 'Task completed'],
];

function Status({ connected, pending = false }) {
  return (
    <span className={`integration-status ${connected ? 'is-connected' : pending ? 'is-pending' : ''}`}>
      <span className="integration-status-dot" />
      {connected ? 'Connected' : pending ? 'Needs GitHub' : 'Not connected'}
    </span>
  );
}


function IntegrationCard({ icon, title, description, children, className = '' }) {
  return (
    <article className={`integration-card ${className}`}>
      <div className="integration-card-heading">
        <div className={`integration-logo integration-logo-${icon}`}>
          {icon === 'github' ? (
            <svg viewBox="0 0 24 24" aria-label="GitHub" role="img">
              <path
                fill="currentColor"
                d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.53v-2.08c-3.1.67-3.76-1.32-3.76-1.32-.5-1.28-1.23-1.62-1.23-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15 1 1.71 2.62 1.22 3.26.93.1-.72.39-1.22.71-1.5-2.47-.28-5.07-1.24-5.07-5.5 0-1.22.44-2.21 1.15-2.99-.12-.28-.5-1.42.11-2.95 0 0 .94-.3 3.05 1.14a10.6 10.6 0 0 1 5.55 0c2.12-1.44 3.05-1.14 3.05-1.14.61 1.53.23 2.67.11 2.95.72.78 1.15 1.77 1.15 2.99 0 4.27-2.6 5.22-5.08 5.5.4.35.76 1.02.76 2.06V22c0 .29.2.63.76.52A11.1 11.1 0 0 0 12 .9Z"
              />
            </svg>
          ) : icon === 'slack' ? (
            <svg viewBox="0 0 24 24" aria-label="Slack" role="img">
              <path fill="#36C5F0" d="M9.5 2a1.5 1.5 0 0 0-3 0v4.5h3V2Zm0 6H2a1.5 1.5 0 0 0 0 3h7.5V8Z"/>
              <path fill="#2EB67D" d="M22 9.5a1.5 1.5 0 0 0 0-3h-4.5v3H22Zm-6 0V2a1.5 1.5 0 0 0-3 0v7.5h3Z"/>
              <path fill="#E01E5A" d="M14.5 22a1.5 1.5 0 0 0 3 0v-4.5h-3V22Zm0-6H22a1.5 1.5 0 0 0 0-3h-7.5v3Z"/>
              <path fill="#ECB22E" d="M2 14.5a1.5 1.5 0 0 0 0 3h4.5v-3H2Zm6 0V22a1.5 1.5 0 0 0 3 0v-7.5H8Z"/>
            </svg>
          ) : (
            <span className="integration-ci-icon">CI</span>
          )}
        </div>

        <div className="integration-card-heading-text">
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      {children}
    </article>
  );
}


export default function IntegrationsPage() {
  const { workspaceId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [projects, setProjects] = useState([]);
  const [repositories, setRepositories] = useState([]);
  const [channels, setChannels] = useState([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedRepo, setSelectedRepo] = useState('');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [selectedEvents, setSelectedEvents] = useState(EVENTS.slice(0, 3).map(([key]) => key));
  const [activity, setActivity] = useState(null);
  const [workflowRuns, setWorkflowRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const github = status?.integrations?.github;
  const slack = status?.integrations?.slack;
  const linkedRepositories = status?.repositories || [];
  const selectedRepository = useMemo(
    () => repositories.find((repo) => repo.id === selectedRepo),
    [repositories, selectedRepo],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [integrationData, projectData] = await Promise.all([
        integrationsApi.status(workspaceId),
        projectApi.list(workspaceId, { limit: 100 }),
      ]);
      setStatus(integrationData);
      const list = projectData?.projects || projectData?.items || projectData?.data || [];
      setProjects(Array.isArray(list) ? list : []);
      if (integrationData.slackSettings) {
        setSelectedChannel(integrationData.slackSettings.channelId);
        setSelectedEvents(integrationData.slackSettings.events || []);
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, toast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('integration_error');
    if (connected) {
      toast.success(`${connected === 'github' ? 'GitHub' : 'Slack'} connected successfully.`);
      setSearchParams({}, { replace: true });
      load();
    } else if (error) {
      toast.error(error);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, toast, load]);

  const loadRepositories = async () => {
    setBusy('repositories');
    try {
      const data = await integrationsApi.repositories(workspaceId);
      setRepositories(data.repositories || []);
      toast.success('GitHub repositories loaded.');
    } catch (error) { toast.error(error.message); }
    finally { setBusy(''); }
  };

  const loadChannels = async () => {
    setBusy('channels');
    try {
      const data = await integrationsApi.slackChannels(workspaceId);
      setChannels(data.channels || []);
      toast.success('Slack channels loaded.');
    } catch (error) { toast.error(error.message); }
    finally { setBusy(''); }
  };

  const disconnect = async (provider) => {
    if (!window.confirm(`Disconnect ${provider === 'github' ? 'GitHub' : 'Slack'} from this workspace?`)) return;
    setBusy(provider);
    try {
      await integrationsApi.disconnect(workspaceId, provider);
      toast.success(`${provider === 'github' ? 'GitHub' : 'Slack'} disconnected.`);
      setRepositories([]);
      setChannels([]);
      setActivity(null);
      setWorkflowRuns([]);
      await load();
    } catch (error) { toast.error(error.message); }
    finally { setBusy(''); }
  };

  const linkRepository = async () => {
    if (!selectedProject || !selectedRepository) {
      toast.error('Choose a DevFlow project and a GitHub repository.');
      return;
    }
    setBusy('link');
    try {
      await integrationsApi.linkRepository(workspaceId, {
        projectId: selectedProject,
        repository: selectedRepository,
      });
      toast.success('Repository linked to project.');
      setSelectedRepo('');
      await load();
    } catch (error) { toast.error(error.message); }
    finally { setBusy(''); }
  };

  const loadProjectData = async () => {
    if (!selectedProject) return toast.error('Select a project first.');
    setBusy('project-data');
    try {
      const [activityData, workflowData] = await Promise.all([
        integrationsApi.githubActivity(workspaceId, selectedProject),
        integrationsApi.workflows(workspaceId, selectedProject),
      ]);
      setActivity(activityData);
      setWorkflowRuns(workflowData.workflowRuns || []);
    } catch (error) { toast.error(error.message); }
    finally { setBusy(''); }
  };

  const saveSlack = async () => {
    const channel = channels.find((item) => item.id === selectedChannel);
    if (!channel) return toast.error('Choose a Slack channel first.');
    setBusy('slack-save');
    try {
      await integrationsApi.saveSlackSettings(workspaceId, {
        channelId: channel.id, channelName: channel.name, events: selectedEvents,
      });
      toast.success('Slack notification settings saved.');
      await load();
    } catch (error) { toast.error(error.message); }
    finally { setBusy(''); }
  };

  const testSlack = async () => {
    setBusy('slack-test');
    try {
      const result = await integrationsApi.sendSlackTest(workspaceId);
      toast.success(`Test message sent to #${result.channel}.`);
    } catch (error) { toast.error(error.message); }
    finally { setBusy(''); }
  };

  const toggleEvent = (event) => {
    setSelectedEvents((current) => current.includes(event)
      ? current.filter((item) => item !== event)
      : [...current, event]);
  };

  return (
    <main className="integrations-page">
      <header className="integrations-page-header">
        <div>
          <div className="integrations-breadcrumb">
            <Link to={`/workspaces/${workspaceId}`}>Workspace</Link>
            <Icon name="chevronRight" /> Integrations
          </div>

          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Icon name="link" className="size-5" />
            </span>
            <h1>Integrations</h1>
          </div>

          <p>Connect your development and communication tools to your workspace.</p>
        </div>

        <button
          type="button"
          className="integration-secondary-button"
          onClick={load}
          disabled={loading}
        >
          <Icon name="refresh" /> Refresh
        </button>
      </header>

      <div className="integrations-callout">
        <Icon name="info" />
        <p>Connections are shared at workspace level. Only workspace members can view integration status and settings. OAuth credentials remain on the server.</p>
      </div>

      {loading ? <div className="integrations-loading">Loading integrations…</div> : (
        <div className="integrations-layout">
          <IntegrationCard icon="github" title="GitHub" description="Connect repositories and track development activity, pull requests, issues and CI workflows.">
            <div className="integration-card-body">
              <div className="integration-card-status-row">
                <Status connected={Boolean(github?.connected)} />
                {github?.connected && <span className="integration-account">Connected as <strong>{github.accountName}</strong></span>}
              </div>
              {!github?.connected ? (
                <a className="integration-primary-button" href={integrationsApi.connectUrl(workspaceId, 'github')}>
                  <Icon name="link" /> Connect GitHub
                </a>
              ) : (
                <>
                  <div className="integration-actions">
                    <button type="button" className="integration-primary-button" onClick={loadRepositories} disabled={busy === 'repositories'}>
                      {busy === 'repositories' ? 'Loading…' : 'Browse repositories'}
                    </button>
                    <button type="button" className="integration-danger-button" onClick={() => disconnect('github')} disabled={busy === 'github'}>Disconnect</button>
                  </div>
                  {repositories.length > 0 && (
                    <div className="integration-config-panel">
                      <label>DevFlow project
                        <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)}>
                          <option value="">Select a project</option>
                          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                        </select>
                      </label>
                      <label>GitHub repository
                        <select value={selectedRepo} onChange={(e) => setSelectedRepo(e.target.value)}>
                          <option value="">Select a repository</option>
                          {repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.fullName}{repo.private ? ' · Private' : ''}</option>)}
                        </select>
                      </label>
                      <button type="button" className="integration-primary-button" onClick={linkRepository} disabled={!selectedProject || !selectedRepo || busy === 'link'}>
                        {busy === 'link' ? 'Linking…' : 'Link repository to project'}
                      </button>
                    </div>
                  )}
                  {linkedRepositories.length > 0 && (
                    <div className="integration-linked-list">
                      <h3>Linked repositories</h3>
                      {linkedRepositories.map((repo) => (
                        <div className="integration-linked-row" key={repo.id}>
                          <Icon name="folder" />
                          <span><strong>{repo.repositoryFullName}</strong><small>{repo.projectName} · {repo.defaultBranch}</small></span>
                        </div>
                      ))}
                      <label>Inspect project
                        <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)}>
                          <option value="">Select linked project</option>
                          {linkedRepositories.map((repo) => <option key={repo.projectId} value={repo.projectId}>{repo.projectName}</option>)}
                        </select>
                      </label>
                      <button type="button" className="integration-secondary-button" onClick={loadProjectData} disabled={!selectedProject || busy === 'project-data'}>
                        {busy === 'project-data' ? 'Loading activity…' : 'Load GitHub activity & CI runs'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </IntegrationCard>

          <IntegrationCard icon="slack" title="Slack" description="Send project updates and task notifications to a channel your team chooses.">
            <div className="integration-card-body">
              <div className="integration-card-status-row">
                <Status connected={Boolean(slack?.connected)} />
                {slack?.connected && <span className="integration-account">Connected to <strong>{slack.accountName}</strong></span>}
              </div>
              {!slack?.connected ? (
                <a className="integration-primary-button" href={integrationsApi.connectUrl(workspaceId, 'slack')}>
                  <Icon name="link" /> Connect Slack
                </a>
              ) : (
                <>
                  <div className="integration-actions">
                    <button type="button" className="integration-primary-button" onClick={loadChannels} disabled={busy === 'channels'}>
                      {busy === 'channels' ? 'Loading…' : 'Load channels'}
                    </button>
                    <button type="button" className="integration-danger-button" onClick={() => disconnect('slack')} disabled={busy === 'slack'}>Disconnect</button>
                  </div>
                  {(channels.length > 0 || status?.slackSettings) && (
                    <div className="integration-config-panel">
                      <label>Notification channel
                        <select value={selectedChannel} onChange={(e) => setSelectedChannel(e.target.value)}>
                          <option value="">Select a channel</option>
                          {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}{channel.isPrivate ? ' · Private' : ''}</option>)}
                        </select>
                      </label>
                      <fieldset className="integration-event-options">
                        <legend>Notify this channel about</legend>
                        {EVENTS.map(([key, label]) => (
                          <label key={key} className="integration-checkbox">
                            <input type="checkbox" checked={selectedEvents.includes(key)} onChange={() => toggleEvent(key)} />
                            {label}
                          </label>
                        ))}
                      </fieldset>
                      <div className="integration-actions">
                        <button type="button" className="integration-primary-button" onClick={saveSlack} disabled={!selectedChannel || busy === 'slack-save'}>
                          {busy === 'slack-save' ? 'Saving…' : 'Save settings'}
                        </button>
                        <button type="button" className="integration-secondary-button" onClick={testSlack} disabled={!status?.slackSettings || busy === 'slack-test'}>
                          {busy === 'slack-test' ? 'Sending…' : 'Send test'}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </IntegrationCard>

          {activity && (
            <section className="integration-card integration-activity-card">
              <div className="integration-activity-header">
                <div>
                  <span className="integration-section-eyebrow">REPOSITORY INSIGHTS</span>
                  <h2>GitHub project activity</h2>
                  <p>
                    Recent development activity
                    {projects.find((project) => String(project.id) === String(selectedProject))?.name
                      ? ` for ${projects.find((project) => String(project.id) === String(selectedProject)).name}`
                      : ' from the linked repository'}.
                  </p>
                </div>
                <span className="integration-activity-live"><span /> Loaded</span>
              </div>

              <div className="integration-activity-stats">
                <div className="integration-activity-stat">
                  <span className="integration-activity-stat-label">Commits</span>
                  <strong>{(activity.commits || []).length}</strong>
                  <small>Recent changes</small>
                </div>
                <div className="integration-activity-stat">
                  <span className="integration-activity-stat-label">Pull requests</span>
                  <strong>{(activity.pullRequests || []).length}</strong>
                  <small>Code reviews</small>
                </div>
                <div className="integration-activity-stat">
                  <span className="integration-activity-stat-label">Issues</span>
                  <strong>{(activity.issues || []).length}</strong>
                  <small>Tracked work</small>
                </div>
              </div>

              <div className="integration-activity-columns">
                {[
                  ['Recent commits', activity.commits || [], (item) => item.message, (item) => `${item.author || 'Unknown'} · ${item.date ? new Date(item.date).toLocaleString() : 'Date unavailable'}`, 'commit'],
                  ['Pull requests', activity.pullRequests || [], (item) => `#${item.number} ${item.title}`, (item) => `${item.state || 'Status unavailable'} · ${item.updatedAt ? new Date(item.updatedAt).toLocaleString() : 'Date unavailable'}`, 'pull'],
                  ['Issues', activity.issues || [], (item) => `#${item.number} ${item.title}`, (item) => `${item.state || 'Status unavailable'} · ${item.updatedAt ? new Date(item.updatedAt).toLocaleString() : 'Date unavailable'}`, 'issue'],
                ].map(([title, items, primary, secondary, type]) => (
                  <div className="integration-activity-group" key={title}>
                    <div className="integration-activity-group-heading">
                      <h3>{title}</h3>
                      <span>{items.length}</span>
                    </div>
                    {items.length === 0 ? (
                      <div className="integration-activity-empty">
                        <strong>Nothing to show yet</strong>
                        <p>New {type === 'pull' ? 'pull requests' : type === 'issue' ? 'issues' : 'commits'} will appear here.</p>
                      </div>
                    ) : (
                      <div className="integration-activity-list">
                        {items.map((item) => (
                          <a className="integration-activity-item" href={item.url} target="_blank" rel="noreferrer" key={item.sha || item.id || item.url}>
                            <span className={`integration-activity-marker ${type}`} />
                            <span className="integration-activity-item-content">
                              <strong>{primary(item)}</strong>
                              <small>{secondary(item)}</small>
                            </span>
                            <span className="integration-activity-arrow" aria-hidden="true">↗</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <IntegrationCard icon="github-actions" title="GitHub Actions" description="Review CI workflow runs and deployment outcomes for repositories linked to DevFlow projects." className="integration-card-wide">
            <div className="integration-card-body">
              <div className="integration-card-status-row"><Status connected={Boolean(github?.connected)} pending={!github?.connected} /></div>
              {!github?.connected ? <p className="integration-muted">Connect GitHub and link a repository to enable workflow monitoring.</p> : linkedRepositories.length === 0 ? (
                <p className="integration-muted">Link a GitHub repository to a project to inspect its Actions workflows.</p>
              ) : (
                <div className="integration-workflows">
                  {workflowRuns.length === 0 ? <p className="integration-muted">Select a linked project in the GitHub card and load activity to see recent workflow runs here.</p> : workflowRuns.map((run) => (
                    <a className="integration-workflow-row" href={run.url} target="_blank" rel="noreferrer" key={run.id}>
                      <span className={`workflow-indicator ${run.conclusion === 'success' ? 'success' : run.conclusion === 'failure' ? 'failure' : 'running'}`} />
                      <span className="workflow-main"><strong>{run.displayTitle || run.name}</strong><small>{run.branch} · {run.event} · {new Date(run.createdAt).toLocaleString()}</small></span>
                      <span className="workflow-result">{run.conclusion || run.status}</span>
                      <Icon name="chevronRight" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </IntegrationCard>


        </div>
      )}
    </main>
  );
}
