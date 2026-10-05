---
name: joserah-docker-native-parity
description: Use when changing the Joserah server's Dockerfile, compose files, start-up paths or anything that must behave the same natively on Windows and inside the Linux container.
---

# One code base, two install modes

- Image `node:24-slim`, user `joserah` (uid 10001), git, curl, Claude Code by its official native installer pinned to one version (`curl -fsSL https://claude.ai/install.sh | bash -s <version>`), `DISABLE_AUTOUPDATER=1` (the image is the version).
- Volumes: `/workspace` (the workspace), `/home/joserah/.claude` (`CLAUDE_CONFIG_DIR`, the Claude Code login), `/home/joserah/state` (`JOSERAH_STATE_DIR`, server secrets). Nothing is shared from the host.
- `JOSERAH_IN_DOCKER=1` makes the server bind `0.0.0.0` inside the container; what the host sees is decided by compose: `127.0.0.1:4747:4747` by default.
- The terminal door: `docker exec -it -w /workspace joserah claude`; the image's `claude` wrapper adds `--plugin-dir /opt/joserah` so jobs and the terminal both load the plugin.
- Paths: build them with `path.join`, compare workspace-relative paths with `/` separators; never hard-code `C:/` or `/home`.
- Line endings: `.gitattributes` forces `eol=lf` for `.ts`, `.mjs`, `.sh` and the Dockerfile, so a Windows checkout builds the same image.
- Native mode (`node server/main.ts --workspace <dir>`, wrapped as `joserah serve`) prints its URL and opens no window.
- File change detection never relies on inotify (it does not fire across the Windows boundary): the Store emits its own events and polls mtimes every 2 s.
- One heavy thing at a time: one `docker build`, never beside a browser test or a second build.
