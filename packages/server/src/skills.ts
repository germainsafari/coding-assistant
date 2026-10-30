// Folder-based skills: <dir>/<name>/SKILL.md with YAML-ish frontmatter
//   ---
//   name: write-tests
//   description: When and why to use this skill (shown to the model)
//   ---
//   …full instructions, loaded on demand via the load_skill tool…
import fs from 'node:fs';
import path from 'node:path';
import type { SkillInfo } from '@hearth/shared';
import { BUILTIN_SKILLS_DIR, USER_SKILLS_DIR, getSettings } from './config.ts';

export function parseFrontmatter(md: string): { data: Record<string, string>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: md };
  const data: Record<string, string> = {};
  let lastKey = '';
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      lastKey = kv[1];
      data[lastKey] = kv[2].replace(/^["']|["']$/g, '').trim();
    } else if (lastKey && /^\s+\S/.test(line)) {
      data[lastKey] = (data[lastKey] + ' ' + line.trim()).trim();
    }
  }
  return { data, body: m[2] };
}

export function skillDirs(projectRoot?: string): { dir: string; source: SkillInfo['source'] }[] {
  const dirs: { dir: string; source: SkillInfo['source'] }[] = [
    { dir: BUILTIN_SKILLS_DIR, source: 'builtin' },
    { dir: USER_SKILLS_DIR, source: 'user' },
  ];
  if (projectRoot) {
    dirs.push({ dir: path.join(projectRoot, '.hearth', 'skills'), source: 'project' });
    dirs.push({ dir: path.join(projectRoot, '.claude', 'skills'), source: 'project' });
  }
  return dirs;
}

export function listSkills(projectRoot?: string): SkillInfo[] {
  const disabled = new Set(getSettings().disabledSkills);
  const byName = new Map<string, SkillInfo>();
  for (const { dir, source } of skillDirs(projectRoot)) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      const { data } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
      const name = data.name || entry.name;
      // later sources (user, project) override builtin skills with the same name
      byName.set(name, { name, description: data.description || '(no description)', path: file, source, enabled: !disabled.has(name) });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function loadSkill(name: string, projectRoot?: string): { info: SkillInfo; body: string; files: string[] } | null {
  const info = listSkills(projectRoot).find((s) => s.name === name);
  if (!info) return null;
  const { body } = parseFrontmatter(fs.readFileSync(info.path, 'utf8'));
  const dir = path.dirname(info.path);
  const files = fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile() && f.name !== 'SKILL.md')
    .map((f) => path.relative(dir, path.join(f.parentPath, f.name)).split(path.sep).join('/'));
  return { info, body, files };
}
