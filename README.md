# DevFlow⚡

> ### Plan smarter. Collaborate better. Build faster.

**DevFlow** is a full-stack collaborative project management platform designed to simplify project planning, task tracking, team collaboration, and workflow management. It provides a centralized workspace where teams can manage projects, organize tasks, monitor progress, collaborate with members, and access intelligent AI-powered assistance.

Built using **React, Vite, Node.js, Express.js, PostgreSQL, Redis, Docker, and Google Gemini**, DevFlow combines modern full-stack architecture with AI-powered document intelligence through Retrieval-Augmented Generation (RAG).

---

## 📌 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Technology Stack](#-technology-stack)
- [System Architecture](#-system-architecture)
- [AI-Powered Workspace Assistant](#-ai-powered-workspace-assistant)
- [RAG Pipeline](#-rag-retrieval-augmented-generation-pipeline)
- [Authentication and Security](#-authentication-and-security)
- [Workspace and Team Management](#-workspace-and-team-management)
- [Project and Task Management](#-project-and-task-management)
- [Kanban Board](#-kanban-board)
- [Dashboard and Analytics](#-dashboard-and-analytics)
- [Redis Integration](#-redis-integration)
- [Notifications](#-notifications)
- [Database Architecture](#-database-architecture)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Installation and Setup](#-installation-and-setup)
- [Environment Configuration](#-environment-configuration)
- [Running the Application](#-running-the-application)
- [Docker Setup](#-docker-setup)
- [API Reference](#-api-reference)
- [Testing](#-testing)
- [Available Scripts](#-available-scripts)
- [Security Considerations](#-security-considerations)
- [CI Pipeline](#-Continuous-Integration (CI))
- [Deployment](#-deployment)

---

## 🌟 Overview

Managing multiple projects, team members, deadlines, and tasks across different tools can become complicated.

DevFlow addresses this problem by providing a centralized project management environment with:

- Workspace-based collaboration.
- Role-based access control.
- Project and task organization.
- Interactive Kanban boards.
- Dashboard and activity tracking.
- Redis-powered caching and rate limiting.
- Persistent notifications.
- AI-powered workspace assistance.
- Document-based knowledge retrieval.

The platform is designed with modular architecture, secure API communication, workspace-level data isolation, and PostgreSQL as the primary source of truth.

**Database philosophy:** DevFlow uses direct PostgreSQL access through the `pg` package and handwritten SQL queries. No ORM is used.

---

## ✨ Key Features

| Module | Features |
|---|---|
| Authentication | Registration, login, logout, session management, CSRF protection |
| Workspaces | Workspace creation, settings, membership, role management |
| Team Collaboration | Member invitations, email delivery, invitation acceptance |
| Project Management | Project creation, updates, archiving, restoration, deletion |
| Task Management | Task assignment, priorities, statuses, labels, deadlines |
| Kanban Board | Drag-and-drop task organization and column management |
| Dashboard | Project statistics, task completion, overdue tasks, deadlines |
| Activity History | Workspace and project activity tracking |
| Notifications | Persistent notifications and deadline reminders |
| Redis | Dashboard caching and distributed rate limiting |
| DevFlow AI | Gemini-powered workspace assistant |
| Knowledge Base | Document extraction, indexing, embeddings, and semantic retrieval |
| Docker | Containerized PostgreSQL, Redis, and backend infrastructure |
| CI Pipeline | GitHub Actions-based automated validation, testing, and build verification. |

---

## 🛠️ Technology Stack

### Frontend

- React
- Vite
- JavaScript
- Tailwind CSS
- React Router
- React Markdown
- Remark GFM
- @dnd-kit for drag-and-drop interactions

<p align="left">
  <img src="https://skillicons.dev/icons?i=react,vite,js,tailwind" />
</p>

### Backend

- Node.js
- Express.js
- REST API architecture
- JavaScript ES Modules
- dotenv
- Nodemailer
- Direct PostgreSQL access using `pg`

<p align="left">
  <img src="https://skillicons.dev/icons?i=nodejs,express,js" />
</p>

### Database and Caching

- PostgreSQL 16
- Redis 7
- SQL migrations
- JSONB for AI document embeddings

<p align="left">
  <img src="https://skillicons.dev/icons?i=postgres,redis" />
</p>

### Artificial Intelligence

- Google Gemini API
- Gemini embedding model
- Retrieval-Augmented Generation (RAG)
- Text chunking
- Vector embeddings
- Cosine similarity
- Semantic document retrieval

<p align="left">
  <img src="https://skillicons.dev/icons?i=googleai,python" />
</p>

### Document Processing

- PDF.js — PDF text extraction
- Mammoth — DOCX text extraction
- Native Node.js text processing — TXT and Markdown

<p align="left">
  <img src="https://img.shields.io/badge/PDF.js-CC0000?style=for-the-badge&logo=adobeacrobatreader&logoColor=white" />
  <img src="https://img.shields.io/badge/DOCX-Mammoth-blue?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Markdown-000000?style=for-the-badge&logo=markdown&logoColor=white" />
</p>

### DevOps and Developer Tools

- Git and GitHub
- Docker
- Docker Compose
- npm
- Postman
- Visual Studio Code

<p align="left">
  <img src="https://skillicons.dev/icons?i=git,github,docker,vscode,postman,npm" />
</p>
---

## 🏗️ System Architecture

DevFlow follows a modular client-server architecture.

```text
                    USER
                      |
                      v
             React Frontend (Vite)
                      |
                      | REST API
                      v
               Express Backend
                      |
        +-------------+-------------+
        |             |             |
        v             v             v
   Middleware    Controllers     Services
        |             |             |
        +-------------+-------------+
                      |
          +-----------+-----------+
          |           |           |
          v           v           v
      PostgreSQL    Redis      Gemini API
      (Primary DB)  (Cache)     (AI / LLM)
          |           |           |
          |           |           v
          |           |      AI Response
          |           |
          |           v
          |      Cache / Rate Limits
          |
          v
     Persistent Data
```

### Architecture Principles

**1. Separation of Concerns**

- Routes define API endpoints.
- Controllers handle HTTP requests and responses.
- Services contain reusable business logic.
- Middleware handles authentication, authorization, rate limiting, and error handling.
- Database modules manage PostgreSQL connectivity and migrations.

**2. PostgreSQL as the Source of Truth**

All important application data is stored in PostgreSQL, including users, sessions, workspaces, projects, tasks, activity records, notifications, and AI document chunks.

**3. Redis as an Accelerator**

Redis is used for temporary, recomputable data such as dashboard cache entries and rate-limit counters.

**4. Workspace Isolation**

Every workspace-specific operation verifies membership and authorization before accessing its resources.

**5. Stateless API Design**

Session information is stored in PostgreSQL, while Redis manages shared cache and rate-limit data. This supports running multiple API instances behind a load balancer.

---

## 🤖 AI-Powered Workspace Assistant

DevFlow includes an AI-powered workspace assistant that helps users understand project information, tasks, deadlines, discussions, and uploaded documents.

The assistant integrates **Google Gemini** with workspace context and document retrieval to generate relevant responses.

### Features

- Natural-language interaction with the workspace.
- Workspace-aware question answering.
- Contextual responses using project and task information.
- Document-based question answering through RAG.
- Knowledge Base interface for document indexing.
- Markdown-formatted AI responses.
- Source document references in generated answers.
- Workspace-scoped document retrieval.

### Workspace Context

The assistant can use available workspace information, including:

- Projects and their descriptions.
- Tasks, statuses, priorities, and deadlines.
- Assignees.
- Discussions and their authors.

### AI Interaction Flow

```text
       User Opens DevFlow AI
                 |
                 v
          Select Workspace
                 |
                 v
          Ask a Question
                 |
                 v
       Backend Receives Request
                 |
                 v
       Collect Workspace Context
                 |
                 v
        Retrieve Relevant Documents
                 |
                 v
          Gemini API Integration
                 |
                 v
        Generate Contextual Answer
                 |
                 v
       Display Answer and Sources
```

---

## 🧠 RAG (Retrieval-Augmented Generation) Pipeline

DevFlow uses Retrieval-Augmented Generation to allow its AI assistant to answer questions based on uploaded workspace documents.

Instead of depending only on the language model's general knowledge, the application retrieves relevant information from indexed documents and provides it as context to Gemini.

### Document Indexing Workflow

```text
       Document Upload
              |
              v
       Document Storage
              |
              v
       Text Extraction
              |
              v
        Text Chunking
              |
              v
      Embedding Generation
              |
              v
       PostgreSQL Storage
              |
              v
       Indexed Knowledge Base
```

### Question Answering Workflow

```text
          User Question
                |
                v
         Query Embedding
                |
                v
       Semantic Similarity Search
                |
                v
       Retrieve Relevant Chunks
                |
                v
       Build Context for Gemini
                |
                v
         Gemini Generation
                |
                v
        Contextual AI Answer
                |
                v
         Source References
```

### Document Processing

DevFlow supports the following document formats:

| Format | Extension | Processing |
|---|---|---|
| PDF | `.pdf` | PDF.js |
| Microsoft Word | `.docx` | Mammoth |
| Text | `.txt` | Native text extraction |
| Markdown | `.md`, `.markdown` | Native text extraction |

**Note:** Scanned PDFs without an embedded text layer require OCR, which is not currently implemented.

### Text Chunking

Extracted document text is divided into smaller overlapping chunks before embedding generation.

This helps retrieve relevant portions of documents instead of sending entire documents to the language model.

### Embedding Generation

Text chunks and user queries are converted into numerical vector representations using the configured Gemini embedding model.

### Semantic Similarity

Cosine similarity is used to compare the query embedding with stored document embeddings.

Relevant chunks are ranked and the most relevant excerpts are passed to Gemini.

### Storage

Document chunks and their embeddings are stored in PostgreSQL using the `ai_document_chunks` table.

The stored data includes:

- Workspace ID.
- Document ID.
- Chunk index.
- Extracted text content.
- Embedding vector.

### Source References

The AI response includes references to the documents used during retrieval, helping users identify the source of the generated information.

### AI Security

- Document retrieval is scoped to the current workspace.
- Users cannot retrieve documents from other workspaces through the AI endpoint.
- Retrieved document content is treated as untrusted reference data, not as system instructions.
- The assistant is instructed not to invent unavailable workspace facts.

---

## 🔐 Authentication and Security

DevFlow implements session-based authentication and multiple backend security controls.

### Authentication Features

- User registration.
- User login and logout.
- Password hashing using bcrypt.
- Server-side session management.
- Protected routes.
- User profile retrieval and updates.

### Session Management

- Random 256-bit session tokens.
- Only SHA-256 hashes of session tokens are stored in PostgreSQL.
- Session tokens are transmitted through HttpOnly cookies.
- Sessions have a seven-day fixed lifetime.
- Logout invalidates the server-side session.

### CSRF Protection

The backend uses a signed double-submit CSRF token mechanism.

All state-changing API requests require the CSRF cookie and the `X-CSRF-Token` header.

### Authorization

- Workspace membership is checked on the backend.
- Workspace roles determine permitted actions.
- Project and task access is verified through workspace membership.
- Non-members cannot discover resources belonging to other workspaces.

### Additional Security Controls

- Security headers.
- CORS restrictions.
- Request body size limits.
- Strict input validation.
- Parameterized SQL queries.
- Allowlisted sorting fields.
- Centralized error handling.
- Redis-backed rate limiting.
- Environment-based secret management.

---

## 👥 Workspace and Team Management

Workspaces provide isolated environments for teams to organize their projects and collaborate.

### Workspace Features

- Create workspaces.
- View workspaces.
- Update workspace names and descriptions.
- Configure member invitation permissions.
- Manage workspace members.
- Delete workspaces.

### Role-Based Access Control

DevFlow supports three workspace roles:

| Permission | Owner | Admin | Member |
|---|:---:|:---:|:---:|
| View workspace | Yes | Yes | Yes |
| View members | Yes | Yes | Yes |
| Update workspace | Yes | Yes | No |
| Delete workspace | Yes | No | No |
| Invite members | Yes | Yes | Conditional |
| Invite admins | Yes | No | No |
| Change member roles | Yes | No | No |
| Manage invitations | Yes | Yes | No |
| Remove members | Yes | Yes, members only | No |

The owner has full workspace control. Each workspace has exactly one owner.

### Invitation Management

DevFlow supports workspace invitations through email.

The invitation workflow includes:

1. An authorized user enters the invitee's email and role.
2. The backend creates an invitation.
3. If SMTP is configured, an invitation email is sent.
4. The invitee opens the invitation link.
5. The invitee registers or signs in using the invited email.
6. The invitee explicitly accepts the invitation.

### Invitation Security

- Random invitation tokens.
- SHA-256 token hashes stored in PostgreSQL.
- Seven-day invitation expiry.
- Email matching during acceptance.
- Duplicate active invitations prevented.
- Transaction-based membership creation.

Email delivery uses Nodemailer and SMTP.

---

## 📁 Project and Task Management

DevFlow provides project and task management capabilities within workspaces.

### Project Management

- Create projects.
- View project details.
- Update project information.
- Archive projects.
- Restore archived projects.
- Delete projects.
- Search and filter projects.
- Sort and paginate project lists.

### Task Management

Tasks support:

- Title and description.
- Project association.
- Assignee.
- Reporter.
- Status.
- Priority.
- Labels.
- Due dates.
- Creation and update timestamps.

### Task Statuses

| Status | Description |
|---|---|
| Backlog | Work not yet scheduled |
| To Do | Work ready to begin |
| In Progress | Work currently being completed |
| In Review | Work awaiting review |
| Done | Completed work |

### Task Priorities

- Low
- Medium
- High
- Urgent

### Additional Task Capabilities

- Assign and reassign tasks.
- Filter by status and priority.
- Search tasks.
- Filter by assignee and reporter.
- Filter by labels and due dates.
- Sort and paginate task lists.
- Track task activity.
- Validate assignee workspace membership.

Task changes are recorded in workspace-scoped activity history.

---

## 📋 Kanban Board

DevFlow includes an interactive Kanban board for visual task organization.

### Features

- Five task-status columns.
- Drag-and-drop task movement.
- Task ordering within columns.
- Optimistic UI updates.
- Automatic rollback on failed updates.
- Conflict handling and board refresh.
- Alternative Move To menu.
- Mouse, touch, and keyboard interactions.

### Task Ordering

Task positions are stored in PostgreSQL.

The backend calculates positions using neighboring tasks. If repeated reordering exhausts the available position gap, the column is renumbered.

Concurrent moves are serialized using a project row lock.

---

## 📊 Dashboard and Analytics

The workspace dashboard provides an overview of project and task progress.

### Dashboard Metrics

- Total active projects.
- Archived projects.
- Total tasks.
- Task completion rate.
- Overdue tasks.
- Tasks assigned to the current user.
- Task status distribution.
- Project progress.
- Upcoming deadlines.
- Recent activity.

### Dashboard Consistency

Dashboard metrics are calculated using a single PostgreSQL `REPEATABLE READ` snapshot.

This ensures the figures returned in one response are consistent with each other.

---

## ⚡ Redis Integration

Redis is used to improve application performance and support shared rate limiting.

PostgreSQL remains the primary source of truth.

### 1. Dashboard Caching

Dashboard responses are cached for 60 seconds by default.

Cache keys are workspace-scoped and user-scoped.

The response includes an `X-Cache` header:

- `HIT` — Data returned from Redis.
- `MISS` — Cache entry was not available.
- `BYPASS` — Redis was unavailable and PostgreSQL was used.

### Cache Invalidation

Dashboard cache versions are updated after relevant project, task, and member changes.

This avoids serving stale dashboard data after successful updates.

### 2. Distributed Rate Limiting

DevFlow uses Redis-backed rate limiting with an atomic Lua script.

This allows multiple backend instances to share rate-limit counters.

Examples of protected operations include:

- Login.
- Registration.
- Profile updates.
- Workspace invitations.
- Invitation acceptance.
- Member management.
- Workspace and project deletion.

### 3. Redis Failure Handling

If Redis becomes unavailable:

- The API continues serving data from PostgreSQL.
- Dashboard requests bypass Redis.
- Rate limiting falls back to per-process counters.
- Redis command timeouts and a circuit breaker prevent prolonged blocking.

---

## 🔔 Notifications

DevFlow includes persistent notifications stored in PostgreSQL.

### Notification Events

| Event | Recipient |
|---|---|
| Task assigned or reassigned | New assignee |
| Task reassigned away | Previous assignee |
| Task status, priority, or due date changed | Assignee and reporter |
| Task deleted | Assignee and reporter |
| Workspace invitation | Invited user, if an account exists |
| Upcoming or overdue task deadline | Assignee |

### Notification API Capabilities

- Retrieve notifications.
- Filter unread notifications.
- Retrieve unread counts.
- Mark individual notifications as read.
- Mark all notifications as read.

### Deadline Notifications

A scheduled database operation runs every 15 minutes to identify relevant upcoming and overdue tasks.

A unique notification constraint prevents duplicate notifications for the same user and deadline event.

**Current limitation:** Real-time WebSocket delivery and a dedicated notification UI are not implemented.

---

## 🗄️ Database Architecture

DevFlow uses PostgreSQL for persistent application data.

Database operations are performed using:

- `pg` Node.js package.
- Handwritten SQL.
- Parameterized queries.
- Database transactions.
- Numbered SQL migrations.
- PostgreSQL indexes and constraints.

No ORM is used.

### Main Data Areas

| Data | Purpose |
|---|---|
| Users | Account information |
| Sessions | Server-side authentication sessions |
| Workspaces | Workspace details and settings |
| Workspace Members | Membership and roles |
| Workspace Invitations | Invitation lifecycle |
| Projects | Project information |
| Tasks | Task details and assignments |
| Activity Logs | Project and task history |
| Notifications | Persistent user notifications |
| Workspace Documents | Uploaded workspace documents |
| AI Document Chunks | Extracted document chunks and embeddings |

### Database Migrations

Schema changes are maintained in numbered SQL migration files.

| Migration | Purpose |
|---|---|
| 001 | Core tables |
| 002 | Sessions |
| 003 | Workspace management and invitations |
| 004 | Projects and tasks |
| 005 | Kanban, dashboard, and activity optimizations |
| 006 | Notifications |

The migration runner:

- Applies migrations in individual transactions.
- Records SHA-256 checksums.
- Prevents modification of already-applied migrations.
- Uses PostgreSQL advisory locks.
- Stops when a migration fails.

Never modify an applied migration. Create a new numbered migration instead.

---

## 📂 Project Structure

```text
DevFlow/
│
├── client/
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/
│   │   │   ├── projects/
│   │   │   ├── tasks/
│   │   │   └── ...
│   │   │
│   │   ├── context/
│   │   ├── hooks/
│   │   ├── layouts/
│   │   ├── lib/
│   │   ├── pages/
│   │   └── ...
│   │
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
├── server/
│   ├── db/
│   │   └── migrations/
│   │
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── db/
│   │   ├── jobs/
│   │   ├── lib/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── services/
│   │   └── utils/
│   │
│   ├── test/
│   ├── test-support/
│   ├── Dockerfile
│   └── package.json
│
├── e2e/
│   └── ...
│
├── docker-compose.yml
├── package.json
├── .gitignore
└── README.md
```

### Important AI Backend Files

```text
server/src/
├── controllers/
│   └── ai.controller.js
│
└── services/
    ├── ai.service.js
    └── document-extractor.service.js
```

### Frontend AI Component

```text
client/src/
└── components/
    └── DevFlowAI.jsx
```

---

## 💻 Prerequisites

Install the following before running DevFlow:

- Node.js 22 or 24 LTS.
- npm 10 or newer.
- Git.
- PostgreSQL 16.
- Redis 7.
- Docker Desktop with Docker Compose v2 (recommended).
- Google Gemini API key for AI features.

---

## 🚀 Installation and Setup

### 1. Clone the Repository

```bash
git clone <your-repository-url>
cd DevFlow
```

### 2. Install Dependencies

From the repository root:

```bash
npm run install:all
```

Alternatively:

```bash
npm install --prefix client
npm install --prefix server
```

### 3. Configure Environment Variables

Create local environment files:

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

On Windows PowerShell:

```powershell
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env
```

### 4. Configure PostgreSQL and Redis

Update the database and Redis credentials in `server/.env`.

### 5. Configure Gemini

Add your Gemini API key and model configuration to `server/.env`:

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=your_supported_gemini_model
```

Use the model configured and tested with your Gemini API account.

Keep API keys private. Never commit real credentials.

### 6. Run Database Migrations

```bash
npm run db:migrate --prefix server
```

### 7. Seed Development Data

```bash
npm run db:seed --prefix server
```

The seed script creates sample development data and does not create a usable password for the placeholder user. Register a normal account through the application.

---

## ⚙️ Environment Configuration

### Server Environment

The backend uses environment variables for application configuration.

| Variable | Purpose |
|---|---|
| `NODE_ENV` | Runtime environment |
| `PORT` | Backend API port |
| `CLIENT_ORIGIN` | Allowed frontend origin |
| `SESSION_SECRET` | CSRF token signing secret |
| `DEVFLOW_DB_HOST` | PostgreSQL host |
| `DEVFLOW_DB_PORT` | PostgreSQL port |
| `DEVFLOW_DB_NAME` | Database name |
| `DEVFLOW_DB_USER` | Database user |
| `DEVFLOW_DB_PASSWORD` | Database password |
| `DEVFLOW_REDIS_URL` | Redis connection URL |
| `DEVFLOW_REDIS_ENABLED` | Enable or disable Redis |
| `DEVFLOW_REDIS_COMMAND_TIMEOUT_MS` | Redis command timeout |
| `DEVFLOW_DASHBOARD_CACHE_TTL_SECONDS` | Dashboard cache lifetime |
| `DEVFLOW_TRUST_PROXY` | Trusted reverse proxy count |
| `DEVFLOW_RATE_LIMIT_SCALE` | Rate-limit multiplier |
| `GEMINI_API_KEY` | Gemini API key |
| `GEMINI_MODEL` | Gemini generation model |

### Client Environment

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Backend URL for deployed builds |
| `VITE_API_PROXY_TARGET` | Backend target for Vite development proxy |

Additional optional variables for SMTP, Redis, and Docker are documented in `server/.env.example`.

---

## ▶️ Running the Application

Run the frontend and backend in separate terminals.

### Terminal 1 — Backend

```bash
npm run dev:server
```

Default API:

```text
http://localhost:5000
```

### Terminal 2 — Frontend

```bash
npm run dev:client
```

Default frontend:

```text
http://localhost:5173
```

Open the frontend in your browser:

```text
http://localhost:5173
```

Register an account, create a workspace, and start managing projects.

---

## 🐳 Docker Setup

DevFlow includes Docker Compose configuration for PostgreSQL, Redis, and the backend API.

### Start PostgreSQL and Redis

```bash
docker compose --env-file server/.env up -d
```

### Start the Full Backend Stack

```bash
docker compose --env-file server/.env --profile app up -d --build
```

The application stack includes:

- PostgreSQL.
- Redis.
- A one-time database migration service.
- Express backend API.

The React frontend can run separately through Vite during development.

### Useful Docker Commands

```bash
# View running services
docker compose --env-file server/.env ps

# View backend logs
docker compose --env-file server/.env --profile app logs -f backend

# Build the backend image
docker compose --env-file server/.env --profile app build

# Stop containers while preserving data
docker compose --env-file server/.env --profile app down
```

**Warning:** Avoid `docker compose down -v` unless you intentionally want to delete the persistent PostgreSQL and Redis volumes.

---

## 🌐 API Reference

All backend endpoints are prefixed with `/api`.

### Authentication

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/auth/csrf` | Obtain CSRF token |
| POST | `/auth/register` | Register a user |
| POST | `/auth/login` | Authenticate user |
| POST | `/auth/logout` | Log out |
| GET | `/auth/me` | Get current user |
| PATCH | `/auth/me` | Update profile |

### Workspaces

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/workspaces` | List workspaces |
| POST | `/workspaces` | Create workspace |
| GET | `/workspaces/:workspaceId` | Get workspace |
| PATCH | `/workspaces/:workspaceId` | Update workspace |
| DELETE | `/workspaces/:workspaceId` | Delete workspace |
| GET | `/workspaces/:workspaceId/members` | List members |
| PATCH | `/workspaces/:workspaceId/members/:userId` | Change member role |
| DELETE | `/workspaces/:workspaceId/members/:userId` | Remove or leave workspace |

### Invitations

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/workspaces/:workspaceId/invitations` | List invitations |
| POST | `/workspaces/:workspaceId/invitations` | Create invitation |
| DELETE | `/workspaces/:workspaceId/invitations/:invitationId` | Revoke invitation |
| POST | `/invitations/accept` | Accept invitation |

### Projects

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/workspaces/:workspaceId/projects` | List projects |
| POST | `/workspaces/:workspaceId/projects` | Create project |
| GET | `/workspaces/:workspaceId/projects/:projectId` | Get project |
| PATCH | `/workspaces/:workspaceId/projects/:projectId` | Update project |
| DELETE | `/workspaces/:workspaceId/projects/:projectId` | Delete project |
| POST | `/workspaces/:workspaceId/projects/:projectId/archive` | Archive project |
| POST | `/workspaces/:workspaceId/projects/:projectId/restore` | Restore project |

### Tasks

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/projects/:projectId/tasks` | List tasks |
| POST | `/projects/:projectId/tasks` | Create task |
| GET | `/projects/:projectId/tasks/:taskId` | Get task |
| PATCH | `/projects/:projectId/tasks/:taskId` | Update task |
| DELETE | `/projects/:projectId/tasks/:taskId` | Delete task |
| POST | `/projects/:projectId/tasks/:taskId/move` | Move task |
| GET | `/projects/:projectId/tasks/:taskId/activity` | Task activity |

### Dashboard and Activity

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/workspaces/:workspaceId/dashboard` | Workspace dashboard |
| GET | `/workspaces/:workspaceId/activity` | Workspace activity |
| GET | `/projects/:projectId/board` | Kanban board |
| GET | `/projects/:projectId/activity` | Project activity |
| GET | `/workspaces/:workspaceId/tasks` | Workspace-wide tasks |

### Notifications

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/notifications` | Retrieve notifications |
| GET | `/notifications/unread-count` | Get unread count |
| POST | `/notifications/:notificationId/read` | Mark notification as read |
| POST | `/notifications/read-all` | Mark notifications as read |

### AI Endpoints

The AI routes provide workspace-scoped chat, document indexing, and indexed-document listing.

The exact route paths are defined in the backend AI router. Refer to `server/src/routes/` for the current endpoint definitions.

**API Security:** State-changing requests require the CSRF cookie and `X-CSRF-Token` header. Protected routes require a valid session.

---

## 🧪 Testing

DevFlow includes backend tests, frontend unit tests, and browser-based end-to-end tests.

### Backend Tests

```bash
npm test --prefix server
```

Backend tests cover:

- Authentication and sessions.
- CSRF and security headers.
- Workspace authorization.
- Project and task operations.
- Kanban board behavior.
- Dashboard calculations.
- Activity tracking.
- Redis caching.
- Rate limiting.
- Notifications.
- Migration and seed safety.
- Production configuration.

Database-backed tests require a PostgreSQL database whose name ends with `_test`.

### Frontend Tests

```bash
npm test --prefix client
```

### End-to-End Tests

```bash
cd e2e
npm install
```

Run browser tests with Chrome configured:

```bash
CHROME_PATH=/path/to/chrome npm run e2e
```

Run accessibility tests:

```bash
CHROME_PATH=/path/to/chrome npm run axe
```

The browser test suite exercises real application flows against a running backend and frontend.

### Health Check

```bash
curl http://localhost:5000/api/health
```

The API health endpoint checks backend availability and PostgreSQL connectivity.

---

## 📜 Available Scripts

Run the following commands from the repository root.

| Command | Description |
|---|---|
| `npm run install:all` | Install client and server dependencies |
| `npm run dev:client` | Start Vite development server |
| `npm run dev:server` | Start backend in watch mode |
| `npm run start:server` | Start backend normally |
| `npm run build` | Build frontend for production |
| `npm run db:migrate --prefix server` | Apply SQL migrations |
| `npm run db:seed --prefix server` | Seed development data |
| `npm test --prefix server` | Run backend tests |
| `npm test --prefix client` | Run frontend tests |

---

## 🔒 Security Considerations

Security is enforced primarily on the backend.

Important controls include:

- Password hashing with bcrypt.
- HttpOnly session cookies.
- CSRF protection.
- Workspace-level authorization.
- Parameterized SQL queries.
- Input validation and allowlisted sorting.
- Rate limiting.
- CORS restrictions.
- Security headers.
- Centralized error handling.
- Environment-based secrets.
- Workspace-scoped AI document retrieval.

### Important Deployment Practices

- Use strong production database passwords.
- Configure a strong `SESSION_SECRET`.
- Use HTTPS in production.
- Configure the correct `CLIENT_ORIGIN`.
- Use authenticated or managed Redis in production.
- Never expose database credentials or Gemini API keys.
- Never commit `.env` files.
- Back up PostgreSQL before production migrations.

---

## ⚙️ Continuous Integration (CI)

DevFlow uses **GitHub Actions** to automate code validation and maintain code quality throughout the development process.

### CI Pipeline Features

- **Automated Triggers:** Runs workflows when code is pushed or pull requests are created.
- **Dependency Installation:** Installs the required frontend and backend dependencies.
- **Code Validation:** Checks the application for potential errors.
- **Build Verification:** Validates that the frontend production build completes successfully.
- **Automated Testing:** Executes configured tests to identify issues early.
- **Workflow Status:** Reports whether the CI pipeline passes or fails.

---

### CI Workflow

```text
Developer Push / Pull Request
          |
          v
   GitHub Actions Trigger
          |
          v
  Install Dependencies
          |
          v
    Run Configured Tests
          |
          v
  Validate Frontend Build
          |
          v
    CI Status: Pass / Fail
```

The CI pipeline helps detect issues early, maintain code quality, and ensure that changes are validated before integration.

## 🚀 Deployment

DevFlow currently supports local development and Docker-based backend infrastructure.

Production deployment is a planned next step.

A production deployment should include:

1. A static hosting provider for the React frontend.
2. A container platform for the Express backend.
3. Managed PostgreSQL.
4. Managed Redis.
5. Secure environment variable configuration.
6. HTTPS and reverse proxy configuration.
7. Database migrations as a deployment release step.
8. Health checks and monitoring.

The backend exposes `/api/health` for health monitoring.

---

## 👨‍💻 Project

**DevFlow — Collaborative Project Management Platform**

*Bringing project management, team collaboration, and AI-powered document intelligence into one workspace.*

**Built with React, Node.js, PostgreSQL, Redis, Docker, and Google Gemini.**
