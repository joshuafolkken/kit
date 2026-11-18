import { json_format } from '#scripts/config-merge/json-format'
import { parse_jsonc } from '#scripts/config-merge/parse-jsonc'
import { string_record_schema } from '#scripts/lib/schemas'
import { init_logic_json_merge } from './init-logic-json-merge'
import { kit_development_versions } from './kit-development-versions'

const SECRETLINT_CONFIG_FILENAME = '.secretlintrc.json'
const SECRETLINT_CLI = 'secretlint'
// Since secretlint v14 the recommend preset is built in: this id still names the rule in the config,
// while the package of the same name is deprecated and no longer installed.
const SECRETLINT_RULE_PRESET = '@secretlint/secretlint-rule-preset-recommend'

// secretlint resolves its CLI from the project it runs in, not transitively through the kit — the
// same constraint that forces the prettier plugins into consumer devDependencies (as kit peers, see
// init.ts). Omitting it makes the pre-commit hook fail with "Cannot find module". The version is
// kit's own.
const SECRETLINT_PACKAGES = [SECRETLINT_CLI]

function generate_secretlint_config(): string {
	const config = { rules: [{ id: SECRETLINT_RULE_PRESET }] }

	return `${JSON.stringify(config, undefined, '\t')}\n`
}

function get_secretlint_config_filename(): string {
	return SECRETLINT_CONFIG_FILENAME
}

// A consumer an earlier kit provisioned still declares the preset package. Dropping it alone would
// leave a pre-v14 CLI without its rules, so the CLI moves to kit's version in the same edit.
function retire_preset_package(content: string): string {
	const parsed = parse_jsonc(content)
	const raw = parsed['devDependencies']
	if (raw === undefined) return content

	const existing = string_record_schema.parse(raw)
	if (!Object.hasOwn(existing, SECRETLINT_RULE_PRESET)) return content

	const kept = Object.entries(existing).filter(([name]) => name !== SECRETLINT_RULE_PRESET)
	const cli = kit_development_versions.versions_of(SECRETLINT_PACKAGES)

	return json_format.format_package_json({
		...parsed,
		devDependencies: { ...Object.fromEntries(kept), ...cli },
	})
}

function merge_secretlint_development_deps(content: string): string {
	return init_logic_json_merge.merge_development_dependencies(
		retire_preset_package(content),
		kit_development_versions.versions_of(SECRETLINT_PACKAGES),
	)
}

const init_logic_secretlint = {
	generate_secretlint_config,
	get_secretlint_config_filename,
	merge_secretlint_development_deps,
}

export { init_logic_secretlint }
