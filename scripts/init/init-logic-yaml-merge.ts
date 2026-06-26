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

// Maps a base cspell import to the imports that already provide it transitively. When
// a superseding import is present, the base import is redundant and must not be added.
// kit only string-matches the game import name here; it does not depend on game-kit.
const CSPELL_SUPERSEDING_IMPORTS: ReadonlyArray<{
	base: string
	superseded_by: ReadonlyArray<string>
}> = [
	{
		base: '@joshuafolkken/kit/cspell/sveltekit',
		superseded_by: ['@joshuafolkken/game-kit/cspell/game'],
	},
]

function is_cspell_import_superseded(value: string, existing: ReadonlyArray<string>): boolean {
	const rule = CSPELL_SUPERSEDING_IMPORTS.find((entry) => entry.base === value)
	if (rule === undefined) return false

	return rule.superseded_by.some((entry) => existing.includes(entry))
}

// Ensure `value` is in the cspell `import` list, skipping it when a superseding import already
// covers it. Delegates the structural patch to the shared config-merge library; the superseding
// rule stays here because it is kit-specific business logic, not a generic list operation.
function merge_cspell_import(content: string, value: string): string {
	const existing = config_merge.read_yaml_list_field(content, CSPELL_IMPORT_FIELD)
	if (is_cspell_import_superseded(value, existing)) return content

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
