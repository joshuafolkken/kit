// The shell command a Claude Code hook is launched with, so it starts without a `pnpm` wrapper — and,
// for a consumer, without the `dist/josh.js` dispatcher re-spawning `tsx` for the hook's `.ts`.
// Each hook is pre-built to its own `dist/hooks/<name>.js`
// (`scripts/build/build-hooks.ts`) and launched directly with `node`.
//
// **The command only names the launcher by its absolute path**; everything else — the move to the
// project root, the launch directory a worktree hook needs, the git location variables a git hook
// leaks — lives once in `scripts/hooks/run-hook.sh`. Claude Code names the root in
// `CLAUDE_PROJECT_DIR`, so its hooks start no `git` to find the launcher. Codex runs a hook in the
// session's directory and names no root, so `.codex/hooks.json` asks git — first without the two
// variables that place a checkout, since a relative or foreign `GIT_DIR` read from a subdirectory names
// the wrong work tree, and with them only when the checkout does not resolve without them (its metadata
// lives outside the work tree). The lookup is scoped to its subshell; the hook's own environment is the
// launcher's to clear.

const HOOK_DIST_DIR = 'dist/hooks'
const RUN_HOOK_SCRIPT = 'scripts/hooks/run-hook.sh'
const ROOT_LOOKUP = 'git rev-parse --show-toplevel'
const CLAUDE_ROOT = '$CLAUDE_PROJECT_DIR'
const CODEX_ROOT = `$( (unset GIT_DIR GIT_WORK_TREE; ${ROOT_LOOKUP} 2>/dev/null) || ${ROOT_LOOKUP})`

// A path under `root` as a hook command names it: quoted, so a root with spaces stays one word.
function rooted_path(root: string, relative_path: string): string {
	return `"${root}/${relative_path}"`
}

// `name` is the hook's bundle under `dist/hooks` without `.js` (e.g. `pretool-guard`), followed by any
// arguments it takes (e.g. `codex-hook-adapter pretool`).
function hook_launch_command(name: string, root = CLAUDE_ROOT): string {
	return `sh ${rooted_path(root, RUN_HOOK_SCRIPT)} ${name}`
}

// The same command as Codex runs it, which names no root.
function codex_command(command: string): string {
	return command.split(`"${CLAUDE_ROOT}/`).join(`"${CODEX_ROOT}/`)
}

// The josh subcommand the launcher falls back to for hook `name`: its first `-` becomes `:`
// (`pretool-guard` → `pretool:guard`). The launcher derives it in shell; this is that rule for the tests
// that hold every wired hook to a subcommand josh has.
function fallback_command(name: string): string {
	return name.replace('-', ':')
}

const hook_launch = {
	CLAUDE_ROOT,
	codex_command,
	CODEX_ROOT,
	fallback_command,
	HOOK_DIST_DIR,
	hook_launch_command,
	rooted_path,
	RUN_HOOK_SCRIPT,
}

export { hook_launch }
