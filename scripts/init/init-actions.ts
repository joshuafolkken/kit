import { readFileSync } from 'node:fs'
import path from 'node:path'
import { json_format } from '#scripts/config-merge/json-format'
import { string_array_schema, vscode_settings_schema } from '#scripts/lib/schemas'
import { init_logic } from './init-logic'
import { package_path, PROJECT_ROOT } from './init-paths'
import type { ProjectShape } from './project-profile'

const PRETTIER_CONFIG_JS = 'prettier.config.js'
const STATIC_PRETTIER_CONFIG = 'prettier.config.mjs'
const VSCODE_EXTENSIONS_PATH = '.vscode/extensions.json'
const VSCODE_SETTINGS_PATH = '.vscode/settings.json'
const TSCONFIG_PATH = 'tsconfig.json'
const LEFTHOOK_PATH = 'lefthook.yml'

interface FileAction {
	dest: string
	create: () => string
	merge?: (existing: string) => string
}

function read_package_file(relative_path: string): string {
	return readFileSync(package_path(relative_path), 'utf8')
}

function read_package_json(relative_path: string): unknown {
	return JSON.parse(read_package_file(relative_path))
}

type MergeFunction = (existing: string) => string

function build_action(destination: string, create: () => string, merge: MergeFunction): FileAction {
	return { dest: destination, create, merge }
}

function build_vscode_actions(): ReadonlyArray<FileAction> {
	const extensions_path = path.join('.vscode', init_logic.VSCODE_EXTENSIONS_FILENAME)
	const settings_path = path.join('.vscode', init_logic.get_vscode_settings_filename())
	const extensions_raw = vscode_settings_schema.parse(read_package_json(extensions_path))
	const raw_recommendations = extensions_raw['recommendations']
	const recommendations = string_array_schema.parse(raw_recommendations)
	const settings_data = init_logic.strip_kit_only_vscode_settings(
		vscode_settings_schema.parse(read_package_json(settings_path)),
	)

	return [
		{
			dest: VSCODE_EXTENSIONS_PATH,
			create: () => read_package_file(extensions_path),
			merge: (existing) =>
				init_logic.merge_json_array_field(existing, 'recommendations', recommendations),
		},
		{
			dest: VSCODE_SETTINGS_PATH,
			create: () =>
				init_logic.strip_kit_only_vscode_settings_content(read_package_file(settings_path)),
			merge: (existing) => init_logic.merge_json_object(existing, settings_data),
		},
	]
}

const STATIC_EXTENSIONS = [
	'streetsidesoftware.code-spell-checker',
	'pkief.material-icon-theme',
	'usernamehw.errorlens',
	'anthropic.claude-code',
	'github.github-vscode-theme',
]
const PRETTIER_EXTENSION = 'esbenp.prettier-vscode'
const DEFAULT_FORMATTER = 'editor.defaultFormatter'
const FORMAT_ON_SAVE = 'editor.formatOnSave'
const STATIC_LANGUAGES = ['[html]', '[css]', '[javascript]']

function static_settings(): Record<string, Record<string, unknown>> {
	const formatter = { [DEFAULT_FORMATTER]: PRETTIER_EXTENSION, [FORMAT_ON_SAVE]: true }

	return Object.fromEntries(STATIC_LANGUAGES.map((language) => [language, formatter]))
}

function build_static_settings_action(): FileAction {
	const settings = static_settings()

	return build_action(
		VSCODE_SETTINGS_PATH,
		() => json_format.format_json(settings),
		(existing) => init_logic.merge_json_object(existing, settings),
	)
}

function build_static_vscode_actions(shape: ProjectShape): ReadonlyArray<FileAction> {
	const recommendations = shape.has_web
		? [...STATIC_EXTENSIONS, PRETTIER_EXTENSION]
		: STATIC_EXTENSIONS
	const actions: Array<FileAction> = [
		build_action(
			VSCODE_EXTENSIONS_PATH,
			() => json_format.format_json({ recommendations }),
			(existing) => init_logic.merge_json_array_field(existing, 'recommendations', recommendations),
		),
	]

	if (shape.has_web) actions.push(build_static_settings_action())

	return actions
}

function build_static_tsconfig_action(): FileAction {
	return build_action(
		TSCONFIG_PATH,
		() => json_format.format_json({ extends: init_logic.get_tsconfig_extends_entry() }),
		(existing) =>
			init_logic.merge_tsconfig_extends(
				existing,
				init_logic.get_tsconfig_extends_entry(),
				PROJECT_ROOT,
			),
	)
}

// Create-only: the rule list is a project-owned allowlist once it exists, so a consumer
// that added custom rules or disabled a noisy one must not have that overwritten.
function build_secretlint_action(): FileAction {
	return {
		dest: init_logic.get_secretlint_config_filename(),
		create: () => init_logic.generate_secretlint_config(),
	}
}

// PROJECT_ROOT is what the consumer's `extends` paths resolve against, which the merge needs to
// migrate a retired `*.jsonc` preset path only once its renamed target is installed (#681).
function build_tsconfig_action(): FileAction {
	return build_action(
		TSCONFIG_PATH,
		() => init_logic.generate_tsconfig(),
		(existing) =>
			init_logic.merge_tsconfig_exclude(
				init_logic.merge_tsconfig_extends(
					existing,
					init_logic.get_tsconfig_extends_entry(),
					PROJECT_ROOT,
				),
			),
	)
}

function build_config_file_actions(): ReadonlyArray<FileAction> {
	const lefthook_extends = init_logic.get_lefthook_extends_value()

	return [
		build_tsconfig_action(),
		build_action(
			'cspell.config.yaml',
			() => init_logic.generate_cspell_config(),
			(existing) => init_logic.merge_cspell_import(existing, init_logic.get_cspell_import_value()),
		),
		build_action(
			LEFTHOOK_PATH,
			() => init_logic.generate_lefthook_config(),
			(existing) => init_logic.merge_lefthook_extends(existing, lefthook_extends),
		),
		build_secretlint_action(),
		...build_vscode_actions(),
	]
}

function build_playwright_action(): FileAction {
	return { dest: 'playwright.config.ts', create: () => init_logic.generate_playwright_config() }
}

function build_eslint_action(): FileAction {
	return build_action(
		'eslint.config.js',
		() => init_logic.generate_eslint_config(),
		(existing) => init_logic.merge_eslint_config(existing),
	)
}

// Union-merge (not byte-copy) so an existing consumer .gitignore keeps its project-local
// entries while gaining any missing kit patterns.
function build_gitignore_action(): FileAction {
	const template = read_package_file('templates/gitignore')

	return build_action(
		'.gitignore',
		() => template,
		(existing) => init_logic.merge_gitignore(existing, template),
	)
}

function build_static_actions(shape: ProjectShape): ReadonlyArray<FileAction> {
	const actions: Array<FileAction> = []
	if (shape.has_git) actions.push(build_gitignore_action())
	if (shape.has_typescript) actions.push(build_static_tsconfig_action())

	if (shape.has_web) {
		actions.push({
			dest: STATIC_PRETTIER_CONFIG,
			create: () =>
				"import { config } from '@joshuafolkken/kit/prettier/static'\n\nexport default config\n",
		})
	}

	actions.push(...build_static_vscode_actions(shape))

	return actions
}

function build_file_actions(shape?: ProjectShape): ReadonlyArray<FileAction> {
	if (shape?.profile === 'static') return build_static_actions(shape)

	return [
		...(shape?.has_git === false ? [] : [build_gitignore_action()]),
		build_action(
			'.npmrc',
			() => init_logic.generate_npmrc(),
			(existing) => init_logic.merge_npmrc(existing),
		),
		build_eslint_action(),
		build_action(
			PRETTIER_CONFIG_JS,
			() =>
				init_logic.generate_prettier_config(init_logic.detect_tailwind_stylesheet(PROJECT_ROOT)),
			(existing) => init_logic.merge_prettier_config(existing, PROJECT_ROOT),
		),
		build_playwright_action(),
		...build_config_file_actions().filter(
			(action) => shape?.has_git !== false || action.dest !== LEFTHOOK_PATH,
		),
	]
}

const init_actions = { build_file_actions, read_package_json }

export type { FileAction }
export { init_actions, PRETTIER_CONFIG_JS }
