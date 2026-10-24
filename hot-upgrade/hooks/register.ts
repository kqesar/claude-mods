import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// A running process keeps the binary it started with: switching versions means
// a restart. This mod picks the moment (nothing running that a restart would
// kill), records the session id for the shell wrapper and exits; the wrapper
// resumes the same session on the new binary.
const pending = atom({ plugin: 'hot-upgrade', key: 'pending' } as const, null)
const isForced = atom({ plugin: 'hot-upgrade', key: 'isForced' } as const, false)
const background = atom({ plugin: 'hot-upgrade', key: 'background' } as const, {
  tasks: 0,
  crons: 0,
})

const BUSY_AGENT = new Set(['pending', 'running', 'waiting'])
// Leaves the command's own output on screen before the exit.
const GRACE_MS = 800

const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`

// What a restart would kill now; empty means it is safe.
async function blockersOf($: EngineInterface, isTurnRunning: boolean): Promise<string[]> {
  const reasons: string[] = []

  if (isTurnRunning) {
    reasons.push('a turn is running')
  }
  if (await read($, isForced)) {
    return reasons
  }
  const agents = (await $.agent.list()).filter(agent => BUSY_AGENT.has(agent.status))
  const { tasks, crons } = await read($, background)

  if (agents.length > 0) {
    reasons.push(plural(agents.length, 'agent') + ' running')
  }
  if (tasks > 0) {
    reasons.push(plural(tasks, 'background task'))
  }
  if (crons > 0) {
    reasons.push(plural(crons, 'scheduled wakeup') + ' a restart would drop')
  }

  return reasons
}

async function installedVersion($: EngineInterface): Promise<string | undefined> {
  const { exitCode, stdout } = await $.process.run(['claude', '--version'])

  return exitCode === 0 ? stdout.trim().split(/\s+/)[0] : undefined
}

const RC_LINE =
  '[ -f "$HOME/.config/claude-mods/claude.sh" ] && . "$HOME/.config/claude-mods/claude.sh"'

// Installs the shell wrapper the mod restarts through, for the user's shell.
async function setup($: EngineInterface): Promise<string> {
  if ((await $.env.get('CLAUDE_RELAUNCH_FILE')) !== undefined) {
    return 'The wrapper is already active: /hot-upgrade restarts on its own.'
  }
  const home = await $.env.get('HOME')
  const shell = ((await $.env.get('SHELL')) ?? '').split('/').pop() ?? ''

  if (home === undefined) {
    return 'HOME is not set: install the wrapper by hand (see the README).'
  }
  const wrapper = (name: string) => $.fs.read(`${$.plugin.root}/wrapper/${name}`)
  const next = 'Open a new terminal and start `claude` there: /hot-upgrade will then restart on its own.'

  if (shell === 'fish') {
    const target = `${home}/.config/fish/functions/claude.fish`
    const isThere = await $.fs.read(target).then(() => true, () => false)

    if (isThere) {
      return `~/.config/fish/functions/claude.fish already exists; left as is. ${next}`
    }
    await $.fs.write(target, await wrapper('claude.fish'))

    return `Wrapper installed in ~/.config/fish/functions/claude.fish. ${next}`
  }
  if (shell === 'bash' || shell === 'zsh') {
    const rc = `${home}/.${shell}rc`
    const current = await $.fs.read(rc).catch(() => '')
    await $.fs.write(`${home}/.config/claude-mods/claude.sh`, await wrapper('claude.sh'))

    if (!current.includes(RC_LINE)) {
      const block = `\n# Resume the Claude Code session after /hot-upgrade (kqesar/claude-mods)\n${RC_LINE}\n`
      await $.fs.write(rc, current + block)
    }

    return `Wrapper installed in ~/.config/claude-mods/claude.sh, sourced from ~/.${shell}rc. ${next}`
  }

  return `No wrapper for ${shell || 'this shell'} yet: bash, zsh and fish are covered (see the README).`
}

async function relaunch($: EngineInterface) {
  const version = await read($, pending)
  await update($, pending, () => null)
  await update($, isForced, () => false)
  $.ui.status(undefined)
  const id = await $.session.id()
  const file = await $.env.get('CLAUDE_RELAUNCH_FILE')

  if (file === undefined || file === '') {
    const command = `claude --resume ${id}`
    await $.ui.copy({ text: command })
    $.ui.toast(`hot-upgrade: ${version} is installed; restart with \`${command}\` (copied). /hot-upgrade setup makes it automatic`)

    return
  }
  await $.fs.write(file, id)
  $.ui.toast(`hot-upgrade: restarting on ${version}`)
  await $.command.run({ command: 'exit' })
}

// Relaunches when nothing blocks, else says what it waits for.
async function attempt($: EngineInterface, isTurnRunning: boolean): Promise<string[]> {
  const version = await read($, pending)

  if (version === null) {
    return []
  }
  const reasons = await blockersOf($, isTurnRunning)

  if (reasons.length === 0) {
    await relaunch($)
  } else {
    $.ui.status(`↻ ${version} waits: ${reasons.join(', ')}`)
  }

  return reasons
}

export const register: Register = on => {
  let isTurnRunning = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'hot-upgrade',
      description: 'Switch to the latest Claude Code and resume this session when nothing runs',
      argumentHint: '[setup | now | cancel]',
    })

    return next(e)
  })

  // `/update` is a name Claude Code reserves: it cannot be registered, and the
  // typeahead completes it to another command, but typed in full it lands here.
  for (const command of ['hot-upgrade', 'update']) {
    on('command.run', { command }, async ($, e) => {
      const arg = (e.args ?? '').trim()

      if (arg === 'setup') {
        return { text: await setup($) }
      }
      if (arg === 'cancel') {
        await update($, pending, () => null)
        await update($, isForced, () => false)
        $.ui.status(undefined)

        return { text: 'Update switch cancelled; the new version starts with the next session.' }
      }
      const running = (await $.session.version()).version
      const updated = await $.process.run(['claude', 'update'], { timeoutMs: 600_000 })

      if (updated.exitCode !== 0) {
        const detail = (updated.stderr || updated.stdout).trim().split('\n').slice(-3).join('\n')

        return { text: `claude update failed (exit ${updated.exitCode}):\n${detail}` }
      }
      const installed = await installedVersion($)

      if (installed === undefined || installed === running) {
        return { text: `Claude Code ${running} is up to date.` }
      }
      await update($, pending, () => installed)
      await update($, isForced, () => arg === 'now')
      const reasons = await blockersOf($, false)

      if (reasons.length > 0) {
        $.ui.status(`↻ ${installed} waits: ${reasons.join(', ')}`)

        return {
          text:
            `Claude Code ${installed} installed (running ${running}). ` +
            `Restarting once nothing runs: ${reasons.join(', ')}. ` +
            '`/hot-upgrade now` restarts regardless, `/hot-upgrade cancel` keeps this version.',
        }
      }
      $.clock.after(GRACE_MS, () => void attempt($, isTurnRunning))
      const hasWrapper = (await $.env.get('CLAUDE_RELAUNCH_FILE')) !== undefined

      return {
        text: hasWrapper
          ? `Claude Code ${installed} installed (running ${running}): restarting on it.`
          : `Claude Code ${installed} installed (running ${running}). No wrapper to restart ` +
            'through: the resume command goes to your clipboard. `/hot-upgrade setup` fixes that.',
      }
    }).catch(($, e, next) =>
      next.called ? next(e) : { text: `hot-upgrade: the command failed; nothing was changed.` },
    )
  }

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      isTurnRunning = true
    }

    return next(e)
  })

  // The Stop hook is the one place that reports background work and crons.
  on('classic.Stop', async ($, e, next) => {
    await update($, background, () => ({
      tasks: e.background_tasks?.length ?? 0,
      crons: e.session_crons?.length ?? 0,
    }))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined) {
      isTurnRunning = false
      $.clock.after(GRACE_MS, () => void attempt($, isTurnRunning))
    }

    return result
  })
}
