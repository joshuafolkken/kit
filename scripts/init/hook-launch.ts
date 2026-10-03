import { GIT_LOCATION_VARIABLES } from '#scripts/git/git-location-environment'

// The shell command a Claude Code hook is launched with, so it starts without a `pnpm` wrapper — and,
// for a consumer, without the `dist/josh.js` dispatcher re-spawning `tsx` for the hook's `.ts`
// (joshuafolkken/kit#2023). Each hook is pre-built to its own `dist/hooks/<name>.js`
// (`scripts/build/build-hooks.ts`) and launched directly with `node`.
//
// **The command starts from the project root, never from wherever the session happens to be**
// (joshuafolkken/kit#2984). Every path after the prefix is relative, so a hook fired from a
// subdirectory would otherwise miss its bundle. The root is git's, with the location variables a git
// hook exports cleared first — the same resolution the consumer rewrite (`hook-command-rewrite.ts`)
// applies, so both sides stay one mechanism for Claude Code and Codex alike.
//
// **The bundle runs only once the ready gate passes** (`scripts/hooks/hook-bundle-ready.ts`): it
// rebuilds `dist/hooks/` when the source beside it has changed, so an edited guard is never shadowed by
// its old bundle. The gate failing — a checkout that cannot build — drops to the fallback, the live
// source. **An `if`/`else`, never `&&`/`||`**: a guard's refusal is a non-zero exit, and a
// `node … || pnpm josh …` chain would read that refusal as a missing bundle and run the hook twice.

const HOOK_DIST_DIR = 'dist/hooks'
const UNSET_OPTIONS = GIT_LOCATION_VARIABLES.map((name) => `-u ${name}`).join(' ')
const PROJECT_ROOT_PREFIX = `if project_root="$(env ${UNSET_OPTIONS} git rev-parse --show-toplevel 2>/dev/null)"; then unset ${GIT_LOCATION_VARIABLES.join(' ')}; else project_root="$(git rev-parse --show-toplevel)" || exit 1; fi; cd "$project_root" && `
// Plain `node` runs the gate's TypeScript directly; the flag keeps Node 22's type-stripping notice off
// every hook's stderr.
const BUNDLE_READY_GATE =
	'node --disable-warning=ExperimentalWarning scripts/hooks/hook-bundle-ready.ts'

// Run `primary_command` when `gate` exits 0, else `fallback_command` — both verbatim. Kept generic so
// a test can exercise the branch selection with stub commands rather than real hooks.
function launch_command(gate: string, primary_command: string, fallback_command: string): string {
	return `if ${gate}; then ${primary_command}; else ${fallback_command}; fi`
}

// `invocation` is the hook's file under `dist/hooks` plus any arguments (e.g. `pretool-guard.js`);
// `fallback_command` runs the same hook from source.
function bundle_launch_command(invocation: string, fallback_command: string): string {
	const primary = `node ${HOOK_DIST_DIR}/${invocation}`

	return `${PROJECT_ROOT_PREFIX}${launch_command(BUNDLE_READY_GATE, primary, fallback_command)}`
}

// `bundle` is the hook's file under `dist/hooks` (e.g. `pretool-guard.js`); `command` is the josh
// subcommand the fallback runs (e.g. `pretool:guard`).
function hook_launch_command(bundle: string, command: string): string {
	return bundle_launch_command(bundle, `pnpm josh ${command}`)
}

const hook_launch = {
	BUNDLE_READY_GATE,
	bundle_launch_command,
	HOOK_DIST_DIR,
	hook_launch_command,
	launch_command,
	PROJECT_ROOT_PREFIX,
}

export { hook_launch }
