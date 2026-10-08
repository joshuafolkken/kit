# Install the prerequisites

The tools the [Quick start](../../README.md#quick-start) needs: **Node.js 22.19.0 or later in the 22 line, any 24 release, or 26 and later (Node 25 is not supported)** and **pnpm 12 or later** for every project, and the **gh CLI** for the GitHub Issue workflow (`josh start`, `kickoff`, `fullrun`, `backlogrun`). Then continue with [Set up the full profile](./full.md) for a JavaScript / TypeScript project or [Set up the basic profile](./basic.md) for anything else.

## 1. Check what you have

```bash
node --version   # v22.19.0+ in the 22 line, v24, or v26+
pnpm --version   # 12 or later
gh --version     # any version — only for the GitHub Issue workflow
```

This guide was verified with pnpm 12.6.0; older pnpm releases may lack the commands and options kit uses. If every command you need prints a version that meets the requirement, keep what you have. kit never installs or replaces a machine-wide Node.js, pnpm or gh. If `pnpm` is older than 12, update it yourself with `pnpm self-update`; if `node` is older, install a newer release with the same route you used before, or with `pnpm runtime set node 22 -g` from step 2. A project that pins a pnpm other than yours does not need that version installed — if its commands refuse to run, [Troubleshooting → Wrong Node or pnpm version](../troubleshooting.md#wrong-node-or-pnpm-version) shows how to let pnpm fetch the pinned version.

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

## 3. Install and sign in to the gh CLI

Skip this step when the project will not use the GitHub Issue workflow.

- **macOS:** `brew install gh`
- **Windows:** `winget install --id GitHub.cli`
- **Linux:** follow the package-manager instructions on the [gh installation page](https://github.com/cli/cli#installation).

Then sign in once per machine:

```bash
gh auth login
gh auth status
```

`josh start` and the workflow keywords call GitHub through `gh`, so they stop with an error until `gh auth status` reports a signed-in account. Hitting an error? See [troubleshooting.md](../troubleshooting.md).
