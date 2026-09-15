// The shell command a Claude Code hook is launched with, so it starts without a `pnpm` wrapper — and,
// for a consumer, without the `dist/josh.js` dispatcher re-spawning `tsx` for the hook's `.ts`
// (joshuafolkken/kit#2023). Each hook is pre-built to its own `dist/hooks/<name>.js`
// (`scripts/build/build-hooks.ts`) and launched directly with `node`.
//
// **The fallback is a real branch, not a courtesy.** A fresh clone has no `dist/hooks/` until
// `pnpm build` runs, so the command prefers the bundle and drops to `pnpm josh <command>` (the live
// `tsx` source) when the bundle is absent, rather than passing silently. **An `if`/`else`, never
// `&&`/`||`**: a guard's refusal is a non-zero exit, and a `node … || pnpm josh …` chain would read
// that refusal as a missing bundle and run the hook twice. `[ -f ]` decides on the file alone and
// leaves the chosen branch's exit code untouched.

// Relative to the working directory a hook runs in — kit's own root, where the built `dist/hooks/`
// sits. The consumer rewrite (`hook-command-rewrite.ts`) rebases this onto the installed package.
const HOOK_DIST_DIR = 'dist/hooks'

// Prefer `primary_path` (run as `node <path>`) when it exists, else run `fallback_command` verbatim.
// Kept generic so a test can exercise the branch selection with stub commands rather than real hooks.
function launch_command(primary_path: string, fallback_command: string): string {
	return `if [ -f ${primary_path} ]; then node ${primary_path}; else ${fallback_command}; fi`
}

// `bundle` is the hook's file under `dist/hooks` (e.g. `pretool-guard.js`); `command` is the josh
// subcommand the fallback runs (e.g. `pretool:guard`).
function hook_launch_command(bundle: string, command: string): string {
	return launch_command(`${HOOK_DIST_DIR}/${bundle}`, `pnpm josh ${command}`)
}

const hook_launch = { HOOK_DIST_DIR, hook_launch_command, launch_command }

export { hook_launch }
