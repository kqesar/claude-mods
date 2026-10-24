import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'checklist',
  component: 'Pane',
  requestId: 'checklist',
  props: {
    title: 'Plan',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

test('tasks flow from the task tools to the pane and the status line', async ($, on) => {
  let id = 0
  const statuses: (string | undefined)[] = []

  // Nothing sits beneath the plugin: these hooks stand for the engine.
  on('ui.status', (_, e) => (statuses.push(e.text), { value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', { tool: 'TaskCreate' }, (_, e) => ({
    result: { task: { id: String(++id), subject: e.subject } },
  }))
  on('tool.call', { tool: 'TaskUpdate' }, (_, e) => ({
    result: { success: true, taskId: e.taskId, updatedFields: ['status'] },
  }))

  await $.tool.call({ tool: 'TaskCreate', subject: 'Write code', description: '' })
  await $.tool.call({
    tool: 'TaskCreate',
    subject: 'Run tests',
    description: '',
    activeForm: 'Running tests',
  })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' })

  expect(statuses.at(-1)).toBe('1/2 ▸ Running tests')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /done$/ }))?.text).toBe('1/2 done')
    expect((await ui.find({ type: 'Text', text: /Write code/ }))?.text).toBe('☑ Write code')
    expect((await ui.find({ type: 'Text', text: /Running/ }))?.text).toBe('▶ Running tests')
    await ui.unmount()
  }
})

test('a subagent task stays out of the list', async ($, on) => {
  on('tool.call', { tool: 'TaskCreate' }, (_, e) => ({
    result: { task: { id: '9', subject: e.subject } },
  }))

  await $.tool.call({ tool: 'TaskCreate', subject: 'Inner step', description: '', agentId: 'a1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('No task yet.')
  await ui.unmount()
})

test('the system prompt gets the plan-to-tasks guidance', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'x', scope: 'shared' }] }))

  const { sections } = await $.prompt.compose({
    model: 'm',
    promptModel: 'm',
    surfaces: [],
    tools: ['TaskCreate'],
    outputStyle: null,
    traits: [],
  })

  expect(sections.map(section => section.id)).toEqual(['intro', 'checklist:tasks'])
})

test('a task is deleted from the pane after a confirmation', async ($, on) => {
  const deleted: string[] = []
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', { tool: 'TaskCreate' }, (_, e) => ({
    result: { task: { id: e.subject, subject: e.subject } },
  }))
  on('tool.call', { tool: 'TaskUpdate' }, (_, e) => {
    if (e.status === 'deleted') {
      deleted.push(e.taskId)
    }

    return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }
  })

  await $.tool.call({ tool: 'TaskCreate', subject: 'A', description: '' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'B', description: '' })

  await $.tool.call({ tool: 'TaskCreate', subject: 'C', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'C', status: 'completed' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'delete-A' })).toBeDefined()
    expect(await ui.find({ key: 'delete-C' })).toBeUndefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'delete-A' })
  expect(deleted).toEqual([])
  await ui.press({ key: 'yes-A' })

  expect(deleted).toEqual(['A'])
  expect(await ui.find({ type: 'Text', text: /A$/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /done$/ }))?.text).toBe('1/2 done')
  await ui.unmount()
})
