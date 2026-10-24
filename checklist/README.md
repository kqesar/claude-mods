# checklist

Shows the task list Claude keeps with `TaskCreate` / `TaskUpdate` in a live
pane beside the chat, and a counter in the status line.

```
1/3 done
☑ Write the parser        (struck through)
▶ Running the tests   ✕
☐ Update the docs     ✕
```

- `/checklist` opens the pane. It also opens by itself on the first task when
  the terminal docks panes (fullscreen layout, wide enough).
- The status line reads `1/3 ▸ Running the tests`, then `3/3 ✓`.
- `✕` deletes a pending or running task from Claude's own list, after a
  `Delete? Yes / No` confirmation. Done tasks cannot be deleted.
- A system prompt section asks Claude to turn every approved plan into tasks,
  and approving a plan (`ExitPlanMode`) adds a reminder to do it right away.
- Models that use `TodoWrite` instead of the task tools are mirrored too.

## Requirements

The task tools are enabled by default on some models only. Elsewhere, set
`CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, for instance in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1" } }
```

The mod warns with a toast when no task tool is offered to the model.

## Design notes

The plugin API exposes no task list, so the mod keeps a mirror in the session
state (`$.state`), rebuilt from the task tools' calls; a `TaskList` call
resyncs it with the engine's list (useful after `/resume`). Subagents' tasks
are left out. The pane is terminal-only: remote surfaces (claude.ai/code, the
mobile app) do not place plugin panes.

## Install

```
/plugin install checklist --marketplace kqesar/claude-mods
```
