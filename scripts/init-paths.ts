import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT_ROOT = process.cwd()

function package_path(relative_path: string): string {
	return path.join(PACKAGE_DIR, relative_path)
}

export { PACKAGE_DIR, PROJECT_ROOT, package_path }
