FROM node:22-bookworm-slim

# Install system dependencies: Git, OpenSSH, curl, bash, and Docker CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    curl \
    ca-certificates \
    bash \
    gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Install opencode CLI
RUN curl -fsSL https://opencode.ai/install.sh | bash || true
ENV PATH="/root/.opencode/bin:${PATH}"

# Set working directory
WORKDIR /app

# Copy package descriptors
COPY package*.json tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src/ ./src/

# Compile TypeScript
RUN npm run build

# Default environment
ENV NODE_ENV=production
ENV PROJECTS_BASE_DIR=/home/zsn/code
ENV OPENCODE_MODEL=deepseek/deepseek-v4-flash
ENV OPENCODE_FLAGS=--auto

# Start Lumba Bot
CMD ["npm", "start"]
