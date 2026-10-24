# claude-mods

Small mods for [Claude Code](https://code.claude.com) that I use every day.
They are plain plugins on its function hooks API: no dependency, nothing to
build, one line to install.

![The checklist pane: the plan ticking itself off, and the files it changed](checklist/assets/pane.png)

| Mod | What it does |
| --- | --- |
| [checklist](checklist/README.md) | A live pane with the session's tasks and the files they changed, and a status line counter |
| [hot-upgrade](hot-upgrade/README.md) | `/hot-upgrade` moves the session to the latest Claude Code without losing it |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install checklist --marketplace kqesar/claude-mods
/plugin install hot-upgrade --marketplace kqesar/claude-mods
```

From a shell:

```
claude plugin install checklist --marketplace kqesar/claude-mods
claude plugin install hot-upgrade --marketplace kqesar/claude-mods
```

The checklist mod also needs `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` on models
that do not ship the task tools by default: see its
[setup](checklist/README.md#setup).

The hot-upgrade mod needs a small shell wrapper to restart for you: see
its [setup](hot-upgrade/README.md#setup).
