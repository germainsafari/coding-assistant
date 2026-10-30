import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelProfile, ModelSettings, Settings } from '@hearth/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repository root (…/packages/server/src -> …) */
export const APP_ROOT = path.resolve(here, '..', '..', '..');
loadDotEnv(path.join(APP_ROOT, '.env'));
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

export function defaultModel(): ModelSettings {
  return {
    baseUrl: process.env.HEARTH_LLM_BASE_URL || 'http://localhost:8080/v1',
    apiKey: process.env.HEARTH_LLM_API_KEY || 'local',
    model: process.env.HEARTH_LLM_MODEL || 'qwen3.6-35b-a3b',
    temperature: 0.6,
    topP: 0.95,
    topK: 20,
    maxOutputTokens: 12000,
    contextLimit: 0,
    thinking: true,
    reasoningEffort: '',
    toolMode: 'auto',
    vision: true,
  };
}

export function defaultSettings(): Settings {
  const model = defaultModel();
  return {
    model,
    profiles: [{ id: 'default', name: model.model, ...model }],
    activeProfileId: 'default',
    approvalMode: 'auto-edit',
    compactAt: 0.65,
    longRun: { doneCommand: '', maxMinutes: 240, maxSteps: 400, maxVerifyAttempts: 6, autoResume: true },
    maxSteps: 40,
    shellTimeoutSec: 120,
    projectsDir: process.env.HEARTH_PROJECTS_DIR || path.join(os.homedir(), 'HearthProjects'),
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
    if (k === 'mcpServers' || k === 'profiles') out[k] = over[k];
    else out[k] = b !== undefined && typeof b === 'object' && !Array.isArray(b) && b !== null ? deepMerge(b, over[k]) : over[k];
  }
  return out;
}

export function getSettings(): Settings {
  if (cached) return cached;
  let fromFile: any = {};
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      // Windows editors (Notepad, PowerShell 5 `Set-Content -Encoding utf8`) prepend a BOM.
      fromFile = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8').replace(/^\uFEFF/, ''));
    } catch (e) {
      console.error('[settings] could not parse settings.json, using defaults', e);
    }
  }
  // legacy settings.json (single "model" object) -> one profile
  if (!Array.isArray(fromFile.profiles) && fromFile.model) {
    fromFile.profiles = [{ id: 'default', name: fromFile.model.model ?? 'default', ...defaultModel(), ...fromFile.model }];
    fromFile.activeProfileId = 'default';
  }
  delete fromFile.model;
  cached = resolve(deepMerge(defaultSettings(), fromFile));
  // env always wins for the GitHub token if settings is empty
  if (!cached.githubToken && process.env.GITHUB_TOKEN) cached.githubToken = process.env.GITHUB_TOKEN;
  return cached;
}

/** Fill missing profile fields with defaults and point `model` at the active profile. */
function resolve(s: Settings): Settings {
  const base = defaultModel();
  s.profiles = (s.profiles?.length ? s.profiles : defaultSettings().profiles).map((p, i) => ({
    ...base,
    ...p,
    id: String(p.id || `profile${i + 1}`),
    name: String(p.name || p.model || `Profile ${i + 1}`),
  }));
  const active = s.profiles.find((p) => p.id === s.activeProfileId) ?? s.profiles[0];
  s.activeProfileId = active.id;
  s.model = profileToModel(active);
  return s;
}

export function profileToModel(p: ModelProfile): ModelSettings {
  const { id: _id, name: _name, ...m } = p;
  return m;
}

/** Settings with `model` replaced by another profile (for per-run / per-eval overrides). */
export function settingsForProfile(profileId: string | undefined, s: Settings = getSettings()): Settings {
  if (!profileId) return s;
  const p = s.profiles.find((x) => x.id === profileId || x.name === profileId);
  if (!p) throw new Error(`Unknown model profile "${profileId}". Known: ${s.profiles.map((x) => x.id).join(', ')}`);
  return { ...s, model: profileToModel(p) };
}

export function updateSettings(patch: Partial<Settings> | any): Settings {
  const p = { ...patch };
  // `model` is a derived view; a patch to it edits the active profile
  if (p.model && !p.profiles) {
    const cur = getSettings();
    p.profiles = cur.profiles.map((x) => (x.id === (p.activeProfileId ?? cur.activeProfileId) ? { ...x, ...p.model } : x));
  }
  delete p.model;
  const next = resolve(deepMerge(getSettings(), p));
  const { model: _derived, ...persist } = next;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(persist, null, 2));
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
