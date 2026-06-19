import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { package_with_deps_schema } from '#scripts/schemas'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PROJECT_ROOT = process.cwd()
const SVELTEKIT_PACKAGE = '@sveltejs/kit'

function package_path(relative_path: string): string {
	return path.join(PACKAGE_DIR, relative_path)
}

function parse_json_file(file_path: string): unknown {
	try {
		return JSON.parse(readFileSync(file_path, 'utf8'))
	} catch {
		return undefined
	}
}

// The new `sv` library template (`sv create --template library`) ships no
// svelte.config.{js,ts} — it configures the sveltekit() plugin in vite.config.ts
// instead — so fall back to detecting `@sveltejs/kit` in the project's dependencies.
function has_sveltekit_dependency(project_root: string): boolean {
	const package_json_path = path.join(project_root, 'package.json')
	if (!existsSync(package_json_path)) return false
	const parsed = package_with_deps_schema.safeParse(parse_json_file(package_json_path))
	if (!parsed.success) return false
	const deps = { ...parsed.data.dependencies, ...parsed.data.devDependencies }

	return Object.hasOwn(deps, SVELTEKIT_PACKAGE)
}

function is_sveltekit_project(project_root: string): boolean {
	return (
		existsSync(path.join(project_root, 'svelte.config.js')) ||
		existsSync(path.join(project_root, 'svelte.config.ts')) ||
		has_sveltekit_dependency(project_root)
	)
}

export { PACKAGE_DIR, PROJECT_ROOT, package_path, is_sveltekit_project }
