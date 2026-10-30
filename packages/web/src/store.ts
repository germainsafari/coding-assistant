// Global UI state (zustand). Per-thread chat state lives in the Chat component.
import { create } from 'zustand';
import type { Capabilities } from '@hearth/shared';
import { api, type ProjectInfo, type PublicSettings, type ThreadInfo } from './api';

export type RightTab = 'files' | 'git' | 'browser' | 'terminal' | 'traces';
export type Modal = null | 'settings' | 'project';

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem('hearth.ui') ?? '{}');
  } catch {
    return {};
  }
})();

interface State {
  settings: PublicSettings | null;
  caps: Capabilities | null;
  projects: ProjectInfo[];
  threads: Record<string, ThreadInfo[]>;
  projectId: string | null;
  threadId: string | null;
  rightTab: RightTab;
  rightOpen: boolean;
  modal: Modal;
  settingsTab: string;
  /** bumped when the agent (or user) changes files, so panels refresh */
  fsVersion: number;
  openFile: string | null;
  toast: { text: string; kind: 'info' | 'error' } | null;

  loadSettings: () => Promise<void>;
  saveSettings: (patch: Partial<PublicSettings>) => Promise<void>;
  probe: (force?: boolean) => Promise<void>;
  loadProjects: () => Promise<void>;
  loadThreads: (projectId: string) => Promise<void>;
  selectProject: (id: string | null) => void;
  selectThread: (id: string | null) => void;
  setRightTab: (t: RightTab) => void;
  toggleRight: () => void;
  openModal: (m: Modal, tab?: string) => void;
  bumpFs: () => void;
  setOpenFile: (p: string | null) => void;
  notify: (text: string, kind?: 'info' | 'error') => void;
}

export const useStore = create<State>((set, get) => ({
  settings: null,
  caps: null,
  projects: [],
  threads: {},
  projectId: saved.projectId ?? null,
  threadId: saved.threadId ?? null,
  rightTab: saved.rightTab ?? 'files',
  rightOpen: saved.rightOpen ?? true,
  modal: null,
  settingsTab: 'models',
  fsVersion: 0,
  openFile: null,
  toast: null,

  async loadSettings() {
    set({ settings: await api.settings() });
  },
  async saveSettings(patch) {
    const s = await api.saveSettings(patch);
    set({ settings: s });
    if ('profiles' in patch || 'activeProfileId' in patch) void get().probe();
  },
  async probe(force = false) {
    try {
      set({ caps: await api.capabilities(undefined, force) });
    } catch (e) {
      set({ caps: { reachable: false, error: (e as Error).message, models: [], nativeTools: false, templateTools: false, reasoning: false, effectiveToolMode: 'prompt', checkedAt: Date.now() } });
    }
  },
  async loadProjects() {
    const projects = await api.projects();
    set({ projects });
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
    set({ projectId: id, threadId: null, openFile: null });
    if (id) void get().loadThreads(id);
    persist();
  },
  selectThread(id) {
    set({ threadId: id });
    persist();
  },
  setRightTab(t) {
    set({ rightTab: t, rightOpen: true });
    persist();
  },
  toggleRight() {
    set((s) => ({ rightOpen: !s.rightOpen }));
    persist();
  },
  openModal(m, tab) {
    set({ modal: m, ...(tab ? { settingsTab: tab } : {}) });
  },
  bumpFs() {
    set((s) => ({ fsVersion: s.fsVersion + 1 }));
  },
  setOpenFile(p) {
    set({ openFile: p, rightTab: 'files', rightOpen: true });
  },
  notify(text, kind = 'info') {
    set({ toast: { text, kind } });
    setTimeout(() => {
      if (get().toast?.text === text) set({ toast: null });
    }, kind === 'error' ? 7000 : 3500);
  },
}));

function persist() {
  const { projectId, threadId, rightTab, rightOpen } = useStore.getState();
  localStorage.setItem('hearth.ui', JSON.stringify({ projectId, threadId, rightTab, rightOpen }));
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
