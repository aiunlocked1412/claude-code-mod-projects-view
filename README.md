# AI UNLOCKED: projects and chats pane for Claude Code

A Claude Code mod that adds a side pane listing your projects and chats, so you can jump between them quickly.

- **Recent tab** with three sections: ⚡ working now, 💬 waiting for you (finished in the last 24 h), 🕘 recent. The chat you are in is highlighted.
- **Projects tab** grouped by folder, with ❤️ favorites, 📌 pins (pinned projects stay on top of every tab), 🎨 row colors, and sorting by last used, newest, name or your own order (▲▼).
- Press a chat to open it in the desktop app (in a terminal it copies `claude --resume <id>`). Press ✖️ to stop and archive a chat; it can be brought back from Archived.
- Fold each section with ▾ / ▸, and turn sections on or off in ⚙️ settings.
- Thai and English (⚙️ settings).
- A 📁 button above the prompt opens and closes the pane; `/projects` does the same.

Best in the Claude desktop app, which gives the mod the live session list. In a terminal it reads the transcripts under `~/.claude/projects`.

## Install

At the prompt of a terminal session:

```
/plugin install projects-view --marketplace aiunlocked1412/claude-code-mod-projects-view
```

Answer `y` to add the marketplace, then choose the user scope.

From a shell:

```
claude plugin install projects-view --marketplace aiunlocked1412/claude-code-mod-projects-view
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `aiunlocked1412/claude-code-mod-projects-view`, then Add plugin.

This repository is private: it installs only for people who can read it on GitHub and whose machine already holds a git credential for github.com (an SSH key, or `gh auth login` then `gh auth setup-git`).

## Remove

```
claude plugin uninstall projects-view
```
