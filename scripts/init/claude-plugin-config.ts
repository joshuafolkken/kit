import path from 'node:path'
import { init_logic_json_merge } from './init-logic-json-merge'

// The Claude Code plugin that ships kit's distributed skills (joshuafolkken/kit#1879). A consumer no
// longer receives the five skill directories as a byte copy under its own `.claude/skills/`; it
// receives this marketplace and plugin declaration in its `.claude/settings.json`, and the skills
// load from the package as `kit:<name>`.
const MARKETPLACE_NAME = 'kit'
const PLUGIN_ID = 'kit@kit'
// Relative to the consumer's project root, where `@joshuafolkken/kit` is installed. An absolute path
// would be correct only on the machine it was written on, so it has to stay relative; the `./`
// prefix keeps `claude plugin marketplace add` from reading it as a GitHub `owner/repo` shorthand.
const MARKETPLACE_PATH = './node_modules/@joshuafolkken/kit'
const CLAUDE_SETTINGS_DESTINATION = path.join('.claude', 'settings.json')

// `enabledPlugins` declares the plugin; `extraKnownMarketplaces` says where to find it. The CLI does
// not auto-install from these alone — a consumer runs `claude plugin install kit@kit` once — so the
// declaration is what makes that one command resolve without further arguments.
const PLUGIN_SETTINGS: Record<string, unknown> = {
	extraKnownMarketplaces: {
		[MARKETPLACE_NAME]: { source: { source: 'directory', path: MARKETPLACE_PATH } },
	},
	enabledPlugins: { [PLUGIN_ID]: true },
}

function inject_plugin_config(content: string): string {
	return init_logic_json_merge.merge_json_object(content, PLUGIN_SETTINGS)
}

// Only the consumer's `.claude/settings.json` receives the plugin block. kit's own settings file is
// never transformed in place — kit loads the skills locally from `.claude/skills/`, so enabling the
// plugin in kit would double-load every skill (`kit:workflow-commands` beside the local
// `workflow-commands`). The check is against the copied file's destination, which is why it runs in
// the copy transform rather than against kit's source tree.
function apply_plugin_config_for_destination(destination_path: string, content: string): string {
	return destination_path.endsWith(CLAUDE_SETTINGS_DESTINATION)
		? inject_plugin_config(content)
		: content
}

const claude_plugin_config = {
	MARKETPLACE_NAME,
	PLUGIN_ID,
	MARKETPLACE_PATH,
	CLAUDE_SETTINGS_DESTINATION,
	PLUGIN_SETTINGS,
	inject_plugin_config,
	apply_plugin_config_for_destination,
}

export { claude_plugin_config }
