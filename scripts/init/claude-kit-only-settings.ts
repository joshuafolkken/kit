import { patch_json_key } from '#scripts/config-merge/patch-json-key'
import { claude_plugin_config } from './claude-plugin-config'

// Keys kit's own `.claude/settings.json` sets for its sessions but never ships. `enableArtifact:
// false` keeps the Artifact tool's ~12k tokens out of every call of a kit run,
// but Claude Code lets any layer that sets it to `false` win, so a
// consumer given it could not turn the tool back on from `.claude/settings.local.json`.
const KIT_ONLY_SETTING_KEYS: ReadonlyArray<string> = ['enableArtifact']

function strip_kit_only_settings(content: string): string {
	let stripped = content
	for (const key of KIT_ONLY_SETTING_KEYS) stripped = patch_json_key.remove_json_key(stripped, key)

	return stripped
}

function apply_kit_only_strip_for_destination(destination_path: string, content: string): string {
	return destination_path.endsWith(claude_plugin_config.CLAUDE_SETTINGS_DESTINATION)
		? strip_kit_only_settings(content)
		: content
}

const claude_kit_only_settings = {
	KIT_ONLY_SETTING_KEYS,
	strip_kit_only_settings,
	apply_kit_only_strip_for_destination,
}

export { claude_kit_only_settings }
