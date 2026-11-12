# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| Older   | :x:                |

Fixes ship in a new release rather than as patches to older versions; upgrade to the latest release to receive them. Each release's changes are listed on the [Releases](https://github.com/joshuafolkken/kit/releases) page.

## Reporting a Vulnerability

If you discover a security vulnerability, please do not report it publicly.

- **Preferred**: Open a [draft security advisory](https://github.com/joshuafolkken/kit/security/advisories/new) on GitHub.
- **Alternative**: Email [joshuafolkken@gmail.com](mailto:joshuafolkken@gmail.com) directly.

We aim to acknowledge reports within **48 hours** and provide a resolution or mitigation plan within **7 days** for confirmed vulnerabilities.

## Published Package Contents

The `files` field of `package.json` decides what the published `@joshuafolkken/kit` package contains. None of it carries credentials or private URLs. `josh init` and `josh sync` copy or merge part of it into a project; [sync.md](https://github.com/joshuafolkken/kit/blob/main/docs/sync.md) lists which files are overwritten and which are merged.

**Code that runs on your machine and in CI**

- `dist/`, `scripts/` — the `josh` command and the scripts behind it. They read and write files in your repository, run `git`, `gh` and `pnpm`, and call the GitHub API and, when configured, the Telegram API.
- `.claude/settings.json` — Claude Code hooks that run `pnpm josh …` commands on session start, on each prompt, before and after tool calls and on stop, plus a deny list for staging, committing, merging, force pushes, branch deletions and reads of `.env`, `.env.*` (except the tracked `.env.example` and `.env.test`), `.dev.vars` and the credential files `~/.config/gh/**`, `~/.codex/auth.json`, `~/.netrc` and `~/.ssh/**`; the `pretool-guard` hook refuses the same reads through a shell reader, and of `~/.curlrc` and `~/.npmrc` too. The deny list and the `pretool-guard` hook are a guardrail, not a sandbox: another spelling of the same action (a git command inside `bash -c '…'`, a script that opens the file itself) gets through, and an instruction planted in text the agent reads can run with your permissions; the section linked below describes these limits and what keeps them small. It allows `Bash(*)` and ships no `permissions.defaultMode`, which Claude Code v2.1.257 and later ignore in a project settings file; the distributed `.vscode/settings.json` turns the VS Code extension's prompts off — an opt-out default, described in [`docs/init.md` → "Claude Code permission mode"](https://github.com/joshuafolkken/kit/blob/main/docs/init.md#claude-code-permission-mode).
- `.codex/` — the same hooks for Codex (`hooks.json`) and its project settings (`config.toml`).
- `.github/` — GitHub Actions workflows (CI, tagging, pull request classification, Dependabot auto-merge, SonarQube and production), composite actions, `dependabot.yml`, the pull request template and the release-notes config. `josh sync` overwrites the distributed workflows; their action references are pinned to commit SHAs. kit's own `publish.yml` ships in the package but is never copied into a project.
- `lefthook/` — Git hook presets: lint before commit, checks before push.
- The `preinstall` script `josh init` adds to `package.json` is a `node -e` check that fetches nothing and only prints a warning — outside CI, when safe-chain is not scanning the install (see [Installing safe-chain](#installing-safe-chain)). The `prepare` script it adds runs `lefthook install` when Lefthook is present, then, when tsx is present, kit's `fix-gh-packages` script: only when the project `.npmrc` routes a scope to GitHub Packages, it reads a GitHub token (`NODE_AUTH_TOKEN`, a token in the project `.npmrc`, or `gh auth token`), queries GitHub Packages and rewrites tarball URLs in `pnpm-lock.yaml`.
- `.pnpmfile.mjs` — a pnpm `beforePacking` hook that removes that safe-chain `preinstall` from the manifest `pnpm pack` and `pnpm publish` write, and changes nothing else. `josh init` and `josh sync` copy it only into a project whose `package.json` is not `private: true`, and never over a pnpmfile of the project's own.

**Agent instructions and skills**

- `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules`, `prompts/` — the rules and procedures AI agents follow.
- `.claude/skills/`, `.claude/.claude-plugin/`, `.claude-plugin/` — the Claude Code skills, shipped as the `kit` plugin and its marketplace entry.
- `.claude/agents/` — the Claude Code subagent definitions (the `investigator` and the `reviewer`), shipped beside the skills. The `investigator` is granted no `Edit` / `Write` tool, but it is granted `Bash`, so its read-only scope is an instruction in its prompt rather than a tool restriction — a dispatched unit can run any shell command the parent session's permissions allow. The `reviewer` is granted `Edit`, `Write` and `Bash` so a review can apply its fixes, and no `Agent` / `Skill` tool, so it cannot launch another agent.
- `.mcp.json` — the MCP server configuration for the Svelte documentation server. It contains only the public endpoint `https://mcp.svelte.dev/mcp`.
- `.coderabbit.yaml` — CodeRabbit review settings.

**Configuration presets and templates**

- `eslint/`, `prettier/`, `tsconfig/`, `cspell/`, `env/`, `ports/`, `playwright.config.ts`, `tsconfig.sonar.json` — shared configuration your project imports or receives.
- `templates/` — the templates `josh init` and `josh sync` write from.
- `.vscode/`, `.gitattributes`, `.prettierignore`, `pnpm-workspace.yaml` — editor, Git and package-manager settings.
- `CODE_OF_CONDUCT.md`, `SECURITY.md` — community files.

## Installing safe-chain

[safe-chain](https://github.com/AikidoSec/safe-chain) scans a local `pnpm install` for malware once its shell integration is active. The `preinstall` script only warns when it is not; it never installs safe-chain itself. Install it from a release whose installer hash you have checked — the same release and SHA-256 kit's CI uses, pinned as `SAFE_CHAIN_INSTALLER_VERSION` and `SAFE_CHAIN_INSTALLER_SHA256` in [`.github/actions/setup-pnpm/action.yml`](https://github.com/joshuafolkken/kit/blob/main/.github/actions/setup-pnpm/action.yml):

```sh
version=<SAFE_CHAIN_INSTALLER_VERSION>
sha256=<SAFE_CHAIN_INSTALLER_SHA256>
curl --proto '=https' -fsSL "https://github.com/AikidoSec/safe-chain/releases/download/$version/install-safe-chain.sh" -o install-safe-chain.sh
echo "$sha256  install-safe-chain.sh" | shasum -a 256 -c -
sh install-safe-chain.sh
```

Stop if `shasum` does not print `install-safe-chain.sh: OK`. Then restart your terminal; if the warning still appears, run `safe-chain setup` and restart it again.

The shell integration wraps every `pnpm` call, `pnpm josh …` included, which costs about 0.25 s per call and adds up across an agent's many josh runs. `pnpm josh` installs nothing, and the `pnpm` calls josh makes itself are child processes that never pass through a shell function, so exempting it loses no protection. In `~/.zshrc`, after the line safe-chain added:

```sh
pnpm() { [ "$1" = josh ] && { command pnpm "$@"; return; }; wrapSafeChainCommand pnpm "$@"; }
```

`pnpm install`, `pnpm add` and every other subcommand still go through safe-chain.

## Secrets

kit never stores a secret in a file it ships or commits. The ones it uses:

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — Telegram notifications. Keep them in a local `.env` file, which is gitignored, or in the environment. Set `JOSH_NOTIFY=off` to need neither.
- `SONAR_TOKEN` — a repository secret the distributed SonarQube workflow reads. Without it the workflow skips the scan.
- `GITHUB_TOKEN` — supplied by GitHub Actions to the distributed workflows; nothing to configure.
- `GH_TOKEN` — authenticates `gh` in CI and cloud sessions, where `gh auth login` is not available.
- `NODE_AUTH_TOKEN` — the GitHub Packages credential, only for projects that still install kit from there ([authentication.md](https://github.com/joshuafolkken/kit/blob/main/docs/authentication.md)). The `prepare` script above reads it.

An unattended agent runs with `Bash(*)`, so an instruction planted in text it reads could send one of these off the machine. The `egress` guard row (`scripts/rules/egress-guard.ts`) refuses an agent's `Bash` call that reaches another host (`curl`, `wget`, `nc`, `ssh`, `scp`, a remote `rsync`, a network call in an inline `node -e` / `python -c` script, `gh` sent to a host other than github.com) or prints a credential (`gh auth token`, `printenv`, a bare `env`, a `*TOKEN*` / `*SECRET*` / `*KEY*` variable, a keychain secret through `security find-generic-password` / `find-internet-password` / `dump-keychain` / `export` or `security -i`), nested in `bash -c`, `eval` or `$(…)` as well. The same row refuses a direct `gh` write against github.com: a subcommand other than `browse`, `search`, `status` or a read action (`view`, `list`, `diff`, `checks`, …), a `gh api graphql` call that merges a pull request or writes to another owner's repository, and any other `gh api` call with a non-`GET` method or a field flag (`-f`, `-F`, `--input`) (`scripts/rules/shell-permissions.ts` → `is_gh_write`). Writes go through the `pnpm josh` routes instead — `issue:file`, `issue:comment`, `issue:priority`, `git`, `pr` — or the user runs them. `gh` reads against github.com, `git` and `pnpm` stay allowed. `.claude/settings.json` denies `curl`, `wget`, `nc`, `gh auth token` and `printenv` as a static backstop for when the hook does not run, so a plain `curl` / `wget` is refused even to localhost; the hook's localhost / GitHub allowance covers only the spellings that deny list does not reach (a nested or wrapped call).

## MCP External Endpoints

This project ships `.mcp.json` which connects to external MCP servers at runtime (e.g. `https://mcp.svelte.dev/mcp`). These servers are treated as trusted third-party services. Consumers should be aware that:

- MCP tool responses from external servers are not sandboxed — treat them as you would any external API call.
- If the external endpoint is compromised or returns malicious content, the AI agent executing the tool may act on it.
- Review and pin the MCP server URL before deploying in sensitive environments.
