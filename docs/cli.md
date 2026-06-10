# Install the global `josh` CLI

Install `@joshuafolkken/kit` globally to run `josh` from any directory, independent of any project's `node_modules` — the same model as `@joshuafolkken/game-kit`'s `jgame`.

## 1. Authenticate

One-time GitHub Packages setup — see [authentication.md](./authentication.md). For a global install, write the `.npmrc` lines to your home `~/.npmrc`.

## 2. Install globally

pnpm requires a one-time setup before any global install — it registers `PNPM_HOME` and appends it to your `PATH` via your shell rc file:

```bash
pnpm setup
exec $SHELL
```

Then install the kit and confirm the CLI runs:

```bash
pnpm add -g @joshuafolkken/kit
josh help
```

`josh` now works from any directory. The global bin is a compiled, self-contained executable (`dist/josh.js`) — it is **not** tied to any project's `node_modules`, so reinstalling or removing a project's dependencies never breaks it.

## 3. If `josh` isn't found

The pnpm global bin directory isn't on your `PATH` yet:

```bash
pnpm setup
exec $SHELL
which josh   # should now print a path
```

If `which josh` is still empty, open a new terminal so the updated `PATH` takes effect. You can print the directory to add manually with `pnpm bin -g`.

## 4. Migrating from older versions

Versions prior to `0.200.0` installed a project-pinned shim at `~/.local/bin/josh` via `postinstall`. That shim is no longer created and can break when its origin project's `node_modules` is removed (e.g. `…/node_modules/.bin/tsx: No such file or directory`), or it can shadow the pnpm-global `josh` on `PATH`. The fastest fix is the built-in self-healing command, which detects the stale shim and removes it for you:

```bash
josh doctor --fix
```

Equivalently, remove it by hand and rely on the global install:

```bash
rm -f ~/.local/bin/josh
pnpm add -g @joshuafolkken/kit
```

If the shim keeps coming back, a project pinned `< 0.200.0` is regenerating it on every `pnpm install` — upgrade that project (`pnpm add -D @joshuafolkken/kit@latest`). See [josh-commands.md → `josh doctor`](./josh-commands.md#josh-doctor).

## Next

- Full command reference: [josh-commands.md](./josh-commands.md).
- Using the kit inside a project too? See [package.md](./package.md).
- Hitting an error? See [troubleshooting.md](./troubleshooting.md).
