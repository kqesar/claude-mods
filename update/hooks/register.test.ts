import { expect, mock, test } from 'claude-code/testing'
import type { AgentStatus, CommandRunInput, On } from 'claude-code'

// `/update` typed at the prompt, with `args` after it.
const typed = (args = ''): CommandRunInput => ({
  command: 'update',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
})

// The engine beneath the plugin: a session on `running`, `claude --version`
// answering `installed`, and the given agents. The mod answers `/update`
// itself, so only the commands it runs reach `commands`.
function engine(on: On, running: string, installed: string, agents: AgentStatus[] = []) {
  const written: [string, string][] = []
  const commands: string[] = []
  const statuses: (string | undefined)[] = []

  on('session.version', () => ({ value: { version: running, base: running } }))
  on('session.id', () => ({ value: 'abc-123' }))
  on('process.run', (_, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv[1] === '--version' ? `${installed} (Claude Code)\n` : 'ok\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('agent.list', () => ({
    value: agents.map((status, i) => ({ id: `a${i}`, description: '', type: 'Explore', status })),
  }))
  on('fs.write', (_, e) => (written.push([e.path, e.text]), { value: undefined }))
  on('command.run', (_, e) => (commands.push(e.command), {}))
  on('ui.status', (_, e) => (statuses.push(e.text), { value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.copy', () => ({ value: { isCopied: true } }))

  return { written, commands, statuses }
}

test('/upgrade-claude is registered and answers like /update', async ($, on) => {
  const seen = engine(on, '2.1.310', '2.1.310')
  const registered: string[] = []
  on('command.register', (_, e) => (registered.push(e.name), { value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const { text } = await $.command.run({ ...typed(), command: 'upgrade-claude' })

  expect(registered).toEqual(['upgrade-claude'])
  expect(text).toBe('Claude Code 2.1.310 is up to date.')
  expect(seen.commands).toEqual([])
})

test('an up-to-date session is left alone', async ($, on) => {
  const seen = engine(on, '2.1.310', '2.1.310')

  const { text } = await $.command.run(typed())

  expect(text).toBe('Claude Code 2.1.310 is up to date.')
  expect(seen.commands).toEqual([])
})

test('an idle session records its id for the wrapper and exits', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { CLAUDE_RELAUNCH_FILE: '/tmp/relaunch' })
  const seen = engine(on, '2.1.309', '2.1.310')

  const { text } = await $.command.run(typed())
  expect(text).toContain('restarting on it')
  await clock.advance(1000)

  expect(seen.written).toEqual([['/tmp/relaunch', 'abc-123']])
  expect(seen.commands).toEqual(['exit'])
})

test('a running agent holds the restart until cancelled', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { CLAUDE_RELAUNCH_FILE: '/tmp/relaunch' })
  const seen = engine(on, '2.1.309', '2.1.310', ['running'])

  const { text } = await $.command.run(typed())
  await clock.advance(1000)

  expect(text).toContain('1 agent running')
  expect(seen.statuses.at(-1)).toBe('↻ 2.1.310 waits: 1 agent running')
  expect(seen.commands).toEqual([])

  await $.command.run(typed('cancel'))
  expect(seen.statuses.at(-1)).toBeUndefined()
})

test('setup installs the fish wrapper from the mod folder', async ($, on) => {
  mock.env(on, { HOME: '/home/u', SHELL: '/usr/bin/fish' })
  const seen = engine(on, '2.1.310', '2.1.310')
  on('fs.read', (_, e) => {
    if (!e.path.includes('/wrapper/')) {
      throw new Error('ENOENT')
    }

    return { value: `wrapper from ${e.path}` }
  })

  const { text } = await $.command.run(typed('setup'))

  expect(text).toContain('~/.config/fish/functions/claude.fish')
  expect(seen.written).toEqual([
    ['/home/u/.config/fish/functions/claude.fish', expect.stringContaining('wrapper/claude.fish')],
  ])
})

test('setup sources the bash wrapper once', async ($, on) => {
  // Setup reads the environment and files only: no engine() here.
  mock.env(on, { HOME: '/home/u', SHELL: '/bin/bash' })
  const files = new Map([['/home/u/.bashrc', 'alias ll=ls\n']])
  on('fs.read', (_, e) => {
    if (e.path.includes('/wrapper/')) {
      return { value: 'wrapper' }
    }
    const text = files.get(e.path)
    if (text === undefined) {
      throw new Error('ENOENT')
    }

    return { value: text }
  })
  on('fs.write', (_, e) => (files.set(e.path, e.text), { value: undefined }))

  await $.command.run(typed('setup'))
  await $.command.run(typed('setup'))

  expect(files.get('/home/u/.config/claude-mods/claude.sh')).toBe('wrapper')
  // The source line names the script twice (test, then source), and only once.
  expect(files.get('/home/u/.bashrc')?.match(/claude-mods\/claude\.sh/g)?.length).toBe(2)
})

test('setup leaves an existing fish function alone', async ($, on) => {
  mock.env(on, { HOME: '/home/u', SHELL: '/usr/bin/fish' })
  const seen = engine(on, '2.1.310', '2.1.310')
  on('fs.read', () => ({ value: 'my own claude function' }))

  const { text } = await $.command.run(typed('setup'))

  expect(text).toContain('already exists')
  expect(seen.written).toEqual([])
})
