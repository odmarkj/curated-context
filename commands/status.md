---
description: Show curated-context daemon status, queue depth, and API usage
allowed-tools: Bash, Read
---

# /curated-context:status — System Status

Check the health of the curated-context daemon and display system metrics.

## Steps

1. Check daemon health:
   ```bash
   curl -s http://localhost:7377/health 2>/dev/null || echo '{"status":"stopped"}'
   ```

2. Count pending session files:
   ```bash
   ls ~/.curated-context/sessions/*.jsonl 2>/dev/null | wc -l
   ```

3. Read API usage from `~/.curated-context/config.json` (the `apiUsage` field)

4. Count project and global memories from store files in `~/.curated-context/store/`

## Display Format

```
Daemon: running (pid: 12345, uptime: 2h 30m)
Queue: 0 pending sessions
API: 2/10 calls this hour

Project memories: 15 (across 4 categories)
Global memories: 3
```
