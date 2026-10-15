# Troubleshooting

Common errors when installing or using `@joshuafolkken/kit`, and how to fix them, the ones a new install meets first at the top. New installs use public npm; the GitHub Packages errors at the end apply only to existing projects that still route this scope there ([authentication.md](./authentication.md)).

## `ERR_PNPM_FETCH_404` — package not found

Check which registry the install uses before changing `.npmrc`.

- For a new kit-only install, public npm is the expected registry. Check `https://registry.npmjs.org/@joshuafolkken%2fkit/<version>` for the exact version requested — the package URL can return `200` while that version returns `404`. A GitHub Packages mapping does not fix it.
- For an existing project intentionally using GitHub Packages, confirm its `.npmrc` still contains the mapping. See §3 of [authentication.md](./authentication.md) if it is missing:
  ```ini
  @joshuafolkken:registry=https://npm.pkg.github.com
  ```
- A project `.npmrc` shadows `~/.npmrc`. Check both when an existing project unexpectedly changes registry. A GitHub Packages `401`/`403` points to its separate credential setup.

## `josh: command not found` after `pnpm add -g`

The pnpm global bin directory isn't on your `PATH`.

```bash
pnpm setup
exec $SHELL
which josh   # should now print a path
```

`pnpm setup` registers `PNPM_HOME` and appends it to `PATH` via your shell rc. If `which josh` is still empty, open a new terminal so the updated `PATH` takes effect. You can print the directory to add manually with `pnpm bin -g`.

## pnpm does not start — `bin/pnpm.cjs` not found

Every `pnpm` command, `pnpm -v` included, stops with an error that `bin/pnpm.cjs` cannot be found. The Corepack bundled with Node.js is launching pnpm for you, and it may fail to launch pnpm 12 — the pnpm kit requires, and the one a `full` project pins in `packageManager`. `josh` cannot report this, because it runs through pnpm.

Take pnpm away from Corepack, then install the standalone release:

```bash
corepack disable pnpm
```

Then follow [Install pnpm and Node.js](./setup/prerequisites.md#2-install-pnpm-and-nodejs) and check `pnpm -v` in a new terminal.

## Every `josh gate` check fails at once, in 0.0s

`josh gate` marks every check ✗ after `0.0s`, and each one says `spawn pnpm ENOENT` and that pnpm was not found on the PATH. Each check runs as a `pnpm josh <check>` child process, so none of them could start.

This happens when the gate was started from somewhere with a different `PATH` than your terminal — an editor task, an AI agent's shell, a CI step, or a service — that skips the profile file (`~/.zshrc`, `~/.bashrc`) holding pnpm's `PATH` line.

Ask from the same place the gate ran:

```bash
josh doctor   # the `pnpm:` line prints a version, or `(not on PATH)`
```

Then make pnpm's directory part of that process's `PATH`: print it with `dirname "$(command -v pnpm)"` in a terminal where pnpm works, and add it to the editor's, agent's or service's environment settings — or start that program from a terminal that already has it. If pnpm is not installed at all, follow [Install pnpm and Node.js](./setup/prerequisites.md#2-install-pnpm-and-nodejs).

## Wrong Node or pnpm version

kit needs the Node.js and pnpm versions [Install the prerequisites](./setup/prerequisites.md) lists. A `full` project that ran `josh init` pins pnpm exactly in `packageManager` and `devEngines.packageManager.version`; use that version there. Check:

```bash
node -v
pnpm -v
```

If pnpm is older than 12, install the current standalone pnpm release using the [official installer](https://pnpm.io/installation/), then check `pnpm -v` again. A Corepack-managed pnpm cannot run `pnpm self-update`; switch to the standalone installation before updating the project pin.

If pnpm only differs from the project's pin, you do not need to install that version: with `devEngines.packageManager.onFail: "download"` (what `josh init` writes) pnpm fetches the pinned version itself. A project that still has `"error"` refuses to run; run `josh sync`, which moves it to `"download"` ([sync.md](./sync.md#what-does-not-get-synced)).

For a project you cannot change, set pnpm's own [`pmOnFail`](https://pnpm.io/settings/cli#pmonfail) on your machine. It overrides `onFail` in **every** project there. Edit (or add) the line in pnpm's global `config.yaml`:

- macOS: `~/Library/Preferences/pnpm/config.yaml`
- Linux: `~/.config/pnpm/config.yaml` (`$XDG_CONFIG_HOME/pnpm/config.yaml` when that is set)
- Windows: `~\AppData\Local\pnpm\config\config.yaml`

```yaml
pmOnFail: download
```

Edit the file directly: pnpm 12 refuses `pnpm config set --global pmOnFail download` with `ERR_PNPM_CONFIG_SET_UNSUPPORTED_YAML_CONFIG_KEY`, although it reads the key from that file. `pnpm config get pmOnFail` prints `download` once the line is in place.

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

Names are Playwright's own, lowercase — `chromium`, `firefox`, `webkit`, `chromium-headless-shell`. Characters other than letters, dashes and spaces are stripped, and a value with no usable name falls back to `chromium`. A misspelled name fails the install step, naming the value. The `Resolve Playwright image` job logs the list it settled on. The container path ignores the variable — the image already ships every browser.

## Local E2E aborts with "http://localhost:5173 is already used"

Something else is listening on the port `playwright.config.ts` runs the dev server on — usually another vite project, since `5173` is vite's default. Playwright refuses to reuse it, so the suite never runs against a different application.

Free the port — usually by stopping the other project's dev server — and re-run. If several kit projects share one machine, give each its own ports by setting `PORT_SEED` in its `.env` (see [`josh port`](./josh-commands.md#josh-port)).

If the server on that port **is** this project's own and you want Playwright to skip booting a second one, opt in explicitly:

```bash
PLAYWRIGHT_REUSE_SERVER=1 pnpm josh test
```

The flag accepts `1`, `true`, `yes` or `on` (case- and whitespace-insensitive); every other value, including unset, boots a fresh server. It works the same in CI. Do **not** edit `reuseExistingServer` in `playwright.config.ts` instead — `josh sync` overwrites that file.

## `CI=0` runs locally but the HTML report never opens

`playwright.config.ts` treats every value of `CI` as CI **except** an empty one and `0`, `false`, `no` and `off` (case- and whitespace-insensitive). `CI=0` therefore runs locally: the `dev` script on the seeded dev port (`5173` with no `PORT_SEED`), no retries, the `list` reporter.

To stop Playwright's own modules, which treat any non-empty `CI` as CI, from silencing the HTML report, the config **removes `CI` from the environment** once it has judged the run local. The dev server it starts does not see `CI` either, so `CI=0` and `unset CI` behave the same. If the report still does not open, run `pnpm exec playwright show-report`.

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

The builder is not a GitHub Actions runner: it has no `~/.npmrc` and no kit CI authentication step, so nothing supplies the credential once an existing project `.npmrc` carries only the registry mapping. CI cannot reproduce it — the kit CI template writes a GitHub Packages credential placeholder before dependency installation — so the failure surfaces first at deploy time.

- Give the builder a credential from a source pnpm reads: see [§4 of authentication.md](./authentication.md#4-build-platforms-with-no-user-level-npmrc).
- Restoring `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` to the project `.npmrc` fixes nothing **on its own** — pnpm ignores that line by default (next section). It becomes the credential only together with `npmrcAuthFile`, which is option (d) of that section.

## `[WARN] Ignored project-level auth setting "//npm.pkg.github.com/:_authToken"`

pnpm ignores a credential line in a project `.npmrc` unless `npmrcAuthFile` declares that file trusted — why is in [§2 of authentication.md](./authentication.md#2-put-the-credential-in-npmrc). The warning means the opt-in is absent, so the line contributes no auth — whatever currently works is coming from somewhere else — and it repeats on every pnpm command.

- Want the line to do nothing? Delete it from the project `.npmrc` and keep the credential in a source pnpm expands by default — see §2 of [authentication.md](./authentication.md). `josh sync` neither adds nor removes it, so the deletion sticks.
- Want the line to be the credential (typically on a deploy builder with no user-level npmrc)? Set `npmrcAuthFile` to that file — see [§4(d) of authentication.md](./authentication.md#4-build-platforms-with-no-user-level-npmrc). The warning disappears and the token is expanded.

## Still stuck?

- Installing from GitHub Packages? Re-read [authentication.md](./authentication.md) end to end — the ordering (token → env var → `~/.npmrc` credential → project registry mapping) matters.
- Check installed vs. latest version: `josh version`.
- Open an issue: <https://github.com/joshuafolkken/kit/issues>.
