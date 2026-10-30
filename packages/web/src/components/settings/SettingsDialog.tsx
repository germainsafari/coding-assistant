import { useEffect, useState } from 'react';
import { Bot, Brain, Cpu, Plug, Puzzle, Link as LinkIcon } from 'lucide-react';
import { useStore } from '../../store';
import { Modal, Tabs } from '../ui';
import { ModelsTab } from './ModelsTab';
import { AgentTab } from './AgentTab';
import { McpTab } from './McpTab';
import { ConnectorsTab } from './ConnectorsTab';
import { SkillsTab, MemoryTab } from './SkillsMemoryTabs';

type Tab = 'models' | 'agent' | 'mcp' | 'connectors' | 'skills' | 'memory';

export function SettingsDialog() {
  const { openModal, settingsTab } = useStore();
  const [tab, setTab] = useState<Tab>((settingsTab as Tab) || 'models');
  useEffect(() => setTab((settingsTab as Tab) || 'models'), [settingsTab]);
  return (
    <Modal title="Settings" onClose={() => openModal(null)} wide>
      <div className="flex h-[72vh] flex-col">
        <div className="shrink-0 border-b border-zinc-800 px-4 py-2">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'models', label: <><Cpu className="h-3.5 w-3.5" /> Models</> },
              { id: 'agent', label: <><Bot className="h-3.5 w-3.5" /> Agent</> },
              { id: 'mcp', label: <><Plug className="h-3.5 w-3.5" /> MCP servers</> },
              { id: 'connectors', label: <><LinkIcon className="h-3.5 w-3.5" /> Connectors</> },
              { id: 'skills', label: <><Puzzle className="h-3.5 w-3.5" /> Skills</> },
              { id: 'memory', label: <><Brain className="h-3.5 w-3.5" /> Memory</> },
            ]}
          />
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
    </Modal>
  );
}
