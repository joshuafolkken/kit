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

| Environment                                                             | Status                                                                                                                                                                                                     |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS (Darwin 25.6.0), pnpm 12.10.1, kit 1.1240.0, Claude Code, `basic` | Step 3 verified — the agent read `index.html`, changed it, ran Prettier, read the title back in a browser and reported                                                                                     |
| Same, `full`                                                            | Step 3 verified — the agent added a unit test, ran `pnpm josh gate` and reported each check; it did not name the tests before editing                                                                      |
| Same, `full`, step 4 (`pnpm josh gate`)                                 | Fails at lint — ESLint stops on the `.gitignore` a project without Git does not have ([#3653](https://github.com/joshuafolkken/kit/issues/3653)); check, cspell, behavior, exports and the unit tests pass |
| Same, `full`, step 4 after `touch .gitignore`                           | Verified — lint reads the project's code and the gate passes all six checks                                                                                                                                |
| Linux and Windows                                                       | Not verified end to end                                                                                                                                                                                    |

## The basic profile setup

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
