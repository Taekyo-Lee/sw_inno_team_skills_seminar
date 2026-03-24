FROM node:20-slim

WORKDIR /app

# Skip TLS verification for corporate proxy/firewall environments
ENV NODE_TLS_REJECT_UNAUTHORIZED=0
RUN npm config set strict-ssl false

# Install Python, pip, and LibreOffice for document generation skills
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    libreoffice-impress poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Configure pip to skip SSL verification globally (for both build-time and runtime agent installs)
RUN pip3 config set global.trusted-host "pypi.org pypi.python.org files.pythonhosted.org" && \
    pip3 install --break-system-packages "markitdown[pptx]" python-pptx Pillow

# Install pptxgenjs globally for creating presentations from scratch
RUN npm install -g pptxgenjs

# Install dependencies (cache layer)
COPY package.json package-lock.json* ./
RUN npm install

# Copy application source
COPY tsconfig.json vite.config.ts index.html docker-entrypoint.sh ./
COPY server/ ./server/
COPY src/ ./src/
RUN chmod +x /app/docker-entrypoint.sh

# Build frontend
RUN ./node_modules/.bin/vite build

# Create workspace directory for coding agents
RUN mkdir -p /workspace

ENV NODE_ENV=production
ENV PORT=3001
ENV NODE_PATH=/usr/local/lib/node_modules

EXPOSE 3001

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
