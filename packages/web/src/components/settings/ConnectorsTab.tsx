import { useEffect, useState } from 'react';
import { CircleCheck, CircleX } from 'lucide-react';
import { api } from '../../api';
import { errText, useStore } from '../../store';
import { Button, Spinner } from '../ui';

export function ConnectorsTab() {
  const { settings, saveSettings, notify, openModal } = useStore();
  const [token, setToken] = useState('');
  const [gh, setGh] = useState<{ ok: boolean; text: string } | 'loading' | null>(null);
  const [ltUrl, setLtUrl] = useState(settings?.languageToolUrl ?? '');
  const [lt, setLt] = useState<{ ok: boolean; text: string } | 'loading' | null>(null);
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
  const Result = ({ r }: { r: { ok: boolean; text: string } | 'loading' | null }) =>
    r === 'loading' ? (
      <Spinner />
    ) : r ? (
      <div className={`flex items-center gap-1.5 text-xs ${r.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
        {r.ok ? <CircleCheck className="h-3.5 w-3.5" /> : <CircleX className="h-3.5 w-3.5" />} {r.text}
      </div>
    ) : null;

  return (
    <div className="max-w-3xl space-y-6 p-4">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-200">GitHub</h3>
        <p className="text-xs text-zinc-400">
          A personal access token lets Hearth list and clone your repositories, push, and read/create issues and pull requests (UI + agent tools <code>github_*</code>). Create a fine-grained token at github.com → Settings → Developer settings
          with "Contents", "Issues" and "Pull requests" read/write. Stored locally in <code>data/settings.json</code>.
        </p>
        <div className="flex gap-2">
          <input className="flex-1 font-mono" type="password" placeholder={settings?.hasGithubToken ? `saved (${settings.githubToken})` : 'github_pat_…'} value={token} onChange={(e) => setToken(e.target.value)} />
          <Button
            variant="primary"
            disabled={!token}
            onClick={async () => {
              try {
                await saveSettings({ githubToken: token });
                setToken('');
                notify('GitHub token saved');
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
            <Button variant="ghost" onClick={() => saveSettings({ githubToken: '' }).then(() => setGh(null))}>
              Remove
            </Button>
          )}
        </div>
        <Result r={gh} />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-200">LanguageTool (grammar & spelling)</h3>
        <p className="text-xs text-zinc-400">
          Used by the <code>languagetool_check</code> agent tool and to polish generated commit messages / PR descriptions. Run it locally with Docker: <code>docker run -d -p 8081:8010 erikvl87/languagetool</code>.
        </p>
        <div className="flex gap-2">
          <input className="flex-1 font-mono" value={ltUrl} onChange={(e) => setLtUrl(e.target.value)} />
          <Button onClick={() => saveSettings({ languageToolUrl: ltUrl }).then(testLt)}>Save & test</Button>
        </div>
        <Result r={lt} />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-200">Google Drive and other services (via MCP)</h3>
        <p className="text-xs text-zinc-400">
          Hearth connects to external services through MCP servers. For Google Drive, add the <b>google-drive</b> template in the MCP tab, fill in your Google OAuth client id/secret, and remove <code>"disabled": true</code>. Step-by-step instructions are in{' '}
          <code>docs/connectors.md</code>.
        </p>
        <Button size="sm" onClick={() => openModal('settings', 'mcp')}>
          Open MCP servers
        </Button>
      </section>
    </div>
  );
}
