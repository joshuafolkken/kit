import { cpSync, lstatSync } from 'node:fs'
import path from 'node:path'

// `josh init` and `josh sync` both copy a distributed directory with `cpSync`, and both have to
// answer the same question first: is this copy one that `cpSync` will refuse? The answer lives here
// rather than in each command, because the failure modes are the same and a second copy of the list
// would drift (joshuafolkken/kit#853, which made the directory list non-empty for the first time).
//
// Every check goes through `lstat`, never `existsSync` or `stat`:
//   - `stat` follows a symlink, so a link pointing at a directory would read as a directory while
//     `cpSync` — which compares with `lstat` — throws ERR_FS_CP_DIR_TO_NON_DIR on it;
//   - `existsSync` is false for a broken link, and `cpSync` does not merely throw on one: it ends
//     the process with an uncaught filesystem error, which no caller can report or recover from.
type DestinationKind = 'absent' | 'directory' | 'other'

// Only "there is nothing here" reads as absent, which is ENOENT and nothing else. A permission error
// says the opposite — something is there and cannot be inspected — and ENOTDIR says a component of
// the path is a file, which is also something rather than nothing. Reading either as absent would
// send the caller into the `cpSync` that then throws uncaught, the abort this module exists to stop.
const ABSENT_CODE = 'ENOENT'

function error_code_of(error: unknown): string {
	return error instanceof Error && 'code' in error ? String(error.code) : ''
}

function classify_path(candidate_path: string): DestinationKind {
	try {
		return lstatSync(candidate_path).isDirectory() ? 'directory' : 'other'
	} catch (error) {
		return error_code_of(error) === ABSENT_CODE ? 'absent' : 'other'
	}
}

// The reason this copy cannot run, or nothing when it can. Phrased for the console line each command
// prints, so a skip always says which of the cases it was.
function directory_copy_blocker(source_path: string, destination_path: string): string | undefined {
	if (classify_path(source_path) !== 'directory') return 'missing from the installed package'

	if (path.resolve(source_path) === path.resolve(destination_path)) {
		return "already the package's own copy"
	}

	return classify_path(destination_path) === 'other' ? 'destination is not a directory' : undefined
}

// The guards above answer what can be known before the copy; this one answers what the copy itself
// runs into. `cpSync` walks the whole tree, so a type conflict nested inside it — a consumer
// directory where the package has a file — throws only once the walk reaches it, and an uncaught
// throw here would end `josh init` or `josh sync` in the middle of their work. The message is
// returned for the caller to report, the same way a blocker is.
function copy_directory_failure(source_path: string, destination_path: string): string | undefined {
	try {
		cpSync(source_path, destination_path, { recursive: true })

		return undefined
	} catch (error) {
		return `copy failed (${error instanceof Error ? error.message : String(error)})`
	}
}

export { classify_path, copy_directory_failure, directory_copy_blocker }
export type { DestinationKind }
