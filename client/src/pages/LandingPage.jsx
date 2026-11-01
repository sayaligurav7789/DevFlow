import { useState } from 'react';
import { Link } from 'react-router-dom';
import './LandingPage.css';

const features = [
  {
    icon: '▦',
    title: 'Project management',
    description: 'Organize projects, break work into tasks, and keep every milestone moving.',
    tone: 'violet',
  },
  {
    icon: '◉',
    title: 'Visual task boards',
    description: 'See what is planned, in progress, and completed with clear team visibility.',
    tone: 'blue',
  },
  {
    icon: '♧',
    title: 'Team collaboration',
    description: 'Bring teammates, discussions, documents, and decisions into one workspace.',
    tone: 'green',
  },
  {
    icon: '⌘',
    title: 'GitHub integration',
    description: 'Connect repositories and follow commits, pull requests, issues, and CI runs.',
    tone: 'dark',
  },
  {
    icon: '✳',
    title: 'Slack notifications',
    description: 'Keep your team informed with task updates delivered to the right channel.',
    tone: 'amber',
  },
  {
    icon: '◷',
    title: 'Schedules & activity',
    description: 'Understand timelines and recent activity without jumping between tools.',
    tone: 'rose',
  },
];

const steps = [
  ['01', 'Create your workspace', 'Set up a shared home for your team and projects.'],
  ['02', 'Bring your team together', 'Invite teammates and decide who owns each task.'],
  ['03', 'Plan, build, and deliver', 'Track progress and connect the tools your team already uses.'],
];

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M10 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m4 10 4 4 8-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ProductPreview() {
  return (
    <div className="lp-preview-shell" aria-label="Illustrative DevFlow dashboard preview">
      <div className="lp-preview-window">
        <div className="lp-preview-topbar">
          <div className="lp-window-dots"><i /><i /><i /></div>
          <div className="lp-preview-address">app.devflow / workspace / overview</div>
          <div className="lp-preview-avatar">SG</div>
        </div>

        <div className="lp-preview-app">
          <aside className="lp-preview-sidebar">
            <div className="lp-preview-brand"><img src="/devflow-logo.png" alt="DevFlow" className="lp-brand-logo"/> devflow</div>
            <div className="lp-preview-nav-label">WORKSPACE</div>
            <div className="lp-preview-nav active"><span>▦</span> Overview</div>
            <div className="lp-preview-nav"><span>▤</span> Projects</div>
            <div className="lp-preview-nav"><span>✓</span> My tasks</div>
            <div className="lp-preview-nav"><span>♧</span> Team</div>
            <div className="lp-preview-nav"><span>◷</span> Calendar</div>
            <div className="lp-preview-nav-label lp-preview-bottom-label">WORKSPACE</div>
            <div className="lp-preview-nav"><span>⌘</span> Integrations</div>
          </aside>

          <div className="lp-preview-main">
            <div className="lp-preview-greeting">
              <div>
                <div className="lp-preview-kicker">MONDAY, YOUR WORKSPACE</div>
                <h3>Good morning, Sayali <span>✦</span></h3>
                <p>Here’s what’s happening across your projects.</p>
              </div>
              <span className="lp-preview-new">＋ New project</span>
            </div>

            <div className="lp-preview-stats">
              <div><small>Active projects</small><strong>08</strong><em>Across your workspace</em></div>
              <div><small>Tasks in progress</small><strong>24</strong><em className="lp-positive">↑ 12% this week</em></div>
              <div><small>Completed tasks</small><strong>56</strong><em>This month</em></div>
            </div>

            <div className="lp-preview-lower">
              <div className="lp-preview-panel lp-preview-projects">
                <div className="lp-preview-panel-head"><strong>Project progress</strong><span>View all →</span></div>
                <div className="lp-project-line"><div><b>DevFlow Platform</b><small>Product development</small></div><strong>78%</strong></div>
                <div className="lp-progress"><i style={{ width: '78%' }} /></div>
                <div className="lp-project-line"><div><b>Mobile experience</b><small>Design & engineering</small></div><strong>52%</strong></div>
                <div className="lp-progress"><i style={{ width: '52%' }} /></div>
                <div className="lp-project-line"><div><b>Website refresh</b><small>Marketing</small></div><strong>34%</strong></div>
                <div className="lp-progress"><i style={{ width: '34%' }} /></div>
              </div>
              <div className="lp-preview-panel lp-preview-activity">
                <div className="lp-preview-panel-head"><strong>Recent activity</strong><span>Today</span></div>
                <div className="lp-activity-row"><span className="lp-activity-avatar purple">SG</span><div><b>Sayali</b><small>completed a task</small></div><time>10:42</time></div>
                <div className="lp-activity-row"><span className="lp-activity-avatar green">AK</span><div><b>Anisa</b><small>updated a project</small></div><time>09:18</time></div>
                <div className="lp-activity-row"><span className="lp-activity-avatar blue">RM</span><div><b>Rahul</b><small>joined the workspace</small></div><time>Yesterday</time></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="lp-float-card lp-float-top"><span className="lp-float-check"><CheckIcon /></span><div><b>Task completed</b><small>Great work, team!</small></div></div>
      <div className="lp-float-card lp-float-bottom"><span className="lp-float-github">⌘</span><div><b>GitHub connected</b><small>Activity is up to date</small></div><span className="lp-live-dot" /></div>
    </div>
  );
}

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  return (
    <main className="landing-page">
      <header className="lp-navbar">
        <div className="lp-nav-inner">
          <Link to="/" className="lp-logo" onClick={closeMenu} aria-label="DevFlow home">
            <img src="/devflow-logo.png" alt="DevFlow" className="brand-logo"/>
            <span>devflow</span>
          </Link>

          <button
            type="button"
            className="lp-menu-toggle"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span /><span /><span />
          </button>

          <nav className={`lp-nav-links ${menuOpen ? 'is-open' : ''}`}>
            <a href="#features" onClick={closeMenu}>Features</a>
            <a href="#how-it-works" onClick={closeMenu}>How it works</a>
            <a href="#integrations" onClick={closeMenu}>Integrations</a>
            <Link to="/login" className="lp-nav-login" onClick={closeMenu}>Log in</Link>
            <Link to="/register" className="lp-button lp-button-small" onClick={closeMenu}>
              Get started <ArrowIcon />
            </Link>
          </nav>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-glow lp-glow-one" />
        <div className="lp-hero-glow lp-glow-two" />
        <div className="lp-container lp-hero-content">
          <div className="lp-hero-copy">
            <div className="lp-eyebrow"><span className="lp-eyebrow-dot" /> THE WORKSPACE FOR TEAMS THAT BUILD</div>
            <h1>Make great work<br /> <span>flow together.</span></h1>
            <p className="lp-hero-description">
              Plan projects, bring your team together, and keep development moving.
              Everything your team needs, connected in one clear workspace.
            </p>
            <div className="lp-hero-actions">
              <Link to="/register" className="lp-button">Get started for free <ArrowIcon /></Link>
              <Link to="/login" className="lp-text-link">I already have an account</Link>
            </div>
            <div className="lp-hero-proof">
              <div className="lp-proof-avatars"><span>SG</span><span>AK</span><span>RM</span><span>＋</span></div>
              <p><strong>One connected workspace</strong><br />for your projects and people</p>
            </div>
          </div>
          <div className="lp-hero-visual">
            <ProductPreview />
          </div>
        </div>
        <div className="lp-container lp-trust-strip">
          <span>YOUR WORKFLOW, CONNECTED</span>
          <div className="lp-trust-items">
            <span><b className="lp-trust-github">⌘</b> GitHub</span>
            <span><b className="lp-trust-slack">✳</b> Slack</span>
            <span><b className="lp-trust-check">✓</b> GitHub Actions</span>
            <span><b className="lp-trust-calendar">◷</b> Project schedules</span>
          </div>
        </div>
      </section>

      <section className="lp-section lp-features" id="features">
        <div className="lp-container">
          <div className="lp-section-heading">
            <span className="lp-section-label">ONE PLACE. LESS FRICTION.</span>
            <h2>Everything your team needs<br /><span>to move work forward.</span></h2>
            <p>From the first project plan to the final deployment, keep the important pieces connected.</p>
          </div>
          <div className="lp-feature-grid">
            {features.map((feature) => (
              <article className="lp-feature-card" key={feature.title}>
                <div className={`lp-feature-icon ${feature.tone}`}>{feature.icon}</div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
                <span className="lp-feature-arrow"><ArrowIcon /></span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section lp-workflow" id="how-it-works">
        <div className="lp-container lp-workflow-layout">
          <div className="lp-workflow-intro">
            <span className="lp-section-label">GET IN SYNC, QUICKLY</span>
            <h2>From scattered work<br />to <span>shared momentum.</span></h2>
            <p>Give everyone a clear place to see priorities, take ownership, and make progress together.</p>
            <Link to="/register" className="lp-inline-link">Build your workspace <ArrowIcon /></Link>
          </div>
          <div className="lp-steps">
            {steps.map(([number, title, description]) => (
              <div className="lp-step" key={number}>
                <span className="lp-step-number">{number}</span>
                <div><h3>{title}</h3><p>{description}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section lp-integrations" id="integrations">
        <div className="lp-container lp-integration-banner">
          <div>
            <span className="lp-section-label">KEEP YOUR TOOLS IN THE LOOP</span>
            <h2>Your tools work better<br />when they <span>work together.</span></h2>
            <p>Connect GitHub to follow repository activity and CI runs. Connect Slack to keep your team up to date on task changes.</p>
            <Link to="/register" className="lp-inline-link">Start connecting your workflow <ArrowIcon /></Link>
          </div>
          <div className="lp-integration-tiles">
            <div className="lp-integration-tile"><span className="lp-github-mark">⌘</span><b>GitHub</b><small>Code & collaboration</small><i>Connected workflow</i></div>
            <div className="lp-integration-tile"><span className="lp-slack-mark">✳</span><b>Slack</b><small>Team notifications</small><i>Connected workflow</i></div>
            <div className="lp-integration-tile lp-ci-tile"><span>✓</span><b>GitHub Actions</b><small>Build & deployment status</small><i>Workflow visibility</i></div>
          </div>
        </div>
      </section>

      <section className="lp-final-cta">
        <div className="lp-container lp-final-cta-inner">
          <span className="lp-section-label">READY WHEN YOU ARE</span>
          <h2>Make your next project<br /><span>your best-flowing one.</span></h2>
          <p>Bring your projects, people, and progress into one workspace.</p>
          <Link to="/register" className="lp-button lp-button-light">Get started with DevFlow <ArrowIcon /></Link>
          <small>Already using DevFlow? <Link to="/login">Log in</Link></small>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <Link to="/" className="lp-logo"><img src="/devflow-logo.png" alt="DevFlow" className="brand-logo"/><span>devflow</span></Link>
          <p>One workspace. Every project. Better flow.</p>
          <div><Link to="/login">Log in</Link><Link to="/register">Create account</Link></div>
          <small>© {new Date().getFullYear()} DevFlow. Built for teams that build.</small>
        </div>
      </footer>
    </main>
  );
}
