import path from 'node:path'
import { parse_jsonc } from '#scripts/config-merge/parse-jsonc'
import { fix_gh_packages_logic } from '#scripts/gh/fix-gh-packages-logic'
import { init_logic_json_merge } from '#scripts/init/init-logic-json-merge'
import { file_reader } from '#scripts/lib/read-file'
import { z } from 'zod'
import { migrate_lock } from './migrate-lock'

const NPM = 'https://registry.npmjs.org/'
const SCOPE = '@joshuafolkken'
const LOCKFILE = 'pnpm-lock.yaml'
const SCRIPTS = ['prepare', 'postinstall']
const dependency_schema = z.record(z.string(), z.string()).optional()
const manifest_schema = z.object({
	dependencies: dependency_schema,
	devDependencies: dependency_schema,
	optionalDependencies: dependency_schema,
	peerDependencies: dependency_schema,
})
const scripts_schema = z.looseObject({ scripts: z.record(z.string(), z.string()).optional() })

function read(root: string, name: string): string {
	return file_reader.read_file_or_empty(path.join(root, name))
}

// The migration entry commits this mapping after verifying every scoped artifact. An absent
// mapping is not evidence of migration: a user's registry may still point at GitHub.
function is_npm(content: string): boolean {
	const registry = fix_gh_packages_logic.parse_scope_registries(content).get(SCOPE)

	return registry === NPM || registry === NPM.slice(0, -1)
}

function is_project_npm(
	root: string = process.cwd(),
	npmrc: string = read(root, '.npmrc'),
): boolean {
	return is_npm(npmrc) && migrate_lock.has_npm_sources(read(root, LOCKFILE))
}

function is_npm_only(root: string, npmrc: string = read(root, '.npmrc')): boolean {
	return is_project_npm(root, npmrc) && fix_gh_packages_logic.parse_gh_scopes(npmrc).size === 0
}

function has_scoped_name(dependencies: Record<string, string> | undefined): boolean {
	return Object.keys(dependencies ?? {}).some((name) => name.startsWith(migrate_lock.SCOPE))
}

function has_scoped_dependencies(content: string): boolean {
	const manifest = manifest_schema.parse(parse_jsonc(content || '{}'))

	return Object.values(manifest).some((dependencies) => has_scoped_name(dependencies))
}

// Existing scoped dependencies require the transactional entry, never a partial sync migration.
function can_initialize(root: string): boolean {
	return (
		read(root, 'pnpm-workspace.yaml') === '' &&
		!has_scoped_dependencies(read(root, 'package.json')) &&
		migrate_lock.scoped_artifacts(read(root, LOCKFILE)).length === 0
	)
}

function can_manage(root: string): boolean {
	const content = read(root, '.npmrc')

	return (
		is_npm(content) ||
		(!fix_gh_packages_logic.parse_scope_registries(content).has(SCOPE) && can_initialize(root))
	)
}

function merge_npmrc(content: string, root: string): string {
	if (is_npm(content)) return migrate_lock.npmrc(content)
	if (fix_gh_packages_logic.parse_scope_registries(content).has(SCOPE)) return content
	if (can_initialize(root)) return migrate_lock.npmrc(content)

	return content
}

function is_script_value(content: string, key: string, value: string): boolean {
	return scripts_schema.parse(parse_jsonc(content)).scripts?.[key] === value
}

function strip_script(content: string, key: string, command: string): string {
	const script = scripts_schema.parse(parse_jsonc(content)).scripts?.[key]
	if (script === undefined) return content
	const suffix = ` && (${command} || true)`
	if (!script.endsWith(suffix)) return content

	return init_logic_json_merge.replace_in_package_script(
		content,
		key,
		script,
		script.slice(0, -suffix.length),
	)
}

// Only the exact trailing clause kit generated is owned here. Other GitHub scopes still need
// the public repair API, and custom commands (including mere name matches) stay byte-identical.
function merge_lifecycle(content: string, root: string, command: string): string {
	if (!is_npm_only(root)) return content

	let merged = content
	for (const key of SCRIPTS) merged = strip_script(merged, key, command)

	return merged
}

const npm_acquisition = {
	is_npm,
	is_project_npm,
	is_npm_only,
	is_script_value,
	can_manage,
	merge_npmrc,
	merge_lifecycle,
}
export { npm_acquisition }
