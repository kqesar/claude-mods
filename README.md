# claude-mods

Mods for [Claude Code](https://code.claude.com): plugins built on its function
hooks API, with no third-party dependency.

| Mod | What it does |
| --- | --- |
| [checklist](checklist/README.md) | A live pane listing the session's tasks and a status line counter |
| [update](update/README.md) | `/update` moves the session to the latest Claude Code without losing it |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install checklist --marketplace kqesar/claude-mods
/plugin install update --marketplace kqesar/claude-mods
```

From a shell:

```
claude plugin install checklist --marketplace kqesar/claude-mods
claude plugin install update --marketplace kqesar/claude-mods
```

The checklist mod also needs `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` on models
that do not ship the task tools by default: see its
[setup](checklist/README.md#setup).

The update mod needs a small shell wrapper to restart for you: see its
[setup](update/README.md#setup).
