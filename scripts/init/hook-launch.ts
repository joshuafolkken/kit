// The shell command a Claude Code hook is launched with, so it starts without a `pnpm` wrapper — and,
// for a consumer, without the `dist/josh.js` dispatcher re-spawning `tsx` for the hook's `.ts`.
// Each hook is pre-built to its own `dist/hooks/<name>.js`
// (`scripts/build/build-hooks.ts`) and launched directly with `node`.
//
// **The command starts from the project root, never from wherever the session happens to be**.
// Every path after the prefix is relative, so a hook fired from a subdirectory would otherwise miss its
// script. Claude Code names the root in `CLAUDE_PROJECT_DIR`, so its hooks start no `git` to find it;
// Codex runs a hook in the session's directory and names no root, so there the root is git's — asked
// first without the git location variables a git hook leaks, since a relative or bare `GIT_DIR` read
// from a subdirectory names the wrong work tree, and with them only when the checkout does not resolve
// without them (its metadata lives outside the work tree). A lookup that fails ends the command before
// the launcher (joshuafolkken/kit#4187).
//
// **Everything after the root is one script** (`scripts/hooks/run-hook.sh`): the git location
// variables a git hook exports, the bundle-ready gate and the live-source fallback live there once, so
// each hook command names only its hook. The consumer rewrite (`hook-command-rewrite.ts`) keeps this
// prefix, so both sides stay one mechanism for Claude Code and Codex alike.

import { GIT_LOCATION_VARIABLES } from '#scripts/git/git-location-environment'

const HOOK_DIST_DIR = 'dist/hooks'
const RUN_HOOK_SCRIPT = 'scripts/hooks/run-hook.sh'
const ROOT_LOOKUP = 'git rev-parse --show-toplevel'
const CODEX_ROOT = `$( (unset ${GIT_LOCATION_VARIABLES.join(' ')}; ${ROOT_LOOKUP} 2>/dev/null) || ${ROOT_LOOKUP})`
const PROJECT_ROOT_PREFIX = `project_root="\${CLAUDE_PROJECT_DIR:-${CODEX_ROOT}}" && cd "$project_root" && `

// `name` is the hook's bundle under `dist/hooks` without `.js` (e.g. `pretool-guard`), followed by any
// arguments it takes (e.g. `codex-hook-adapter pretool`).
function hook_launch_command(name: string): string {
	return `${PROJECT_ROOT_PREFIX}sh ${RUN_HOOK_SCRIPT} ${name}`
}

// The josh subcommand the launcher falls back to for hook `name`: its first `-` becomes `:`
// (`pretool-guard` → `pretool:guard`). The launcher derives it in shell; this is that rule for the tests
// that hold every wired hook to a subcommand josh has.
function fallback_command(name: string): string {
	return name.replace('-', ':')
}

const hook_launch = {
	fallback_command,
	HOOK_DIST_DIR,
	hook_launch_command,
	PROJECT_ROOT_PREFIX,
	RUN_HOOK_SCRIPT,
}

export { hook_launch }
