import { config_merge } from '#scripts/config-merge/index'

const CSPELL_IMPORT_FIELD = 'import'
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

// Ensure `value` is in the cspell `import` list. Delegates the structural patch to the shared
// config-merge library. kit is framework-agnostic: it only ever ensures its own generic base
// dictionary (`@joshuafolkken/kit/cspell`) and knows nothing about downstream framework presets.
// Deduplicating a redundant base import when a downstream preset already re-exports it is the
// downstream init/sync overlay's responsibility (app-kit / game-kit), not kit's.
function merge_cspell_import(content: string, value: string): string {
	return config_merge.patch_yaml_list_field(content, {
		field: CSPELL_IMPORT_FIELD,
		ensure: [value],
		position: CSPELL_IMPORT_POSITION,
		quote_style: CSPELL_QUOTE_STYLE,
	})
}

const init_logic_yaml_merge = {
	merge_yaml_list_entry,
	merge_cspell_import,
}

export { init_logic_yaml_merge }
