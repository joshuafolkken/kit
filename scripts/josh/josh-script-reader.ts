import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function read_script(script: string): string {
	return readFileSync(path.join(REPOSITORY_ROOT, script), 'utf8')
}

export { read_script }
