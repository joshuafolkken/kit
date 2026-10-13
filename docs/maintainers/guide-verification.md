# How the user guides were verified

Maintainer-only record of how the step-by-step user guides were checked end to end, and what has not
been. The guides themselves carry only the steps; re-run the procedure here after a change to one of
them and update its table.

## The tutorial

[tutorial.md](../tutorial.md). The Issue that added the page
([#2714](https://github.com/joshuafolkken/kit/issues/2714)) was run with `fullrun` on this
repository, which exercised Pattern A's step 3: the gate went green and the pull request opened with
`closes #2714`.

| Environment                                                                   | Status                                                   |
| ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| macOS (Darwin 25.6.0), Node.js 25.3.0, pnpm 12.6.0, kit 1.947.0, Claude Code  | Pattern A step 3 (`fullrun`) verified on this repository |
| Pattern A steps 1–2 (`kickoff new`, `halfrun`) in a fresh practice repository | Not verified end to end                                  |
| Pattern B (`auto-ok` + `backlogrun`) in a fresh practice repository           | Not verified end to end                                  |
| Linux and Windows                                                             | Not verified end to end                                  |

### Without GitHub

The section [Without GitHub: one change, checked locally](../tutorial.md#without-github-one-change-checked-locally)
([#3630](https://github.com/joshuafolkken/kit/issues/3630)) was checked by running `josh init` in a
directory with no Git repository, then giving the step 2 prompt to a headless agent:

```bash
pnpm --allow-build=esbuild dlx @joshuafolkken/kit init
claude -p 'Change the page title to "Hello", then tell me what you checked.' --allowedTools "Read,Edit,Write,Glob,Grep,Bash"
```

A project with only `index.html` gets the `basic` profile; the `full` project also held
`src/main.ts`, one vitest test, and `typescript` and `vitest` as development dependencies.

| Environment                                                               | Status                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS (Darwin 25.6.0), pnpm 12.10.1, kit 1.1240.0, Claude Code, `basic`   | Step 3 verified — the agent read `index.html`, changed it, ran Prettier, read the title back in a browser and reported                                                                          |
| Same, `full`                                                              | Step 3 verified — the agent added a unit test, ran `pnpm josh gate` and reported each check; it did not name the tests before editing                                                           |
| Same, `full`, step 4 (`pnpm josh gate`), kit 1.1240.0                     | Failed at lint — ESLint stopped on the `.gitignore` a project without Git does not have; fixed by [#3653](https://github.com/joshuafolkken/kit/issues/3653)                                     |
| Same, `full`, step 4, kit linked from the #3653 checkout, no `.gitignore` | Verified — lint reads the project's code and passes, as do check, behavior, exports and the unit tests; cspell flagged only the local `link:` path the linked install wrote into `package.json` |
| Linux and Windows                                                         | Not verified end to end                                                                                                                                                                         |

## The basic profile setup

The container steps below are what `pnpm josh fresh:run kit-test-html-init` runs from the packed
checkout, with the log kept — [fresh-machine.md](./fresh-machine.md).

[setup/basic.md](../setup/basic.md). The guide is checked by running
[the prerequisites' step 2](../setup/prerequisites.md#2-install-pnpm-and-nodejs) and steps 2–3 of the
guide in a fresh container with no Git, no `~/.npmrc` and no Node.js. `buildpack-deps:bookworm-curl`
is a Debian image with curl and without Git. The pnpm installer reads `SHELL` to pick the profile it
edits, and a container does not set it:

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

For a project without Web files, replace `index.html` with, for example, `pyproject.toml` and
`main.py`; `josh init` then creates no `prettier.config.mjs`.

| Platform | Status                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Linux    | Verified — Debian bookworm, pnpm 12.6.0, Node.js 22.23.3 (`index.html` and Python projects)                                |
| macOS    | Step 3 verified — pnpm 12.6.0, an empty `index.html` directory ([#2794](https://github.com/joshuafolkken/kit/issues/2794)) |
| Windows  | Not verified end to end                                                                                                    |

## Removing kit

[how-to/uninstall.md](../how-to/uninstall.md). `josh uninstall` is checked from a tarball of the
checkout, since the published package may not hold the command yet. The bare `package.json` is what
`pnpm dlx @joshuafolkken/kit init` writes before it installs kit:

```bash
pnpm pack --pack-destination /tmp/kit-pack
docker run --rm -it -e SHELL=/bin/bash -v /tmp/kit-pack:/kit:ro buildpack-deps:bookworm-curl bash
# inside the container
curl -fsSL https://get.pnpm.io/install.sh | sh - && source ~/.bashrc
pnpm runtime set node 22 -g
mkdir /site && cd /site && printf '<!doctype html><html><body><h1>Hello</h1></body></html>\n' > index.html
printf '{ "private": true }\n' > package.json
pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver /kit/joshuafolkken-kit-*.tgz
pnpm exec josh init
pnpm exec josh uninstall --yes
find . -path ./node_modules -prune -o -type f -print   # index.html, package.json, pnpm-lock.yaml, pnpm-workspace.yaml
cat package.json   # private, scripts.preinstall, scripts.josh, devDependencies.prettier
```

`package.json` holds exactly the four entries the command listed under **Review by hand**, and
`pnpm-workspace.yaml` is the one file under **Keep**. Run the command once per container: pnpm 12
drops kit from `node_modules` on the next `pnpm exec`, so a second `pnpm exec josh uninstall` ends
with `Command "josh" not found`.

The own-files scenario adds `notes.txt`, `style.css`, a `.prettierignore` and a `package.json` with a
`build` script before kit is installed, runs `pnpm exec josh init --profile basic` — a `package.json`
with scripts is otherwise detected as `full` — appends a line to `AGENTS.md`, and compares
`sha256sum` of the four files before and after. The git-hooks scenario uses
`buildpack-deps:bookworm-scm`, which has Git: `git init`, a `package.json` with `typescript`,
`src/main.ts`, `pnpm exec josh init --profile full`, and `ls .git/hooks` before and after.

| Environment                                                          | Status                                                                                                                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux (Debian bookworm), pnpm 12.11.2, Node.js 22.23.3, kit 1.1387.0 | Verified — only `index.html`: the preview without `--yes` removed nothing; `--yes` left `index.html`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` |
| Same, own files and an edited `AGENTS.md`, `--profile basic`         | Verified — `index.html`, `style.css`, `notes.txt` and `AGENTS.md` byte-identical; `.prettierignore` and the `build` script kept                               |
| Same, `buildpack-deps:bookworm-scm`, `--profile full`                | Verified — `.git/hooks` held `commit-msg`, `pre-commit`, `pre-push` after `josh init` and none after; `src/main.ts`, `.aikido` and `.eslintcache` remained    |
| macOS and Windows                                                    | Not verified end to end                                                                                                                                       |
