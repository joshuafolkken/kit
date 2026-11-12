import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Writes `content` to `relative` under `root`, creating the parent directories a fixture tree lacks.
function write_file(root: string, relative: string, content: string): void {
	const file = path.join(root, relative)

	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, content)
}

export { write_file }
