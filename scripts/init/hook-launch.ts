import { GIT_LOCATION_VARIABLES } from '#scripts/git/git-location-environment'

// The shell command a Claude Code hook is launched with, so it starts without a `pnpm` wrapper — and,
// for a consumer, without the `dist/josh.js` dispatcher re-spawning `tsx` for the hook's `.ts`.
// Each hook is pre-built to its own `dist/hooks/<name>.js`
// (`scripts/build/build-hooks.ts`) and launched directly with `node`.
//
// **The command starts from the project root, never from wherever the session happens to be**.
// Every path after the prefix is relative, so a hook fired from a
// subdirectory would otherwise miss its script. The root is git's, resolved with the location
// variables a git hook exports cleared first, and resolved with them only when that fails — git
// metadata outside the work tree. The consumer rewrite (`hook-command-rewrite.ts`) keeps this prefix,
// so both sides stay one mechanism for Claude Code and Codex alike.
//
// **Everything after the root is one script** (`scripts/hooks/run-hook.sh`):
// clearing the location variables for the hook itself, the bundle-ready gate and the live-source
// fallback live there once, so each hook command names only its hook.

const HOOK_DIST_DIR = 'dist/hooks'
const RUN_HOOK_SCRIPT = 'scripts/hooks/run-hook.sh'
const UNSET_OPTIONS = GIT_LOCATION_VARIABLES.map((name) => `-u ${name}`).join(' ')
const ROOT_LOOKUP = 'git rev-parse --show-toplevel'
const PROJECT_ROOT_PREFIX = `project_root="$(env ${UNSET_OPTIONS} ${ROOT_LOOKUP} 2>/dev/null || ${ROOT_LOOKUP})" && cd "$project_root" && `

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
