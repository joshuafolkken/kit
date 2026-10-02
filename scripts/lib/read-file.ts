import { readFileSync } from 'node:fs'

const ABSENT_CODE = 'ENOENT'

function is_absent(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === ABSENT_CODE
}

// An absent file is an answer ("nothing declared here"); any other failure — a permission error, a
// directory where a file was expected — is not, and is thrown so it cannot pass for an empty file.
function read_optional(path: string): string | undefined {
	try {
		return readFileSync(path, 'utf8')
	} catch (error) {
		if (is_absent(error)) return undefined

		throw error
	}
}

// Several readers treat an absent file as "nothing declared" rather than an error: a project may
// carry no lockfile yet, and either overrides location may be missing entirely. Empty content is
// the shared stand-in, so the callers do not each re-implement the try/catch.
function read_file_or_empty(path: string): string {
	return read_optional(path) ?? ''
}

// For a reader whose contract is to never fail — a hook running after a write already succeeded, a
// report that states "unreadable" itself — every failure to read, not only absence, is `undefined`.
function read_if_readable(path: string): string | undefined {
	try {
		return readFileSync(path, 'utf8')
	} catch {
		return undefined
	}
}

const file_reader = { read_optional, read_file_or_empty, read_if_readable }

export { file_reader }
