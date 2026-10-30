# Hearth web app + agent runtime. The agent's shell commands run inside this
# container (bash), which also gives you an extra layer of isolation.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git python3 python-is-python3 python3-venv ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*'

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci --no-audit --no-fund

# Headless Chromium for the agent's browser tools (+ its system libraries).
RUN npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*

COPY . .
RUN npm run build

ENV HEARTH_HOST=0.0.0.0 \
    HEARTH_PORT=3000 \
    HEARTH_DATA_DIR=/data \
    HEARTH_PROJECTS_DIR=/workspace \
    GIT_AUTHOR_NAME=Hearth GIT_AUTHOR_EMAIL=hearth@localhost \
    GIT_COMMITTER_NAME=Hearth GIT_COMMITTER_EMAIL=hearth@localhost
VOLUME ["/data", "/workspace"]
EXPOSE 3000
CMD ["npm", "run", "start:only"]
