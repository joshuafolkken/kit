import { readFileSync } from 'node:fs'

// Several readers treat an absent file as "nothing declared" rather than an error: a project may
// carry no lockfile yet, and either overrides location may be missing entirely. Empty content is
// the shared stand-in, so the callers do not each re-implement the try/catch.
function read_file_or_empty(path: string): string {
	try {
		return readFileSync(path, 'utf8')
	} catch {
		return ''
	}
}

const file_reader = { read_file_or_empty }

export { file_reader }
