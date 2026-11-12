import { claude_plugin_config } from './claude-plugin-config'
import { hook_launch } from './hook-launch'

// The consumer's `.claude/settings.json` runs its hooks off the published package directly, not
// through `pnpm josh`. Two paths inside a hook
// command are rebased onto the installed package: the hook launcher `scripts/hooks/run-hook.sh`,
// which picks the bundle or the dispatcher from where it is installed, and a
// plain `pnpm josh <command>`, which becomes the `dist/josh.js` dispatcher — the published package
// always ships `dist`, and a `pnpm` launch would only add the wrapper this exists to remove.
//
// kit's own settings file keeps the launcher's live-source fallback (`pnpm josh` against
// `scripts/josh/josh.ts`), so a fresh clone with no `dist/` still runs the current guards. The rewrite
// is gated on the copy destination, exactly as the plugin injection is — kit's source tree is never
// transformed in place.

const PNPM_JOSH_PREFIX = 'pnpm josh '
const { MARKETPLACE_PATH } = claude_plugin_config
// The installed package below the project root, as a rooted path names it.
const PACKAGE_PATH = MARKETPLACE_PATH.replace(/^\.\//u, '')
const INSTALLED_LAUNCHER = `${PACKAGE_PATH}/${hook_launch.RUN_HOOK_SCRIPT}`
const INSTALLED_DISPATCHER = `${PACKAGE_PATH}/dist/josh.js`
const INSTALLED_MANIFEST = `${PACKAGE_PATH}/package.json`
const MISSING_INSTALL_NOTICE = 'kit hooks inactive: run pnpm install, then reread CLAUDE.md'
const CODEX_HOOKS_DESTINATION = '.codex/hooks.json'

// Each shape a hook command took while it moved to the project root first and named every path
// relative to it, before joshuafolkken/kit#6033 named the launcher by its absolute path. The settings
// merge still tells a consumer's not-yet-synced kit hooks by these. History, never edited; removable
// from kit 2.0.0.
const RELATIVE_RUN_HOOK_INVOCATION = `sh ${hook_launch.RUN_HOOK_SCRIPT} `
const RELATIVE_CONSUMER_RUN_HOOK_INVOCATION = `sh ${MARKETPLACE_PATH}/${hook_launch.RUN_HOOK_SCRIPT} `
// The installed dispatcher the releases from 2026-09-13 (joshuafolkken/kit#1930) rebased `pnpm josh`
// onto.
const RELATIVE_BUNDLE_INVOCATION = `node ${MARKETPLACE_PATH}/dist/josh.js `
const RELATIVE_INSTALL_GUARD = `if [ ! -f ${MARKETPLACE_PATH}/package.json ]; then echo '${MISSING_INSTALL_NOTICE}' >&2; exit 0; fi; `
const LOCATION_VARIABLES =
	'GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_DIR GIT_INDEX_FILE GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_WORK_TREE'
const ROOT_LOOKUP = 'git rev-parse --show-toplevel'
const LOCATION_FREE_ROOT = `$( (unset ${LOCATION_VARIABLES}; ${ROOT_LOOKUP} 2>/dev/null) || ${ROOT_LOOKUP})`
// The root prefixes, newest first: until joshuafolkken/kit#6033, until #4617 (no launch directory)
// and until #4187 (the git location variables cleared here rather than in the launcher).
const ROOT_PREFIXES: ReadonlyArray<string> = [
	`export JOSH_HOOK_CWD="$PWD" && project_root="\${CLAUDE_PROJECT_DIR:-${LOCATION_FREE_ROOT}}" && cd "$project_root" && `,
	`project_root="\${CLAUDE_PROJECT_DIR:-${LOCATION_FREE_ROOT}}" && cd "$project_root" && `,
	`if project_root="$(unset ${LOCATION_VARIABLES}; ${ROOT_LOOKUP} 2>/dev/null)"; then unset ${LOCATION_VARIABLES}; else project_root="$(${ROOT_LOOKUP})"; fi && cd "$project_root" && `,
]
// Before joshuafolkken/kit#1930 nothing was rebased: a consumer received these six as the whole hook
// command. A plain `pnpm josh <command>` is also how a project writes a hook of its own, so only the
// exact commands count — and kit still delivers each of them through the launcher, so one left in
// place would run its guard or formatter a second time. The list is history and never grows.
const PLAIN_KIT_COMMANDS: ReadonlySet<string> = new Set(
	[
		'audit:provision',
		'batch:guard',
		'format:edited',
		'investigation:guard',
		'rule:guard',
		'session:lang',
	].map((command) => `${PNPM_JOSH_PREFIX}${command}`),
)
// Every shape a hook command kit wrote can carry: the launcher under any root, kit's or the installed
// package's, the installed dispatcher under any root, and the relative shapes above. The settings merge
// tells kit's hooks from a project's own by these and the list above, so the shapes stay beside the
// rewrite that produces them.
const KIT_COMMAND_MARKERS: ReadonlyArray<string> = [
	`/${hook_launch.RUN_HOOK_SCRIPT}" `,
	`/${INSTALLED_DISPATCHER}" `,
	RELATIVE_RUN_HOOK_INVOCATION,
	RELATIVE_CONSUMER_RUN_HOOK_INVOCATION,
	RELATIVE_BUNDLE_INVOCATION,
]
// Capture the value of every `"command"` field, escapes and all, so the rewrites below touch command
// values alone — never an echo reminder's prose or a `"description"` that merely mentions the string.
const COMMAND_FIELD = /("command":\s*")((?:[^"\\]|\\.)*)(")/gu

function install_guard(root: string): string {
	const manifest = hook_launch.rooted_path(root, INSTALLED_MANIFEST)

	return `if [ ! -f ${manifest} ]; then echo '${MISSING_INSTALL_NOTICE}' >&2; exit 0; fi; `
}

// What a command starts with ahead of its launch — a root prefix, an install guard — is taken off
// before the rewrite, and the current guard put back after it, so a second pass never doubles either.
function launch_part(command: string, root: string): string {
	const prefix = ROOT_PREFIXES.find((candidate) => command.startsWith(candidate)) ?? ''
	const launch = command.slice(prefix.length)
	const guard = [RELATIVE_INSTALL_GUARD, install_guard(root)].find((candidate) =>
		launch.startsWith(candidate),
	)

	return launch.slice(guard?.length ?? 0)
}

// Every launch shape becomes the installed launcher or dispatcher under `root`. No replacement contains
// another's anchor, so the order does not matter and the whole rewrite is safe to run more than once.
function rebased(launch: string, root: string): string {
	const consumer_launch = `sh ${hook_launch.rooted_path(root, INSTALLED_LAUNCHER)} `
	const bundle_launch = `node ${hook_launch.rooted_path(root, INSTALLED_DISPATCHER)} `
	const replacements: ReadonlyArray<readonly [string, string]> = [
		[`sh ${hook_launch.rooted_path(root, hook_launch.RUN_HOOK_SCRIPT)} `, consumer_launch],
		[RELATIVE_CONSUMER_RUN_HOOK_INVOCATION, consumer_launch],
		[RELATIVE_RUN_HOOK_INVOCATION, consumer_launch],
		[RELATIVE_BUNDLE_INVOCATION, bundle_launch],
		[PNPM_JOSH_PREFIX, bundle_launch],
	]
	let text = launch

	for (const [from, to] of replacements) text = text.split(from).join(to)

	return text
}

function rewrite_command(command: string, root: string): string {
	const rewritten = rebased(launch_part(command, root), root)

	return rewritten.includes(PACKAGE_PATH) ? `${install_guard(root)}${rewritten}` : rewritten
}

// The field holds the command JSON-escaped; it is rewritten as the shell reads it and escaped back,
// and a command the rewrite leaves alone keeps its original text.
function rewrite_command_value(value: string, root: string): string {
	const command = JSON.parse(`"${value}"`) as string
	const rewritten = rewrite_command(command, root)

	return rewritten === command ? value : JSON.stringify(rewritten).slice(1, -1)
}

function rewrite_hook_commands(content: string, is_codex = false): string {
	const root = is_codex ? hook_launch.CODEX_ROOT : hook_launch.CLAUDE_ROOT

	return content.replaceAll(
		COMMAND_FIELD,
		(_match, open: string, value: string, close: string) =>
			`${open}${rewrite_command_value(value, root)}${close}`,
	)
}

// Rewrite copied Claude and Codex hook files only; kit's source files keep their live-source fallback.
function apply_hook_command_rewrite_for_destination(
	destination_path: string,
	content: string,
): string {
	if (destination_path.endsWith(CODEX_HOOKS_DESTINATION)) {
		return rewrite_hook_commands(content, true)
	}

	if (destination_path.endsWith(claude_plugin_config.CLAUDE_SETTINGS_DESTINATION)) {
		return rewrite_hook_commands(content)
	}

	return content
}

function is_kit_hook_command(command: string): boolean {
	if (PLAIN_KIT_COMMANDS.has(command)) return true

	return KIT_COMMAND_MARKERS.some((marker) => command.includes(marker))
}

const hook_command_rewrite = {
	apply_hook_command_rewrite_for_destination,
	is_kit_hook_command,
	rewrite_hook_commands,
}

export { hook_command_rewrite }
