<p align="center">
  <img src="assets/banner.png" alt="Jarvis" width="100%">
</p>

# Jarvis
<p align="center">
  <a href="https://jarvis-agent.nousresearch.com/">Jarvis</a> | <a href="https://jarvis-agent.nousresearch.com/">Jarvis Desktop</a>
</p>
<p align="center">
  <a href="https://jarvis-agent.nousresearch.com/docs/"><img src="https://img.shields.io/badge/Docs-jarvis--agent.nousresearch.com-FFD700?style=for-the-badge" alt="Documentation"></a>
  <a href="https://discord.gg/NousResearch"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://github.com/NousResearch/jarvis-brain/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT"></a>
  <a href="https://nousresearch.com"><img src="https://img.shields.io/badge/Built%20by-Nous%20Research-blueviolet?style=for-the-badge" alt="Built by Nous Research"></a>
  <a href="README.zh-CN.md"><img src="https://img.shields.io/badge/Lang-中文-red?style=for-the-badge" alt="中文"></a>
  <a href="README.ur-pk.md"><img src="https://img.shields.io/badge/Lang-اردو-green?style=for-the-badge" alt="اردو"></a>
</p>

**Jarvis is a self-improving AI operating layer built by [Nous Research](https://nousresearch.com).** The core runtime is the **Jarvis Brain**: it learns from work, creates and improves skills, recalls past sessions, schedules jobs, delegates to sub-brains, and carries the same mind across CLI, desktop, TUI, and messaging platforms.

Run Jarvis where it makes sense: on your laptop, a $5 VPS, a GPU cluster, or serverless infrastructure that sleeps when idle. Talk to it from the terminal, Telegram, Discord, Slack, WhatsApp, Signal, or the desktop app while the Brain keeps one continuous memory.

Use any model you want — [Nous Portal](https://portal.nousresearch.com), [OpenRouter](https://openrouter.ai) (200+ models), [NovitaAI](https://novita.ai), [NVIDIA NIM](https://build.nvidia.com), [Xiaomi MiMo](https://platform.xiaomimimo.com), [z.ai/GLM](https://z.ai), [Kimi/Moonshot](https://platform.moonshot.ai), [MiniMax](https://www.minimax.io), [Hugging Face](https://huggingface.co), OpenAI, or your own endpoint. Switch with `jarvis model` — no code changes, no lock-in.

<table>
<tr><td><b>Jarvis Brain</b></td><td>One reusable runtime across every surface, with memory, skills, prompt caching, sub-brain delegation, and scheduled work.</td></tr>
<tr><td><b>Terminal-grade control</b></td><td>Full TUI with multiline editing, slash-command autocomplete, conversation history, interrupt-and-redirect, and streaming tool output.</td></tr>
<tr><td><b>Everywhere interface</b></td><td>Telegram, Discord, Slack, WhatsApp, Signal, desktop, and CLI from one gateway. Voice memo transcription and cross-platform conversation continuity included.</td></tr>
<tr><td><b>Closed learning loop</b></td><td>Brain-curated memory, autonomous skill creation, skill self-improvement, FTS5 session search, LLM recall summaries, and optional <a href="https://github.com/plastic-labs/honcho">Honcho</a> user modeling.</td></tr>
<tr><td><b>Autonomous routines</b></td><td>Built-in cron scheduler with delivery to any platform. Daily reports, nightly backups, weekly audits, and unattended natural-language workflows.</td></tr>
<tr><td><b>Cloud-ready execution</b></td><td>Six terminal backends: local, Docker, SSH, Singularity, Modal, and Daytona. Environments can hibernate between sessions and wake on demand.</td></tr>
<tr><td><b>Research-ready</b></td><td>Batch trajectory generation and trajectory compression for training the next generation of tool-calling systems.</td></tr>
</table>

---

## Quick Install

### Linux, macOS, WSL2, Termux

```bash
curl -fsSL https://jarvis-agent.nousresearch.com/install.sh | bash
```

### Windows (native, PowerShell)

> **Heads up:** Native Windows runs Jarvis without WSL — CLI, gateway, TUI, and tools all work natively. If you'd rather use WSL2, the Linux/macOS one-liner above works there too. Found a bug? Please [file issues](https://github.com/NousResearch/jarvis-brain/issues).

Run this in PowerShell:

```powershell
iex (irm https://jarvis-agent.nousresearch.com/install.ps1)
```

The installer handles everything: uv, Python 3.11, Node.js, ripgrep, ffmpeg, **and a portable Git Bash** (MinGit, unpacked to `%LOCALAPPDATA%\jarvis\git` — no admin required, completely isolated from any system Git install). Jarvis uses this bundled Git Bash to run shell commands.

If you already have Git installed, the installer detects it and uses that instead. Otherwise a ~45MB MinGit download is all you need — it won't touch or interfere with any system Git.

> **Android / Termux:** The tested manual path is documented in the [Termux guide](https://jarvis-agent.nousresearch.com/docs/getting-started/termux). On Termux, Jarvis installs a curated `.[termux]` extra because the full `.[all]` extra currently pulls Android-incompatible voice dependencies.
>
> **Windows:** Native Windows is fully supported — the PowerShell one-liner above installs everything. If you'd rather use WSL2, the Linux command works there too. Native Windows install lives under `%LOCALAPPDATA%\jarvis`; WSL2 installs under `~/.jarvis` as on Linux.

After installation:

```bash
source ~/.bashrc    # reload shell (or: source ~/.zshrc)
jarvis              # start chatting!
```

---

## Getting Started

```bash
jarvis              # Interactive CLI — start a conversation
jarvis model        # Choose your LLM provider and model
jarvis tools        # Configure which tools are enabled
jarvis config set   # Set individual config values
jarvis gateway      # Start the messaging gateway (Telegram, Discord, etc.)
jarvis setup        # Run the full setup wizard (configures everything at once)
jarvis claw migrate # Migrate from OpenClaw (if coming from OpenClaw)
jarvis update       # Update to the latest version
jarvis doctor       # Diagnose any issues
```

📖 **[Full documentation →](https://jarvis-agent.nousresearch.com/docs/)**

---

## Skip the API-key collection — Nous Portal

Jarvis works with whatever provider you want — that's not changing. But if you'd rather not collect five separate API keys for the model, web search, image generation, TTS, and a cloud browser, **[Nous Portal](https://portal.nousresearch.com)** covers all of them under one subscription:

- **300+ models** — pick any of them with `/model <name>`
- **Tool Gateway** — web search (Firecrawl), image generation (FAL), text-to-speech (OpenAI), cloud browser (Browser Use), all routed through your sub. No extra accounts.

One command from a fresh install:

```bash
jarvis setup --portal
```

That logs you in via OAuth, sets Nous as your provider, and turns on the Tool Gateway. Check what's wired up any time with `jarvis portal info`. Full details on the [Tool Gateway docs page](https://jarvis-agent.nousresearch.com/docs/user-guide/features/tool-gateway).

You can still bring your own keys per-tool whenever you want — the gateway is per-backend, not all-or-nothing.

---

## CLI vs Messaging Quick Reference

Jarvis has two entry points: start the terminal UI with `jarvis`, or run the gateway and talk to it from Telegram, Discord, Slack, WhatsApp, Signal, or Email. Once you're in a conversation, many slash commands are shared across both interfaces.

| Action                         | CLI                                           | Messaging platforms                                                              |
| ------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------- |
| Start chatting                 | `jarvis`                                      | Run `jarvis gateway setup` + `jarvis gateway start`, then send the bot a message |
| Start fresh conversation       | `/new` or `/reset`                            | `/new` or `/reset`                                                               |
| Change model                   | `/model [provider:model]`                     | `/model [provider:model]`                                                        |
| Set a personality              | `/personality [name]`                         | `/personality [name]`                                                            |
| Retry or undo the last turn    | `/retry`, `/undo`                             | `/retry`, `/undo`                                                                |
| Compress context / check usage | `/compress`, `/usage`, `/insights [--days N]` | `/compress`, `/usage`, `/insights [days]`                                        |
| Browse skills                  | `/skills` or `/<skill-name>`                  | `/<skill-name>`                                                                  |
| Interrupt current work         | `Ctrl+C` or send a new message                | `/stop` or send a new message                                                    |
| Platform-specific status       | `/platforms`                                  | `/status`, `/sethome`                                                            |

For the full command lists, see the [CLI guide](https://jarvis-agent.nousresearch.com/docs/user-guide/cli) and the [Messaging Gateway guide](https://jarvis-agent.nousresearch.com/docs/user-guide/messaging).

---

## Documentation

All documentation lives at **[jarvis-agent.nousresearch.com/docs](https://jarvis-agent.nousresearch.com/docs/)**:

| Section                                                                                             | What's Covered                                             |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [Quickstart](https://jarvis-agent.nousresearch.com/docs/getting-started/quickstart)                 | Install → setup → first conversation in 2 minutes          |
| [CLI Usage](https://jarvis-agent.nousresearch.com/docs/user-guide/cli)                              | Commands, keybindings, personalities, sessions             |
| [Configuration](https://jarvis-agent.nousresearch.com/docs/user-guide/configuration)                | Config file, providers, models, all options                |
| [Messaging Gateway](https://jarvis-agent.nousresearch.com/docs/user-guide/messaging)                | Telegram, Discord, Slack, WhatsApp, Signal, Home Assistant |
| [Security](https://jarvis-agent.nousresearch.com/docs/user-guide/security)                          | Command approval, DM pairing, container isolation          |
| [Tools & Toolsets](https://jarvis-agent.nousresearch.com/docs/user-guide/features/tools)            | 40+ tools, toolset system, terminal backends               |
| [Skills System](https://jarvis-agent.nousresearch.com/docs/user-guide/features/skills)              | Procedural memory, Skills Hub, creating skills             |
| [Memory](https://jarvis-agent.nousresearch.com/docs/user-guide/features/memory)                     | Persistent memory, user profiles, best practices           |
| [MCP Integration](https://jarvis-agent.nousresearch.com/docs/user-guide/features/mcp)               | Connect any MCP server for extended capabilities           |
| [Cron Scheduling](https://jarvis-agent.nousresearch.com/docs/user-guide/features/cron)              | Scheduled tasks with platform delivery                     |
| [Context Files](https://jarvis-agent.nousresearch.com/docs/user-guide/features/context-files)       | Project context that shapes every conversation             |
| [Architecture](https://jarvis-agent.nousresearch.com/docs/developer-guide/architecture)             | Project structure, agent loop, key classes                 |
| [Contributing](https://jarvis-agent.nousresearch.com/docs/developer-guide/contributing)             | Development setup, PR process, code style                  |
| [CLI Reference](https://jarvis-agent.nousresearch.com/docs/reference/cli-commands)                  | All commands and flags                                     |
| [Environment Variables](https://jarvis-agent.nousresearch.com/docs/reference/environment-variables) | Complete env var reference                                 |

---

## Migrating from OpenClaw

If you're coming from OpenClaw, Jarvis can automatically import your settings, memories, skills, and API keys.

**During first-time setup:** The setup wizard (`jarvis setup`) automatically detects `~/.openclaw` and offers to migrate before configuration begins.

**Anytime after install:**

```bash
jarvis claw migrate              # Interactive migration (full preset)
jarvis claw migrate --dry-run    # Preview what would be migrated
jarvis claw migrate --preset user-data   # Migrate without secrets
jarvis claw migrate --overwrite  # Overwrite existing conflicts
```

What gets imported:

- **SOUL.md** — persona file
- **Memories** — MEMORY.md and USER.md entries
- **Skills** — user-created skills → `~/.jarvis/skills/openclaw-imports/`
- **Command allowlist** — approval patterns
- **Messaging settings** — platform configs, allowed users, working directory
- **API keys** — allowlisted secrets (Telegram, OpenRouter, OpenAI, Anthropic, ElevenLabs)
- **TTS assets** — workspace audio files
- **Workspace instructions** — AGENTS.md (with `--workspace-target`)

See `jarvis claw migrate --help` for all options, or use the `openclaw-migration` skill for an interactive agent-guided migration with dry-run previews.

---

## Contributing

We welcome contributions! See the [Contributing Guide](https://jarvis-agent.nousresearch.com/docs/developer-guide/contributing) for development setup, code style, and PR process.

Quick start for contributors — use the standard installer, then work from the
full git checkout it creates at `$JARVIS_HOME/jarvis-agent` (usually
`~/.jarvis/jarvis-agent`). This matches the layout used by `jarvis update`, the
managed venv, lazy dependencies, gateway, and docs tooling.

```bash
curl -fsSL https://jarvis-agent.nousresearch.com/install.sh | bash
cd "${JARVIS_HOME:-$HOME/.jarvis}/jarvis-agent"
uv pip install -e ".[all,dev]"
scripts/run_tests.sh
```

Manual clone fallback (for throwaway clones/CI where you intentionally do not
want the managed install layout):

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
uv venv .venv --python 3.11
source .venv/bin/activate
uv pip install -e ".[all,dev]"
scripts/run_tests.sh
```

---

## Community

- 💬 [Discord](https://discord.gg/NousResearch)
- 📚 [Skills Hub](https://agentskills.io)
- 🐛 [Issues](https://github.com/NousResearch/jarvis-brain/issues)
- 🔌 [computer-use-linux](https://github.com/avifenesh/computer-use-linux) — Linux desktop-control MCP server for Jarvis and other MCP hosts, with AT-SPI accessibility trees, Wayland/X11 input, screenshots, and compositor window targeting.
- 🔌 [JarvisClaw](https://github.com/AaronWong1999/jarvisclaw) — Community WeChat bridge: Run Jarvis and OpenClaw on the same WeChat account.

---

## License

MIT — see [LICENSE](LICENSE).

Built by [Nous Research](https://nousresearch.com).
