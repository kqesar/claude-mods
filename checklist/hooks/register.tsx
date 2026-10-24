import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderSurface } from 'claude-code'

import type { Task, TaskStatus } from '../types'

const PANE = 'checklist'
const TITLE = 'Plan'
// The engine exposes no task list to plugins: this is a mirror rebuilt from
// the task tools' calls. Bump the tag when Task changes shape.
const tasks = atom({ plugin: 'checklist', key: 'tasks' } as const, [], {
  shape: 'tasks-1',
})
// The task whose ✕ was pressed, waiting for its confirmation.
const armed = atom({ plugin: 'checklist', key: 'armed' } as const, null)

const MARK: Record<TaskStatus, string> = {
  pending: '☐',
  in_progress: '▶',
  completed: '☑',
}

const GUIDANCE = [
  'Task list: whenever a plan is approved (ExitPlanMode accepted, or the user',
  'validates a plan you proposed), immediately convert every step of it into',
  'tasks with TaskCreate (or TodoWrite when that is the available tool), one',
  'task per step, in order, before starting the work. Then keep the list',
  'current: mark a task in_progress when you start it (only one at a time)',
  'and completed as soon as it is done. The user follows progress through',
  'this list, so never work through a multi-step plan without it.',
].join('\n')

const REMINDER =
  'The plan was approved. Before anything else, create one task per plan step ' +
  'with TaskCreate (or TodoWrite), then mark the first one in_progress.'

const isTaskTool = (name: string) => name === 'TaskCreate' || name === 'TodoWrite'

const labelOf = (task: Task) =>
  task.status === 'in_progress' ? (task.activeForm ?? task.subject) : task.subject

function statusOf(list: readonly Task[]): string | undefined {
  if (list.length === 0) {
    return undefined
  }
  const done = list.filter(task => task.status === 'completed').length
  const current = list.find(task => task.status === 'in_progress')
  const count = `${done}/${list.length}`

  if (current) {
    return `${count} ▸ ${labelOf(current)}`
  }

  return done === list.length ? `${count} ✓` : count
}

// A done task stays as a record; TodoWrite items have no id to delete by.
const isDeletable = (task: Task) =>
  task.status !== 'completed' && !task.id.startsWith('todo-')

// Deletes the task in the engine's own list, then in the mirror: the mod's
// own TaskUpdate hook does not see a call the mod raised itself.
async function remove($: EngineInterface, taskId: string) {
  await update($, armed, () => null)
  const ran = await $.tool.call({ tool: 'TaskUpdate', taskId, status: 'deleted' })

  if (ran.deny === undefined && ran.isError !== true) {
    const after = await update($, tasks, list => list.filter(task => task.id !== taskId))
    $.ui.status(statusOf(after))
  }
}

async function drawChecklist(
  $: EngineInterface,
  { Box, Text, Button }: Pick<ElementTable, 'Box' | 'Text' | 'Button'>,
) {
  const list = await read($, tasks)
  const armedId = await read($, armed)
  const done = list.filter(task => task.status === 'completed').length

  return (
    <Box flexDirection="column">
      <Text bold>
        {done}/{list.length} done
      </Text>
      {list.map(task => {
        const isDone = task.status === 'completed'

        return (
          <Box flexDirection="row" gap={1}>
            <Text bold={task.status === 'in_progress'} dimColor={isDone} strikethrough={isDone}>
              {MARK[task.status]} {labelOf(task)}
            </Text>
            {isDeletable(task) && armedId !== task.id && (
              <Button
                key={`delete-${task.id}`}
                plain
                label="✕"
                onPress={() => update($, armed, () => task.id)}
              />
            )}
            {armedId === task.id && (
              <Box flexDirection="row" gap={1}>
                <Text color="red">Delete?</Text>
                <Button key={`yes-${task.id}`} label="Yes" onPress={() => remove($, task.id)} />
                <Button key={`no-${task.id}`} label="No" onPress={() => update($, armed, () => null)} />
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

// Applies a change to the mirror, then refreshes the status line and opens
// the pane unasked on the first task where a surface docks it as a sidebar.
async function change(
  $: EngineInterface,
  docking: ReadonlySet<RenderSurface>,
  fn: (list: Task[]) => Task[],
) {
  const before = (await read($, tasks)).length
  const after = await update($, tasks, list => fn([...list]))
  $.ui.status(statusOf(after))

  if (before === 0 && after.length > 0 && docking.size > 0) {
    void $.ui.open({ id: PANE, title: TITLE })
  }
}

export const register: Register = on => {
  // Surfaces whose last drawing said they dock a pane beside the transcript.
  const docking = new Set<RenderSurface>()
  let hasWarned = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'checklist',
      description: 'Show the current task list in a live pane',
    })
    $.ui.status(statusOf(await read($, tasks)))

    return next(e)
  })

  on('command.run', { command: 'checklist' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    const count = (await read($, tasks)).length

    if (!opened.isPlaced) {
      return { text: `Checklist pane not shown: ${opened.reason}` }
    }

    return {
      text: count === 0 ? 'Checklist opened: no task yet.' : 'Checklist opened.',
    }
  })

  // A new plan starts once every task of the previous one is done.
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)

    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true) {
      const task: Task = {
        id: ran.result.task.id,
        subject: e.subject,
        activeForm: e.activeForm,
        status: 'pending',
      }
      await change($, docking, list => {
        const isFinished = list.every(one => one.status === 'completed')

        return isFinished ? [task] : [...list, task]
      })
    }

    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)

    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true) {
      const { status } = e
      await change($, docking, list => {
        if (status === 'deleted') {
          return list.filter(task => task.id !== e.taskId)
        }

        return list.map(task =>
          task.id === e.taskId
            ? {
                ...task,
                subject: e.subject ?? task.subject,
                activeForm: e.activeForm ?? task.activeForm,
                status: status ?? task.status,
              }
            : task,
        )
      })
    }

    return ran
  })

  // TaskList is the source of truth: it resyncs a mirror that drifted (resume).
  on('tool.call', { tool: 'TaskList' }, async ($, e, next) => {
    const ran = await next(e)

    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true) {
      const known = new Map((await read($, tasks)).map(task => [task.id, task]))
      await change($, docking, () =>
        ran.result.tasks.map(task => ({
          id: task.id,
          subject: task.subject,
          activeForm: known.get(task.id)?.activeForm,
          status: task.status,
        })),
      )
    }

    return ran
  })

  // Models that ship TodoWrite instead of the Task* tools rewrite the whole list.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)

    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true) {
      await change($, docking, () =>
        ran.result.newTodos.map((todo, index) => ({
          id: `todo-${index}`,
          subject: todo.content,
          activeForm: todo.activeForm,
          status: todo.status,
        })),
      )
    }

    return ran
  })

  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const ran = await next(e)
    const isApproved =
      e.agentId === undefined &&
      ran.deny === undefined &&
      ran.isError !== true &&
      ran.result.awaitingLeaderApproval !== true

    return isApproved ? { ...ran, context: [...(ran.context ?? []), REMINDER] } : ran
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    if (!e.tools.some(isTaskTool) && !hasWarned) {
      hasWarned = true
      $.ui.toast('checklist: no task tool in this session, set CLAUDE_CODE_ENABLE_TODO_TOOLS=1')
    }

    return {
      sections: [
        ...composed.sections,
        { id: 'checklist:tasks', text: GUIDANCE, scope: 'session' },
      ],
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.viewport?.isFullscreen === true) {
      docking.add(e.surface)
    } else if (e.viewport?.isFullscreen === false) {
      docking.delete(e.surface)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)

    if ((await read($, tasks)).length === 0) {
      return <ui.Text dimColor>No task yet.</ui.Text>
    }

    return drawChecklist($, ui)
  })
}
