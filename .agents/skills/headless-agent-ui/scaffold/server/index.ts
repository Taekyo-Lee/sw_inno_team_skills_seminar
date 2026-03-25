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

// Location-aware API configuration
// Reads PROJECT_* prefixed env vars and sets up API keys based on location
console.log('[config] PROJECT_A2G_LOCATION:', process.env.PROJECT_A2G_LOCATION);
console.log('[config] PROJECT_LITE_LLM_KEY exists:', !!process.env.PROJECT_LITE_LLM_KEY);
console.log('[config] PROJECT_LITE_URL:', process.env.PROJECT_LITE_URL);

// Normalize location to match a2g_models convention: CORP, DEV, HOME
const rawLocation = process.env.PROJECT_A2G_LOCATION || 'COMPANY';
const location = ['COMPANY', 'PRODUCTION', 'CORP'].includes(rawLocation) ? 'CORP'
  : ['DEVELOPMENT', 'DEV'].includes(rawLocation) ? 'DEV'
  : rawLocation;
if (location === 'CORP') {
  // Use on-prem LLM (Lite LLM proxy)
  process.env.OPENAI_API_KEY = process.env.PROJECT_LITE_LLM_KEY || process.env.PROJECT_OPENAI_API_KEY || '';
  process.env.OPENAI_API_BASE = process.env.PROJECT_LITE_URL || process.env.PROJECT_OPENAI_API_BASE || '';
  process.env.OPENAI_BASE_URL = process.env.OPENAI_API_BASE;
  process.env.GEMINI_API_KEY = process.env.OPENAI_API_KEY;
  process.env.GOOGLE_API_KEY = process.env.OPENAI_API_KEY;
  console.log(`[config] Location: CORP - Using on-prem LLM (${process.env.OPENAI_API_BASE})`);
  console.log(`[config] API Key set: ${process.env.OPENAI_API_KEY ? 'yes (length: ' + process.env.OPENAI_API_KEY.length + ')' : 'no'}`);
} else if (location === 'HOME' || location === 'DEV') {
  // Use OpenRouter — gemini-cli needs OPENAI_API_KEY/BASE to route through OpenRouter
  process.env.OPENROUTER_API_KEY = process.env.PROJECT_OPENROUTER_API_KEY || '';
  process.env.OPENAI_API_KEY = process.env.PROJECT_OPENROUTER_API_KEY || '';
  process.env.OPENAI_API_BASE = process.env.PROJECT_OPENROUTER_API_BASE || 'https://openrouter.ai/api/v1';
  process.env.OPENAI_BASE_URL = process.env.OPENAI_API_BASE;
  process.env.GEMINI_API_KEY = process.env.OPENAI_API_KEY;
  process.env.GOOGLE_API_KEY = process.env.OPENAI_API_KEY;
  console.log(`[config] Location: ${location} - Using OpenRouter (${process.env.OPENAI_API_BASE})`);
} else {
  console.log(`[config] Unknown location: ${location} - Using defaults`);
}

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
      const _log = console.log; console.log = console.error;
      const { getAvailableModels } = require(${JSON.stringify(GEMINI_CLI_FORK)});
      console.log = _log;
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
  outputExts?: string[],
): string[] {
  const newFiles: string[] = [];
  for (const [file] of after) {
    if (before.has(file)) continue; // only truly new files
    if (outputExts && outputExts.length > 0) {
      const ext = path.extname(file).toLowerCase();
      if (!outputExts.includes(ext)) continue;
    }
    newFiles.push(file);
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

// --- Helper: strip CLI bootstrap noise from stdout chunks ---
const NOISE_RE = /^\[LLMRegistry\].*$/gm;
function stripNoise(raw: string): string {
  const cleaned = raw.replace(NOISE_RE, '').replace(/^\n+/, '');
  return cleaned;
}

// --- Helper: pre-fetch URLs found in a query ---
const URL_RE = /https?:\/\/[^\s"'<>]+/g;
async function prefetchUrls(query: string): Promise<string> {
  const urls = query.match(URL_RE);
  if (!urls || urls.length === 0) return '';

  const results: string[] = [];
  for (const url of urls.slice(0, 3)) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgentUI/1.0)' },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!resp.ok) continue;
      const html = await resp.text();
      // Strip HTML tags, scripts, styles for a readable text extract
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 30000);
      if (text.length > 100) {
        results.push(`<fetched_url src="${url}">\n${text}\n</fetched_url>`);
        console.log(`[prefetch] ${url} → ${text.length} chars`);
      }
    } catch (err) {
      console.warn(`[prefetch] Failed: ${url}`, (err as Error).message);
    }
  }
  return results.length > 0 ? results.join('\n\n') + '\n\n' : '';
}

// --- Helper: run CLI and collect full output ---
function runCli(
  provider: string, model: string, prompt: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let cmd: string;
    let args: string[];
    if (provider === 'opencode') {
      cmd = 'opencode';
      args = ['run'];
      if (model) args.push('-m', model);
      args.push(prompt);
    } else {
      cmd = 'gemini';
      args = ['-p', prompt, '-y', '--sandbox=false', '-o', 'text'];
      if (model) args.push('-m', model);
    }
    const proc = spawn(cmd, args, {
      env: { ...process.env },
      cwd: WORKSPACE,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    proc.stdout!.on('data', (c: Buffer) => { stdout += c.toString(); });
    proc.stderr!.on('data', () => {});
    proc.on('close', () => resolve(stdout));
    proc.on('error', reject);
  });
}

// --- Chat endpoint ---
// Progressive disclosure (2-turn orchestration by server):
//   Turn 1: query + skill list (name/description) → LLM decides which skill
//   Turn 2: if skill chosen → query + full SKILL.md content → LLM executes

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

  const historyContext = formatHistory(Array.isArray(history) ? history as HistoryEntry[] : []);
  const urlContext = await prefetchUrls(query);
  const skills = registry.getAll();

  // --- Turn 1: Discovery via direct API call (no CLI, no tool execution) ---
  // Lightweight LLM call to decide which skill (if any) to use.
  // This mimics tool-calling: LLM returns a skill name or "none".

  // --- Skill matching: try multi-match first, fall back to single ---
  let activatedSkills: import('./skills.js').Skill[] = [];

  // Extract last activated skill from history for follow-up context
  const historyArr = Array.isArray(history) ? history as { role: string; skillName?: string }[] : [];
  const lastSkillName = [...historyArr].reverse().find(h => h.skillName)?.skillName;

  if (skills.length > 0) {
    activatedSkills = registry.matchAllKeyword(query);
    // If no keyword match, let LLM decide (with previous skill context for follow-ups)
    if (activatedSkills.length === 0) {
      const single = await registry.match(query, lastSkillName, historyContext);
      if (single) activatedSkills = [single];
    }
  }

  if (activatedSkills.length > 0) {
    const skillNames = activatedSkills.map(s => s.name);
    res.write(`data: ${JSON.stringify({ type: 'skill', name: skillNames[0], chain: skillNames.length > 1 ? skillNames : undefined })}\n\n`);

    // Helper: run one skill via CLI and stream output
    const runSkill = (skill: import('./skills.js').Skill, step: number, total: number): Promise<number | null> => {
      return new Promise((resolve) => {
        if (total > 1) {
          console.log(`[turn2] Step ${step}/${total}: "${skill.name}"`);
          res.write(`data: ${JSON.stringify({ type: 'chain_step', step, total, skill: skill.name })}\n\n`);
        } else {
          console.log(`[turn2] Activated: "${skill.name}"`);
        }

        const turn2Prompt = `${historyContext}${urlContext}<skill name="${skill.name}">\n${skill.body}\nSkill directory: ${skill.skillDir}/\n</skill>\n\n<instructions>\n- Working directory: ${WORKSPACE}\n- All relative paths in the skill (e.g. scripts/, ooxml/) are relative to the skill directory. Always resolve to absolute paths. Example: "scripts/html2pptx.js" → "${skill.skillDir}/scripts/html2pptx.js"\n- If URLs were provided, their content is already fetched and included above as <fetched_url> tags. Use that content directly instead of trying to access the URL yourself.\n- NEVER ask the user for help, clarification, or to upload files. You have all the tools and information you need. Just execute the task autonomously.\n- If something fails, debug and retry with a different approach. Do not give up or ask for guidance.\n</instructions>\n\nUser request: ${query}`;

        let cmd: string;
        let args: string[];
        if (reqProvider === 'opencode') {
          cmd = 'opencode';
          args = ['run'];
          if (reqModel) args.push('-m', reqModel);
          args.push(turn2Prompt);
        } else {
          cmd = 'gemini';
          args = ['-p', turn2Prompt, '-y', '--sandbox=false', '-o', 'text'];
          if (reqModel) args.push('-m', reqModel);
        }

        const beforeSnap = snapshotFiles(WORKSPACE);
        const proc = spawn(cmd, args, { env: { ...process.env }, cwd: WORKSPACE, stdio: ['ignore', 'pipe', 'pipe'] });
        let hasStdout = false;
        let stderrBuf = '';

        proc.stdout!.on('data', (chunk: Buffer) => {
          const content = stripNoise(chunk.toString());
          if (!content) return;
          hasStdout = true;
          res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
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
          const afterSnap = snapshotFiles(WORKSPACE);
          const newFiles = diffSnapshots(beforeSnap, afterSnap, skill.outputs);
          if (newFiles.length > 0) {
            res.write(`data: ${JSON.stringify({ type: 'files', paths: newFiles })}\n\n`);
          }
          resolve(code);
        });
        proc.on('error', (err: Error) => {
          res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
          resolve(1);
        });
      });
    };

    // Execute skills sequentially
    const total = activatedSkills.length;
    let lastCode: number | null = 0;
    for (let i = 0; i < total; i++) {
      lastCode = await runSkill(activatedSkills[i], i + 1, total);
    }
    res.write(`data: ${JSON.stringify({ type: 'done', exitCode: lastCode })}\n\n`);
    res.end();
    return;
  }

  // --- No skill: run plain query via CLI (streamed) ---
  console.log(`[execution] No skill, plain query`);
  const plainPrompt = (historyContext || urlContext) ? `${historyContext}${urlContext}<instructions>\n- Working directory: ${WORKSPACE}\n- If URLs were provided, their content is already fetched above as <fetched_url> tags. Use that content directly.\n- NEVER ask the user for help. Execute the task autonomously.\n</instructions>\n\nUser request: ${query}` : query;

  let cmd2: string;
  let args2: string[];
  if (reqProvider === 'opencode') {
    cmd2 = 'opencode';
    args2 = ['run'];
    if (reqModel) args2.push('-m', reqModel);
    args2.push(plainPrompt);
  } else {
    cmd2 = 'gemini';
    args2 = ['-p', plainPrompt, '-y', '--sandbox=false', '-o', 'text'];
    if (reqModel) args2.push('-m', reqModel);
  }

  const plainSnap = snapshotFiles(WORKSPACE);
  const plainProc = spawn(cmd2, args2, { env: { ...process.env }, cwd: WORKSPACE, stdio: ['ignore', 'pipe', 'pipe'] });
  let plainHasStdout = false;
  let plainStderr = '';

  plainProc.stdout!.on('data', (chunk: Buffer) => {
    const content = stripNoise(chunk.toString());
    if (!content) return;
    plainHasStdout = true;
    res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
  });
  plainProc.stderr!.on('data', (chunk: Buffer) => {
    plainStderr += chunk.toString();
    res.write(`data: ${JSON.stringify({ type: 'status', content: chunk.toString() })}\n\n`);
  });
  plainProc.on('close', (code: number | null) => {
    if (code !== 0 && !plainHasStdout && plainStderr.trim()) {
      const clean = plainStderr.replace(/\x1b\[[0-9;]*m/g, '').trim();
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: `Error: ${clean}` })}\n\n`);
    }
    const afterPlain = snapshotFiles(WORKSPACE);
    const newPlain = diffSnapshots(plainSnap, afterPlain);
    if (newPlain.length > 0) {
      res.write(`data: ${JSON.stringify({ type: 'files', paths: newPlain })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: 'done', exitCode: code })}\n\n`);
    res.end();
  });
  plainProc.on('error', (err: Error) => {
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
