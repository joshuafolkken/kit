import { claude_plugin_config } from './claude-plugin-config'
import { hook_launch } from './hook-launch'

// The consumer's `.claude/settings.json` runs its hooks off the published package directly, not
// through `pnpm josh` (joshuafolkken/kit#1930, joshuafolkken/kit#2023). Two paths inside a hook
// command are rebased onto the installed package: the per-hook bundle `dist/hooks/<name>.js` a hook
// prefers, and the `pnpm josh <command>` fallback it drops to when that bundle is missing — which for
// a consumer becomes the `dist/josh.js` dispatcher, since the published package always ships `dist`
// and a `pnpm` launch would only add the wrapper this exists to remove.
//
// kit's own settings file keeps the `pnpm josh` fallback (`tsx scripts/josh/josh.ts` against live
// source), so a fresh clone with no `dist/` still runs the current guards. The rewrite is gated on the
// copy destination, exactly as the plugin injection is — kit's source tree is never transformed in
// place.

const PNPM_JOSH_PREFIX = 'pnpm josh '
const CODEX_ADAPTER_SOURCE = 'pnpm exec tsx scripts/hooks/codex-hook-adapter.ts'
// Relative to the consumer's project root, which is the working directory a Claude Code hook runs in.
// The path is the plugin marketplace's `node_modules` location plus the built entry `bin.josh` names.
const BUNDLE_INVOCATION = `node ${claude_plugin_config.MARKETPLACE_PATH}/dist/josh.js `
// The per-hook bundle directory a fresh clone builds, and where it lives inside the installed package.
const HOOK_BUNDLE_DIR = `${hook_launch.HOOK_DIST_DIR}/`
const CONSUMER_HOOK_BUNDLE_DIR = `${claude_plugin_config.MARKETPLACE_PATH}/${HOOK_BUNDLE_DIR}`
const CONSUMER_PACKAGE_MANIFEST = `${claude_plugin_config.MARKETPLACE_PATH}/package.json`
const MISSING_INSTALL_NOTICE = 'kit hooks inactive: run pnpm install, then reread CLAUDE.md'
const MISSING_INSTALL_GUARD = `if [ ! -f ${CONSUMER_PACKAGE_MANIFEST} ]; then echo '${MISSING_INSTALL_NOTICE}' >&2; exit 0; fi; `
const CODEX_ADAPTER_BUNDLE = `node ${CONSUMER_HOOK_BUNDLE_DIR}codex-hook-adapter.js`
const CODEX_HOOKS_DESTINATION = '.codex/hooks.json'
const CODEX_ROOT_PREFIX = String.raw`cd \"$(git rev-parse --show-toplevel)\" && `
// Capture the value of every `"command"` field, escapes and all, so the rewrites below touch command
// values alone — never an echo reminder's prose or a `"description"` that merely mentions the string.
const COMMAND_FIELD = /("command":\s*")((?:[^"\\]|\\.)*)(")/gu

// Idempotent on its own: `CONSUMER_HOOK_BUNDLE_DIR` still contains `HOOK_BUNDLE_DIR`, so a blind
// second pass would rebase an already-rebased path onto itself. A value already targeting the
// installed package is left untouched, restoring the idempotency the earlier `pnpm josh`-anchored
// rewrite had for free.
function rebase_bundle_directory(value: string): string {
	return value.includes(CONSUMER_HOOK_BUNDLE_DIR)
		? value
		: value.split(HOOK_BUNDLE_DIR).join(CONSUMER_HOOK_BUNDLE_DIR)
}

// Rebase both paths a hook command can carry: the bundle it prefers, then the `pnpm josh` fallback.
// The bundle rewrite runs first — its replacement never contains `pnpm josh`, so the two are
// independent whichever order they run. The fallback rewrite is idempotent too (`BUNDLE_INVOCATION`
// holds no `pnpm josh `), so the whole rewrite is safe to run more than once.
function rewrite_command_value(value: string): string {
	const rewritten = rebase_bundle_directory(value)
		.split(PNPM_JOSH_PREFIX)
		.join(BUNDLE_INVOCATION)
		.split(CODEX_ADAPTER_SOURCE)
		.join(CODEX_ADAPTER_BUNDLE)

	if (!rewritten.includes(claude_plugin_config.MARKETPLACE_PATH)) return rewritten
	if (rewritten.includes(MISSING_INSTALL_GUARD)) return rewritten

	return `${MISSING_INSTALL_GUARD}${rewritten}`
}

function rewrite_hook_commands(content: string, is_codex = false): string {
	return content.replaceAll(COMMAND_FIELD, (_match, open: string, value: string, close: string) => {
		const rewritten = rewrite_command_value(value)
		const prefix = is_codex && !rewritten.startsWith(CODEX_ROOT_PREFIX) ? CODEX_ROOT_PREFIX : ''

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

const hook_command_rewrite = {
	apply_hook_command_rewrite_for_destination,
	BUNDLE_INVOCATION,
	PNPM_JOSH_PREFIX,
	rewrite_hook_commands,
}

export { hook_command_rewrite }
