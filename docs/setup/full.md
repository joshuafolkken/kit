# Set up the full profile

The detailed version of the [Quick start](../../README.md#quick-start) for the `full` [profile](../init.md#project-profiles): a JavaScript / TypeScript project with npm dependencies. For an `index.html` site, or a Python, Rust or other non-Node project, see [Set up the basic profile](./basic.md).

kit needs the Node.js and pnpm versions [Install the prerequisites](./prerequisites.md) lists, and `josh start` needs the gh CLI — install them there, then return here. The package is independent of the [global `josh` CLI](../cli.md) — most projects want both, but the package alone is enough to consume configs.

## 1. Choose `josh init` or `josh start`

Which one to run is decided in [init.md → `josh init` or `josh start`](../init.md#josh-init-or-josh-start). Both set up the `full` profile the same way: `josh init` is §2, `josh start` is §3.

## 2. Install and initialize with `josh init`

```bash
pnpm --allow-build=esbuild dlx @joshuafolkken/kit init
pnpm josh lint:related && pnpm josh test:related
pnpm josh gate
```

On a branch, `josh gate` refuses to start until the scoped checks `lint:related` and `test:related` have passed on the files the branch changed, so the second line runs them first. A project without vitest needs only `lint:related`: `test:related` skips there and the gate does not ask for it.

`pnpm dlx` fetches kit from the public npm registry without a GitHub token or project `.npmrc` mapping, adds `@joshuafolkken/kit` to the project's development dependencies, and hands the run to the `josh init` of the kit it just added ([init.md → Run from outside the project](../init.md#run-from-outside-the-project)). Existing projects with a `@joshuafolkken` mapping to GitHub Packages keep using it; see [authentication.md](../authentication.md) until those projects migrate.

`josh init` creates or merges the config files, adds the development dependencies the generated configs need — ESLint and its plugins, TypeScript, Prettier, cspell, Playwright and, when Git exists, lefthook ([init.md → Dependencies](../init.md#dependencies)) — then runs `pnpm install` and `josh format`. So the dependencies are installed, the Git hooks are in place and the new files are formatted before `josh gate` runs. `--no-install` skips both steps. See [init.md](../init.md) for the full list of managed files.

To install kit without initializing — to import only its presets, for example — add it yourself:

```bash
pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver @joshuafolkken/kit
```

kit's CLI runs on tsx, which depends on esbuild, and kit's optional ESLint import plugins bring in unrs-resolver; pnpm fails an install whose dependencies carry an unapproved build script. The two `--allow-build` flags record both approvals in `pnpm-workspace.yaml`. Added without them, the command exits non-zero with `ERR_PNPM_IGNORED_BUILDS`, so keep both flags. A package-only installation does not include ESLint: a project importing `@joshuafolkken/kit/eslint/vanilla` installs ESLint and its plugins itself ([manual-config.md](../manual-config.md)).

## 3. Set up for the GitHub Issue workflow with `josh start`

```bash
pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver @joshuafolkken/kit
pnpm exec josh start
```

`josh start` needs the [gh CLI](https://cli.github.com/), signed in. It asks first, runs the same setup as §2, then carries it to GitHub: it creates what is missing — Git, the first commit, the repository — and, when `main` already has commits, opens a pull request with only kit's files for you to merge. Which steps run for each starting state: [init.md → `josh init` or `josh start`](../init.md#josh-init-or-josh-start). Once the setup is on `main`, `kickoff new` works — see [tutorial.md](../tutorial.md).

Then make `main` require the checks the distributed workflows report — without a required check, a pull request with a failing one can still merge. Create a branch ruleset for `main` under Settings → Rules → Rulesets with **Require status checks to pass** turned on, then let kit fill in the list:

```bash
pnpm josh ruleset:check --apply
```

`pnpm josh ruleset:check` alone reports what is missing; [josh-commands-automation.md → `josh ruleset:check`](../josh-commands-automation.md#josh-rulesetcheck) lists the checks.

## 4. Keep it up to date

After upgrading the package, pull in updated AI files, workflow templates and other managed files with `pnpm exec josh sync` ([sync.md](../sync.md)); the full procedure is [Update kit](../how-to/update-kit.md). A project-local `josh` is available via `pnpm josh …` after installation, so the CLI works even without the global install.

## Next

- Make your first change with an agent: [without GitHub](../tutorial.md#without-github-one-change-checked-locally), or after `josh start` from Issue to merge with [tutorial.md](../tutorial.md).
- Task guides: [how-to.md](../how-to.md).
- Import the config presets and libraries directly: [package-api.md](../package-api.md), or wire them up without `josh init`: [manual-config.md](../manual-config.md).
- Full command reference: [josh-commands.md](../josh-commands.md).
- Want `josh` available everywhere? Install the [global CLI](../cli.md).
- Hitting an error? See [troubleshooting.md](../troubleshooting.md).
