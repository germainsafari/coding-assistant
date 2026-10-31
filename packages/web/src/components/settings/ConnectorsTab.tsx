import { useEffect, useState, type ReactNode } from 'react';
import { CircleCheck, CircleX, GitBranch, Plug, SpellCheck } from 'lucide-react';
import { api } from '../../api';
import { errText, useStore } from '../../store';
import { Badge, Button, cx, Section, Spinner } from '../ui';

type Check = { ok: boolean; text: string } | 'loading' | null;

function CheckResult({ r }: { r: Check }) {
  if (r === 'loading')
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-fg-muted">
        <Spinner className="h-3.5 w-3.5" /> Checking…
      </div>
    );
  if (!r) return null;
  return (
    <div role="status" className={cx('mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs', r.ok ? 'border-ok/30 bg-ok/[0.06] text-ok-ink' : 'border-danger/30 bg-danger/[0.06] text-danger-ink')}>
      {r.ok ? <CircleCheck className="h-3.5 w-3.5 shrink-0" /> : <CircleX className="h-3.5 w-3.5 shrink-0" />} {r.text}
    </div>
  );
}

const Title = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
  <span className="flex items-center gap-2">
    <span className="text-fg-subtle [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
    {children}
  </span>
);

export function ConnectorsTab() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const notify = useStore((s) => s.notify);
  const openModal = useStore((s) => s.openModal);
  const [token, setToken] = useState('');
  const [gh, setGh] = useState<Check>(null);
  const [ltUrl, setLtUrl] = useState(settings?.languageToolUrl ?? '');
  const [lt, setLt] = useState<Check>(null);
  useEffect(() => setLtUrl(settings?.languageToolUrl ?? ''), [settings?.languageToolUrl]);

  const testGh = async () => {
    setGh('loading');
    try {
      const me = await api.githubMe();
      setGh({ ok: true, text: `Connected as ${me.login}${me.name ? ` (${me.name})` : ''}` });
    } catch (e) {
      setGh({ ok: false, text: errText(e) });
    }
  };
  const testLt = async () => {
    setLt('loading');
    try {
      const r = await api.languageTool('This are a test.');
      setLt({ ok: true, text: `Working: found ${r.matches.length} issue(s) in "This are a test." (${r.language})` });
    } catch (e) {
      setLt({ ok: false, text: errText(e) });
    }
  };

  return (
    <div className="space-y-4 p-5">
      <Section
        title={<Title icon={<GitBranch />}>GitHub</Title>}
        actions={settings?.hasGithubToken ? <Badge tone="ok" dot>token saved</Badge> : <Badge>not connected</Badge>}
        description={
          <>
            A personal access token lets Hearth list and clone your repositories, push, and read or create issues and pull requests (in the UI and through the <code className="font-mono text-fg">github_*</code> agent tools). Create a fine-grained token at github.com →
            Settings → Developer settings with Contents, Issues and Pull requests read/write.
          </>
        }
      >
        <div className="flex gap-2">
          <input className="flex-1 font-mono text-[13px]" type="password" aria-label="GitHub token" placeholder={settings?.hasGithubToken ? `saved (${settings.githubToken})` : 'github_pat_…'} value={token} onChange={(e) => setToken(e.target.value)} />
          <Button
            variant="primary"
            disabled={!token}
            onClick={async () => {
              try {
                await saveSettings({ githubToken: token });
                setToken('');
                notify('GitHub token saved', 'success');
                void testGh();
              } catch (e) {
                notify(errText(e), 'error');
              }
            }}
          >
            Save
          </Button>
          <Button onClick={testGh} disabled={!settings?.hasGithubToken}>
            Test
          </Button>
          {settings?.hasGithubToken && (
            <Button variant="danger-ghost" onClick={() => saveSettings({ githubToken: '' }).then(() => setGh(null))}>
              Remove
            </Button>
          )}
        </div>
        <CheckResult r={gh} />
      </Section>
      <Section
        title={<Title icon={<SpellCheck />}>LanguageTool</Title>}
        description={
          <>
            Grammar and spelling, used by the <code className="font-mono text-fg">languagetool_check</code> tool and to polish generated commit messages and PR descriptions. Run it locally with{' '}
            <code className="font-mono text-fg">docker run -d --name languagetool -p 8081:8081 meyay/languagetool</code>.
          </>
        }
      >
        <div className="flex gap-2">
          <input className="flex-1 font-mono text-[13px]" aria-label="LanguageTool URL" value={ltUrl} onChange={(e) => setLtUrl(e.target.value)} />
          <Button onClick={() => saveSettings({ languageToolUrl: ltUrl }).then(testLt)}>Save & test</Button>
        </div>
        <CheckResult r={lt} />
      </Section>
      <Section
        title={<Title icon={<Plug />}>Google Drive and other services</Title>}
        description={
          <>
            Hearth connects to external services through MCP servers. For Google Drive, add the <b className="text-fg">google-drive</b> template in the MCP tab, fill in your Google OAuth client id and secret, and remove{' '}
            <code className="font-mono text-fg">"disabled": true</code>. Step-by-step instructions are in <code className="font-mono text-fg">docs/connectors.md</code>.
          </>
        }
      >
        <Button size="sm" onClick={() => openModal('settings', 'mcp')}>
          Open MCP servers
        </Button>
      </Section>
    </div>
  );
}
