import { config_merge } from '#scripts/config-merge/index'
import { kit_base_preset } from './kit-base-preset'

const CSPELL_IMPORT_FIELD = 'import'
const LEFTHOOK_EXTENDS_FIELD = 'extends'
// cspell config places the `import` block right after the `version` line; emit double-quoted
// scalars so the output matches what the VSCode cspell extension writes, avoiding quote churn.
const CSPELL_IMPORT_POSITION = { after: 'version' } as const
const CSPELL_QUOTE_STYLE = 'double' as const

// Add `value` to a YAML list field (creating it at the front when absent), preserving the other
// keys. Thin wrapper over the shared config-merge library so the ensure semantics are single-
// sourced; kept for the lefthook `extends` caller whose new field goes to the front of the file.
function merge_yaml_list_entry(content: string, key: string, value: string): string {
	return config_merge.patch_yaml_list_field(content, {
		field: key,
		ensure: [value],
		position: 'front',
	})
}

// Ensure kit's lefthook base preset is in the `extends` list — UNLESS an `@joshuafolkken/*`
// lefthook preset (kit's own, or an app-kit / game-kit framework preset that already extends kit
// base) is present. Adding kit's `vanilla.yml` alongside such a preset would extend
// `lefthook/base.yml` twice, which lefthook rejects with a hard "possible recursion in extends"
// crash. See joshuafolkken/kit#660.
function merge_lefthook_extends(content: string, value: string): string {
	const entries = config_merge.read_yaml_list_field(content, LEFTHOOK_EXTENDS_FIELD)
	if (kit_base_preset.is_lefthook_base_present(entries)) return content

	return merge_yaml_list_entry(content, LEFTHOOK_EXTENDS_FIELD, value)
}

// Ensure kit's base dictionary is in the cspell `import` list — UNLESS an `@joshuafolkken/*` cspell
// preset (kit's own base, or an app-kit / game-kit framework preset that already imports kit's
// cspell base) is present. Adding kit's base alongside such a preset is a redundant double import.
// kit owns this dedup because there is no downstream overlay in kit's `josh sync` path — every
// consumer drives the sync through kit's CLI, so the check must live here. See joshuafolkken/kit#660.
function merge_cspell_import(content: string, value: string): string {
	const entries = config_merge.read_yaml_list_field(content, CSPELL_IMPORT_FIELD)
	if (kit_base_preset.is_cspell_base_present(entries)) return content

	return config_merge.patch_yaml_list_field(content, {
		field: CSPELL_IMPORT_FIELD,
		ensure: [value],
		position: CSPELL_IMPORT_POSITION,
		quote_style: CSPELL_QUOTE_STYLE,
	})
}

const init_logic_yaml_merge = {
	merge_yaml_list_entry,
	merge_lefthook_extends,
	merge_cspell_import,
}

export { init_logic_yaml_merge }
