# Set up the basic profile

The detailed version of the [Quick start](../../README.md#quick-start) for the `basic` [profile](../init.md#project-profiles). It takes a directory that holds only an `index.html` file — or a Python, Rust or other project without Web files — from an empty machine to a formatted, verified project. It needs no Git repository, no GitHub account and no npm token; only the optional GitHub Issue workflow at the end of step 3 needs Git and GitHub. For a JavaScript / TypeScript project, see [Set up the full profile](./full.md).

## 1. Install the prerequisites

kit needs **Node.js 22.19.0 or later** and **pnpm 12 or later**. [Install the prerequisites](./prerequisites.md) checks what you have and installs what is missing; its gh CLI step is only for the optional GitHub Issue workflow.

## 2. Install kit and initialize

In the project directory:

```bash
pnpm --allow-build=esbuild dlx @joshuafolkken/kit init
```

`pnpm dlx` fetches kit from the public npm registry without authentication and runs its `josh init`; `--allow-build=esbuild` approves the build script of esbuild, which kit's CLI runs on. That kit only starts the setup: it adds `@joshuafolkken/kit` to the project — creating `package.json` if the directory has none, and approving the esbuild and unrs-resolver build scripts kit's dependencies carry — then hands the run to the `josh init` of the kit it just added. So the kit that sets the project up is the one pnpm picked for the project, even when `dlx` ran an older copy from its cache ([init.md → Run from outside the project](../init.md#run-from-outside-the-project)). pnpm 12 skips releases published less than a day ago by default (`minimumReleaseAge`), so right after a kit release the project gets the previous version.

`josh init` selects the `basic` profile and records it in `package.json`. It creates only:

| File                                                                                           | When                                                          |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules`                                          | Always — short AI assistant instructions                      |
| `.vscode/extensions.json`                                                                      | Always — recommendations, not installs                        |
| `pnpm-workspace.yaml`                                                                          | Always — approves the esbuild and unrs-resolver build scripts |
| `package.json` scripts `preinstall` and `josh`                                                 | Always                                                        |
| `prettier.config.mjs`, `.prettierignore`, `.vscode/settings.json`, Prettier                    | Only when HTML, CSS or JavaScript files exist                 |
| `tsconfig.json`                                                                                | Only when TypeScript files exist                              |
| `.gitignore`, `.gitattributes`                                                                 | Only when the directory is a Git repository                   |
| `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/pull_request_template.md`, `.github/release.yml` | Only when the Git repository has a GitHub `origin`            |

It then runs `pnpm install` and `josh format` for you, so the tools it listed are installed and every file is formatted. If the install fails, `josh init` stops before formatting, exits non-zero and prints the commands to re-run by hand. `--no-install` skips both steps, for CI or an offline machine; run `pnpm install` and `pnpm josh format` yourself afterwards.

It adds no ESLint, cspell, Playwright, Git hooks, GitHub workflows or external-service settings, and it creates no Git repository. Existing VS Code settings, such as a `[python]` section, are kept. See [init.md](../init.md#project-profiles) for how the profile is chosen.

**The `preinstall` script does not scan the `pnpm install` on your machine.** It runs [safe-chain](https://github.com/AikidoSec/safe-chain)'s `setup-ci`, which only acts on a CI runner. To have local installs scanned for malware, install safe-chain as its [README](https://github.com/AikidoSec/safe-chain#installation) describes (or run `safe-chain setup` if it is already installed), then restart your terminal; until then `preinstall` prints a warning with these steps and never blocks the install. Details: [init.md → Package scripts](../init.md#package-scripts).

## 3. Verify

```bash
pnpm josh gate
```

`josh gate` is not part of `josh init`, so a lint error in your own code is never mistaken for a failed setup. The `josh format` that `josh init` ran uses Prettier over every file type it supports — HTML, CSS and JavaScript, and also Markdown, JSON and YAML such as `CLAUDE.md` and `package.json`; running it again changes nothing. `josh gate` runs Prettier's check and skips each check the project does not have, printing why — for example `josh eslint: no ESLint configuration was found — skipping eslint.` A project with no Web files has no Prettier, so both commands skip it with `josh prettier: no HTML, CSS or JavaScript files were found`.

Re-running `pnpm exec josh init` later leaves the files unchanged. **If the project will use the GitHub Issue workflow** (`kickoff`, `fullrun`, `backlogrun`), run `pnpm exec josh start` now — it needs the [gh CLI](https://cli.github.com/), signed in. It leaves this setup as it is and carries it to GitHub: it creates what is missing — Git, the first commit, the repository — and, when `main` already has commits, opens a pull request with only kit's files for you to merge. Which steps run for each starting state: [init.md → `josh init` or `josh start`](../init.md#josh-init-or-josh-start).

## 4. Check the page in a browser

Open `index.html` in a browser and check the layout, links and any interaction at the screen widths you care about. kit does not require an automated browser test for each HTML change.

## Next

- Make your first change with an agent, from Issue to merge: [tutorial.md](../tutorial.md).
- Task guides: [how-to.md](../how-to.md).
- Hitting an error? See [troubleshooting.md](../troubleshooting.md).

## Verifying this guide

The guide is checked by running [the prerequisites' step 2](./prerequisites.md#2-install-pnpm-and-nodejs) and steps 2–3 here in a fresh container with no Git, no `~/.npmrc` and no Node.js. `buildpack-deps:bookworm-curl` is a Debian image with curl and without Git. The pnpm installer reads `SHELL` to pick the profile it edits, and a container does not set it:

```bash
docker run --rm -it -e SHELL=/bin/bash buildpack-deps:bookworm-curl bash
# inside the container
curl -fsSL https://get.pnpm.io/install.sh | sh - && source ~/.bashrc
pnpm runtime set node 22 -g
mkdir /site && cd /site && printf '<!doctype html><html><body><h1>Hello</h1></body></html>\n' > index.html
pnpm --allow-build=esbuild dlx @joshuafolkken/kit init
pnpm josh gate
ls -A   # no .git, .github or lefthook.yml
```

For a project without Web files, replace `index.html` with, for example, `pyproject.toml` and `main.py`; `josh init` then creates no `prettier.config.mjs`.

| Platform | Status                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Linux    | Verified — Debian bookworm, pnpm 12.6.0, Node.js 22.23.3 (`index.html` and Python projects)                                |
| macOS    | Step 3 verified — pnpm 12.6.0, an empty `index.html` directory ([#2794](https://github.com/joshuafolkken/kit/issues/2794)) |
| Windows  | Not verified end to end                                                                                                    |
