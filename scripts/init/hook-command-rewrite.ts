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
// Relative to the consumer's project root, which hook commands select before using this path.
// The path is the plugin marketplace's `node_modules` location plus the built entry `bin.josh` names.
const BUNDLE_INVOCATION = `node ${claude_plugin_config.MARKETPLACE_PATH}/dist/josh.js `
// Anchored on the `sh ` that launches it: the installed path still ends in the source path, so only the
// anchor keeps a second pass from rebasing an already-rebased launcher onto itself.
const RUN_HOOK_INVOCATION = `sh ${hook_launch.RUN_HOOK_SCRIPT} `
const CONSUMER_RUN_HOOK_INVOCATION = `sh ${claude_plugin_config.MARKETPLACE_PATH}/${hook_launch.RUN_HOOK_SCRIPT} `
const CONSUMER_PACKAGE_MANIFEST = `${claude_plugin_config.MARKETPLACE_PATH}/package.json`
const MISSING_INSTALL_NOTICE = 'kit hooks inactive: run pnpm install, then reread CLAUDE.md'
const MISSING_INSTALL_GUARD = `if [ ! -f ${CONSUMER_PACKAGE_MANIFEST} ]; then echo '${MISSING_INSTALL_NOTICE}' >&2; exit 0; fi; `
const CODEX_HOOKS_DESTINATION = '.codex/hooks.json'
// Every shape a hook command kit wrote can carry: the launcher as kit's own file names it, the
// launcher rebased onto the installed package, and the installed dispatcher the releases from
// 2026-09-13 (joshuafolkken/kit#1930) to the launcher rebased `pnpm josh` onto. The settings merge
// tells kit's hooks from a project's own by these and the list below, so the shapes stay beside the
// rewrite that produces them.
const KIT_COMMAND_MARKERS: ReadonlyArray<string> = [
	RUN_HOOK_INVOCATION,
	CONSUMER_RUN_HOOK_INVOCATION,
	BUNDLE_INVOCATION,
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
// The values below are matched inside raw JSON text, so the root prefix is taken in its escaped form.
const PROJECT_ROOT_PREFIX = JSON.stringify(hook_launch.PROJECT_ROOT_PREFIX).slice(1, -1)
// Capture the value of every `"command"` field, escapes and all, so the rewrites below touch command
// values alone — never an echo reminder's prose or a `"description"` that merely mentions the string.
const COMMAND_FIELD = /("command":\s*")((?:[^"\\]|\\.)*)(")/gu

// Rebase both paths a hook command can carry: the launcher, then a plain `pnpm josh`. Neither
// replacement contains the other's anchor, so the two are independent whichever order they run, and
// the whole rewrite is safe to run more than once.
function rewrite_command_value(value: string): string {
	const rewritten = value
		.split(RUN_HOOK_INVOCATION)
		.join(CONSUMER_RUN_HOOK_INVOCATION)
		.split(PNPM_JOSH_PREFIX)
		.join(BUNDLE_INVOCATION)

	if (!rewritten.includes(claude_plugin_config.MARKETPLACE_PATH)) return rewritten
	if (rewritten.includes(MISSING_INSTALL_GUARD)) return rewritten

	return `${MISSING_INSTALL_GUARD}${rewritten}`
}

// kit's own commands already start from the root (`hook-launch.ts`), and so does an already-rewritten
// value. The prefix is taken off before the rewrite and put back after it, so the install guard sits
// behind the `cd` it depends on and a second pass never doubles the prefix.
function without_root_prefix(value: string): string {
	return value.startsWith(PROJECT_ROOT_PREFIX) ? value.slice(PROJECT_ROOT_PREFIX.length) : value
}

function rewrite_hook_commands(content: string, is_codex = false): string {
	return content.replaceAll(COMMAND_FIELD, (_match, open: string, value: string, close: string) => {
		const rewritten = rewrite_command_value(without_root_prefix(value))
		const should_select_root = is_codex || rewritten.includes(claude_plugin_config.MARKETPLACE_PATH)
		const prefix = should_select_root ? PROJECT_ROOT_PREFIX : ''

		return `${open}${prefix}${rewritten}${close}`
	})
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
