# Mem0 Memory Provider

Server-side LLM fact extraction with semantic search, reranking, and automatic deduplication.

## Requirements

- `pip install mem0ai`
- Mem0 API key from [app.mem0.ai](https://app.mem0.ai)

## Setup

```bash
jarvis memory setup    # select "mem0"
```

Or manually:
```bash
jarvis config set memory.provider mem0
echo "MEM0_API_KEY=your-key" >> ~/.jarvis/.env
```

## Config

Config file: `$JARVIS_HOME/mem0.json`

| Key | Default | Description |
|-----|---------|-------------|
| `user_id` | `jarvis-user` | User identifier on Mem0 |
| `agent_id` | `jarvis` | Agent identifier |
| `rerank` | `true` | Enable reranking for recall |

## Tools

| Tool | Description |
|------|-------------|
| `mem0_profile` | All stored memories about the user |
| `mem0_search` | Semantic search with optional reranking |
| `mem0_conclude` | Store a fact verbatim (no LLM extraction) |
