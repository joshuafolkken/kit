import { init_logic_json_merge } from './init-logic-json-merge'

const SECRETLINT_CONFIG_FILENAME = '.secretlintrc.json'
const SECRETLINT_RULE_PRESET = '@secretlint/secretlint-rule-preset-recommend'

// secretlint resolves both its CLI and every rule package from the project it runs in, not
// transitively through the kit — the same constraint that forces the prettier plugins into
// consumer devDependencies (see PRETTIER_PLUGIN_DEV_DEPS in init-logic.ts). Omitting either
// entry makes the pre-commit hook fail with "Cannot find module". Versions mirror the kit's
// own devDependencies.
const SECRETLINT_DEV_DEPS: Record<string, string> = {
	secretlint: '^13.0.2',
	[SECRETLINT_RULE_PRESET]: '^13.0.2',
}

function generate_secretlint_config(): string {
	const config = { rules: [{ id: SECRETLINT_RULE_PRESET }] }

	return `${JSON.stringify(config, undefined, '\t')}\n`
}

function get_secretlint_config_filename(): string {
	return SECRETLINT_CONFIG_FILENAME
}

function merge_secretlint_development_deps(content: string): string {
	return init_logic_json_merge.merge_development_dependencies(content, SECRETLINT_DEV_DEPS)
}

const init_logic_secretlint = {
	generate_secretlint_config,
	get_secretlint_config_filename,
	merge_secretlint_development_deps,
}

export { init_logic_secretlint }
