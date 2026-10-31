// Global UI state (zustand). Per-thread chat state lives in chat/useThread.ts.
import { create } from 'zustand';
import type { Capabilities } from '@hearth/shared';
import { api, type ProjectInfo, type PublicSettings, type ThreadInfo } from './api';
import { applyTheme, loadThemePref, resolveTheme, type Theme, type ThemePref } from './theme';

export type RightTab = 'files' | 'git' | 'browser' | 'terminal' | 'traces';
export type Modal = null | 'settings' | 'project' | 'palette' | 'shortcuts';

/** Live stats of the run shown in the current thread (for the header and status bar). */
export interface RunStats {
  runId: string | null;
  running: boolean;
  step: number;
  longRun: boolean;
  tokensPerSec?: number;
  promptTokens?: number;
  contextLimit?: number;
  waiting: boolean;
}

const UI_KEY = 'hearth.ui';
const saved: { projectId?: string; threadId?: string; rightTab?: RightTab; rightOpen?: boolean; sidebarOpen?: boolean } = (() => {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) ?? '{}');
  } catch {
    return {};
  }
})();

interface State {
  settings: PublicSettings | null;
  caps: Capabilities | null;
  probing: boolean;
  projects: ProjectInfo[];
  projectsLoaded: boolean;
  projectsError: string | null;
  threads: Record<string, ThreadInfo[]>;
  projectId: string | null;
  threadId: string | null;
  rightTab: RightTab;
  rightOpen: boolean;
  sidebarOpen: boolean;
  themePref: ThemePref;
  theme: Theme;
  modal: Modal;
  /** sub-view of the open modal: settings tab or project dialog mode */
  modalTab: string;
  /** bumped when the agent (or user) changes files, so panels refresh */
  fsVersion: number;
  openFile: string | null;
  run: RunStats;
  toast: { id: number; text: string; kind: 'info' | 'error' | 'success' } | null;

  loadSettings: () => Promise<void>;
  saveSettings: (patch: Partial<PublicSettings>) => Promise<void>;
  probe: (force?: boolean) => Promise<void>;
  loadProjects: () => Promise<void>;
  loadThreads: (projectId: string) => Promise<void>;
  selectProject: (id: string | null) => void;
  selectThread: (id: string | null) => void;
  newThread: (projectId?: string) => void;
  renameThread: (projectId: string, id: string, title: string) => Promise<void>;
  setRightTab: (t: RightTab) => void;
  toggleRight: () => void;
  toggleSidebar: () => void;
  setThemePref: (p: ThemePref) => void;
  syncSystemTheme: () => void;
  openModal: (m: Modal, tab?: string) => void;
  bumpFs: () => void;
  setOpenFile: (p: string | null) => void;
  setRun: (r: RunStats) => void;
  notify: (text: string, kind?: 'info' | 'error' | 'success') => void;
}

const idleRun: RunStats = { runId: null, running: false, step: 0, longRun: false, waiting: false };
const initialTheme = loadThemePref();
let toastSeq = 0;

export const useStore = create<State>((set, get) => ({
  settings: null,
  caps: null,
  probing: false,
  projects: [],
  projectsLoaded: false,
  projectsError: null,
  threads: {},
  projectId: saved.projectId ?? null,
  threadId: saved.threadId ?? null,
  rightTab: saved.rightTab ?? 'files',
  rightOpen: saved.rightOpen ?? true,
  sidebarOpen: saved.sidebarOpen ?? true,
  themePref: initialTheme,
  theme: resolveTheme(initialTheme),
  modal: null,
  modalTab: '',
  fsVersion: 0,
  openFile: null,
  run: idleRun,
  toast: null,

  async loadSettings() {
    set({ settings: await api.settings() });
  },
  async saveSettings(patch) {
    const s = await api.saveSettings(patch);
    set({ settings: s });
    if ('profiles' in patch || 'activeProfileId' in patch) void get().probe(true);
  },
  async probe(force = false) {
    set({ probing: true });
    try {
      set({ caps: await api.capabilities(undefined, force) });
    } catch (e) {
      set({ caps: { reachable: false, error: (e as Error).message, models: [], nativeTools: false, templateTools: false, reasoning: false, effectiveToolMode: 'prompt', checkedAt: Date.now() } });
    } finally {
      set({ probing: false });
    }
  },
  async loadProjects() {
    let projects: ProjectInfo[];
    try {
      projects = await api.projects();
    } catch (e) {
      set({ projectsLoaded: true, projectsError: errText(e) });
      return;
    }
    set({ projects, projectsLoaded: true, projectsError: null });
    const { projectId } = get();
    if (projectId && !projects.some((p) => p.id === projectId)) get().selectProject(projects[0]?.id ?? null);
    else if (!projectId && projects[0]) get().selectProject(projects[0].id);
    else if (projectId) await get().loadThreads(projectId);
  },
  async loadThreads(projectId) {
    const list = await api.threads(projectId);
    set((s) => ({ threads: { ...s.threads, [projectId]: list } }));
  },
  selectProject(id) {
    if (id === get().projectId) return;
    set({ projectId: id, threadId: null, openFile: null });
    if (id) void get().loadThreads(id);
    persist();
  },
  selectThread(id) {
    set({ threadId: id });
    persist();
  },
  newThread(projectId) {
    const pid = projectId ?? get().projectId;
    if (!pid) return get().openModal('project');
    if (pid !== get().projectId) get().selectProject(pid);
    get().selectThread(null);
    requestAnimationFrame(() => window.dispatchEvent(new Event('hearth:focus-composer')));
  },
  async renameThread(projectId, id, title) {
    await api.renameThread(id, title);
    await get().loadThreads(projectId);
  },
  setRightTab(t) {
    set({ rightTab: t, rightOpen: true });
    persist();
  },
  toggleRight() {
    set((s) => ({ rightOpen: !s.rightOpen }));
    persist();
  },
  toggleSidebar() {
    set((s) => ({ sidebarOpen: !s.sidebarOpen }));
    persist();
  },
  setThemePref(p) {
    set({ themePref: p, theme: applyTheme(p) });
  },
  syncSystemTheme() {
    if (get().themePref === 'system') set({ theme: applyTheme('system') });
  },
  openModal(m, tab) {
    set({ modal: m, modalTab: tab ?? '' });
  },
  bumpFs() {
    set((s) => ({ fsVersion: s.fsVersion + 1 }));
  },
  setOpenFile(p) {
    set({ openFile: p, rightTab: 'files', rightOpen: true });
  },
  setRun(r) {
    const cur = get().run;
    if (
      cur.runId === r.runId &&
      cur.running === r.running &&
      cur.step === r.step &&
      cur.waiting === r.waiting &&
      cur.longRun === r.longRun &&
      cur.tokensPerSec === r.tokensPerSec &&
      cur.promptTokens === r.promptTokens &&
      cur.contextLimit === r.contextLimit
    )
      return;
    set({ run: r });
  },
  notify(text, kind = 'info') {
    const id = ++toastSeq;
    set({ toast: { id, text, kind } });
    setTimeout(
      () => {
        if (get().toast?.id === id) set({ toast: null });
      },
      kind === 'error' ? 7000 : 3200,
    );
  },
}));

function persist() {
  const { projectId, threadId, rightTab, rightOpen, sidebarOpen } = useStore.getState();
  localStorage.setItem(UI_KEY, JSON.stringify({ projectId, threadId, rightTab, rightOpen, sidebarOpen }));
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
