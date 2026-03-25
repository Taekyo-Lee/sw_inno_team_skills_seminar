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
  outputs?: string[];
  scope: 'project' | 'global';
}

interface Frontmatter {
  name: string;
  description: string;
  provider?: string;
  model?: string;
  chain?: string[];
  outputs?: string[];
}

function parseFrontmatter(raw: string): Frontmatter {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return { name: '', description: '' };

  const fm = match[1];
  const get = (key: string) => fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim() || '';
  const chainRaw = get('chain');
  const chain = chainRaw ? chainRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined;
  const outputsRaw = get('outputs');
  const outputs = outputsRaw ? outputsRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined;

  return {
    name: get('name'),
    description: get('description'),
    provider: get('provider') || undefined,
    model: get('model') || undefined,
    chain,
    outputs,
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
        outputs: fm.outputs,
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
    const allProject: Skill[] = [];
    const seenNames = new Set<string>();
    for (const dir of this.projectDirs) {
      for (const s of scanDir(dir, 'project')) {
        if (!seenNames.has(s.name)) {
          allProject.push(s);
          seenNames.add(s.name);
        }
      }
    }
    const globalSkills = scanDir(this.globalDir, 'global');

    // Project skills override global skills with the same name
    const merged = [...allProject, ...globalSkills.filter(s => !seenNames.has(s.name))];

    this.skills = merged;
    console.log(`[skills] Reloaded: ${allProject.length} project + ${globalSkills.length} global = ${merged.length} total`);
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

  matchAllKeyword(query: string): Skill[] {
    const queryLower = query.toLowerCase();
    const matched: Skill[] = [];
    const seen = new Set<string>();

    for (const skill of this.skills) {
      if (seen.has(skill.name)) continue;
      const nameLower = skill.name.toLowerCase();
      const descLower = skill.description?.toLowerCase() || '';

      // Direct skill name match
      if (queryLower.includes(nameLower)) {
        matched.push(skill);
        seen.add(skill.name);
        continue;
      }

      // Keyword overlap from description
      const keywords = descLower.split(/[\s,;.\-]+/).map(k => k.trim()).filter(k => k.length > 2);
      const matchCount = keywords.filter(k => queryLower.includes(k)).length;
      if (matchCount >= 2) {
        matched.push(skill);
        seen.add(skill.name);
        continue;
      }

      // Term mappings
      const termMappings: Record<string, string[]> = {
        'headless-agent-ui': ['lambda', 'app', 'web', 'ui', 'headless'],
      };
      const relatedTerms = termMappings[nameLower] || [];
      if (relatedTerms.some(term => queryLower.includes(term))) {
        matched.push(skill);
        seen.add(skill.name);
      }
    }

    if (matched.length > 0) {
      console.log(`[skills] matchAll keyword: ${matched.map(s => s.name).join(', ')}`);
    }
    return matched;
  }

  async match(query: string, contextSkill?: string, historyContext?: string): Promise<Skill | null> {
    if (this.skills.length === 0) return null;

    const queryLower = query.toLowerCase();

    // --- Step 1: Fast keyword-based matching (no API call) ---
    for (const skill of this.skills) {
      const nameLower = skill.name.toLowerCase();
      const descLower = skill.description?.toLowerCase() || '';

      // Direct skill name match in query
      if (queryLower.includes(nameLower)) {
        console.log(`[skills] Keyword matched: ${skill.name}`);
        return skill;
      }

      // Keyword overlap from description
      const keywords = descLower
        .split(/[\s,;.\-]+/)
        .map(k => k.trim())
        .filter(k => k.length > 2);
      const matchCount = keywords.filter(k => queryLower.includes(k)).length;
      if (matchCount >= 2) {
        console.log(`[skills] Keyword matched: ${skill.name} (${matchCount} keywords)`);
        return skill;
      }

      // Term mappings for common synonyms
      const termMappings: Record<string, string[]> = {
        'headless-agent-ui': ['lambda', 'app', 'web', 'ui', 'headless'],
      };
      const relatedTerms = termMappings[nameLower] || [];
      if (relatedTerms.some(term => queryLower.includes(term))) {
        console.log(`[skills] Term mapping matched: ${skill.name}`);
        return skill;
      }
    }

    // --- Step 2: LLM-based matching (use on-prem or OpenRouter) ---
    const openAiBase = process.env.PROJECT_OPENAI_API_BASE || process.env.OPENAI_API_BASE;
    const openAiKey = process.env.PROJECT_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    const openRouterKey = process.env.PROJECT_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;

    const skillList = this.skills.map(s => `- ${s.name}: ${s.description}`).join('\n');
    const contextHint = contextSkill
      ? `\nThe previous turn used the "${contextSkill}" skill. If the user's query is a follow-up to that work (e.g. editing, modifying, or continuing), choose "${contextSkill}". If the query is unrelated (e.g. greeting, thanks, new topic), choose "none".`
      : '';
    const historyHint = historyContext ? `\nConversation history:\n${historyContext}\n` : '';
    const prompt = `You are a skill router. Given a user query and a list of available skills, determine which skill (if any) should handle the query.

Available skills:
${skillList}
${contextHint}${historyHint}
User query: "${query}"

Respond with ONLY the skill name that best matches. If no skill matches, respond with "none".
Do not explain. Just output the skill name or "none".`;

    // Try on-prem OpenAI-compatible endpoint first
    if (openAiBase) {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (openAiKey) headers['Authorization'] = `Bearer ${openAiKey}`;

        const res = await fetch(`${openAiBase}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: 'Kimi-K2.5-Thinking',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 50,
            temperature: 0,
          }),
        });

        if (res.ok) {
          const data = await res.json() as { choices: { message: { content: string } }[] };
          const answer = data.choices?.[0]?.message?.content?.trim().toLowerCase() || 'none';
          console.log(`[skills] On-prem LLM match: ${answer}`);
          if (answer !== 'none' && !answer.includes('none')) {
            const exact = this.skills.find(s => s.name.toLowerCase() === answer);
            if (exact) return exact;
            const fuzzy = this.skills.find(s => answer.includes(s.name.toLowerCase()));
            if (fuzzy) return fuzzy;
          }
        }
      } catch (err) {
        console.warn('[skills] On-prem LLM failed:', err);
      }
    }

    // Fallback to OpenRouter
    if (openRouterKey) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openRouterKey}`,
          },
          body: JSON.stringify({
            model: 'anthropic/claude-haiku-4-5',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 50,
            temperature: 0,
          }),
        });

        if (res.ok) {
          const data = await res.json() as { choices: { message: { content: string } }[] };
          const answer = data.choices?.[0]?.message?.content?.trim().toLowerCase() || 'none';
          console.log(`[skills] OpenRouter match: ${answer}`);
          if (answer !== 'none' && !answer.includes('none')) {
            const exact = this.skills.find(s => s.name.toLowerCase() === answer);
            if (exact) return exact;
            const fuzzy = this.skills.find(s => answer.includes(s.name.toLowerCase()));
            if (fuzzy) return fuzzy;
          }
        }
      } catch (err) {
        console.error('[skills] OpenRouter failed:', err);
      }
    }

    console.warn('[skills] No LLM endpoint available');
    return null;
  }
}
