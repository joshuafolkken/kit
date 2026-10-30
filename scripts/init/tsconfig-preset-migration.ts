import { existsSync } from 'node:fs'
import path from 'node:path'
import { parse_jsonc } from '#scripts/config-merge/parse-jsonc'
import { patch_json_key } from '#scripts/config-merge/patch-json-key'
import { string_array_schema } from '#scripts/lib/schemas'

// Playwright appends `.json` to `extends` entries without that suffix, so a `.jsonc` preset path
// becomes missing and prevents E2E startup. The ensure-based merge cannot repair an existing kit
// entry, so this rewrite replaces its suffix. Only `@joshuafolkken/*/tsconfig/*` paths qualify;
// project-local `.jsonc` configs remain untouched. Removable from kit 2.0.0; compatibility is needed
// for consumers with `.jsonc` preset references (joshuafolkken/kit#4187).
const LEGACY_PRESET_ENTRY = /@joshuafolkken\/[^/]+\/tsconfig\/[^/]+\.jsonc$/u
const LEGACY_SUFFIX = '.jsonc'
const CURRENT_SUFFIX = '.json'

// Single-sourced with init-logic-json-merge, which reads and patches the same field — a drift
// between the key this module writes and the key that module reads would silently break the merge.
const EXTENDS_FIELD = 'extends'

// The rename lands package by package, so the `.json` preset may not exist yet in the version of
// app-kit / game-kit the consumer has installed. Rewriting blindly would swap a path Playwright
// cannot resolve for one `tsc` cannot resolve either — strictly worse. Rewriting only once the
// target is actually on disk makes the migration order-independent: the entry stays untouched until
// the package shipping it catches up, and the next sync repairs it.
function is_migration_target_present(base_directory: string, entry: string): boolean {
	return existsSync(path.resolve(base_directory, entry))
}

function migrate_entry(base_directory: string, entry: string): string {
	if (!LEGACY_PRESET_ENTRY.test(entry)) return entry

	const migrated = `${entry.slice(0, -LEGACY_SUFFIX.length)}${CURRENT_SUFFIX}`

	return is_migration_target_present(base_directory, migrated) ? migrated : entry
}

// Preserve the authored shape: a string `extends` stays a string, an array stays an array.
function migrate_extends_value(base_directory: string, raw: unknown): unknown {
	if (typeof raw === 'string') return migrate_entry(base_directory, raw)

	if (Array.isArray(raw)) {
		return string_array_schema.parse(raw).map((entry) => migrate_entry(base_directory, entry))
	}

	return raw
}

// `base_directory` is the consumer project root the `extends` paths are relative to — the directory
// holding the `tsconfig.json` being merged.
function migrate_preset_paths(content: string, base_directory: string): string {
	const parsed = parse_jsonc(content)
	const raw = parsed[EXTENDS_FIELD]
	const migrated = migrate_extends_value(base_directory, raw)
	if (JSON.stringify(migrated) === JSON.stringify(raw)) return content

	return patch_json_key.set_json_key(content, EXTENDS_FIELD, migrated)
}

const tsconfig_preset_migration = {
	migrate_preset_paths,
}

export { EXTENDS_FIELD, tsconfig_preset_migration }
