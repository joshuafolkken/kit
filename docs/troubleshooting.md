# Troubleshooting

Common errors when installing or using `@joshuafolkken/kit`, and how to fix them. Most install-time failures trace back to the [authentication setup](./authentication.md).

## `pnpm install` fails with `401 Unauthorized` / `403 Forbidden`

`pnpm` reached GitHub Packages but the token was missing or expired.

1. Confirm the credential lives in your **user-level** `~/.npmrc`, not the project `.npmrc` — pnpm ignores a project-level one (see the warning below). `pnpm config get "//npm.pkg.github.com/:_authToken"` should print the token or the `${NODE_AUTH_TOKEN}` placeholder; if it is empty, run §2 of [authentication.md](./authentication.md).
2. Using the placeholder form? Confirm the env var is set in the current shell:
   ```bash
   echo $NODE_AUTH_TOKEN
   ```
   If it is empty, your shell rc hasn't run §1 of [authentication.md](./authentication.md) yet — open a new shell or run `exec $SHELL`.
3. The `gh` token may have expired or lost the `read:packages` scope. Refresh it:
   ```bash
   gh auth refresh --scopes read:packages
   exec $SHELL   # re-evaluates export NODE_AUTH_TOKEN=$(gh auth token)
   ```
4. Verify the token is live: `gh auth token` should print a non-empty value.

## `401` on a deploy build (Cloudflare, Vercel, Docker) while CI is green

The builder is not a GitHub Actions runner: it has no `~/.npmrc` and no `actions/setup-node` step, so nothing supplies the credential once the project `.npmrc` carries only the registry mapping. CI cannot reproduce it — the kit's workflows call setup-node with `registry-url`, which writes the credential for the job — so the failure surfaces first at deploy time.

- Give the builder a credential from a source pnpm reads outside the project: see [§4 of authentication.md](./authentication.md#4-build-platforms-with-no-user-level-npmrc).
- Do **not** answer it by restoring `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` to the project `.npmrc`. pnpm ignores that line (next section), and `josh sync` removes it again on the next run.

## `[WARN] Ignored project-level auth setting "//npm.pkg.github.com/:_authToken"`

Since pnpm 11.6, environment variables are not expanded in registry credentials read from a project `.npmrc`, because that file is committed and could leak the token to an attacker-controlled registry. The line is inert — whatever auth currently works is coming from somewhere else — and it warns on every pnpm command.

- Delete the `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` line from the project `.npmrc`, or run `josh sync`, which removes it. Versions of the kit before this change re-added it on every sync; upgrade first if the line keeps coming back.
- Move the credential to a source pnpm still expands — see §2 of [authentication.md](./authentication.md).

## `ERR_PNPM_FETCH_404` — package not found

`pnpm` tried the **public npm registry** instead of GitHub Packages. The scoped registry line is missing from `.npmrc`.

- Re-run §3 of [authentication.md](./authentication.md) in the right location (`~/.npmrc` for a global `josh` install, the project root for a devDependency).
- Confirm the file contains the registry mapping:
  ```ini
  @joshuafolkken:registry=https://npm.pkg.github.com
  ```
- A project `.npmrc` shadows `~/.npmrc`. If you have both, make sure the project one also carries the scoped registry line.
- The credential is a separate concern and belongs in `~/.npmrc` — a `404` means routing, a `401`/`403` means auth.

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

## `josh <command>` fails with `MODULE_NOT_FOUND` pointing at a pnpm store path

```text
Error: Cannot find module '/…/node_modules/.pnpm/tsx@<old>/node_modules/tsx/dist/cli.mjs'
  code: 'MODULE_NOT_FOUND'
```

pnpm's generated `node_modules/@joshuafolkken/kit/node_modules/.bin/tsx` shim hardcodes the absolute store path of the tsx version present when it was written. After a tsx bump the old store entry is pruned, but the nested shim is not regenerated — so it points at a path that no longer exists. `pnpm install` (even `--force`) is a no-op here, because the lockfile is already satisfied.

Kit `>= 1.17.0` no longer uses that shim: it resolves the tsx CLI entry from tsx's own manifest at runtime, so a stale shim cannot break the command. On older versions, delete the dead shim or reinstall from scratch:

```bash
rm node_modules/@joshuafolkken/kit/node_modules/.bin/tsx   # resolution falls back to the hoisted tsx
# or
rm -rf node_modules && pnpm install
```

## Wrong Node or pnpm version

The kit targets **pnpm ≥ 11** (see `devEngines` in `package.json`) and **Node ≥ 22.19** (see `engines`). Check:

```bash
node -v
pnpm -v
```

If pnpm is older than 11, upgrade via Corepack: `corepack prepare pnpm@latest --activate`.

## `josh sync` reports config drift

`josh sync` overwrites managed config files (e.g. `playwright.config.ts`, the CI workflow) with the latest published versions. If you intentionally customized one of these, your change will be reverted. Keep local-only config in files **not** managed by the kit, or re-apply the change after syncing. See [sync.md](./sync.md) for the managed-file list.

## CI warns that the Playwright image could not be resolved

The `checks` and `e2e` jobs normally run inside `mcr.microsoft.com/playwright:v<version>-noble`, derived from the `@playwright/test` version in your manifest. Microsoft publishes that image days after the npm release, so right after a Playwright bump the tag may not exist yet.

When the tag is missing, the workflow does **not** fail. The `Resolve Playwright image` job logs a warning like:

```text
Playwright image mcr.microsoft.com/playwright:v1.62.0-noble could not be resolved on MCR (HTTP 404).
Running on the plain runner and installing browsers with 'playwright install --with-deps' instead.
```

Both jobs then run on `ubuntu-latest` and download browsers themselves, which adds roughly two minutes but always matches the installed Playwright exactly. No action is required — the warning disappears on its own once the image is published. Do **not** pin `@playwright/test` back to make it go away.

## Still stuck?

- Re-read [authentication.md](./authentication.md) end to end — the ordering (token → env var → `~/.npmrc` credential → project registry mapping) matters.
- Check installed vs. latest version: `josh version`.
- Open an issue: <https://github.com/joshuafolkken/kit/issues>.
