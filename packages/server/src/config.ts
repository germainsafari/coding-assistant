import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Settings } from '@hearth/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repository root (…/packages/server/src -> …) */
export const APP_ROOT = path.resolve(here, '..', '..', '..');
export const DATA_DIR = path.resolve(process.env.HEARTH_DATA_DIR || path.join(APP_ROOT, 'data'));
export const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
export const DB_PATH = path.join(DATA_DIR, 'hearth.db');
export const BUILTIN_SKILLS_DIR = path.join(APP_ROOT, 'skills');
export const USER_SKILLS_DIR = path.join(DATA_DIR, 'skills');
export const EVALS_DIR = path.join(APP_ROOT, 'evals');
export const WEB_DIST = path.join(APP_ROOT, 'packages', 'web', 'dist');
/** `--dev`: API only (the Vite dev server on :3000 proxies /api to us on :3001). */
export const DEV = process.argv.includes('--dev');
export const PORT = Number(process.env.HEARTH_PORT || (DEV ? 3001 : 3000));
export const HOST = process.env.HEARTH_HOST || '127.0.0.1';

fs.mkdirSync(DATA_DIR, { recursive: true });

loadDotEnv(path.join(APP_ROOT, '.env'));

function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

export function defaultSettings(): Settings {
  return {
    model: {
      baseUrl: process.env.HEARTH_LLM_BASE_URL || 'http://localhost:8080/v1',
      apiKey: process.env.HEARTH_LLM_API_KEY || 'local',
      model: process.env.HEARTH_LLM_MODEL || 'qwen3.6-35b-a3b',
      temperature: 0.6,
      topP: 0.95,
      maxOutputTokens: 12000,
      contextLimit: 0,
      thinking: true,
      toolMode: 'auto',
      vision: true,
    },
    approvalMode: 'auto-edit',
    maxSteps: 40,
    shellTimeoutSec: 120,
    projectsDir: path.join(os.homedir(), 'HearthProjects'),
    languageToolUrl: process.env.HEARTH_LANGUAGETOOL_URL || 'http://localhost:8081',
    githubToken: process.env.GITHUB_TOKEN || '',
    mcpServers: {},
    disabledSkills: [],
    memoryAutoRecall: true,
    otel: { enabled: false, endpoint: 'http://localhost:4318/v1/traces' },
  };
}

let cached: Settings | null = null;
const listeners = new Set<(s: Settings) => void>();

function deepMerge<T>(base: T, over: any): T {
  if (over === undefined || over === null) return base;
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return over as T;
  const out: any = { ...base };
  for (const k of Object.keys(over)) {
    const b = (base as any)[k];
    // free-form maps are replaced wholesale so that deleting an entry works
    if (k === 'mcpServers') out[k] = over[k];
    else out[k] = b !== undefined && typeof b === 'object' && !Array.isArray(b) && b !== null ? deepMerge(b, over[k]) : over[k];
  }
  return out;
}

export function getSettings(): Settings {
  if (cached) return cached;
  let fromFile: any = {};
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      fromFile = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    } catch (e) {
      console.error('[settings] could not parse settings.json, using defaults', e);
    }
  }
  cached = deepMerge(defaultSettings(), fromFile);
  // env always wins for the GitHub token if settings is empty
  if (!cached.githubToken && process.env.GITHUB_TOKEN) cached.githubToken = process.env.GITHUB_TOKEN;
  return cached;
}

export function updateSettings(patch: Partial<Settings> | any): Settings {
  const next = deepMerge(getSettings(), patch);
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
  cached = next;
  for (const l of listeners) l(next);
  return next;
}

export function onSettingsChange(fn: (s: Settings) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Settings safe to send to the browser (secrets masked). */
export function publicSettings(s: Settings = getSettings()) {
  return {
    ...s,
    githubToken: s.githubToken ? '••••' + s.githubToken.slice(-4) : '',
    hasGithubToken: !!s.githubToken,
  };
}
