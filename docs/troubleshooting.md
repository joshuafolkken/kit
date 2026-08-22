# Troubleshooting

Common errors when installing or using `@joshuafolkken/kit`, and how to fix them. Most install-time failures trace back to the [authentication setup](./authentication.md).

## `pnpm install` fails with `401 Unauthorized` / `403 Forbidden`

`pnpm` reached GitHub Packages but the token was missing or expired.

1. Confirm the credential lives in your **user-level** `~/.npmrc`, not the project `.npmrc` — pnpm ignores a project-level one unless `npmrcAuthFile` opts it in (see the warning below). `pnpm config get "//npm.pkg.github.com/:_authToken"` should print the token or the `${NODE_AUTH_TOKEN}` placeholder; if it is empty, run §2 of [authentication.md](./authentication.md).
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

The builder is not a GitHub Actions runner: it has no `~/.npmrc` and no `actions/setup-node` step, so nothing supplies the credential once the project `.npmrc` carries only the registry mapping. CI cannot reproduce it — every workflow job that installs dependencies calls setup-node with `registry-url` first, which writes the credential for that job — so the failure surfaces first at deploy time.

- Give the builder a credential from a source pnpm reads: see [§4 of authentication.md](./authentication.md#4-build-platforms-with-no-user-level-npmrc).
- Restoring `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` to the project `.npmrc` fixes nothing **on its own** — pnpm ignores that line by default (next section). It becomes the credential only together with `npmrcAuthFile`, which is option (d) of that section.
- Did this start right after a kit upgrade, on a project that was using `npmrcAuthFile`? Kit before `1.60.0` stripped the line on every `josh sync`. Upgrade to `1.60.0` or later, restore the line, and it stays.

## `[WARN] Ignored project-level auth setting "//npm.pkg.github.com/:_authToken"`

Since pnpm 11.6, environment variables are not expanded in registry credentials read from a project `.npmrc` **unless `npmrcAuthFile` declares that file trusted**, because the file is committed and could leak the token to an attacker-controlled registry. The warning means the opt-in is absent, so the line contributes no auth — whatever currently works is coming from somewhere else — and it repeats on every pnpm command.

- Want the line to do nothing? Delete it from the project `.npmrc` and keep the credential in a source pnpm expands by default — see §2 of [authentication.md](./authentication.md). `josh sync` neither adds nor removes it, so the deletion sticks.
- Want the line to be the credential (typically on a deploy builder with no user-level npmrc)? Set `npmrcAuthFile` to that file — see [§4(d) of authentication.md](./authentication.md#4-build-platforms-with-no-user-level-npmrc). The warning disappears and the token is expanded.

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

The `checks` and `e2e` jobs normally run inside `mcr.microsoft.com/playwright:v<version>-noble`, derived from the `@playwright/test` version in your manifest — read from `devDependencies` or `dependencies`, whichever declares it. Microsoft publishes that image days after the npm release, so right after a Playwright bump the tag may not exist yet.

When the tag is missing, the workflow does **not** fail. The `Resolve Playwright image` job logs a warning like:

```text
Playwright image mcr.microsoft.com/playwright:v1.62.0-noble could not be resolved on MCR (HTTP 404).
Running on the plain runner and installing chromium instead (set the JOSH_PLAYWRIGHT_BROWSERS repository variable to change the list).
```

Both jobs then run on `ubuntu-latest` and download browsers themselves, which adds roughly two minutes but always matches the installed Playwright exactly. No action is required — the warning disappears on its own once the image is published. Do **not** pin `@playwright/test` back to make it go away.

### Widening the fallback browser list

The fallback downloads `chromium` only. A bare `playwright install` would fetch chromium, firefox and webkit plus ffmpeg — roughly 1 GB — and the `checks` job runs under an 8-minute timeout, so the download alone can turn a recoverable image lag into a red build. A single chromium project is what kit scaffolds, so that is the default.

If your `playwright.config.ts` (or a Vitest browser-mode project) drives more than chromium, set a **repository variable** named `JOSH_PLAYWRIGHT_BROWSERS` to a space-separated list:

```text
JOSH_PLAYWRIGHT_BROWSERS = chromium firefox webkit
```

Set it under _Settings → Secrets and variables → Actions → Variables_. Use the variable rather than editing the workflow: the CI workflow is managed by `josh sync` and a local edit is overwritten on the next sync.

Names are Playwright's own and are lowercase — `chromium`, `firefox`, `webkit`, `chromium-headless-shell`. Only letters, dashes and the spaces between them are passed through; anything else is stripped before the command runs, and a value left with no usable name falls back to `chromium`. A misspelled name is _not_ silently dropped: it reaches Playwright and the install step fails naming the value, so the mistake surfaces where it was made rather than later as a missing browser executable. The `Resolve Playwright image` job logs the list it settled on, so the run always says which browsers it installed. The container path ignores the variable entirely — the image already ships every browser it needs.

## Local E2E aborts with "http://localhost:5173 is already used"

Something else is listening on the port `playwright.config.ts` runs the dev server on, and Playwright refuses to start rather than adopt it. This is deliberate: `5173` is vite's default, so it is the port _every_ vite project takes first, and later ones drift to `5174`, `5178`, and so on. Because the config sets no `use.baseURL`, Playwright derives the base URL from `webServer.port` — so a reused foreign server would send every relative navigation in every spec to a different application, and the suite would report green against it. The abort replaces a silent wrong-app pass.

Free the port — usually by stopping the other project's dev server — and re-run. If you hit this regularly because several kit projects share one machine, give each project its own pair of ports instead by setting `PORT_SEED` in its `.env` (see [`josh port`](./josh-commands.md#josh-port)) — a seed reduces how often a foreign server is on the port at all, while this abort is what stops a foreign server from being adopted when one is.

If the server on that port **is** this project's own and you want Playwright to skip booting a second one, opt in explicitly:

```bash
PLAYWRIGHT_REUSE_SERVER=1 pnpm josh test
```

The flag accepts `1`, `true`, `yes` or `on` (case- and whitespace-insensitive); every other value, including unset, boots a fresh server. It means the same thing in CI, where it exists for an orchestrator that pre-builds and boots the preview so several checks share one server. Do **not** edit `reuseExistingServer` in `playwright.config.ts` instead — that file is managed by `josh sync` and the change is overwritten on the next sync.

## `CI=0` runs locally but the HTML report never opens

`playwright.config.ts` treats every value of `CI` as CI **except** an empty one and the explicit negatives `0`, `false`, `no` and `off` (case- and whitespace-insensitive). The test is inverted rather than an allow-list because `CI` has no fixed vocabulary — Woodpecker exports `CI=woodpecker`, and an allow-list would drop such a run into dev mode. Exporting `CI=0` therefore selects the local branch: `pnpm run dev` on the dev port the seed resolves to (`5173` with no `PORT_SEED` set), no retries, the `list` reporter.

Playwright's own modules read `CI` with plain truthiness, though, and `'0'` is a non-empty string. Left alone they would still classify the run as CI — most visibly in the HTML reporter, which then stays silent when the run ends: no auto-open after a failing run, and no `To open last HTML report run:` hint either, so the report is unreachable unless you already know `pnpm exec playwright show-report`. To keep every reader on one verdict, the config **removes `CI` from the environment** once it has judged the run local. Nothing is removed on the CI branch, and a provider value such as `CI=woodpecker` is never touched.

One consequence is worth knowing: the `webServer` child process (`pnpm run dev`) inherits that environment, so it does not see `CI` either. That is deliberate — a dev server still reading `CI=0` as CI would reproduce the same bug one process down — but it means `CI=0` and `unset CI` are equivalent for anything in your dev pipeline that keys off the variable.

## Still stuck?

- Re-read [authentication.md](./authentication.md) end to end — the ordering (token → env var → `~/.npmrc` credential → project registry mapping) matters.
- Check installed vs. latest version: `josh version`.
- Open an issue: <https://github.com/joshuafolkken/kit/issues>.
