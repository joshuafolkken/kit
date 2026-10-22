import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'

// **The one fingerprint every kept result is computed with** (joshuafolkken/kit#4497). A reuse of a
// verdict holds only while what it read holds, and each reader of a verdict once computed that on its
// own — the ESLint cache's import closure, the test-read map's dirty files, the gate's tool versions —
// so a miss in one (joshuafolkken/kit#4407, #4415, #4423, #4425) was a miss nowhere else. Every one now
// digests a file, a set of files and a set of named entries here.

// The digest of a path that does not exist, or cannot be read, so it still differs from any content.
const ABSENT = 'absent'

function of_content(content: Buffer | string): string {
	return stamp_file.digest(content)
}

// One digest over `entries`, independent of their order.
function of_entries(entries: Iterable<string>): string {
	return of_content([...entries].toSorted((left, right) => left.localeCompare(right)).join('\n'))
}

function of_file(file_path: string): string {
	try {
		return of_content(readFileSync(file_path))
	} catch {
		return ABSENT
	}
}

// Each of `relatives` (relative to `root`) keyed to the digest of its content, in path order.
function of_files(root: string, relatives: Iterable<string>): Record<string, string> {
	const sorted = [...new Set(relatives)].toSorted((left, right) => left.localeCompare(right))

	return Object.fromEntries(
		sorted.map((relative) => [relative, of_file(path.join(root, relative))]),
	)
}

const input_fingerprint = { ABSENT, of_entries, of_file, of_files }

export { input_fingerprint }
