import express from 'express';
import { spawn, execFileSync } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SkillRegistry, wrapSkillContent } from './skills.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const WORKSPACE = process.env.AGENT_WORKSPACE || '/workspace';

const GEMINI_CLI_FORK = process.env.GEMINI_CLI_FORK_PATH
  || path.resolve(__dirname, '../../gemini-cli-fork/packages/core/dist/index.js');

// Skill registry with hot-reload + global scope
const registry = new SkillRegistry(WORKSPACE);

app.use(express.json());

// --- App config endpoint ---
app.get('/api/config', (_req, res) => {
  res.json({
    appName: process.env.APP_NAME || 'Skill App',
    appSubtitle: process.env.APP_SUBTITLE || 'Lambda-style Agent',
  });
});

// --- Skills endpoint (always returns latest) ---
app.get('/api/skills', (_req, res) => {
  res.json(registry.getAll().map(s => ({
    name: s.name,
    description: s.description,
    scope: s.scope,
    provider: s.provider,
    model: s.model,
  })));
});

// Serve built frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
}

// --- Model list endpoints ---

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

app.get('/api/models/opencode', (_req, res) => {
  try {
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

    const output = execFileSync('opencode', ['models'], {
      env: { ...process.env },
      timeout: 15000,
    });
    const catalogModels = output.toString().split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.includes('migration') && !l.includes('sqlite') && !l.includes('Database'))
      .filter(l => !customIds.has(l))
      .map(name => ({ name, displayName: '', custom: false }));

    res.json([...customModels, ...catalogModels]);
  } catch (err) {
    console.error('Failed to load opencode models:', err);
    res.json([]);
  }
});

// --- File snapshot helper for download detection ---
function snapshotFiles(dir: string): Map<string, number> {
  const snap = new Map<string, number>();
  try {
    const walk = (d: string) => {
      for (const entry of readdirSync(d)) {
        if (entry.startsWith('.') || entry === 'node_modules') continue;
        const full = path.join(d, entry);
        try {
          const st = statSync(full);
          if (st.isDirectory()) walk(full);
          else snap.set(full, st.mtimeMs);
        } catch (_e) { /* skip */ }
      }
    };
    walk(dir);
  } catch (_e) { /* skip */ }
  return snap;
}

function diffSnapshots(
  before: Map<string, number>,
  after: Map<string, number>,
): string[] {
  const newFiles: string[] = [];
  for (const [file, mtime] of after) {
    const prev = before.get(file);
    if (!prev || mtime > prev) {
      newFiles.push(file);
    }
  }
  return newFiles;
}

// --- File download endpoint ---
app.get('/api/download', (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath || !filePath.startsWith(WORKSPACE)) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }
  res.download(filePath);
});

// --- Run a single skill and collect stdout ---
import type { Skill } from './skills.js';

function runSkill(
  skill: Skill,
  prompt: string,
  reqProvider: string,
  reqModel: string,
  res: express.Response,
  stream: boolean,
  historyContext?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const provider = skill.provider || reqProvider;
    const model = skill.model || reqModel;

    const wrappedSkill = wrapSkillContent(skill);

    const injected = `You are an execution agent. You MUST write and run code to produce actual output files. Do NOT just plan, describe, or outline steps — actually execute them.

${wrappedSkill}

IMPORTANT: Do NOT output a plan or description. Write the code, execute it, and create the actual files. The user expects a real file as output, not a summary of what you would do.
Working directory: ${WORKSPACE}

${historyContext}User request: ${prompt}`;

    let cmd: string;
    let args: string[];

    if (provider === 'opencode') {
      cmd = 'opencode';
      args = ['run'];
      if (model) args.push('-m', model);
      args.push(injected);
    } else {
      cmd = 'gemini';
      args = ['-p', injected, '-y', '--sandbox=false', '-o', 'text'];
      if (model) args.push('-m', model);
    }

    console.log(`[${provider}] Executing: ${cmd} ${args[0]} ... (skill: ${skill.name})`);

    const proc = spawn(cmd, args, {
      env: { ...process.env },
      cwd: WORKSPACE,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let hasStdout = false;
    let stderrBuf = '';

    proc.stdout!.on('data', (chunk: Buffer) => {
      hasStdout = true;
      const text = chunk.toString();
      stdout += text;
      if (stream) {
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: text })}\n\n`);
      }
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      if (stream) {
        res.write(`data: ${JSON.stringify({ type: 'status', content: chunk.toString() })}\n\n`);
      }
    });

    proc.on('close', (code: number | null) => {
      if (code !== 0 && !hasStdout && stderrBuf.trim()) {
        const clean = stderrBuf.replace(/\x1b\[[0-9;]*m/g, '').trim();
        if (stream) {
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: `Error: ${clean}` })}\n\n`);
        }
        stdout += `Error: ${clean}`;
      }
      resolve(stdout);
    });

    proc.on('error', (err: Error) => {
      reject(err);
    });
  });
}

// --- Chat history helper ---
interface HistoryEntry { role: 'user' | 'assistant'; content: string }

function formatHistory(history: HistoryEntry[]): string {
  if (!history || history.length === 0) return '';
  // Keep last N turns to avoid prompt bloat
  const recent = history.slice(-10);
  const lines = recent.map(h =>
    `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content.slice(0, 2000)}`,
  );
  return `<conversation_history>\n${lines.join('\n\n')}\n</conversation_history>\n\n`;
}

// --- Chat endpoint ---

app.post('/api/chat', async (req, res) => {
  const { query, provider: reqProvider, model: reqModel, history } = req.body;

  if (!query || !reqProvider) {
    res.status(400).json({ error: 'Missing query or provider' });
    return;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(': heartbeat\n\n');

  // --- Build history context ---
  const historyContext = formatHistory(history as HistoryEntry[]);

  // --- Skill matching ---
  const matched = await registry.match(query);

  if (matched) {
    // --- Resolve skill chain ---
    const chain = registry.resolveChain(matched);
    const chainNames = chain.map(s => s.name);
    res.write(`data: ${JSON.stringify({ type: 'skill', name: matched.name, chain: chainNames.length > 1 ? chainNames : undefined })}\n\n`);
    console.log(`[skills] Matched: ${matched.name} (chain: ${chainNames.join(' -> ')})`);

    const beforeSnap = snapshotFiles(WORKSPACE);

    try {
      let currentPrompt = query;

      for (let i = 0; i < chain.length; i++) {
        const skill = chain[i];
        const isLast = i === chain.length - 1;

        if (chain.length > 1) {
          res.write(`data: ${JSON.stringify({ type: 'chain_step', step: i + 1, total: chain.length, skill: skill.name })}\n\n`);
        }

        const output = await runSkill(skill, currentPrompt, reqProvider, reqModel, res, isLast, historyContext);

        if (!isLast) {
          currentPrompt = `Previous skill (${skill.name}) output:\n${output}\n\nOriginal query: ${query}`;
        }
      }

      const afterSnap = snapshotFiles(WORKSPACE);
      const newFiles = diffSnapshots(beforeSnap, afterSnap);
      if (newFiles.length > 0) {
        res.write(`data: ${JSON.stringify({ type: 'files', paths: newFiles })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ type: 'done', exitCode: 0 })}\n\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: `Error: ${msg}` })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', exitCode: 1 })}\n\n`);
    }

    res.end();
    return;
  }

  // --- No skill matched: run plain query directly ---
  console.log(`[skills] No match for "${query}", running plain query`);

  const fullQuery = historyContext ? `${historyContext}User request: ${query}` : query;

  let cmd: string;
  let args: string[];

  if (reqProvider === 'opencode') {
    cmd = 'opencode';
    args = ['run'];
    if (reqModel) args.push('-m', reqModel);
    args.push(fullQuery);
  } else {
    cmd = 'gemini';
    args = ['-p', fullQuery, '-y', '--sandbox=false', '-o', 'text'];
    if (reqModel) args.push('-m', reqModel);
  }

  console.log(`[${reqProvider}] Executing: ${cmd} ${args.join(' ')}`);

  const proc = spawn(cmd, args, {
    env: { ...process.env },
    cwd: WORKSPACE,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let hasStdout = false;
  let stderrBuf = '';

  proc.stdout!.on('data', (chunk: Buffer) => {
    hasStdout = true;
    res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk.toString() })}\n\n`);
  });

  proc.stderr!.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    res.write(`data: ${JSON.stringify({ type: 'status', content: chunk.toString() })}\n\n`);
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
