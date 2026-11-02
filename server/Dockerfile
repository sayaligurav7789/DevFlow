# syntax=docker/dockerfile:1
#
# DevFlow API image. Build context is ./server (see docker-compose.yml, profile "app").
#
# - Node 24 is the current Active LTS line (Node 22 is in Maintenance until April 2027).
#   Override with --build-arg NODE_VERSION=22 if you must.
# - Debian "slim" (glibc) rather than Alpine: the bcrypt native addon ships glibc prebuilds.
# - Multi-stage: build tools and the npm cache stay out of the runtime image.
# - Runs as the unprivileged "node" user. No secrets are baked in: every credential arrives as an
#   environment variable at run time (docker-compose.yml reads them from server/.env, which is
#   excluded from the build context by .dockerignore and from Git by .gitignore).
ARG NODE_VERSION=24

# ---- Stage 1: production dependencies ---------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app

# Only needed if bcrypt has no prebuilt binary for the platform; it compiles from source then.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# `npm ci` installs exactly what the lockfile says and fails if package.json and the lockfile
# disagree. If it does, run `npm install --prefix server` once and commit the updated lockfile.
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# ---- Stage 2: runtime ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=5000
WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node db ./db

USER node
EXPOSE 5000

# Reports healthy only when the API answers AND PostgreSQL is reachable (GET /api/health is 503 otherwise).
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Exec form, no npm wrapper: Node is PID 1's direct child and receives SIGTERM, so the graceful
# shutdown in src/index.js runs on `docker stop`.
CMD ["sh", "-c", "node src/db/migrate.js && node src/index.js"]
