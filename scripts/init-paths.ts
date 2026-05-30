import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT_ROOT = process.cwd()

function package_path(relative_path: string): string {
	return path.join(PACKAGE_DIR, relative_path)
}

function is_sveltekit_project(project_root: string): boolean {
	return (
		existsSync(path.join(project_root, 'svelte.config.js')) ||
		existsSync(path.join(project_root, 'svelte.config.ts'))
	)
}

export { PACKAGE_DIR, PROJECT_ROOT, package_path, is_sveltekit_project }
