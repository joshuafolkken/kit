import { init_logic_json_merge } from './init-logic-json-merge'
import { kit_development_versions } from './kit-development-versions'

const SECRETLINT_CONFIG_FILENAME = '.secretlintrc.json'
const SECRETLINT_RULE_PRESET = '@secretlint/secretlint-rule-preset-recommend'

// secretlint resolves both its CLI and every rule package from the project it runs in, not
// transitively through the kit — the same constraint that forces the prettier plugins into
// consumer devDependencies (as kit peers, see init.ts). Omitting either
// entry makes the pre-commit hook fail with "Cannot find module". The versions are kit's own.
const SECRETLINT_PACKAGES = ['secretlint', SECRETLINT_RULE_PRESET]

function generate_secretlint_config(): string {
	const config = { rules: [{ id: SECRETLINT_RULE_PRESET }] }

	return `${JSON.stringify(config, undefined, '\t')}\n`
}

function get_secretlint_config_filename(): string {
	return SECRETLINT_CONFIG_FILENAME
}

function merge_secretlint_development_deps(content: string): string {
	return init_logic_json_merge.merge_development_dependencies(
		content,
		kit_development_versions.versions_of(SECRETLINT_PACKAGES),
	)
}

const init_logic_secretlint = {
	generate_secretlint_config,
	get_secretlint_config_filename,
	merge_secretlint_development_deps,
}

export { init_logic_secretlint }
