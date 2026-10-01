# Getting started without Git or a Node project

This guide takes a directory that holds only an `index.html` file — or a Python, Rust or other project without Web files — from an empty machine to a formatted, verified project. It needs no Git repository, no GitHub account and no npm token. For an existing Node project, see [package.md](./package.md).

## 1. Check the prerequisites

kit needs **Node.js 22.19.0 or later** and **pnpm 12 or later**. This guide was verified with pnpm 12.6.0; older pnpm releases may lack the commands and options it uses.

```bash
node --version   # v22.19.0 or later
pnpm --version   # 12 or later
```

If both commands print a version that meets the requirement, keep what you have and go to [step 3](#3-install-kit-and-initialize). kit never installs or replaces a machine-wide Node.js or pnpm. If `node` or `pnpm` is missing, follow step 2 for your operating system. If `pnpm` is older than 12, update it yourself with `pnpm self-update`; if `node` is older, install a newer release with the same route you used before, or with `pnpm runtime set node 22 -g` from step 2.

## 2. Install pnpm and Node.js

Each route below is the tool's own official installer. Use one route per machine.

### Linux and macOS

Install pnpm with its standalone script, which does not need Node.js, then let pnpm install Node.js:

```bash
curl -fsSL https://get.pnpm.io/install.sh | sh -
# open a new terminal, or load the lines the script appended to your shell profile
pnpm runtime set node 22 -g
node --version
```

On macOS, `brew install pnpm` followed by the same `pnpm runtime set node 22 -g` also works if you use Homebrew. See the [pnpm installation page](https://pnpm.io/installation) for other routes.

### Windows

pnpm's standalone Windows executable can be flagged by antivirus software ([pnpm installation page](https://pnpm.io/installation)). Install Node.js first instead, then pnpm:

1. Install the Node.js 22 LTS release from [nodejs.org](https://nodejs.org/en/download), or run `winget install OpenJS.NodeJS.LTS` in PowerShell.
2. Open a new PowerShell window and run:

```powershell
npm install -g pnpm
node --version
pnpm --version
```

## 3. Install kit and initialize

In the project directory:

```bash
pnpm --allow-build=esbuild dlx @joshuafolkken/kit init
```

`pnpm dlx` fetches kit from the public npm registry without authentication and runs its `josh init`; `--allow-build=esbuild` approves the build script of esbuild, which kit's CLI runs on. That kit only starts the setup: it adds `@joshuafolkken/kit` to the project — creating `package.json` if the directory has none, and approving the esbuild and unrs-resolver build scripts kit's dependencies carry — then hands the run to the `josh init` of the kit it just added. So the kit that sets the project up is the one pnpm picked for the project, even when `dlx` ran an older copy from its cache ([init.md → Run from outside the project](./init.md#run-from-outside-the-project)). pnpm 12 skips releases published less than a day ago by default (`minimumReleaseAge`), so right after a kit release the project gets the previous version.

`josh init` selects the `static` profile and records it in `package.json`. It creates only:

| File                                                                        | When                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules`                       | Always — short AI assistant instructions                      |
| `.vscode/extensions.json`                                                   | Always — recommendations, not installs                        |
| `pnpm-workspace.yaml`                                                       | Always — approves the esbuild and unrs-resolver build scripts |
| `package.json` scripts `preinstall` and `josh`                              | Always                                                        |
| `prettier.config.mjs`, `.prettierignore`, `.vscode/settings.json`, Prettier | Only when HTML, CSS or JavaScript files exist                 |
| `tsconfig.json`                                                             | Only when TypeScript files exist                              |

It then runs `pnpm install` and `josh format` for you, so the tools it listed are installed and every file is formatted. If the install fails, `josh init` stops before formatting, exits non-zero and prints the commands to re-run by hand. `--no-install` skips both steps, for CI or an offline machine; run `pnpm install` and `pnpm josh format` yourself afterwards.

It adds no ESLint, cspell, Playwright, Git hooks, GitHub workflows or external-service settings, and it creates no Git repository. Existing VS Code settings, such as a `[python]` section, are kept. See [init.md](./init.md#project-profiles) for how the profile is chosen.

The `preinstall` script runs [safe-chain](https://github.com/AikidoSec/safe-chain)'s `setup-ci`, which creates command shims under `~/.safe-chain` and adds them to `PATH` on a CI runner only. **It does not scan the `pnpm install` on your machine** — neither the one that runs it nor any later one. To have local installs scanned for malware, enable safe-chain's shell integration yourself: install safe-chain as its [README](https://github.com/AikidoSec/safe-chain#installation) describes (or run `safe-chain setup` if it is already installed), then restart your terminal. kit never changes your shell configuration for you. Until the integration is active, `preinstall` prints a warning with these steps; the install itself is never blocked, and the warning stays silent on CI.

CI installs are scanned by the workflow itself, not by `preinstall`: each job's "Setup safe-chain" step downloads safe-chain's release installer, checks its SHA-256 and runs it with `--ci`, which puts the `safe-chain` binary on `PATH` beside its shims ([#2711](https://github.com/joshuafolkken/kit/issues/2711)). The release and the hash are the `SAFE_CHAIN_INSTALLER_VERSION` / `SAFE_CHAIN_INSTALLER_SHA256` env at the top of `ci.yml` and of `pr-classification.yml`, which carry the same pin ([#2765](https://github.com/joshuafolkken/kit/issues/2765)).

## 4. Verify

```bash
pnpm josh gate
```

`josh gate` is not part of `josh init`, so a lint error in your own code is never mistaken for a failed setup. The `josh format` that `josh init` ran uses Prettier over every file type it supports — HTML, CSS and JavaScript, and also Markdown, JSON and YAML such as `CLAUDE.md` and `package.json`; running it again changes nothing. `josh gate` runs Prettier's check and skips each check the project does not have, printing why — for example `josh eslint: no ESLint configuration was found — skipping eslint.` A project with no Web files has no Prettier, so both commands skip it with `josh prettier: no HTML, CSS or JavaScript files were found`.

Re-running `pnpm exec josh init` later leaves the files unchanged.

## 5. Check the page in a browser

Open `index.html` in a browser and check the layout, links and any interaction at the screen widths you care about. kit does not require an automated browser test for each HTML change.

## Next

- Make your first change with an agent, from Issue to merge: [tutorial.md](./tutorial.md).
- Task guides: [how-to.md](./how-to.md).

## Verifying this guide

The guide is checked by running steps 2–4 in a fresh container with no Git, no `~/.npmrc` and no Node.js. `buildpack-deps:bookworm-curl` is a Debian image with curl and without Git. The pnpm installer reads `SHELL` to pick the profile it edits, and a container does not set it:

```bash
docker run --rm -it -e SHELL=/bin/bash buildpack-deps:bookworm-curl bash
# inside the container
curl -fsSL https://get.pnpm.io/install.sh | sh - && source ~/.bashrc
pnpm runtime set node 22 -g
mkdir /site && cd /site && printf '<!doctype html><html><body><h1>Hello</h1></body></html>\n' > index.html
pnpm --allow-build=esbuild dlx @joshuafolkken/kit init
pnpm josh format && pnpm josh gate
ls -A   # no .git, .github or lefthook.yml
```

For a project without Web files, replace `index.html` with, for example, `pyproject.toml` and `main.py`; `josh init` then creates no `prettier.config.mjs`.

| Platform | Status                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Linux    | Verified — Debian bookworm, pnpm 12.6.0, Node.js 22.23.3 (`index.html` and Python projects)                                |
| macOS    | Step 3 verified — pnpm 12.6.0, an empty `index.html` directory ([#2794](https://github.com/joshuafolkken/kit/issues/2794)) |
| Windows  | Not verified end to end                                                                                                    |
