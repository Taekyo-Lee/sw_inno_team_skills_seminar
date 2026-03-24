import express from 'express';
import { spawn, execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

const GEMINI_CLI_FORK = process.env.GEMINI_CLI_FORK_PATH
  || path.resolve(__dirname, '../../gemini-cli-fork/packages/core/dist/index.js');

app.use(express.json());

// Serve built frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
}

// --- Model list endpoints ---

// gemini-cli: from gemini-cli-fork registry (LOCATION-based)
app.get('/api/models/gemini-cli', (_req, res) => {
  try {
    const script = `
      const { getAvailableModels } = require(${JSON.stringify(GEMINI_CLI_FORK)});
      const fmt = (n) => n >= 1000000 ? Math.round(n/1000000)+'M' : Math.round(n/1000)+'K';
      const models = getAvailableModels().map(m => ({
        name: m.model,
        context: fmt(m.contextLength),
        reasoning: m.reasoningModel,
      }));
      process.stdout.write(JSON.stringify(models));
    `;
    const output = execFileSync('node', ['-e', script], {
      env: { ...process.env },
      timeout: 5000,
    });
    res.json(JSON.parse(output.toString()));
  } catch (err) {
    console.error('Failed to load gemini-cli models:', err);
    res.json([]);
  }
});

// opencode: merge config.json custom models + `opencode models` CLI catalog
app.get('/api/models/opencode', (_req, res) => {
  try {
    // 1. Custom models from config.json (with display names, shown first)
    const configPath = path.join(process.env.HOME || '/root', '.config/opencode/config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const customModels: { name: string; displayName: string; custom: boolean }[] = [];
    const customIds = new Set<string>();
    for (const [providerId, providerConf] of Object.entries(config.provider || {})) {
      const p = providerConf as { models?: Record<string, { name: string }> };
      for (const [modelId, modelInfo] of Object.entries(p.models || {})) {
        const fullId = `${providerId}/${modelId}`;
        customModels.push({
          name: fullId,
          displayName: modelInfo.name || modelId,
          custom: true,
        });
        customIds.add(fullId);
      }
    }

    // 2. Catalog models from `opencode models` CLI
    const output = execFileSync('opencode', ['models'], {
      env: { ...process.env },
      timeout: 15000,
    });
    const catalogModels = output.toString().split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.includes('migration') && !l.includes('sqlite') && !l.includes('Database'))
      .filter(l => !customIds.has(l))  // skip duplicates
      .map(name => ({ name, displayName: '', custom: false }));

    res.json([...customModels, ...catalogModels]);
  } catch (err) {
    console.error('Failed to load opencode models:', err);
    res.json([]);
  }
});

// --- Chat endpoint ---

app.post('/api/chat', (req, res) => {
  const { query, provider, model } = req.body;

  if (!query || !provider) {
    res.status(400).json({ error: 'Missing query or provider' });
    return;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Immediate heartbeat so the proxy knows the connection is alive
  res.write(': heartbeat\n\n');

  let cmd: string;
  let args: string[];

  if (provider === 'opencode') {
    // opencode: model is already in "provider/model" format from dropdown
    cmd = 'opencode';
    args = ['run'];
    if (model) args.push('-m', model);
    args.push(query);
  } else {
    // gemini-cli
    cmd = 'gemini';
    args = ['-p', query, '-y', '--sandbox=false', '-o', 'text'];
    if (model) args.push('-m', model);
  }

  console.log(`[${provider}] Executing: ${cmd} ${args.join(' ')}`);

  const proc = spawn(cmd, args, {
    env: { ...process.env },
    cwd: process.env.AGENT_WORKSPACE || '/workspace',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let hasStdout = false;
  let stderrBuf = '';

  proc.stdout!.on('data', (chunk: Buffer) => {
    hasStdout = true;
    const text = chunk.toString();
    res.write(`data: ${JSON.stringify({ type: 'chunk', content: text })}\n\n`);
  });

  proc.stderr!.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stderrBuf += text;
    res.write(`data: ${JSON.stringify({ type: 'status', content: text })}\n\n`);
  });

  proc.on('close', (code: number | null) => {
    if (code !== 0 && !hasStdout && stderrBuf.trim()) {
      const clean = stderrBuf.replace(/\x1b\[[0-9;]*m/g, '').trim();
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: `Error: ${clean}` })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: 'done', exitCode: code })}\n\n`);
    res.end();
  });

  proc.on('error', (err: Error) => {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  });
});

// SPA fallback in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
