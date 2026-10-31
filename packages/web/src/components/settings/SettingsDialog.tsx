import { useState } from 'react';
import { Bot, Brain, Cpu, Link as LinkIcon, Plug, Puzzle, X } from 'lucide-react';
import { useStore } from '../../store';
import { cx, IconButton, Modal } from '../ui';
import { ModelsTab } from './ModelsTab';
import { AgentTab } from './AgentTab';
import { McpTab } from './McpTab';
import { ConnectorsTab } from './ConnectorsTab';
import { SkillsTab, MemoryTab } from './SkillsMemoryTabs';

type Tab = 'models' | 'agent' | 'mcp' | 'connectors' | 'skills' | 'memory';

const TABS: { id: Tab; label: string; Icon: typeof Cpu; description: string }[] = [
  { id: 'models', label: 'Models', Icon: Cpu, description: 'Model servers and generation settings. Switch profiles per message from the composer.' },
  { id: 'agent', label: 'Agent', Icon: Bot, description: 'Safety, the agent loop, long-run defaults and observability.' },
  { id: 'mcp', label: 'MCP servers', Icon: Plug, description: 'Give the agent extra tools through Model Context Protocol servers.' },
  { id: 'connectors', label: 'Connectors', Icon: LinkIcon, description: 'GitHub, LanguageTool and other services.' },
  { id: 'skills', label: 'Skills', Icon: Puzzle, description: 'Reusable instructions the agent loads on demand.' },
  { id: 'memory', label: 'Memory', Icon: Brain, description: 'Long-term facts the agent remembers across threads.' },
];

export function SettingsDialog() {
  const openModal = useStore((s) => s.openModal);
  const modalTab = useStore((s) => s.modalTab);
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === modalTab) ? (modalTab as Tab) : 'models');
  const cur = TABS.find((t) => t.id === tab)!;
  const close = () => openModal(null);
  return (
    <Modal title="Settings" bare onClose={close} size="xl">
      <div className="flex h-[min(78vh,720px)]">
        <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-line bg-panel p-2.5" aria-label="Settings sections">
          <div className="px-2.5 pt-1.5 pb-3 text-[15px] font-semibold tracking-tight text-fg">Settings</div>
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
              className={cx('flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors', tab === id ? 'bg-raised font-medium text-fg shadow-card' : 'text-fg-muted hover:bg-raised/60 hover:text-fg')}
            >
              <Icon className={cx('h-4 w-4', tab === id ? 'text-accent-ink' : 'text-fg-subtle')} /> {label}
            </button>
          ))}
          <div className="flex-1" />
          <p className="px-2.5 pb-1 text-[11px] leading-relaxed text-fg-subtle">Saved to data/settings.json on this machine.</p>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight text-fg">{cur.label}</h3>
              <p className="mt-0.5 text-[13px] text-fg-subtle">{cur.description}</p>
            </div>
            <IconButton label="Close" shortcut="Esc" onClick={close} className="-mr-2">
              <X className="h-4 w-4" />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {tab === 'models' && <ModelsTab />}
            {tab === 'agent' && <AgentTab />}
            {tab === 'mcp' && <McpTab />}
            {tab === 'connectors' && <ConnectorsTab />}
            {tab === 'skills' && <SkillsTab />}
            {tab === 'memory' && <MemoryTab />}
          </div>
        </div>
      </div>
    </Modal>
  );
}
