// What the last turn left running, as its Stop hook reported it.
export type Background = { tasks: number; crons: number }

declare module 'claude-code' {
  interface PluginState {
    update: {
      // The installed version waiting for a safe point to be switched to.
      pending: string | null
      isForced: boolean
      background: Background
    }
  }
}
