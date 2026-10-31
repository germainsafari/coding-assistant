# Setup guide

This guide takes you from a fresh computer to a running Hearth, step by step. No prior experience with AI models is needed. It covers **Windows 10/11** and **Linux** (Ubuntu/Debian commands; other distributions are similar). Expect about 30–60 minutes, most of it waiting for downloads.

Hearth has two parts:

1. **The model server** ([vLLM](https://docs.vllm.ai/)) runs the AI model on your graphics card (GPU) and offers an OpenAI-compatible API on `http://localhost:8080/v1`.
2. **Hearth** is a small Node.js web app that talks to that API and gives the model tools: files, terminal, git, browser and so on. You use it in your web browser.

An optional third part, **LanguageTool**, checks grammar in docs and commit messages.

- [1. Check your hardware](#1-check-your-hardware)
- [2. Install the basics](#2-install-the-basics)
- [3. Start the model server](#3-start-the-model-server)
- [4. Start LanguageTool (optional)](#4-start-languagetool-optional)
- [5. Install and start Hearth](#5-install-and-start-hearth)
- [6. Your first task](#6-your-first-task)
- [7. Configuration](#7-configuration)
- [8. Running Hearth in Docker](#8-running-hearth-in-docker)
- [9. Troubleshooting](#9-troubleshooting)

## 1. Check your hardware

| | Recommended (tested) | Minimum |
|---|---|---|
| GPU | NVIDIA RTX 5090, 32 GB VRAM | NVIDIA GPU with 16–24 GB VRAM and a smaller or more heavily quantized model |
| RAM | 32 GB | 16 GB |
| Disk | 60 GB free (model ~22 GB, Docker images ~15 GB) | 40 GB |
| OS | Windows 11 with WSL 2, or Linux | |

**Which model?** Hearth is tested with `nvidia/Qwen3.6-35B-A3B-NVFP4`, a mixture-of-experts coding model with 35B parameters and only 3B active per token. That makes it fast: about 200 tokens per second on an RTX 5090. On a 32 GB card you can also run `unsloth/Qwen3.8-27B-NVFP4`, which scored equally on the six built-in evals but was about 6× slower; keep Qwen3.6 as the everyday model.

- **NVFP4 needs an NVIDIA Blackwell GPU** (RTX 50-series, RTX PRO 6000, B200).
- **On RTX 30- and 40-series cards** use an AWQ or GPTQ 4-bit build of a Qwen3 coder model that fits your VRAM. Search Hugging Face for the model name plus "AWQ". Then change the model name in the command in step 3, drop `--quantization modelopt` (vLLM detects AWQ/GPTQ automatically), and lower `--max-model-len` (for example to 32768) if you run out of memory.
- **No NVIDIA GPU?** Hearth works with any OpenAI-compatible server, for example llama.cpp's `llama-server` or Ollama (`http://localhost:11434/v1`). Pick "Prompt" tool mode in Settings → Models if tool calls don't work. Only vLLM has been tested, so expect some rough edges.

## 2. Install the basics

You need **Node.js 22.13 or newer**, **Git**, and **Docker** with GPU support. **Python 3** is optional (some eval tasks and many Python projects use it).

### Windows

1. **NVIDIA driver:** install the latest Game Ready or Studio driver from [nvidia.com/drivers](https://www.nvidia.com/drivers).
2. **Node.js, Git and Python:** open *PowerShell* and run:

   ```powershell
   winget install OpenJS.NodeJS.LTS
   winget install Git.Git
   winget install Python.Python.3.13
   ```

   Close and reopen PowerShell afterwards so the new commands are found. Check with `node --version` (should print v22.13 or newer).

3. **Docker Desktop:** install it from [docker.com](https://www.docker.com/products/docker-desktop/). During setup keep "Use WSL 2" selected. Start Docker Desktop once and wait until it says "Engine running". GPU support works out of the box on Windows 11 with a current NVIDIA driver. Test it with:

   ```powershell
   docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu24.04 nvidia-smi
   ```

   You should see a table with your GPU.

4. If PowerShell says *"running scripts is disabled on this system"* when you run `npm`, allow local scripts once:

   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   ```

### Linux (Ubuntu/Debian)

1. **NVIDIA driver:** `sudo ubuntu-drivers install`, then reboot. Check with `nvidia-smi`.
2. **Docker and the NVIDIA Container Toolkit:**

   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER        # log out and back in afterwards
   # NVIDIA Container Toolkit: follow
   # https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html
   sudo nvidia-ctk runtime configure --runtime=docker
   sudo systemctl restart docker
   docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu24.04 nvidia-smi
   ```

3. **Node.js 22, Git and Python:**

   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs git python3 python-is-python3
   node --version    # v22.13 or newer
   ```

## 3. Start the model server

This command downloads vLLM and the model (about 22 GB, so the first start takes a while) and serves it on port 8080. It is one command; copy all of it.

**Linux / macOS / Git Bash:**

```bash
docker run -d --name vllm --restart unless-stopped \
  --gpus all --ipc=host -p 8080:8000 \
  -v hf-cache:/root/.cache/huggingface \
  vllm/vllm-openai:nightly \
  nvidia/Qwen3.6-35B-A3B-NVFP4 \
  --served-model-name qwen3.6-35b-a3b \
  --quantization modelopt \
  --max-model-len 262144 \
  --gpu-memory-utilization 0.88 \
  --enable-auto-tool-choice --tool-call-parser qwen3_coder \
  --reasoning-parser qwen3 \
  --kv-cache-dtype fp8 \
  --enable-prefix-caching
```

**Windows PowerShell** (same command, with backticks for line breaks):

```powershell
docker run -d --name vllm --restart unless-stopped `
  --gpus all --ipc=host -p 8080:8000 `
  -v hf-cache:/root/.cache/huggingface `
  vllm/vllm-openai:nightly `
  nvidia/Qwen3.6-35B-A3B-NVFP4 `
  --served-model-name qwen3.6-35b-a3b `
  --quantization modelopt `
  --max-model-len 262144 `
  --gpu-memory-utilization 0.88 `
  --enable-auto-tool-choice --tool-call-parser qwen3_coder `
  --reasoning-parser qwen3 `
  --kv-cache-dtype fp8 `
  --enable-prefix-caching
```

What the flags do:

| Flag | Why |
|---|---|
| `--served-model-name qwen3.6-35b-a3b` | The name Hearth uses to ask for the model (Hearth's default). |
| `--quantization modelopt` | The NVFP4 checkpoint is made with NVIDIA ModelOpt. |
| `--max-model-len 262144` | Context window: how much text the model sees at once. 262k fits on a 32 GB RTX 5090 with FP8 KV cache. Lower it (for example to 65536) if you run out of memory. |
| `--gpu-memory-utilization 0.88` | Share of VRAM vLLM may use. Leave some for your desktop. |
| `--enable-auto-tool-choice --tool-call-parser qwen3_coder` | Native tool calling. Without these flags Hearth falls back to "template" mode, which also works well (see [harness.md](harness.md#tool-calling-modes)). |
| `--reasoning-parser qwen3` | Separates the model's "thinking" from its answer, so Hearth can show it collapsed. |
| `--kv-cache-dtype fp8` | Halves the memory of the context cache, so the long context fits. |
| `--enable-prefix-caching` | Reuses work between agent steps (the conversation prefix repeats every step), which makes the agent much faster. |

Watch the startup with `docker logs -f vllm`. It is ready when you see `Application startup complete` (the first start can take 5–15 minutes; later starts 1–3 minutes). Press Ctrl+C to stop watching; the server keeps running. Then check it:

```bash
curl http://localhost:8080/v1/models
```

The answer should contain `"id":"qwen3.6-35b-a3b"` and `"max_model_len":65536`.

Some models on Hugging Face require you to accept a license and log in. If the download fails with a 401 or 403 error, create a token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) and add `-e HF_TOKEN=hf_...` to the command.

## 4. Start LanguageTool (optional)

[LanguageTool](https://languagetool.org/) is an open-source grammar checker. Hearth uses it for the `languagetool_check` tool (the agent proofreads docs it writes) and to polish AI-written commit messages.

```bash
docker run -d --name languagetool --restart unless-stopped -p 8081:8081 meyay/languagetool
```

Check it with `curl "http://localhost:8081/v2/check?language=en-US&text=This%20are%20a%20test"`. The response should report one issue.

## 5. Install and start Hearth

```bash
git clone <this repository> hearth
cd hearth
npm install              # installs dependencies (1–3 minutes)
npm run setup:browser    # downloads the headless Chromium used by the browser tools (~150 MB)
npm run doctor           # checks that everything is in place
```

The doctor checks your setup and tells you how to fix anything missing. A healthy setup looks like this:

```text
Hearth doctor

✔ Node.js: 22.20.0
✔ Shell for agent commands: Windows PowerShell 5.1
✔ Git: git version 2.49.0.windows.1
✔ Python (optional, used by some evals): Python 3.13.7
✔ Data folder: …\hearth\data
✔ Web UI build: …\hearth\packages\web\dist
✔ Port 4545 on localhost (IPv4 + IPv6): free
✔ Model "qwen3.6-35b-a3b" (qwen3.6-35b-a3b @ http://localhost:8080/v1): served, context 262144 tokens
✔   Tool calling: native mode (native=true, template=true), reasoning=true
✔ LanguageTool (optional): http://localhost:8081
✔ Browser for agent tools: Playwright Chromium
! GitHub token (optional): not set
    → Settings → Connectors → GitHub (needed for PRs, issues, private clones and pushes).

All required checks passed. Start Hearth with: npm start
```

"Web UI build" shows a warning before your first `npm start`; that's expected. Now start Hearth:

```bash
npm start
```

This builds the web UI and starts the server. Open **<http://localhost:4545>** in your browser. To stop Hearth, press Ctrl+C in that terminal. Next time, `npm run start:only` skips the build and starts in a second.

## 6. Your first task

1. Click **Add project**. Choose **New project**, give it a name (it is created in `HearthProjects` in your home folder), and click **Create project**. You can also open an existing folder or clone a Git repository.
2. Type a request, for example:

   > Create a small Python command-line to-do app that stores tasks in a JSON file, with unit tests. Run the tests.

3. Watch the agent work. Each step appears as a card: files it reads, edits (with diffs), and commands it runs (with output). Click a card to expand it.
4. In the default **Auto-edit** mode the agent edits files freely but asks before running commands that change things. Click **Approve**, **Always allow** (for the rest of this run), or **Deny**. When you deny, you can tell the agent what to do instead. Switch the mode in the box below the message field:
   - **Ask** confirms everything.
   - **Auto-edit** confirms only shell commands.
   - **Full auto** never asks; use it in projects you can afford to lose, or with git.
5. The right-hand panel shows the project's **Files**, **Git** changes, the agent's **Browser**, a **Terminal**, and **Traces** of every step.

For bigger jobs, turn on **Long-run** before sending. The agent then plans, works unattended for up to hours, writes progress notes to `.agent/progress.md`, and may only finish once your "definition of done" command (for example `npm test`) passes. See [harness.md](harness.md#long-run-mode).

## 7. Configuration

Most settings live in the UI (**Settings**, bottom left) and are saved to `data/settings.json`:

- **Models:** model profiles (server URL, model name, temperature, context size, thinking on/off, tool mode). Use **Test connection** to see what Hearth detected. You can add profiles for other servers and pick one per message.
- **Agent:** approval mode, step limit, shell timeout, compaction threshold, projects folder, memory recall, long-run defaults, OpenTelemetry export.
- **MCP servers, Connectors, Skills, Memory:** see [connectors.md](connectors.md) and [harness.md](harness.md).

Startup options come from environment variables or a `.env` file in the Hearth folder; copy [.env.example](../.env.example) to `.env`. The most useful ones:

| Variable | Default | Meaning |
|---|---|---|
| `HEARTH_PORT` | `4545` | Web server port (`npm run dev` uses 4545 for the UI and 4546 for the API) |
| `HEARTH_HOST` | `localhost` | IPv4 and IPv6 loopback. Hearth has no login, so don't bind it to a public address |
| `HEARTH_DATA_DIR` | `./data` | Database, settings and user skills |
| `HEARTH_PROJECTS_DIR` | `~/HearthProjects` | Where "New project" creates folders |
| `HEARTH_LLM_BASE_URL` | `http://localhost:8080/v1` | Default model server (first start only; later the UI settings win) |
| `HEARTH_LLM_MODEL` | `qwen3.6-35b-a3b` | Default model name |
| `HEARTH_LANGUAGETOOL_URL` | `http://localhost:8081` | LanguageTool server |
| `GITHUB_TOKEN` | | GitHub token (can also be set in the UI) |

## 8. Running Hearth in Docker

The included [docker-compose.yml](../docker-compose.yml) runs Hearth in a container. The container includes git, Python and Chromium, and sees only the folder you mount as `/workspace`. That is a good way to give the agent less access to your computer.

```bash
cp .env.example .env                                   # optional
docker compose up -d --build                           # Hearth only (model server already running)
docker compose --profile languagetool up -d --build    # plus LanguageTool
docker compose --profile vllm --profile languagetool up -d --build   # plus vLLM (same flags as step 3)
docker compose --profile observability up -d           # plus Jaeger for traces
```

Open <http://localhost:4545>. Projects are stored in `./workspace` next to the compose file; create them under `/workspace` in the UI. The container reaches the model server through `host.docker.internal:8080`. If you already started vLLM with step 3, don't also use the `vllm` profile: both would claim port 8080 and the GPU.

## 9. Troubleshooting

**The page at localhost:4545 shows a different app, or doesn't load.** Another program is using that port. Hearth prints a warning at startup. Start it on another port:

```powershell
$env:HEARTH_PORT=4550; npm run start:only      # PowerShell
```

```bash
HEARTH_PORT=4550 npm run start:only            # bash
```

**"Cannot reach the model server".** Check `docker ps` (is `vllm` running?) and `docker logs vllm` (is it still loading, or did it crash?). Then try `curl http://localhost:8080/v1/models`. In Settings → Models, make sure the URL ends in `/v1`.

**vLLM crashes with "CUDA out of memory".** Lower `--max-model-len` (for example to 32768) or `--gpu-memory-utilization` (for example to 0.80), and close other GPU-heavy programs. Remove the old container first with `docker rm -f vllm`.

**vLLM says the quantization is not supported.** Your GPU can't run NVFP4. See [step 1](#1-check-your-hardware) for alternatives.

**The doctor says "template mode".** vLLM was started without `--enable-auto-tool-choice --tool-call-parser qwen3_coder`. Hearth still works (it puts the tools into the model's chat template and parses the calls itself). To switch to native mode, recreate the container with the flags from step 3. Hearth re-detects the mode automatically within 5 minutes, or right away when you click **Test connection** in Settings → Models.

**The agent's browser tools fail with "Executable doesn't exist".** Run `npm run setup:browser`. Hearth also falls back to an installed Chrome or Edge.

**Answers are slow.** Check the tokens-per-second figure under the message field. Make sure `--enable-prefix-caching` is set, and that no other program is using the GPU (`nvidia-smi`). Turning off "thinking" in the model profile makes simple tasks faster, but less reliable on hard ones (see the eval results in [observability-and-evals.md](observability-and-evals.md#results)).

**Commands fail with `&&` on Windows.** The agent uses Windows PowerShell 5.1, which doesn't support `&&`. The agent is told this, and usually uses `;` instead. If you have PowerShell 7 (`pwsh`), Hearth uses it automatically.

Still stuck? Run `npm run doctor` and open an issue with its output (see [contributing.md](contributing.md)).
