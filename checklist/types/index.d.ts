export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type Task = {
  id: string
  subject: string
  activeForm?: string
  status: TaskStatus
}

/** One file the working tree changes against HEAD, as git reports it. */
export type Change = {
  path: string
  /** `M` modified, `A` added, `D` deleted, `R` renamed, `?` untracked. */
  kind: 'M' | 'A' | 'D' | 'R' | '?'
  /** Lines added and removed; absent for a binary or untracked file. */
  added?: number
  removed?: number
}

declare module 'claude-code' {
  interface PluginState {
    checklist: {
      tasks: Shaped<Task[]>
      armed: string | null
      /** Null outside a git repository: the pane then shows the plan alone. */
      changes: Shaped<Change[] | null>
    }
  }
}
