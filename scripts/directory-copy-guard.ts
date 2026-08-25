import { cpSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { transform_copied_content } from '#scripts/init/init-copy-content'

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

// `cpSync` copies bytes, so a distributed directory would otherwise carry the package's own
// `prompts/…` references into a consumer, where that directory does not exist — the very rewrite
// every file copy already runs through `transform_copied_content`. Running it over the copied tree
// puts both copy paths on one transform, which is what lets a skill cite the prompt it extends
// (joshuafolkken/kit#854).
//
// Markdown only, and deliberately so: the rewrite is a text substitution, the workflow pin and
// managed-marker passes inside `transform_copied_content` are gated on a `.github/workflows`
// destination and so are no-ops here, and a binary payload run through a utf8 round-trip would be
// corrupted rather than left alone.
const TRANSFORMED_EXTENSION = '.md'

// A `.md` name is not on its own a file to rewrite: a directory or a symlink can carry the suffix,
// and `readFileSync` answers the first with EISDIR and follows the second out of the tree. Both are
// classified before the read rather than caught after it, so a stray entry is skipped instead of
// failing the copy it sits in.
// `lstat` rather than `classify_path`: that one answers "is this a directory", because its callers
// ask about a copy destination, and widening its result would silently loosen the guard that reads
// `'other'` as "refuse". This asks the opposite question and keeps its own answer.
function is_regular_file(candidate_path: string): boolean {
	try {
		return lstatSync(candidate_path).isFile()
	} catch {
		return false
	}
}

function is_transformable(candidate_path: string): boolean {
	return candidate_path.endsWith(TRANSFORMED_EXTENSION) && is_regular_file(candidate_path)
}

// The walk reads the SOURCE listing and rewrites the matching destination paths, never the
// destination's own listing. The copy merges rather than prunes, so a consumer's own notes sit
// beside the distributed files — walking the destination would rewrite those too, silently editing
// text this package never wrote. Only what was just copied is ours to touch.
function transform_copied_tree(source_path: string, destination_path: string): void {
	const entries = readdirSync(source_path, { encoding: 'utf8', recursive: true })

	for (const entry of entries) {
		if (!is_transformable(path.join(source_path, entry))) continue

		const file_path = path.join(destination_path, entry)
		const content = readFileSync(file_path, 'utf8')

		writeFileSync(file_path, transform_copied_content(file_path, content))
	}
}

// The guards above answer what can be known before the copy; this one answers what the copy itself
// runs into. `cpSync` walks the whole tree, so a type conflict nested inside it — a consumer
// directory where the package has a file — throws only once the walk reaches it, and an uncaught
// throw here would end `josh init` or `josh sync` in the middle of their work. The message is
// returned for the caller to report, the same way a blocker is.
function failure_message(prefix: string, error: unknown): string {
	return `${prefix} (${error instanceof Error ? error.message : String(error)})`
}

// The two failures are reported apart because they leave the destination in opposite states, and
// the callers print the message as the reason a directory was skipped. A `cpSync` throw means the
// copy did not finish, which "skipped" describes; a rewrite throw means the copy DID finish and the
// tree was replaced, with some files still citing the package's own `prompts/…` paths. Reporting
// that one as "skipped" would tell the user nothing was written while everything was — so it says
// the directory was replaced and names the fix, which is to run the sync again once the cause of
// the read or write error is gone. There is no rollback: a temp-directory swap would not survive
// the permission and I/O errors that are the realistic throws here either.
function copy_directory_failure(source_path: string, destination_path: string): string | undefined {
	try {
		cpSync(source_path, destination_path, { recursive: true })
	} catch (error) {
		return failure_message('copy failed', error)
	}

	try {
		transform_copied_tree(source_path, destination_path)
	} catch (error) {
		return failure_message('copied but left partly un-rewritten — re-run the sync', error)
	}

	return undefined
}

export { classify_path, copy_directory_failure, directory_copy_blocker, transform_copied_tree }
export type { DestinationKind }
