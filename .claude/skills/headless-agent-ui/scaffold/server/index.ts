import express from 'express';
import { spawn, execFileSync } from 'child_process';
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

// Dynamic model list — runs a clean Node subprocess to avoid dependency conflicts
app.get('/api/models', (_req, res) => {
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
    console.error('Failed to load models from gemini-cli-fork:', err);
    res.status(500).json({ error: 'Could not load model registry' });
  }
});

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
    cmd = 'opencode';
    args = ['run', query];
  } else {
    // gemini-cli
    cmd = 'gemini';
    args = ['-p', query, '-y', '--sandbox=false', '-o', 'text'];
    if (model) {
      args.push('-m', model);
    }
  }

  console.log(`[${provider}] Executing: ${cmd} ${args.join(' ')}`);

  const proc = spawn(cmd, args, {
    env: { ...process.env },
    cwd: process.env.AGENT_WORKSPACE || '/workspace',
  });

  proc.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    res.write(`data: ${JSON.stringify({ type: 'chunk', content: text })}\n\n`);
  });

  proc.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    // Send loading status to keep connection alive
    res.write(`data: ${JSON.stringify({ type: 'status', content: text })}\n\n`);
  });

  proc.on('close', (code: number | null) => {
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
