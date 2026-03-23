import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Serve built frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
}

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
    cmd = 'gemini';
    args = ['-p', query, '-y', '--sandbox=false', '-o', 'text'];
    if (model) {
      args.push('-m', model);
    }
  }

  console.log(`[${provider}] Executing: ${cmd} ${args.join(' ')}`);

  const proc = spawn(cmd, args, { env: { ...process.env } });

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
