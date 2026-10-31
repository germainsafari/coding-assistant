// Global keyboard shortcuts. SHORTCUTS drives both the handler docs and the help dialog.
import { useEffect } from 'react';
import { api } from './api';
import { useStore, type RightTab } from './store';
import { isMac, MOD } from './components/ui';

const PANEL_ORDER: RightTab[] = ['files', 'git', 'browser', 'terminal', 'traces'];

export const SHORTCUTS: { group: string; items: { keys: string[]; label: string }[] }[] = [
  {
    group: 'General',
    items: [
      { keys: [MOD, 'K'], label: 'Command palette' },
      { keys: [MOD, '/'], label: 'Keyboard shortcuts' },
      { keys: [MOD, ','], label: 'Settings' },
      { keys: [MOD, 'Shift', 'L'], label: 'Toggle light / dark theme' },
    ],
  },
  {
    group: 'Chat',
    items: [
      { keys: ['Alt', 'N'], label: 'New thread' },
      { keys: ['↵'], label: 'Send message' },
      { keys: ['Shift', '↵'], label: 'New line' },
      { keys: ['Esc'], label: 'Stop the agent' },
    ],
  },
  {
    group: 'Layout',
    items: [
      { keys: [MOD, 'B'], label: 'Toggle sidebar' },
      { keys: [MOD, 'J'], label: 'Toggle side panel' },
      { keys: ['Alt', '1–5'], label: 'Files, Git, Browser, Terminal, Traces' },
    ],
  },
];

const isTyping = (el: Element | null) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable);

export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const k = e.key.toLowerCase();
      const handle = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (mod && !e.altKey) {
        if (k === 'k' && !e.shiftKey) return handle(() => s.openModal(s.modal === 'palette' ? null : 'palette'));
        if (k === 'b' && !e.shiftKey) return handle(s.toggleSidebar);
        if (k === 'j' && !e.shiftKey) return handle(s.toggleRight);
        if (k === '/') return handle(() => s.openModal(s.modal === 'shortcuts' ? null : 'shortcuts'));
        if (k === ',') return handle(() => s.openModal('settings'));
        if (k === 'l' && e.shiftKey) return handle(() => s.setThemePref(s.theme === 'dark' ? 'light' : 'dark'));
      }
      if (e.altKey && !mod && !e.shiftKey) {
        if (e.code === 'KeyN') return handle(() => s.newThread());
        const n = /^Digit([1-5])$/.exec(e.code);
        if (n) return handle(() => s.setRightTab(PANEL_ORDER[Number(n[1]) - 1]));
      }
      if (s.modal !== null || e.defaultPrevented) return;
      const active = document.activeElement;
      if (e.key === 'Escape' && s.run.running && s.run.runId && (!isTyping(active) || active?.closest('[data-chat]'))) {
        const runId = s.run.runId;
        return handle(() => {
          void api.cancelRun(runId);
          s.notify('Stopping the agent…');
        });
      }
      if (e.key === '?' && !mod && !isTyping(active)) return handle(() => s.openModal('shortcuts'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
