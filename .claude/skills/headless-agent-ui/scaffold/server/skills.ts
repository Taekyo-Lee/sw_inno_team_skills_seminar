import { readFileSync, readdirSync, statSync, watch } from 'fs';
import path from 'path';

export interface Skill {
  name: string;
  description: string;
  content: string;
  body: string;
  filePath: string;
  skillDir: string;
  provider?: string;
  model?: string;
  chain?: string[];
  scope: 'project' | 'global';
}

interface Frontmatter {
  name: string;
  description: string;
  provider?: string;
  model?: string;
  chain?: string[];
}

function parseFrontmatter(raw: string): Frontmatter {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return { name: '', description: '' };

  const fm = match[1];
  const get = (key: string) => fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim() || '';
  const chainRaw = get('chain');
  const chain = chainRaw ? chainRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined;

  return {
    name: get('name'),
    description: get('description'),
    provider: get('provider') || undefined,
    model: get('model') || undefined,
    chain,
  };
}

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim();
}

function listSkillResources(skillDir: string): string[] {
  const resources: string[] = [];
  const walk = (dir: string, prefix: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (_e) {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const full = path.join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full, rel);
        } else if (entry !== 'SKILL.md') {
          resources.push(rel);
        }
      } catch (_e) { /* skip */ }
    }
  };
  walk(skillDir, '');
  return resources;
}

function resolveMarkdownLinks(body: string, skillDir: string): string {
  return body.replace(
    /\[([^\]]+)\]\((?!https?:\/\/)([^)]+)\)/g,
    (_match, text, relPath) => {
      const absPath = path.resolve(skillDir, relPath);
      return `[${text}](${absPath})`;
    },
  );
}

export function wrapSkillContent(skill: Skill): string {
  const resolvedBody = resolveMarkdownLinks(skill.body, skill.skillDir);
  const resources = listSkillResources(skill.skillDir);

  let wrapped = `<skill_content name="${skill.name}">\n`;
  wrapped += resolvedBody + '\n\n';
  wrapped += `Skill directory: ${skill.skillDir}/\n`;
  wrapped += `Relative paths in this skill are relative to the skill directory.\n`;

  if (resources.length > 0) {
    wrapped += '\n<skill_resources>\n';
    for (const res of resources) {
      wrapped += `  <file path="${path.join(skill.skillDir, res)}">${res}</file>\n`;
    }
    wrapped += '</skill_resources>\n';
  }

  wrapped += '</skill_content>';
  return wrapped;
}

function scanDir(dir: string, scope: 'project' | 'global'): Skill[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (_e) {
    return [];
  }

  const skills: Skill[] = [];
  for (const entry of entries) {
    const skillMdPath = path.join(dir, entry, 'SKILL.md');
    try {
      if (!statSync(skillMdPath).isFile()) continue;
    } catch (_e) {
      continue;
    }
    try {
      const raw = readFileSync(skillMdPath, 'utf-8');
      const fm = parseFrontmatter(raw);
      if (!fm.name) continue;
      const skillDir = path.dirname(skillMdPath);
      skills.push({
        name: fm.name,
        description: fm.description,
        content: raw,
        body: stripFrontmatter(raw),
        filePath: skillMdPath,
        skillDir,
        provider: fm.provider,
        model: fm.model,
        chain: fm.chain,
        scope,
      });
    } catch (_e) {
      // skip unreadable
    }
  }
  return skills;
}

// Skill scan directories relative to workspace root
const PROJECT_SKILL_DIRS = [
  '.claude/skills',
  '.agents/skills',
];

export class SkillRegistry {
  private skills: Skill[] = [];
  private projectDirs: string[];
  private globalDir: string;

  constructor(workspace: string, globalSkillsDir?: string) {
    this.projectDirs = PROJECT_SKILL_DIRS.map(d => path.join(workspace, d));
    this.globalDir = globalSkillsDir || '/root/.claude/skills';
    this.reload();
    this.startWatching();
  }

  reload() {
    const projectSkills = this.projectDirs.flatMap(dir => scanDir(dir, 'project'));
    const globalSkills = scanDir(this.globalDir, 'global');

    // Project skills override global skills with the same name
    const nameSet = new Set(projectSkills.map(s => s.name));
    const merged = [...projectSkills, ...globalSkills.filter(s => !nameSet.has(s.name))];

    this.skills = merged;
    console.log(`[skills] Reloaded: ${projectSkills.length} project + ${globalSkills.length} global = ${merged.length} total`);
    console.log(`[skills] Scan dirs: ${this.projectDirs.join(', ')}`);
    for (const s of merged) {
      const extra = [s.scope];
      if (s.provider) extra.push(`provider:${s.provider}`);
      if (s.model) extra.push(`model:${s.model}`);
      console.log(`[skills]   ${s.name} (${extra.join(', ')})`);
    }
  }

  private startWatching() {
    for (const dir of [...this.projectDirs, this.globalDir]) {
      try {
        watch(dir, { recursive: true }, (_event, _filename) => {
          console.log(`[skills] Change detected in ${dir}, reloading...`);
          this.reload();
        });
        console.log(`[skills] Watching ${dir}`);
      } catch (_e) {
        // directory doesn't exist yet, that's fine
      }
    }
  }

  getAll(): Skill[] {
    return this.skills;
  }

  getByName(name: string): Skill | null {
    return this.skills.find(s => s.name === name) || null;
  }

  // Resolve a skill chain: returns ordered list of skills to execute
  resolveChain(skill: Skill): Skill[] {
    const chain = [skill];
    if (!skill.chain) return chain;

    const visited = new Set([skill.name]);
    for (const nextName of skill.chain) {
      if (visited.has(nextName)) continue;
      const next = this.getByName(nextName);
      if (next) {
        chain.push(next);
        visited.add(nextName);
      } else {
        console.warn(`[skills] Chain: ${nextName} not found, skipping`);
      }
    }
    console.log(`[skills] Chain resolved: ${chain.map(s => s.name).join(' -> ')}`);
    return chain;
  }

  async match(query: string): Promise<Skill | null> {
    if (this.skills.length === 0) return null;

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.warn('[skills] No OPENROUTER_API_KEY — skipping LLM matching');
      return null;
    }

    const skillList = this.skills
      .map(s => `- ${s.name}: ${s.description}`)
      .join('\n');

    const prompt = `You are a skill router. Given a user query and a list of available skills, determine which skill (if any) should handle the query.

Available skills:
${skillList}

User query: "${query}"

Respond with ONLY the skill name that best matches. If no skill matches, respond with "none".
Do not explain. Just output the skill name or "none".`;

    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'anthropic/claude-haiku-4-5',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 50,
          temperature: 0,
        }),
      });

      if (!res.ok) {
        console.error(`[skills] Match API error: ${res.status}`);
        return null;
      }

      const data = await res.json() as {
        choices: { message: { content: string } }[];
      };
      const answer = data.choices?.[0]?.message?.content?.trim().toLowerCase() || 'none';
      console.log(`[skills] Match result for "${query}": ${answer}`);

      if (answer === 'none' || answer.includes('none')) return null;

      // Exact match first
      const exact = this.skills.find(s => s.name.toLowerCase() === answer);
      if (exact) return exact;

      // Fuzzy: find any skill name mentioned in the LLM response
      const found = this.skills.find(s => answer.includes(s.name.toLowerCase()));
      if (found) {
        console.log(`[skills] Fuzzy matched: ${found.name}`);
        return found;
      }

      return null;
    } catch (err) {
      console.error('[skills] Match API call failed:', err);
      return null;
    }
  }
}
