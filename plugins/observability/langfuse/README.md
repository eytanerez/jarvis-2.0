# Langfuse Observability Plugin

This plugin ships bundled with Jarvis but is **opt-in** — it only loads when
you explicitly enable it.

## Enable

Pick one:

```bash
# Interactive: walks you through credentials + SDK install + enable
jarvis tools  # → Langfuse Observability

# Manual
pip install langfuse
jarvis plugins enable observability/langfuse
```

## Required credentials

Set these in `~/.jarvis/.env` (or via `jarvis tools`):

```bash
JARVIS_LANGFUSE_PUBLIC_KEY=pk-lf-...
JARVIS_LANGFUSE_SECRET_KEY=sk-lf-...
JARVIS_LANGFUSE_BASE_URL=https://cloud.langfuse.com   # or your self-hosted URL
```

Without the SDK or credentials the hooks no-op silently — the plugin fails
open.

## Verify

```bash
jarvis plugins list                 # observability/langfuse should show "enabled"
jarvis chat -q "hello"              # then check Langfuse for a "Jarvis turn" trace
```

## Optional tuning

```bash
JARVIS_LANGFUSE_ENV=production       # environment tag
JARVIS_LANGFUSE_RELEASE=v1.0.0       # release tag
JARVIS_LANGFUSE_SAMPLE_RATE=0.5      # sample 50% of traces
JARVIS_LANGFUSE_MAX_CHARS=12000      # max chars per field (default: 12000)
JARVIS_LANGFUSE_DEBUG=true           # verbose plugin logging
```

## Disable

```bash
jarvis plugins disable observability/langfuse
```
