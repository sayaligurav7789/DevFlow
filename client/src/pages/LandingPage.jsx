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
    <div className="lp-hero-art">
      <img
        src="/devflow-hero-3d.png"
        alt="3D DevFlow calendar dashboard with floating task cards"
        className="lp-hero-art-img"
        draggable="false"
      />
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
        <div className="lp-container lp-integration-banner lp-3d-interactive">

          {/* Left content */}
          <div className="lp-integration-copy">
            <span className="lp-section-label">
              KEEP YOUR TOOLS IN THE LOOP
            </span>

            <h2>
              Your tools work better
              <br />
              when they <span>work together.</span>
            </h2>

            <p>
              Connect GitHub to follow repository activity and CI runs.
              Connect Slack to keep your team up to date on task changes.
            </p>

            <Link to="/register" className="lp-inline-link">
              Start connecting your workflow <ArrowIcon />
            </Link>
          </div>

          {/* Right interactive 3D area */}
          <div
            className="lp-integration-3d-scene"
            onPointerMove={(event) => {
              if (event.pointerType === 'touch') return;

              const rect = event.currentTarget.getBoundingClientRect();

              const x = (event.clientX - rect.left) / rect.width;
              const y = (event.clientY - rect.top) / rect.height;

              event.currentTarget.style.setProperty(
                '--rotate-y',
                `${(x - 0.5) * 13}deg`
              );

              event.currentTarget.style.setProperty(
                '--rotate-x',
                `${(0.5 - y) * 10}deg`
              );
            }}
            onPointerLeave={(event) => {
              event.currentTarget.style.setProperty('--rotate-x', '0deg');
              event.currentTarget.style.setProperty('--rotate-y', '0deg');
            }}
          >
            <div className="lp-integration-glow" />

            <div className="lp-integration-orbit lp-orbit-one" />
            <div className="lp-integration-orbit lp-orbit-two" />

            <div className="lp-integration-tiles">

              {/* GitHub */}
              <div className="lp-integration-tile lp-tile-github">
                <span className="lp-brand-icon github-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.53v-2.08c-3.1.67-3.75-1.32-3.75-1.32-.5-1.28-1.23-1.62-1.23-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15.99 1.7 2.6 1.21 3.23.93.1-.72.39-1.21.7-1.49-2.47-.28-5.07-1.24-5.07-5.5 0-1.21.43-2.2 1.15-2.98-.12-.28-.5-1.42.11-2.95 0 0 .94-.3 3.05 1.14a10.6 10.6 0 0 1 5.55 0c2.12-1.44 3.05-1.14 3.05-1.14.61 1.53.23 2.67.12 2.95.71.78 1.14 1.77 1.14 2.98 0 4.27-2.6 5.21-5.08 5.49.4.35.75 1.02.75 2.06V22c0 .29.2.63.76.53A11.1 11.1 0 0 0 12 .9Z" />
                  </svg>
                </span>

                <b>GitHub</b>
                <small>Code & collaboration</small>
                <i>● Connected workflow</i>
              </div>

              {/* Slack */}
              <div className="lp-integration-tile lp-tile-slack">
                <span className="lp-brand-icon slack-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#36C5F0" d="M9.1 13.1a1.9 1.9 0 1 1-1.9-1.9h1.9v1.9Zm1 0a1.9 1.9 0 1 1 3.8 0v4.8a1.9 1.9 0 1 1-3.8 0v-4.8Z"/>
                    <path fill="#2EB67D" d="M10.1 5.9a1.9 1.9 0 1 1 1.9 1.9h-1.9V5.9Zm0-1a1.9 1.9 0 1 1-3.8 0 1.9 1.9 0 1 1 3.8 0Z"/>
                    <path fill="#ECB22E" d="M18.1 11.1a1.9 1.9 0 1 1 0 3.8h-1.9v-1.9a1.9 1.9 0 0 1 1.9-1.9Zm-1-1a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 1 1 0 3.8Z"/>
                    <path fill="#E01E5A" d="M14.9 10.1a1.9 1.9 0 1 1-3.8 0V8.2H13a1.9 1.9 0 0 1 1.9 1.9Zm1 0a1.9 1.9 0 1 1 3.8 0 1.9 1.9 0 1 1-3.8 0Z"/>
                  </svg>
                </span>

                <b>Slack</b>
                <small>Team notifications</small>
                <i>● Connected workflow</i>
              </div>

              {/* GitHub Actions */}
              <div className="lp-integration-tile lp-tile-ci">
                <span className="lp-brand-icon actions-icon">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.8"/>
                    <circle cx="5" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.8"/>
                    <circle cx="19" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.8"/>
                    <path d="M12 7.5v3.2M10.5 12.2 6.5 16M13.5 12.2l4 3.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                </span>

                <div>
                  <b>GitHub Actions</b>
                  <small>Build & deployment status</small>
                  <i>● Workflow visibility</i>
                </div>
              </div>

            </div>

            <div className="lp-integration-platform" />
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
