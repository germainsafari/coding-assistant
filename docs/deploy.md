# Deploy Hearth (Cloudflare Tunnel)

Hearth is not a typical web app. It must run **on the GPU workstation**: it talks to vLLM on this machine, edits local files, runs shell commands, and stores state in SQLite. **Do not deploy it to Vercel or Render.** Those platforms have no GPU, no local project folders, and no long-lived process for an agent that can run for hours.

The setup that matches your other Admind services is:

```text
browser  →  https://private-assistant.admindagency.com
         →  Cloudflare Tunnel (proxied)
         →  http://127.0.0.1:8070   (Hearth on this PC)
         →  http://127.0.0.1:8080   (vLLM, localhost only — do not publish this)
```

Ports 8080 / 8081 / 8082 / 8090 stay as they are. Hearth uses **8070**.

- [Why not Vercel or Render](#why-not-vercel-or-render)
- [1. Run Hearth on port 8070](#1-run-hearth-on-port-8070)
- [2. Publish the Cloudflare Tunnel hostname](#2-publish-the-cloudflare-tunnel-hostname)
- [3. Put Cloudflare Access in front](#3-put-cloudflare-access-in-front)
- [4. Keep it running](#4-keep-it-running)
- [Streaming / timeouts](#streaming--timeouts)
- [Checklist](#checklist)

## Why not Vercel or Render

| Need | This PC | Vercel | Render |
|---|---|---|---|
| RTX 5090 + vLLM on :8080 | yes | no | no |
| Edit files / run `git` / shell in a real project | yes | no | only inside a remote container |
| SQLite + Playwright + hours-long agent runs | yes | no | poor fit |
| Public HTTPS URL | Cloudflare Tunnel | yes | yes |

Vercel is for frontends and short serverless functions. Render could host a Node process, but that process would not see your GPU or your repos. Keep Hearth here; only the **URL** is public, through the tunnel.

## 1. Run Hearth on port 8070

In the Hearth folder (`coding assistant`), create a `.env` file:

```env
HEARTH_PORT=8070
HEARTH_HOST=127.0.0.1
HEARTH_LLM_BASE_URL=http://127.0.0.1:8080/v1
HEARTH_LLM_MODEL=qwen3.6-35b-a3b
HEARTH_LANGUAGETOOL_URL=http://127.0.0.1:8081
```

`127.0.0.1` is intentional. Cloudflare's `cloudflared` on this PC connects to localhost. Nothing else on the LAN should reach Hearth.

Then, with vLLM already up on 8080:

```powershell
cd "C:\Users\GermainSafari\Desktop\Admind\coding assistant"
npm install
npm run setup:browser
npm run doctor
npm start
```

You should see `Hearth server listening on http://localhost:8070`. Check it:

```powershell
curl http://127.0.0.1:8070/api/health
```

Docker instead of `npm start` (optional). The container still listens on 4545 inside; map host 8070:

```env
HEARTH_PORT=8070
```

```powershell
docker compose up -d --build
```

`docker-compose.yml` publishes `127.0.0.1:${HEARTH_PORT:-4545}:4545`, so the tunnel target is still `http://127.0.0.1:8070`.

## 2. Publish the Cloudflare Tunnel hostname

In [Zero Trust](https://one.dash.cloudflare.com/) → **Networks** → **Tunnels** → your existing tunnel → **Public Hostname** → Add:

| Field | Value |
|---|---|
| Subdomain | `private-assistant` |
| Domain | `admindagency.com` |
| Type | HTTP |
| URL | `http://localhost:8070` |
| DNS | Proxied (orange cloud) |

Leave vLLM (:8080), LanguageTool (:8081) and the deck engine (:8090) off this hostname. The browser only needs Hearth; Hearth calls those on localhost.

If this tunnel is the Docker `cloudflared` from `Ppttx maker/infra` (`TUNNEL_TOKEN`), adding the public hostname in the dashboard is enough. You do **not** need a second `cloudflared` process.

Restart is only needed if you run a **local config file** (`config.yml`) instead of a remotely managed tunnel. In that case add:

```yaml
ingress:
  - hostname: private-assistant.admindagency.com
    service: http://127.0.0.1:8070
    originRequest:
      noHappyEyeballs: true
      connectTimeout: 30s
      keepAliveTimeout: 90s
      disableChunkedEncoding: false
  # ...your existing hostnames...
  - service: http_status:404
```

## 3. Put Cloudflare Access in front

Hearth has **no login** and can run commands on this PC. A public hostname without Access is equivalent to giving the internet a terminal.

Zero Trust → **Access** → **Applications** → Add an application:

1. Type: **Self-hosted**
2. Application domain: `private-assistant.admindagency.com`
3. Policy: include only your email / Google Workspace / one-time PIN (whoever should use the assistant)
4. Session duration: a few hours is fine

Until Access shows a login page, do not share the URL.

Optional extra: Cloudflare WAF rate limit on `/api/threads/*/runs` if you worry about accidental loops.

## 4. Keep it running

PowerShell, this session only:

```powershell
cd "C:\Users\GermainSafari\Desktop\Admind\coding assistant"
npm start
```

After reboot, either:

- start it the same way, or
- Task Scheduler: trigger **At startup**, action `npm run start:only` in that folder (after a one-time `npm run build`), start in `C:\Users\GermainSafari\Desktop\Admind\coding assistant`.

vLLM and LanguageTool must already be up (your existing Docker stack). If the GPU box is off, the public URL will fail; that is expected.

## Streaming / timeouts

The UI uses **Server-Sent Events** for long agent runs.

- Cloudflare Tunnel generally streams these; if a run dies around **100 seconds**, the orange-cloud proxy timed out. Fix: Zero Trust → the hostname → raise the origin idle timeout if your plan allows it, or set the DNS record to **DNS only** (grey cloud). The tunnel still terminates TLS via Cloudflare for that hostname when using a tunnel CNAME.
- Do not put a second reverse proxy (nginx buffering) in front of 8070.

## Checklist

- [ ] vLLM healthy on `http://127.0.0.1:8080/v1/models`
- [ ] Hearth listening on `http://127.0.0.1:8070` (`/api/health` returns `hearth`)
- [ ] Tunnel public hostname `private-assistant.admindagency.com` → `http://localhost:8070`
- [ ] Cloudflare Access policy on that hostname
- [ ] Open the URL, sign in, create a project, send a short test message
- [ ] Confirm Settings → Models still points at `http://127.0.0.1:8080/v1` (not a public URL)
