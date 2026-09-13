import { claude_plugin_config } from './claude-plugin-config'

// The consumer's `.claude/settings.json` runs its hooks through the published bundle directly, not
// through `pnpm josh` (joshuafolkken/kit#1930). Every guarded call in a consumer used to pay a `pnpm`
// launch — measured at ~0.2 s on top of the ~0.24 s the command itself takes — for no reason but to
// resolve the same `dist/josh.js` the `bin.josh` entry already points at. `node` invokes that bundle
// with none of that wrapper.
//
// kit's own settings file is deliberately left on `pnpm josh` (which runs `tsx scripts/josh/josh.ts`
// against the live source): a consumer wants the fast built bundle, but kit developing the guards
// themselves must run the current source, not a stale build. The rewrite is therefore gated on the
// copy destination, exactly as the plugin injection is — kit's source tree is never transformed in
// place.

const PNPM_JOSH_PREFIX = 'pnpm josh '
// Relative to the consumer's project root, which is the working directory a Claude Code hook runs in.
// The path is the plugin marketplace's `node_modules` location plus the built entry `bin.josh` names.
const BUNDLE_INVOCATION = `node ${claude_plugin_config.MARKETPLACE_PATH}/dist/josh.js `
// Only the value of a `"command"` field that begins with `pnpm josh` — never the echo reminders, which
// begin with `echo`, and never prose that merely mentions the string. The capture keeps whatever
// spacing the serializer produced between the key and the value.
const JOSH_COMMAND_FIELD = /("command":\s*")pnpm josh /gu

function rewrite_hook_commands(content: string): string {
	return content.replaceAll(
		JOSH_COMMAND_FIELD,
		(_match, prefix: string) => `${prefix}${BUNDLE_INVOCATION}`,
	)
}

// Gated on the same destination as the plugin injection: only the copied `.claude/settings.json` is
// rewritten, so kit's own file keeps `pnpm josh`.
function apply_hook_command_rewrite_for_destination(
	destination_path: string,
	content: string,
): string {
	return destination_path.endsWith(claude_plugin_config.CLAUDE_SETTINGS_DESTINATION)
		? rewrite_hook_commands(content)
		: content
}

const hook_command_rewrite = {
	apply_hook_command_rewrite_for_destination,
	BUNDLE_INVOCATION,
	PNPM_JOSH_PREFIX,
	rewrite_hook_commands,
}

export { hook_command_rewrite }
