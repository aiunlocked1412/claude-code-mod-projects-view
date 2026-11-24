import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'projects-view',
  component: 'Pane',
  requestId: 'projects-view',
  props: {
    title: 'Projects',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const ROOT = 'C:/Users/me/.claude/projects'
const now = Date.now()
// The engine hands hooks Windows paths with backslashes.
const norm = (path: string) => path.split(String.fromCharCode(92)).join("/")

type On = Parameters<Parameters<typeof test>[1]>[1]

/** Stands for the engine's own pane, store and timer calls. */
function base(on: On) {
  const open = new Set<string>()
  const store = new Map<string, unknown>()
  on('command.register', () => ({ value: { command: 'projects' } }))
  on('ui.open', (_, e) => {
    open.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('clock.every', () => ({ value: undefined }))

  return { open, store }
}

const DIRS: Record<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }[]> = {
  [ROOT]: [
    { name: 'C--dev-shop', kind: 'dir', size: 0, mtimeMs: now, isLink: false },
    { name: 'C--Users-me-AppData-Local-Temp-x', kind: 'dir', size: 0, mtimeMs: now, isLink: false },
  ],
  [`${ROOT}/C--dev-shop`]: [
    { name: 'aaa.jsonl', kind: 'file', size: 300, mtimeMs: now - 120_000, isLink: false },
    { name: 'bbb.jsonl', kind: 'file', size: 300, mtimeMs: now - 3 * 3_600_000, isLink: false },
  ],
  [`${ROOT}/C--Users-me-AppData-Local-Temp-x`]: [
    { name: 'ccc.jsonl', kind: 'file', size: 300, mtimeMs: now, isLink: false },
  ],
}

const FILES: Record<string, string> = {
  [`${ROOT}/C--dev-shop/aaa.jsonl`]:
    '{"type":"user","cwd":"C:\\\\dev\\\\shop","message":{"content":"hi"}}\n{"type":"custom-title","customTitle":"Fix checkout"}\n',
  [`${ROOT}/C--dev-shop/bbb.jsonl`]:
    '{"type":"user","cwd":"C:\\\\dev\\\\shop","message":{"content":"Add dark mode please"}}\n',
  [`${ROOT}/C--Users-me-AppData-Local-Temp-x/ccc.jsonl`]:
    '{"type":"user","cwd":"C:\\\\Users\\\\me\\\\AppData\\\\Local\\\\Temp\\\\x","message":{"content":"temp job"}}\n',
}

test('lists recent chats and projects, hiding temp folders', async ($, on) => {
  base(on)
  on('env.get', (_, e) => ({
    value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined,
  }))
  on('mcp.call', () => ({ value: { content: [], isError: true } }))
  on('fs.list', (_, e) => ({ value: DIRS[norm(e.path ?? '')] ?? [] }))
  on('fs.read', (_, e) => {
    const text = FILES[norm(e.path)] ?? ''
    const start = e.offset ?? 0
    return { value: text.slice(start, start + (e.length ?? text.length)) }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'projects' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Fix checkout/ }))?.text).toBe(
    'Fix checkout',
  )
  expect(await ui.find({ type: 'Text', text: /Add dark mode/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /temp job/ })).toBeFalsy()

  await ui.press({ key: 'tab:projects' })
  expect(await ui.find({ type: 'Text', text: /^shop$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /2 แชท/ })).toBeTruthy()
  await ui.press({ key: 'open:C--dev-shop' })
  expect(await ui.find({ type: 'Text', text: /Fix checkout/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Add dark mode/ })).toBeTruthy()
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Text', text: /2 แชท/ })).toBeTruthy()
  await ui.unmount()

  for (const surface of ['terminal', 'vscode', 'mobile'] as const) {
    const other = await $.ui.mount({ ...PANE, surface })
    expect(await other.find({ type: 'Text', text: /shop/ })).toBeTruthy()
    await other.unmount()
  }
})

const SESSIONS = [
  {
    sessionId: 'local_1',
    title: 'Fix checkout',
    cwd: 'C:\\dev\\shop',
    lastActivityAt: new Date(now - 60_000).toISOString(),
    link: 'claude://claude.ai/epitaxy/local_1',
  },
  {
    sessionId: 'local_2',
    title: 'Dark mode',
    cwd: 'C:\\dev\\shop',
    lastActivityAt: new Date(now - 7_200_000).toISOString(),
    link: 'claude://claude.ai/epitaxy/local_2',
  },
  {
    sessionId: 'local_3',
    title: 'Quick question',
    cwd: 'C:\\Users\\me\\AppData\\Local\\Claude-Data\\scratch-workspaces\\a\\b',
    lastActivityAt: new Date(now - 30_000).toISOString(),
    link: 'claude://claude.ai/epitaxy/local_3',
  },
]

test('in the desktop app a press opens the chat by its link', async ($, on) => {
  const opened: string[][] = []
  base(on)
  on('env.get', (_, e) => ({ value: e.name === 'OS' ? 'Windows_NT' : undefined }))
  on('mcp.call', (_, e) => {
    expect(e.server).toBe('ccd_session_mgmt')
    return {
      value: {
        content: [{ type: 'text', text: JSON.stringify(SESSIONS) }],
        isError: false,
      },
    }
  })
  on('process.run', (_, e) => {
    opened.push([...e.argv])
    return { value: { exitCode: 1, stdout: '', stderr: '' } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'projects' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /Quick question/ })).toBeTruthy()
  await ui.press({ key: 'press:local_2' })
  expect(opened).toEqual([['explorer.exe', 'claude://claude.ai/epitaxy/local_2']])

  await ui.press({ key: 'tab:projects' })
  expect(await ui.find({ type: 'Text', text: /แชทไม่มีโฟลเดอร์/ })).toBeTruthy()
  // one chat: opens it at once
  await ui.press({ key: 'open:no-folder' })
  expect(opened[1]).toEqual(['explorer.exe', 'claude://claude.ai/epitaxy/local_3'])
  // two chats: lists them
  await ui.press({ key: 'open:c:\\dev\\shop' })
  expect(await ui.find({ type: 'Text', text: /Dark mode/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /← กลับ/ })).toBeFalsy()
  await ui.unmount()
})

/** A Windows path: the slashes turned to backslashes. */
const win = (path: string) => path.split('/').join(String.fromCharCode(92))

const BAND = {
  plugin: 'projects-view',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, bodyColumns: 60, view: {} },
} as const

test('star, pin, color, sort, toggle and the status sections', async ($, on) => {
  const { open, store } = base(on)
  const day = 86_400_000
  const sessions = [
    { sessionId: 'a1', title: 'Shop work', cwd: win('C:/dev/shop'), lastActivityAt: new Date(now - 60_000).toISOString(), isRunning: true, link: 'claude://x/a1' },
    { sessionId: 'b1', title: 'Blog post', cwd: win('C:/dev/blog'), lastActivityAt: new Date(now - 3_600_000).toISOString(), link: 'claude://x/b1' },
    { sessionId: 'c1', title: 'Old api', cwd: win('C:/dev/api'), lastActivityAt: new Date(now - 5 * day).toISOString(), link: 'claude://x/c1' },
  ]
  const created: Record<string, number> = { a1: now - 1 * day, b1: now - 9 * day, c1: now - 3 * day }
  on('env.get', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('mcp.call', (_, e) => {
    const text =
      e.tool === 'list_sessions'
        ? JSON.stringify(sessions)
        : JSON.stringify({ createdAt: new Date(created[e.args.session_id as string]).toISOString() })
    return { value: { content: [{ type: 'text', text }], isError: false } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // The toggle above the prompt opens and closes the pane.
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'toggle-pane' })
  expect(open.has('projects-view')).toBe(true)
  expect((await band.find({ key: 'toggle-pane' }))?.props.label).toBe('📂')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // running and waiting sections
  expect(await ui.find({ type: 'Text', text: /กำลังทำงาน/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /⚡ Shop work/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /รอคำสั่งจากคุณ/ })).toBeTruthy()

  await ui.press({ key: 'tab:projects' })
  const names = async () =>
    (await ui.findAll({ type: 'Text' }))
      .map(one => one.text)
      .filter(text => ['shop', 'blog', 'api'].includes(text))
  expect(await names()).toEqual(['shop', 'blog', 'api'])

  // created: newest first
  await ui.select({ key: 'sort', value: 'created' })
  expect(await names()).toEqual(['shop', 'api', 'blog'])

  // pin api to the top
  await ui.press({ key: `pin:${win('c:/dev/api')}` })
  expect((await names())[0]).toBe('api')
  // pinned rows stay on top in the other tab too
  await ui.press({ key: 'tab:recent' })
  expect(await names()).toEqual(['api'])
  await ui.press({ key: 'tab:projects' })

  // manual: move blog above shop
  await ui.select({ key: 'sort', value: 'manual' })
  await ui.press({ key: `up:${win('c:/dev/blog')}` })
  expect(await names()).toEqual(['api', 'blog', 'shop'])

  // star and the favourites filter
  await ui.press({ key: `star:${win('c:/dev/blog')}` })
  await ui.press({ key: 'only-stars' })
  expect(await names()).toEqual(['api', 'blog'])
  await ui.press({ key: 'only-stars' })

  // row color
  await ui.press({ key: `color:${win('c:/dev/shop')}` })
  await ui.press({ key: `pick:${win('c:/dev/shop')}:green` })

  const kept = store.get('prefs-1') as Record<string, unknown>
  expect(kept.pins).toEqual([win('c:/dev/api')])
  expect(kept.stars).toEqual([win('c:/dev/blog')])
  expect(kept.colors).toEqual({ [win('c:/dev/shop')]: '#22c55e' })
  expect(kept.sort).toBe('manual')

  // the terminal draws the same rows without the tint
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /^shop$/ })).toBeTruthy()
  await term.unmount()

  await band.press({ key: 'toggle-pane' })
  expect(open.has('projects-view')).toBe(false)
  await ui.unmount()
  await band.unmount()
})


test('close a chat in one press, and fold a section', async ($, on) => {
  base(on)
  const calls: string[] = []
  let sessions = [
    { sessionId: 'r1', title: 'Busy job', cwd: win('C:/dev/shop'), lastActivityAt: new Date(now - 30_000).toISOString(), isRunning: true, link: 'claude://x/r1' },
    { sessionId: 'w1', title: 'Done job', cwd: win('C:/dev/blog'), lastActivityAt: new Date(now - 600_000).toISOString(), link: 'claude://x/w1' },
  ]
  on('env.get', () => ({ value: undefined }))
  on('clock.sleep', () => ({ value: undefined }))
  on('mcp.call', (_, e) => {
    const id = e.args.session_id as string
    calls.push(`${e.tool}:${id ?? ''}`)
    if (e.tool === 'archive_session') sessions = sessions.filter(one => one.sessionId !== id)
    const text =
      e.tool === 'list_sessions'
        ? JSON.stringify(sessions)
        : e.tool === 'get_session'
          ? JSON.stringify({ createdAt: new Date(now - 86_400_000).toISOString() })
          : 'ok'
    return { value: { content: [{ type: 'text', text }], isError: false } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'projects' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // a working chat is stopped, then archived, and leaves the list
  await ui.press({ key: 'close:r1' })
  expect(calls).toContain('stop_session:r1')
  expect(calls).toContain('archive_session:r1')
  expect(calls.indexOf('stop_session:r1')).toBeLessThan(calls.indexOf('archive_session:r1'))
  expect(await ui.find({ type: 'Text', text: /Busy job/ })).toBeFalsy()

  // an idle chat is archived without a stop
  await ui.press({ key: 'close:w1' })
  expect(calls).not.toContain('stop_session:w1')
  expect(await ui.find({ type: 'Text', text: /Done job/ })).toBeFalsy()

  // an older chat in the recent section closes the same way
  sessions = [{ sessionId: 'o1', title: 'Old job', cwd: win('C:/dev/api'), lastActivityAt: new Date(now - 5 * 86_400_000).toISOString(), link: 'claude://x/o1' }]
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'close:o1' })
  expect(calls).toContain('archive_session:o1')
  expect(await ui.find({ type: 'Text', text: /Old job/ })).toBeFalsy()

  // fold and unfold a section
  sessions = [{ sessionId: 'n1', title: 'New job', cwd: win('C:/dev/api'), lastActivityAt: new Date(now - 60_000).toISOString(), link: 'claude://x/n1' }]
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /New job/ })).toBeTruthy()
  await ui.press({ key: 'fold:waiting' })
  expect(await ui.find({ type: 'Text', text: /New job/ })).toBeFalsy()
  await ui.press({ key: 'fold:waiting' })
  expect(await ui.find({ type: 'Text', text: /New job/ })).toBeTruthy()
  await ui.unmount()
})

test('settings: language and which sections show', async ($, on) => {
  const { store } = base(on)
  const sessions = [
    { sessionId: 'r1', title: 'Busy job', cwd: win('C:/dev/shop'), lastActivityAt: new Date(now - 30_000).toISOString(), isRunning: true, link: 'claude://x/r1' },
    { sessionId: 'w1', title: 'Done job', cwd: win('C:/dev/blog'), lastActivityAt: new Date(now - 600_000).toISOString(), link: 'claude://x/w1' },
  ]
  on('env.get', () => ({ value: undefined }))
  on('mcp.call', (_, e) => {
    const text =
      e.tool === 'list_sessions'
        ? JSON.stringify(sessions)
        : JSON.stringify({ createdAt: new Date(now - 86_400_000).toISOString() })
    return { value: { content: [{ type: 'text', text }], isError: false } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'projects' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /กำลังทำงาน/ })).toBeTruthy()

  // the gear opens settings; English turns every word over
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Text', text: /ตั้งค่า/ })).toBeTruthy()
  await ui.press({ key: 'lang:en' })
  expect(await ui.find({ type: 'Text', text: /Settings/ })).toBeTruthy()
  const links = (await ui.findAll({ type: 'Link' })).map(one => one.props.href)
  expect(links).toEqual([
    'https://aiunlock.co',
    'https://www.youtube.com/%40AIUnlocked168',
    'https://www.facebook.com/aiunlockedvip',
  ])
  expect(await ui.find({ type: 'Text', text: /Made by AI UNLOCKED/ })).toBeTruthy()

  // turn the running section off
  await ui.press({ key: 'show:running' })
  await ui.press({ key: 'settings-done' })
  expect(await ui.find({ type: 'Text', text: /Working/ })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /Waiting for you/ })).toBeTruthy()
  expect((await ui.find({ key: 'tab:projects' }))?.props.label).toBe('Projects')

  const kept = store.get('prefs-1') as Record<string, unknown>
  expect(kept.lang).toBe('en')
  expect(kept.hidden).toEqual(['running'])

  // and back on, in Thai
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'show:running' })
  await ui.press({ key: 'lang:th' })
  await ui.press({ key: 'settings-done' })
  expect(await ui.find({ type: 'Text', text: /กำลังทำงาน/ })).toBeTruthy()
  await ui.unmount()
})

test('this chat shows as working, with no close button', async ($, on) => {
  base(on)
  const others = [
    { sessionId: 'w1', title: 'Done job', cwd: win('C:/dev/blog'), lastActivityAt: new Date(now - 600_000).toISOString(), link: 'claude://x/w1' },
  ]
  const self = { sessionId: 'me', title: 'Building the pane', cwd: win('C:/dev/shop'), lastActivityAt: new Date(now - 5_000).toISOString(), isRunning: true, isArchived: false, link: 'claude://x/me' }
  on('env.get', () => ({ value: undefined }))
  on('mcp.call', (_, e) => {
    const id = e.args.session_id
    const text =
      e.tool === 'list_sessions'
        ? JSON.stringify(others)
        : id === 'self'
          ? JSON.stringify(self)
          : JSON.stringify({ createdAt: new Date(now - 86_400_000).toISOString() })
    return { value: { content: [{ type: 'text', text }], isError: false } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'projects' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /กำลังทำงาน \(1\)/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Building the pane/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /แชทนี้/ })).toBeTruthy()
  expect(await ui.find({ key: 'close:me' })).toBeFalsy()
  expect(await ui.find({ key: 'close:w1' })).toBeTruthy()
  // its project says where the person is
  await ui.press({ key: 'tab:projects' })
  expect(await ui.find({ type: 'Text', text: /คุณอยู่ที่นี่/ })).toBeTruthy()
  await ui.unmount()
})

test('a new copy takes the stars and pins an earlier copy kept', async ($, on) => {
  const { store } = base(on)
  const folder = 'C:/Users/me/.claude/plugins/store'
  const earlier = { 'prefs-1': { stars: ['c:/dev/blog'], pins: ['c:/dev/api'], lang: 'en' } }
  on('env.get', (_, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/me' : undefined }))
  on('fs.list', (_, e) => ({
    value:
      norm(e.path ?? '') === folder
        ? [{ name: 'projects-view_inline-abc.json', kind: 'file', size: 100, mtimeMs: now, isLink: false }]
        : [],
  }))
  on('fs.read', (_, e) => ({
    value: norm(e.path).endsWith('projects-view_inline-abc.json') ? JSON.stringify(earlier) : '',
  }))
  on('mcp.call', () => ({ value: { content: [], isError: true } }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const kept = store.get('prefs-1') as Record<string, unknown>
  expect(kept.stars).toEqual(['c:/dev/blog'])
  expect(kept.pins).toEqual(['c:/dev/api'])
  expect(kept.lang).toBe('en')
})
