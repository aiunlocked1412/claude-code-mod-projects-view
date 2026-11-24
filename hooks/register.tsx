import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import type { Chat, Prefs, Project, Snapshot, SortKey, Tab } from '../types'

import { TEXT, ago } from './i18n'
import type { Lang, Text as Words } from './i18n'

const PANE = 'projects-view'
const PLUGIN = 'projects-view'
const COMMAND = 'projects'
const RECENT_LIMIT = 30
const PROJECT_CHAT_LIMIT = 40

const data = atom({ plugin: 'projects-view', key: 'data' } as const, null, {
  shape: 'snapshot-3',
})
const tab = atom({ plugin: 'projects-view', key: 'tab' } as const, 'recent')
const showAll = atom({ plugin: 'projects-view', key: 'showAll' } as const, false)
const isLoading = atom(
  { plugin: 'projects-view', key: 'isLoading' } as const,
  false,
)
const openProject = atom(
  { plugin: 'projects-view', key: 'openProject' } as const,
  null,
)
const projectChats = atom(
  { plugin: 'projects-view', key: 'projectChats' } as const,
  [],
  { shape: 'chats-1' },
)

const DEFAULT_PREFS: Prefs = {
  stars: [],
  pins: [],
  order: [],
  colors: {},
  sort: 'used',
  onlyStars: false,
  collapsed: [],
  lang: 'th',
  hidden: [],
}
const prefs = atom({ plugin: 'projects-view', key: 'prefs' } as const, DEFAULT_PREFS, {
  shape: 'prefs-1',
})
const colorPicking = atom(
  { plugin: 'projects-view', key: 'colorPicking' } as const,
  null,
)
const isPaneUp = atom({ plugin: 'projects-view', key: 'isPaneUp' } as const, false)
const closing = atom({ plugin: 'projects-view', key: 'closing' } as const, null)
const isSettingsOpen = atom(
  { plugin: 'projects-view', key: 'isSettingsOpen' } as const,
  false,
)
// The pane's own words for what the loaders store (they stay language-free).
const UNTITLED = '(ไม่มีชื่อ)'
const ICON_SETTINGS = '⚙️'
// Who made this mod, shown at the foot of the settings page.
const CREDITS = [
  { label: '🌐 aiunlock.co', href: 'https://aiunlock.co' },
  { label: '▶️ YouTube', href: 'https://www.youtube.com/%40AIUnlocked168' },
  { label: '📘 Facebook', href: 'https://www.facebook.com/aiunlockedvip' },
]
// The color that marks where the person is now.
const HERE = '#3b82f6'
const SECTIONS = ['pinned', 'running', 'waiting', 'recent'] as const
const PREFS_STORE_KEY = 'prefs-1'
// A chat idle this long or less counts as waiting for the person's next message.
const WAITING_MS = 24 * 3_600_000
const REFRESH_MS = 20_000
// Start dates never change: asked once per project and module load.
const createdCache = new Map<string, number>()
const PANE_TITLE = 'AI UNLOCKED'

// A desktop Button draws its label alone, so every control is one icon.
const PALETTE: { id: string; icon: string; hex?: string }[] = [
  { id: 'none', icon: '⚪' },
  { id: 'red', icon: '🔴', hex: '#ef4444' },
  { id: 'orange', icon: '🟠', hex: '#f97316' },
  { id: 'yellow', icon: '🟡', hex: '#eab308' },
  { id: 'green', icon: '🟢', hex: '#22c55e' },
  { id: 'blue', icon: '🔵', hex: '#3b82f6' },
  { id: 'purple', icon: '🟣', hex: '#a855f7' },
  { id: 'pink', icon: '🩷', hex: '#ec4899' },
]
const ICON_FAVORITE = '❤️'
const ICON_NOT_FAVORITE = '🤍'
const ICON_PIN = '📌'
const ICON_COLOR = '🎨'

function sortsIn(L: Words): { value: SortKey; label: string }[] {
  return [
    { value: 'used', label: L.sortUsed },
    { value: 'created', label: L.sortCreated },
    { value: 'name', label: L.sortName },
    { value: 'manual', label: L.sortManual },
  ]
}

async function wordsOf($: Engine): Promise<Words> {
  return TEXT[(await read($, prefs)).lang] ?? TEXT.th
}

/** Writes the prefs for drawing and keeps them for the next session too. */
async function savePrefs($: Engine, change: (old: Prefs) => Prefs) {
  await update($, prefs, change)
  await $.store.set(PREFS_STORE_KEY, await read($, prefs))
}

function toggle(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter(one => one !== key) : [...list, key]
}

/** Pinned first, then the chosen sort; manual keeps the saved order. */
function arrange(projects: Project[], p: Prefs): Project[] {
  const rank = new Map(p.order.map((key, index) => [key, index]))
  const sorted = [...projects].sort((a, b) => {
    if (p.sort === 'created') return b.createdMs - a.createdMs
    if (p.sort === 'name') return a.name.localeCompare(b.name, 'th')
    if (p.sort === 'manual') {
      const byRank =
        (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER)
      if (byRank !== 0) return byRank
    }
    return b.lastMs - a.lastMs
  })
  const pinned = sorted.filter(one => p.pins.includes(one.key))
  const rest = sorted.filter(one => !p.pins.includes(one.key))

  return [...pinned, ...rest]
}

/** Moves a project one step within its group (pinned or not) and saves the order. */
async function move($: Engine, shown: Project[], key: string, step: -1 | 1) {
  await savePrefs($, old => {
    const keys = shown.map(one => one.key)
    const at = keys.indexOf(key)
    const to = at + step
    const isPinned = (k: string) => old.pins.includes(k)
    if (at < 0 || to < 0 || to >= keys.length) return old
    if (isPinned(keys[at]) !== isPinned(keys[to])) return old
    ;[keys[at], keys[to]] = [keys[to], keys[at]]
    const others = old.order.filter(one => !keys.includes(one))

    return { ...old, order: [...keys, ...others] }
  })
}

/** Opens the pane and loads, or closes it when it is up. */
async function togglePane($: Engine) {
  const isUp = (await $.ui.panes()).some(pane => pane.id === PANE)
  if (isUp) {
    await $.ui.close({ id: PANE })
    await update($, isPaneUp, () => false)
    return
  }
  await $.ui.open({ id: PANE, title: PANE_TITLE })
  await update($, isPaneUp, () => true)
  await load($)
}

/**
 * Closes a chat the person is done with: stops its turn when it is working,
 * then archives it in the app, where the Archived list can bring it back.
 */
async function closeChat($: Engine, chat: Chat) {
  await update($, closing, () => chat.id)
  try {
    if (chat.isRunning) {
      await $.mcp
        .call('ccd_session_mgmt', 'stop_session', { session_id: chat.id })
        .catch(() => undefined)
      // The stopped turn takes a moment to settle before it can be archived.
      await $.clock.sleep(1500)
    }
    const result = await $.mcp
      .call('ccd_session_mgmt', 'archive_session', {
        session_id: chat.id,
        reason: (await wordsOf($)).archiveReason,
      })
      .catch(error => ({
        isError: true,
        content: [{ type: 'text', text: String(error) }],
      }))
    await load($, true)
    const snapshot = await read($, data)
    const isGone = !snapshot?.chats.some(one => one.id === chat.id)
    const said = result.content.find(block => block.type === 'text')?.text ?? ''
    const L = await wordsOf($)
    $.ui.toast(
      isGone
        ? L.closed(chat.title.slice(0, 40))
        : L.closeFailed(said.slice(0, 120) || L.archiveRefused),
    )
  } finally {
    await update($, closing, () => null)
  }
}

/**
 * Stars, pins and the rest kept by another copy of this mod (a test copy, a
 * copy installed under another name): each copy has a store of its own, so a
 * new copy takes the newest it finds once, and keeps it as its own.
 */
async function adoptEarlierPrefs($: Engine): Promise<Partial<Prefs> | undefined> {
  const config =
    (await $.env.get('CLAUDE_CONFIG_DIR')) ??
    `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '~'}/.claude`
  const folder = `${config}/plugins/store`
  const files = (await $.fs.list(folder).catch(() => []))
    .filter(one => one.kind === 'file' && /^projects-view_.*[.]json$/.test(one.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const file of files) {
    try {
      const stored = JSON.parse(await $.fs.read(`${folder}/${file.name}`))
      const found = stored?.[PREFS_STORE_KEY]
      if (found && typeof found === 'object') {
        await $.store.set(PREFS_STORE_KEY, found)
        return found as Partial<Prefs>
      }
    } catch {
      // not a store we can read: try the next
    }
  }

  return undefined
}

/** The band's open/close toggle, drawn alone or beside the other rows. */
function toggleProps($: Engine, isUp: boolean) {
  // One icon, no chrome: an open folder while the pane is up.
  return {
    key: 'toggle-pane',
    label: isUp ? '📂' : '📁',
    plain: true as const,
    onPress: () => togglePane($),
  }
}

// Folders tools make for themselves: temp dirs, app scratch folders, bots.
const NOISE =
  /\\AppData\\Local\\Temp\\|scratch-workspaces|[\\/]\.openmausbot[\\/]|omb-claude-background|AppData-Local-Temp/i
// In the app's own list a scratch folder is a real chat started with no folder.
const TEMP = /\\AppData\\Local\\Temp\\|[\\/]\.openmausbot[\\/]|omb-claude-background/i
const NO_FOLDER = /scratch-workspaces/i
const NO_FOLDER_KEY = 'no-folder'
const NO_FOLDER_NAME = 'แชทไม่มีโฟลเดอร์'


async function projectsRoot($: Engine): Promise<string> {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  if (config) return `${config}/projects`
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))

  return `${home ?? '~'}/.claude/projects`
}

function lastSegments(cwd: string): { name: string; parent: string } {
  const parts = cwd.split(/[\\/]/).filter(Boolean)

  return {
    name: parts[parts.length - 1] ?? cwd,
    parent: parts.slice(0, -1).join('\\'),
  }
}

async function readCwd($: Engine, file: string): Promise<string | undefined> {
  const head = await $.fs.read(file, { length: 24_000 }).catch(() => '')
  const found = /"cwd":("(?:[^"\\]|\\.)*")/.exec(head)
  if (!found) return undefined
  try {
    return JSON.parse(found[1]) as string
  } catch {
    return undefined
  }
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 140)
}

async function readTitle($: Engine, file: string, size: number) {
  const offset = Math.max(0, size - 200_000)
  const tail = await $.fs.read(file, { offset, length: size - offset }).catch(
    () => '',
  )
  let custom: string | undefined
  let ai: string | undefined
  let prompt: string | undefined
  for (const line of tail.split('\n')) {
    if (!line.startsWith('{"type":"')) continue
    try {
      if (line.startsWith('{"type":"custom-title"'))
        custom = JSON.parse(line).customTitle
      else if (line.startsWith('{"type":"ai-title"')) ai = JSON.parse(line).aiTitle
      else if (line.startsWith('{"type":"last-prompt"'))
        prompt = JSON.parse(line).lastPrompt
    } catch {
      // a line cut by the range: skip it
    }
  }
  const title = custom ?? ai ?? prompt
  if (title) return clean(title)

  const head = await $.fs.read(file, { length: 60_000 }).catch(() => '')
  for (const line of head.split('\n')) {
    if (!line.includes('"type":"user"')) continue
    try {
      const content = JSON.parse(line).message?.content
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content.find((part: { type?: string }) => part.type === 'text')
                ?.text
            : undefined
      if (typeof text === 'string' && !text.startsWith('<')) return clean(text)
    } catch {
      // keep looking
    }
  }

  return UNTITLED
}

type FileRow = { dir: string; path: string; id: string; size: number; mtimeMs: number }

async function listChatFiles($: Engine, root: string, dir: string) {
  const entries = await $.fs.list(`${root}/${dir}`).catch(() => [])

  return entries
    .filter(one => one.kind === 'file' && one.name.endsWith('.jsonl'))
    .map(
      (one): FileRow => ({
        dir,
        path: `${root}/${dir}/${one.name}`,
        id: one.name.slice(0, -'.jsonl'.length),
        size: one.size,
        mtimeMs: one.mtimeMs,
      }),
    )
}

async function toChats($: Engine, rows: FileRow[], cwdOf: Map<string, string>) {
  return Promise.all(
    rows.map(async (row): Promise<Chat> => {
      const cwd = cwdOf.get(row.dir) ?? row.dir

      return {
        id: row.id,
        dir: row.dir,
        cwd,
        title: await readTitle($, row.path, row.size),
        mtimeMs: row.mtimeMs,
        isNoise: NOISE.test(cwd) || NOISE.test(row.dir),
      }
    }),
  )
}

type AppSession = {
  sessionId: string
  title?: string
  cwd?: string
  lastActivityAt?: string
  link?: string
  isRunning?: boolean
}

/** The desktop app's own session list, or undefined outside the app. */
async function loadFromApp($: Engine): Promise<Snapshot | undefined> {
  const result = await $.mcp
    .call('ccd_session_mgmt', 'list_sessions', { limit: 500 })
    .catch(() => undefined)
  if (!result || result.isError) return undefined
  const text = result.content.find(block => block.type === 'text')?.text
  let rows: AppSession[]
  try {
    rows = JSON.parse(text ?? '')
  } catch {
    return undefined
  }
  if (!Array.isArray(rows)) return undefined

  // The app's list leaves out the chat asking (this one): add it on its own.
  const own = await $.mcp
    .call('ccd_session_mgmt', 'get_session', { session_id: 'self' })
    .catch(() => undefined)
  let selfId: string | undefined
  try {
    const self = JSON.parse(
      own?.content.find(block => block.type === 'text')?.text ?? '',
    ) as AppSession & { isArchived?: boolean }
    if (self?.sessionId && !self.isArchived) {
      selfId = self.sessionId
      if (!rows.some(row => row.sessionId === selfId)) rows.unshift(self)
    }
  } catch {
    // no own session to add
  }

  const chats = rows.map((row): Chat => {
    const cwd = row.cwd ?? ''
    const isNoFolder = NO_FOLDER.test(cwd)

    return {
      id: row.sessionId,
      dir: isNoFolder ? NO_FOLDER_KEY : cwd.toLowerCase(),
      cwd,
      title: clean(row.title || UNTITLED),
      mtimeMs: Date.parse(row.lastActivityAt ?? '') || 0,
      isNoise: TEMP.test(cwd),
      link: row.link,
      isRunning: row.isRunning === true,
      isSelf: row.sessionId === selfId,
    }
  })
  chats.sort((a, b) => b.mtimeMs - a.mtimeMs)

  const byDir = new Map<string, Project>()
  for (const chat of chats) {
    const known = byDir.get(chat.dir)
    if (known) {
      known.chats += 1
      continue
    }
    const isNoFolder = chat.dir === NO_FOLDER_KEY
    byDir.set(chat.dir, {
      dir: chat.dir,
      key: chat.dir,
      createdMs: chat.mtimeMs,
      cwd: isNoFolder ? 'แชทที่เริ่มโดยไม่ได้เลือกโฟลเดอร์' : chat.cwd,
      ...(isNoFolder
        ? { name: NO_FOLDER_NAME, parent: '' }
        : lastSegments(chat.cwd)),
      chats: 1,
      lastMs: chat.mtimeMs,
      isNoise: chat.isNoise,
    })
  }

  // The list has no start dates: ask the app for each project's oldest chat.
  const projects = [...byDir.values()]
  await Promise.all(
    projects.map(async project => {
      const own = chats.filter(chat => chat.dir === project.dir)
      const oldest = own[own.length - 1]
      if (!oldest) return
      project.createdMs = oldest.mtimeMs
      const cached = createdCache.get(oldest.id)
      if (cached) {
        project.createdMs = cached
        return
      }
      const result = await $.mcp
        .call('ccd_session_mgmt', 'get_session', { session_id: oldest.id })
        .catch(() => undefined)
      const text = result?.content.find(block => block.type === 'text')?.text
      try {
        const created = Date.parse(JSON.parse(text ?? '').createdAt)
        if (created) {
          project.createdMs = created
          createdCache.set(oldest.id, created)
        }
      } catch {
        // keep the oldest chat's last activity
      }
    }),
  )

  return {
    loadedAt: Date.now(),
    source: 'app',
    root: '',
    projects,
    chats,
  }
}

/** Transcripts under ~/.claude/projects, for the terminal and other hosts. */
async function loadFromFiles($: Engine): Promise<Snapshot> {
  const root = await projectsRoot($)
  const dirs = (await $.fs.list(root).catch(() => [])).filter(
    one => one.kind === 'dir',
  )
  const files: FileRow[] = []
  const projects: Project[] = []
  const cwdOf = new Map<string, string>()
  await Promise.all(
    dirs.map(async one => {
      const chats = await listChatFiles($, root, one.name)
      if (chats.length === 0) return
      chats.sort((a, b) => b.mtimeMs - a.mtimeMs)
      files.push(...chats)
      const cwd = (await readCwd($, chats[0].path)) ?? one.name
      cwdOf.set(one.name, cwd)
      projects.push({
        dir: one.name,
        key: NO_FOLDER.test(cwd) ? NO_FOLDER_KEY : cwd.toLowerCase(),
        createdMs: chats[chats.length - 1].mtimeMs,
        cwd,
        ...lastSegments(cwd),
        chats: chats.length,
        lastMs: chats[0].mtimeMs,
        isNoise: NOISE.test(cwd) || NOISE.test(one.name),
      })
    }),
  )
  projects.sort((a, b) => b.lastMs - a.lastMs)
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  // Titles for the newest chats, kept and hidden folders alike, so the
  // "show all" toggle needs no second load.
  const isNoiseRow = (row: FileRow) =>
    NOISE.test(cwdOf.get(row.dir) ?? '') || NOISE.test(row.dir)
  const picked = new Set([
    ...files.filter(row => !isNoiseRow(row)).slice(0, RECENT_LIMIT),
    ...files.slice(0, RECENT_LIMIT),
  ])
  const chats = await toChats($, [...picked], cwdOf)
  chats.sort((a, b) => b.mtimeMs - a.mtimeMs)

  return { loadedAt: Date.now(), source: 'files', root, projects, chats }
}

async function load($: Engine, isQuiet = false) {
  if (!isQuiet) await update($, isLoading, () => true)
  try {
    const snapshot = (await loadFromApp($)) ?? (await loadFromFiles($))
    await update($, data, () => snapshot)
    // An open project's list follows the new snapshot.
    const openDir = await read($, openProject)
    if (openDir && snapshot.source === 'app')
      await update($, projectChats, () =>
        snapshot.chats.filter(chat => chat.dir === openDir),
      )
  } finally {
    if (!isQuiet) await update($, isLoading, () => false)
  }
}

async function openProjectChats($: Engine, project: Project) {
  const snapshot = await read($, data)
  if (!snapshot) return
  await update($, projectChats, () => [])
  await update($, openProject, () => project.dir)
  if (snapshot.source === 'app') {
    const chats = snapshot.chats.filter(chat => chat.dir === project.dir)
    await update($, projectChats, () => chats)
    return
  }
  const rows = (await listChatFiles($, snapshot.root, project.dir))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, PROJECT_CHAT_LIMIT)
  const chats = await toChats($, rows, new Map([[project.dir, project.cwd]]))
  await update($, projectChats, () => chats)
}


function resumeCommand(chat: Chat): string {
  return `cd "${chat.cwd}"; claude --resume ${chat.id}`
}

/** Opens the chat in the desktop app through its claude:// link. */
async function openLink($: Engine, link: string): Promise<boolean> {
  // explorer.exe exits 1 even when it hands the link on, so only a throw fails.
  const run = (argv: string[]) =>
    $.process.run(argv).then(
      () => true,
      () => false,
    )
  if ((await $.env.get('OS')) === 'Windows_NT')
    return run(['explorer.exe', link])

  return (await run(['open', link])) || run(['xdg-open', link])
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const kept = ((await $.store.get(PREFS_STORE_KEY)) ??
      (await adoptEarlierPrefs($))) as Partial<Prefs> | undefined
    if (kept && typeof kept === 'object')
      await update($, prefs, () => ({ ...DEFAULT_PREFS, ...kept }))
    await $.command.register({
      name: COMMAND,
      description: (await wordsOf($)).commandDescription,
    })
    // Keeps the running and waiting sections current while the pane is up.
    $.clock.every(REFRESH_MS, async () => {
      if (await read($, isPaneUp)) await load($, true)
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const wasUp = (await $.ui.panes()).some(pane => pane.id === PANE)
    await togglePane($)

    const L = await wordsOf($)

    return { text: wasUp ? L.paneClosed : L.paneOpened }
  })

  // The person's own close mark: the band's toggle follows it.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE) await update($, isPaneUp, () => false)

    return closed
  })

  // Its own row: shown alone when no other mod draws a row in the band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" justifyContent="flex-end">
        <Button {...toggleProps($, await read($, isPaneUp))} />
      </Box>
    )
  })

  // With other rows in the band, the toggle sits at the right end of them
  // instead of on a line of its own.
  on('ui.render', { component: 'AbovePromptList' }, async ($, e, next) => {
    const others = e.props.rows.filter(row => row.plugin !== PLUGIN)
    if (e.props.hasSurvey || others.length === e.props.rows.length || others.length === 0)
      return next(e)
    const { Box, Button } = $.ui.resolve(e)
    const rest = await next({ ...e, props: { ...e.props, rows: others } })

    return (
      <Box flexDirection="row" alignItems="flex-start" gap="sm">
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {rest}
        </Box>
        <Button {...toggleProps($, await read($, isPaneUp))} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Select, Link } = $.ui.resolve(e)
    const snapshot = await read($, data)
    const current: Tab = await read($, tab)
    const isAll = await read($, showAll)
    const busy = await read($, isLoading)
    const openDir = await read($, openProject)
    const p = await read($, prefs)
    const picking = await read($, colorPicking)
    const closingId = await read($, closing)
    const canTint = e.surface !== 'terminal'
    const now = Date.now()
    const isWidget = e.props.placement === 'widget'
    const L = TEXT[p.lang] ?? TEXT.th
    const isSettings = await read($, isSettingsOpen)
    const since = (ms: number) => ago(ms, now, L)
    const titleOf = (chat: Chat) => (chat.title === UNTITLED ? L.untitled : chat.title)
    const isShown = (id: string) => !p.hidden.includes(id)
    // Where the person is now: the chat this pane runs in.
    const hereFrame = {
      borderStyle: 'bold',
      borderColor: HERE,
      ...(canTint ? { backgroundColor: `${HERE}26` } : {}),
    }
    const hereDir = snapshot?.chats.find(chat => chat.isSelf)?.dir

    const pressChat = async (chat: Chat, surface: typeof e.surface) => {
      if (chat.link && (await openLink($, chat.link))) {
        $.ui.toast(L.opening(titleOf(chat).slice(0, 40)))
        return
      }
      const copied = await $.ui.copy({ text: resumeCommand(chat), surface })
      $.ui.toast(
        copied.isCopied
          ? L.copied(titleOf(chat).slice(0, 40))
          : L.copyFailed(resumeCommand(chat)),
      )
    }

    const closeControls = (chat: Chat) =>
      closingId === chat.id ? (
        <Text dimColor>⏳</Text>
      ) : (
        <Button
          key={`close:${chat.id}`}
          label="✖️"
          plain
          dimColor
          onPress={() => closeChat($, chat)}
        />
      )

    const chatRow = (chat: Chat, withProject: boolean, canClose = false) => (
      <Box
        key={`chat:${chat.id}`}
        flexDirection="row"
        alignItems="center"
        gap="xs"
        paddingX={1}
        paddingY="xs"
        {...(chat.isSelf ? hereFrame : {})}
      >
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Button
            key={`press:${chat.id}`}
            label={titleOf(chat)}
            plain
            onPress={press => pressChat(chat, press.surface)}
          >
            <Text weight="medium" wrap="truncate-end">
              {chat.isRunning ? '⚡ ' : ''}
              {titleOf(chat)}
              {chat.isSelf ? (
                <Text color={HERE} size="caption" weight="semibold">
                  {' '}
                  {L.thisChat}
                </Text>
              ) : (
                ''
              )}
            </Text>
          </Button>
          <Text dimColor size="caption" wrap="truncate-end">
            {withProject
              ? `${p.stars.includes(chat.dir) ? `${ICON_FAVORITE} ` : ''}${
                  chat.dir === NO_FOLDER_KEY ? L.noFolder : lastSegments(chat.cwd).name
                } · `
              : ''}
            {since(chat.mtimeMs)}
          </Text>
        </Box>
        {canClose && chat.link && !chat.isSelf && closeControls(chat)}
      </Box>
    )

    const isFolded = (id: string) => p.collapsed.includes(id)
    const foldButton = (id: string) => (
      <Button
        key={`fold:${id}`}
        label={isFolded(id) ? '▸' : '▾'}
        plain
        dimColor
        onPress={() =>
          savePrefs($, old => ({ ...old, collapsed: toggle(old.collapsed, id) }))
        }
      />
    )

    const tabButton = (id: Tab, label: string) => (
      <Button
        key={`tab:${id}`}
        label={label}
        variant={current === id && !openDir && !isSettings ? 'primary' : 'secondary'}
        onPress={async () => {
          await update($, isSettingsOpen, () => false)
          await update($, openProject, () => null)
          await update($, tab, () => id)
        }}
      />
    )

    const header = (
      <Box flexDirection="row" gap="sm" flexWrap="wrap" alignItems="center">
        {tabButton('recent', L.tabRecent)}
        {tabButton('projects', L.tabProjects)}
        <Box flexGrow={1} />
        <Button
          key="refresh"
          label={busy ? '⏳' : '🔄'}
          plain
          dimColor
          onPress={() => load($)}
        />
        <Button
          key="toggle-all"
          label={isAll ? '🙈' : '👁️'}
          plain
          dimColor={!isAll}
          onPress={() => update($, showAll, value => !value)}
        />
        <Button
          key="settings"
          label={ICON_SETTINGS}
          plain
          dimColor={!isSettings}
          onPress={() => update($, isSettingsOpen, value => !value)}
        />
      </Box>
    )

    if (!snapshot) {
      return (
        <Box flexDirection="column" gap="sm">
          {header}
          <Text dimColor>{busy ? L.readingChats : L.typeToLoad}</Text>
        </Box>
      )
    }

    const projects = snapshot.projects.filter(one => isAll || !one.isNoise)
    const recentAll = snapshot.chats.filter(one => isAll || !one.isNoise)
    const recent = recentAll.slice(0, RECENT_LIMIT)

    if (isWidget) {
      return (
        <Box flexDirection="column">
          <Text weight="semibold">{L.tabRecent}</Text>
          {recent.slice(0, 5).map(chat => (
            <Text key={chat.id} wrap="truncate-end">
              {titleOf(chat)} <Text dimColor>{since(chat.mtimeMs)}</Text>
            </Text>
          ))}
        </Box>
      )
    }

    const isManual = p.sort === 'manual'
    const nameOf = (project: Project) =>
      project.dir === NO_FOLDER_KEY ? L.noFolder : project.name
    const runningIn = (dir: string) =>
      snapshot.chats.filter(chat => chat.dir === dir && chat.isRunning).length
    const arranged = arrange(projects, p)
    const pinnedList = arranged.filter(one => p.pins.includes(one.key))
    const restList = arranged.filter(
      one => !p.pins.includes(one.key) && (!p.onlyStars || p.stars.includes(one.key)),
    )
    const shown = [...pinnedList, ...restList]
    const projectRow = (project: Project, index: number) => {
      const key = project.key
      const isStarred = p.stars.includes(key)
      const isPinned = p.pins.includes(key)
      const color = p.colors[key]
      const colorIcon = PALETTE.find(one => one.hex === color)?.icon ?? ICON_COLOR
      const canMove = (step: number) => {
        const other = shown[index + step]
        return other !== undefined && p.pins.includes(other.key) === isPinned
      }
      const frame = color
        ? {
            borderStyle: 'round',
            borderColor: color,
            ...(canTint ? { backgroundColor: `${color}1f` } : {}),
          }
        : {}

      return (
        <Box key={`wrap:${key}`} flexDirection="column">
          <Box
            key={`project:${key}`}
            flexDirection="row"
            alignItems="center"
            gap="xs"
            paddingX={1}
            paddingY="xs"
            {...frame}
          >
            <Button
              key={`star:${key}`}
              label={isStarred ? ICON_FAVORITE : ICON_NOT_FAVORITE}
              plain
              dimColor={!isStarred}
              onPress={() =>
                savePrefs($, old => ({ ...old, stars: toggle(old.stars, key) }))
              }
            />
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Button
                key={`open:${project.dir}`}
                label={nameOf(project)}
                plain
                onPress={press => {
                  // A project with one chat opens that chat straight away.
                  const only =
                    snapshot.source === 'app' && project.chats === 1
                      ? snapshot.chats.find(chat => chat.dir === project.dir)
                      : undefined
                  return only
                    ? pressChat(only, press.surface)
                    : openProjectChats($, project)
                }}
              >
                <Text weight="semibold" wrap="truncate-end">
                  {nameOf(project)}
                </Text>
              </Button>
              <Text dimColor size="caption" wrap="truncate-end">
                {project.dir === hereDir ? `${L.youAreHere} · ` : ''}
                {runningIn(project.dir) > 0 ? L.runningIn(runningIn(project.dir)) : ''}
                {L.chatCount(project.chats)} · {L.usedAgo(since(project.lastMs))}
                {p.sort === 'created' ? ` · ${L.createdAgo(since(project.createdMs))}` : ''}
              </Text>
            </Box>
            <Button
              key={`pin:${key}`}
              label={ICON_PIN}
              plain
              dimColor={!isPinned}
              onPress={() =>
                savePrefs($, old => ({ ...old, pins: toggle(old.pins, key) }))
              }
            />
            <Button
              key={`color:${key}`}
              label={colorIcon}
              plain
              dimColor={!color}
              onPress={() =>
                update($, colorPicking, old => (old === key ? null : key))
              }
            />
            {isManual && (
              <Button
                key={`up:${key}`}
                label="▲"
                plain
                dimColor={!canMove(-1)}
                onPress={() => move($, shown, key, -1)}
              />
            )}
            {isManual && (
              <Button
                key={`down:${key}`}
                label="▼"
                plain
                dimColor={!canMove(1)}
                onPress={() => move($, shown, key, 1)}
              />
            )}
          </Box>
          {picking === key && (
            <Box flexDirection="row" flexWrap="wrap" gap="xs" paddingX={2}>
              {PALETTE.map(choice => (
                <Button
                  key={`pick:${key}:${choice.id}`}
                  label={choice.icon}
                  plain
                  onPress={async () => {
                    await savePrefs($, old => {
                      const colors = { ...old.colors }
                      if (choice.hex) colors[key] = choice.hex
                      else delete colors[key]
                      return { ...old, colors }
                    })
                    await update($, colorPicking, () => null)
                  }}
                />
              ))}
            </Box>
          )}
        </Box>
      )
    }

    // Pinned projects stay at the top whichever tab is open.
    const pinnedBlock = isShown('pinned') && pinnedList.length > 0 && (
      <Box flexDirection="column" gap="xs">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text weight="semibold" size="caption">
            {ICON_PIN} {L.pinned} ({pinnedList.length})
          </Text>
          {foldButton('pinned')}
        </Box>
        {!isFolded('pinned') && pinnedList.map((one, index) => projectRow(one, index))}
      </Box>
    )

    const sectionName: Record<(typeof SECTIONS)[number], string> = {
      pinned: L.sectionPinned,
      running: L.running,
      waiting: L.waiting,
      recent: L.recent,
    }
    const langButton = (lang: Lang, label: string) => (
      <Button
        key={`lang:${lang}`}
        label={label}
        variant={p.lang === lang ? 'primary' : 'secondary'}
        onPress={() => savePrefs($, old => ({ ...old, lang }))}
      />
    )
    const settingsPage = (
      <Box flexDirection="column" gap="md">
        <Text size="heading" weight="bold">
          {ICON_SETTINGS} {L.settings}
        </Text>
        <Box flexDirection="column" gap="xs">
          <Text weight="semibold">{L.language}</Text>
          <Box flexDirection="row" gap="sm">
            {langButton('th', 'ไทย')}
            {langButton('en', 'English')}
          </Box>
        </Box>
        <Box flexDirection="column" gap="xs">
          <Text weight="semibold">{L.sections}</Text>
          <Text dimColor size="caption">
            {L.sectionsHint}
          </Text>
          {SECTIONS.map(id => (
            <Button
              key={`show:${id}`}
              label={`${isShown(id) ? '✅' : '⬜'} ${sectionName[id]}`}
              plain
              dimColor={!isShown(id)}
              onPress={() =>
                savePrefs($, old => ({ ...old, hidden: toggle(old.hidden, id) }))
              }
            />
          ))}
        </Box>
        <Button
          key="settings-done"
          label={L.done}
          plain
          dimColor
          onPress={() => update($, isSettingsOpen, () => false)}
        />
        <Box flexDirection="column" gap="xs">
          <Text dimColor size="caption">
            {L.madeBy}
          </Text>
          <Box flexDirection="row" gap="md" flexWrap="wrap">
            {CREDITS.map(credit => (
              <Link key={credit.href} href={credit.href} label={credit.label} />
            ))}
          </Box>
        </Box>
      </Box>
    )

    let body
    if (isSettings) {
      body = settingsPage
    } else if (openDir) {
      const project = snapshot.projects.find(one => one.dir === openDir)
      const chats = await read($, projectChats)
      body = (
        <Box flexDirection="column" gap="xs">
          <Button
            key="back"
            label={L.back}
            plain
            dimColor
            onPress={() => update($, openProject, () => null)}
          />
          <Box flexDirection="column" paddingX={1}>
            <Text size="heading" weight="bold" wrap="truncate-end">
              {project ? nameOf(project) : openDir}
            </Text>
            <Text dimColor size="caption" wrap="truncate-middle">
              {project?.dir === NO_FOLDER_KEY ? L.noFolderPath : (project?.cwd ?? '')}
            </Text>
          </Box>
          {chats.length === 0 && (
            <Text dimColor>{L.loadingProjectChats}</Text>
          )}
          {chats.map(chat => chatRow(chat, false))}
        </Box>
      )
    } else if (current === 'projects') {
      body = (
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" gap="sm" flexWrap="wrap" alignItems="center">
            <Select
              key="sort"
              label={L.sortBy}
              value={p.sort}
              options={sortsIn(L)}
              onSelect={value =>
                savePrefs($, old => ({ ...old, sort: value as SortKey }))
              }
            />
            <Button
              key="only-stars"
              label={p.onlyStars ? `${ICON_FAVORITE} ${L.onlyFavorites}` : `${ICON_NOT_FAVORITE} ${L.all}`}
              variant={p.onlyStars ? 'primary' : 'secondary'}
              onPress={() =>
                savePrefs($, old => ({ ...old, onlyStars: !old.onlyStars }))
              }
            />
          </Box>
          <Text dimColor size="caption">
            {L.legend(shown.length)}
            {isManual ? L.legendManual : ''}
          </Text>
          {restList.length === 0 && p.onlyStars && (
            <Text dimColor>{L.noFavorites}</Text>
          )}
          {isShown('pinned') && pinnedList.length > 0 && restList.length > 0 && (
            <Text weight="semibold" size="caption">
              {L.all}
            </Text>
          )}
          {restList.map((one, index) => projectRow(one, index + pinnedList.length))}
        </Box>
      )
    } else {
      const running = recentAll.filter(chat => chat.isRunning)
      const waiting =
        snapshot.source === 'app'
          ? recentAll
              .filter(chat => !chat.isRunning && now - chat.mtimeMs < WAITING_MS)
              .slice(0, 10)
          : []
      const listed = new Set([...running, ...waiting].map(chat => chat.id))
      const rest = recent.filter(chat => !listed.has(chat.id))
      // Each section is its own card: a colored frame, a heading in that
      // color with a count, and its chats inside.
      const section = (
        id: string,
        title: string,
        hint: string,
        hex: string,
        chats: Chat[],
        empty: string,
        canClose = false,
      ) => (
        <Box
          key={`section:${id}`}
          flexDirection="column"
          gap="xs"
          borderStyle="round"
          borderColor={hex}
          paddingX={1}
          paddingY="xs"
          {...(canTint ? { backgroundColor: `${hex}14` } : {})}
        >
          <Box flexDirection="row" gap="xs" alignItems="center">
            <Box flexGrow={1} flexShrink={1}>
              <Text weight="bold" color={hex}>
                {title} ({chats.length})
              </Text>
            </Box>
            <Text dimColor size="caption" wrap="truncate-end">
              {hint}
            </Text>
            {foldButton(id)}
          </Box>
          {!isFolded(id) && chats.length === 0 && (
            <Text dimColor size="caption">
              {empty}
            </Text>
          )}
          {!isFolded(id) && chats.map(chat => chatRow(chat, true, canClose))}
        </Box>
      )

      body = (
        <Box flexDirection="column" gap="md">
          {snapshot.source === 'app' &&
            isShown('running') &&
            section('running', L.running, L.runningHint, '#22c55e', running, L.runningEmpty, true)}
          {snapshot.source === 'app' &&
            isShown('waiting') &&
            section('waiting', L.waiting, L.waitingHint, '#f59e0b', waiting, L.waitingEmpty, true)}
          {isShown('recent') &&
            section(
              'recent',
              L.recent,
              snapshot.source === 'app' ? L.recentHintApp : L.recentHintFiles,
              '#64748b',
              rest,
              L.recentEmpty,
              true,
            )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap="sm">
        {header}
        {!isSettings && pinnedBlock}
        {body}
      </Box>
    )
  })
}
