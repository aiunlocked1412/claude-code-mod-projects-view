export type Chat = {
  id: string
  /** Folder name under ~/.claude/projects */
  dir: string
  cwd: string
  title: string
  mtimeMs: number
  isNoise: boolean
  /** The desktop app's claude:// link that opens this chat, when known */
  link?: string
  /** Claude is working in it right now (desktop app only) */
  isRunning?: boolean
  /** The chat this pane runs in */
  isSelf?: boolean
}

export type Project = {
  /** Where its chats are found: the app's key or the folder under ~/.claude/projects */
  dir: string
  /** What stars, pins, colors and the manual order are kept under */
  key: string
  cwd: string
  name: string
  parent: string
  chats: number
  lastMs: number
  /** When its first chat started, as near as the source says */
  createdMs: number
  isNoise: boolean
}

export type Snapshot = {
  loadedAt: number
  /** app: the desktop app's own session list; files: transcripts on disk */
  source: 'app' | 'files'
  root: string
  projects: Project[]
  /** app: every chat; files: the newest ones only */
  chats: Chat[]
}

export type Tab = 'recent' | 'projects'

export type SortKey = 'used' | 'created' | 'name' | 'manual'

/** Kept in $.store between sessions too */
export type Prefs = {
  stars: string[]
  pins: string[]
  order: string[]
  colors: Record<string, string>
  sort: SortKey
  onlyStars: boolean
  /** Sections folded shut: pinned, running, waiting, recent */
  collapsed: string[]
  /** The pane's language */
  lang: 'th' | 'en'
  /** Sections turned off in settings: pinned, running, waiting, recent */
  hidden: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'projects-view': {
      data: Shaped<Snapshot | null>
      tab: Tab
      showAll: boolean
      isLoading: boolean
      openProject: string | null
      projectChats: Shaped<Chat[]>
      prefs: Shaped<Prefs>
      colorPicking: string | null
      isPaneUp: boolean
      /** The chat being stopped and archived now */
      closing: string | null
      isSettingsOpen: boolean
    }
  }
}
