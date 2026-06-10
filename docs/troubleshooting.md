# Troubleshooting

Common errors when installing or using `@joshuafolkken/kit`, and how to fix them. Most install-time failures trace back to the [authentication setup](./authentication.md).

## `pnpm install` fails with `401 Unauthorized` / `403 Forbidden`

`pnpm` reached GitHub Packages but the token was missing or expired.

1. Confirm the env var is set in the current shell:
   ```bash
   echo $NODE_AUTH_TOKEN
   ```
   If it is empty, your shell rc hasn't run §1 of [authentication.md](./authentication.md) yet — open a new shell or run `exec $SHELL`.
2. The `gh` token may have expired or lost the `read:packages` scope. Refresh it:
   ```bash
   gh auth refresh --scopes read:packages
   exec $SHELL   # re-evaluates export NODE_AUTH_TOKEN=$(gh auth token)
   ```
3. Verify the token is live: `gh auth token` should print a non-empty value.

## `ERR_PNPM_FETCH_404` — package not found

`pnpm` tried the **public npm registry** instead of GitHub Packages. The scoped registry line is missing from `.npmrc`.

- Re-run §2 of [authentication.md](./authentication.md) in the right location (`~/.npmrc` for a global `josh` install, the project root for a devDependency).
- Confirm the file contains both lines:
  ```ini
  @joshuafolkken:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
  ```
- A project `.npmrc` shadows `~/.npmrc`. If you have both, make sure the project one also carries the scoped registry line.

## `josh: command not found` after `pnpm add -g`

The pnpm global bin directory isn't on your `PATH`.

```bash
pnpm setup
exec $SHELL
which josh   # should now print a path
```

`pnpm setup` registers `PNPM_HOME` and appends it to `PATH` via your shell rc. If `which josh` is still empty, open a new terminal so the updated `PATH` takes effect.

## Stale `~/.local/bin/josh` shim from an old version

Versions prior to `0.200.0` wrote a project-pinned shim to `~/.local/bin/josh`. After that project's `node_modules` is removed, running `josh` fails with something like `…/node_modules/.bin/tsx: No such file or directory`, or the shim shadows the global bin. The quickest diagnosis and fix is the built-in command:

```bash
josh doctor          # shows the running binary, the PATH josh, and the pnpm-global josh
josh doctor --fix    # removes the stale kit shim so the global josh takes over
```

`josh version` (alias `josh v`) also warns automatically whenever the `josh` on `PATH` is not the pnpm-global install. You can still remove the shim by hand if you prefer:

```bash
rm -f ~/.local/bin/josh
which josh   # should now resolve to the pnpm global bin
```

If the shim reappears after every `pnpm install`, a project pinned `< 0.200.0` is regenerating it — upgrade that project to `>= 0.200.0`. See [josh-commands.md → `josh doctor`](./josh-commands.md#josh-doctor) and [cli.md §4](./cli.md#4-migrating-from-older-versions).

## Wrong Node or pnpm version

The kit targets **pnpm ≥ 11** (see `devEngines` in `package.json`) and **Node ≥ 22.19** (see `engines`). Check:

```bash
node -v
pnpm -v
```

If pnpm is older than 11, upgrade via Corepack: `corepack prepare pnpm@latest --activate`.

## `josh sync` reports config drift

`josh sync` overwrites managed config files (e.g. `playwright.config.ts`, the CI workflow) with the latest published versions. If you intentionally customized one of these, your change will be reverted. Keep local-only config in files **not** managed by the kit, or re-apply the change after syncing. See [sync.md](./sync.md) for the managed-file list.

## Still stuck?

- Re-read [authentication.md](./authentication.md) end to end — the ordering (token → env var → `.npmrc`) matters.
- Check installed vs. latest version: `josh version`.
- Open an issue: <https://github.com/joshuafolkken/kit/issues>.
