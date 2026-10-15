# Set up the basic profile

The `josh init` path for the `basic` [profile](../init.md#project-profiles) — the detailed version of path B, "Without GitHub", in the [Quick start](../../README.md#quick-start). Its path A, "With GitHub", runs `josh start` instead, for a project that will use the GitHub Issue workflow; [init.md → `josh init` or `josh start`](../init.md#josh-init-or-josh-start) decides which applies. This guide takes a directory that holds only an `index.html` file — or a Python, Rust or other project without Web files — from an empty machine to a formatted, verified project. It needs no Git repository, no GitHub account and no npm token; only the optional GitHub Issue workflow at the end of step 3 needs Git and GitHub. For a JavaScript / TypeScript project, see [Set up the full profile](./full.md).

## 1. Install the prerequisites

kit needs the Node.js and pnpm versions [Install the prerequisites](./prerequisites.md) lists. That page checks what you have and installs what is missing; its gh CLI step is only for the optional GitHub Issue workflow.

## 2. Install kit and initialize

In the project directory:

```bash
pnpm --allow-build=esbuild dlx @joshuafolkken/kit init
```

`pnpm dlx` fetches kit from the public npm registry without authentication and runs its `josh init`; `--allow-build=esbuild` approves the build script of esbuild, which kit's CLI runs on. That kit only starts the setup: it adds `@joshuafolkken/kit` to the project — creating `package.json` if the directory has none, and approving the esbuild and unrs-resolver build scripts kit's dependencies carry — then hands the run to the `josh init` of the kit it just added. So the kit that sets the project up is the one pnpm picked for the project, even when `dlx` ran an older copy from its cache ([init.md → Run from outside the project](../init.md#run-from-outside-the-project)). pnpm 12 skips releases published less than a day ago by default (`minimumReleaseAge`), so right after a kit release the project gets the previous version.

`josh init` selects the `basic` profile and records it in `package.json`. It creates only:

| File                                                                                           | When                                                                                                                    |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules`                                          | Always — short AI assistant instructions                                                                                |
| `.vscode/extensions.json`                                                                      | Always — recommendations, not installs                                                                                  |
| `pnpm-workspace.yaml`                                                                          | Always — approves the esbuild and unrs-resolver build scripts                                                           |
| `package.json` scripts `preinstall` and `josh`                                                 | Always                                                                                                                  |
| `prettier.config.mjs`, `.prettierignore`, `.vscode/settings.json`, Prettier                    | Only when HTML, CSS or JavaScript files exist and the project has no formatter of its own (`biome.json`, `dprint.json`) |
| `tsconfig.json`                                                                                | Only when TypeScript files exist                                                                                        |
| `.gitignore`, `.gitattributes`                                                                 | Only when the directory is a Git repository                                                                             |
| `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/pull_request_template.md`, `.github/release.yml` | Only when the Git repository has a GitHub `origin`                                                                      |

It then runs `pnpm install` and `josh format` for you, so the tools it listed are installed and every file is formatted. If the install fails, `josh init` stops before formatting, exits non-zero and prints the commands to re-run by hand. `--no-install` skips both steps, for CI or an offline machine; run `pnpm install` and `pnpm josh format` yourself afterwards.

It adds no ESLint, cspell, Playwright, Git hooks, GitHub workflows or external-service settings, and it creates no Git repository. Existing VS Code settings, such as a `[python]` section, are kept. See [init.md](../init.md#project-profiles) for how the profile is chosen.

**The `preinstall` script does not scan the `pnpm install` on your machine.** It fetches nothing; it only checks whether [safe-chain](https://github.com/AikidoSec/safe-chain) is scanning the install. To have local installs scanned for malware, install safe-chain with the hash-verified steps in kit's [SECURITY.md](https://github.com/joshuafolkken/kit/blob/main/SECURITY.md#installing-safe-chain), then restart your terminal; until then `preinstall` prints a warning pointing there and never blocks the install. Details: [init.md → Package scripts](../init.md#package-scripts).

## 3. Verify

```bash
pnpm josh gate
```

`josh gate` is not part of `josh init`, so a lint error in your own code is never mistaken for a failed setup. The `josh format` that `josh init` ran uses Prettier over every file type it supports — HTML, CSS and JavaScript, and also Markdown, JSON and YAML such as `CLAUDE.md` and `package.json`; running it again changes nothing. `josh gate` runs Prettier's check and skips each check the project does not have, printing why — for example `josh eslint: no ESLint configuration was found — skipping eslint, which this project does not use.` A project with no Web files has no Prettier, so both commands skip it with `josh prettier: no HTML, CSS or JavaScript files were found`. Nor does a project that formats with Biome or dprint, which both skip with `josh prettier: biome.json configures the project's own formatter`. The last line counts both: `✔ verification gate passed (1 ran, 5 skipped)` when a check ran, and `⚠ verification gate not verified (0 ran, 6 skipped)` when none did — nothing failed, and nothing was checked. The skipped count includes the two checks that have nothing of yours to look at (`exports`, and `behavior` with no transcript).

**The unit check runs the tests your project declares.** A `basic` project has no Vitest, so `josh gate` and `josh test:unit` run the `test` script in `package.json` instead — `pnpm run test` — whatever runner it starts (`node --test`, jest, mocha), and a failing test fails the gate:

| `package.json`                                                    | The unit check                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A `test` script                                                   | Runs it, and fails when it fails                                                                                   |
| No `test` script, an empty one, or the one `npm init` writes      | Skips: `josh test:unit: vitest is not installed and package.json declares no test script — skipping unit tests.`   |
| A `test` script that calls `josh test:unit` or `josh gate` itself | Skips inside that call, so the script does not start itself again                                                  |
| Vitest installed                                                  | Runs Vitest over `*.{test,spec}.{ts,js}` as in a `full` project; with no such file it skips, and `test` is not run |

`josh test:unit`'s filter arguments belong to Vitest, so your `test` script always runs whole.

Re-running `pnpm exec josh init` later leaves the files unchanged. **If the project will use the GitHub Issue workflow** (`kickoff`, `fullrun`, `backlogrun`), run `pnpm exec josh start` now — it needs the [gh CLI](https://cli.github.com/), signed in. It carries this setup to GitHub, creating what is missing — Git, the first commit, the repository. When the repository already has commits, commit what `josh init` wrote first: `josh start` refuses a working tree with uncommitted changes there, and opens a pull request with what its setup adds for you to merge. Its setup step also adds `.claude/settings.json` — the permissions, hooks and plugin the workflow's unattended agents run on — and records `josh.workflow` in `package.json`, so `josh sync` keeps that file merged ([init.md → Project profiles](../init.md#project-profiles)). Which steps run for each starting state: [init.md → `josh init` or `josh start`](../init.md#josh-init-or-josh-start).

## 4. Check the page in a browser

Open `index.html` in a browser and check the layout, links and any interaction at the screen widths you care about. kit does not require an automated browser test for each HTML change.

## Next

- Make your first change with an agent: [without GitHub](../tutorial.md#without-github-one-change-checked-locally), or after `josh start` from Issue to merge with [tutorial.md](../tutorial.md).
- Task guides: [how-to.md](../how-to.md).
- Not a fit? [Remove kit from a project](../how-to/uninstall.md).
- Hitting an error? See [troubleshooting.md](../troubleshooting.md).
