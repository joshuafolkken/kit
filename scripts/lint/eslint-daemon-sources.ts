import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'

// **What the daemon's type program may hold an old copy of: every file whose content differs from the
// commit checked out.** The program keeps each source it read but did not lint, and never re-reads it,
// so a shell edit to an imported module — one the edit hook never sees — left typed rules failing on
// the module's old exports, and the cache guard then recorded that verdict under the new closure hash,
// so it replayed even after the daemon was stopped (joshuafolkken/kit#4867). A file equal to HEAD is
// already covered by the HEAD in the fingerprint, so only the changed ones are hashed: one entry each,
// `<path>\t<content digest>`, one per line, sorted.
//
// The edit hook lints the file it edited through the daemon, which reads it fresh, so it refreshes
// that one entry (`refresh`); an edit it never saw leaves the entry behind, and the next run restarts.

// NUL-separated, so a path git would quote and escape — any non-ASCII name — reads as the file it is.
const CHANGED_FILES: ReadonlyArray<string> = ['diff', 'HEAD', '--name-only', '--relative', '-z']
const NEW_FILES: ReadonlyArray<string> = ['ls-files', '--others', '--exclude-standard', '-z']
const PATH_SEPARATOR = '\0'
const LINE_SEPARATOR = '\n'
const ENTRY_SEPARATOR = '\t'
const DIGEST_ALGORITHM = 'sha256'
const ABSENT = 'absent'
const UNREAD = ':unread'

// One order for `snapshot` and `refresh` alike, so a refreshed record compares equal to a fresh one.
function by_text(left: string, right: string): number {
	return left.localeCompare(right)
}

function lines_of(text: string): ReadonlyArray<string> {
	return text.split(LINE_SEPARATOR).filter((line) => line !== '')
}

function content_digest(file: string): string {
	try {
		return createHash(DIGEST_ALGORITHM).update(readFileSync(file)).digest('hex')
	} catch {
		return ABSENT
	}
}

// A git that could not answer lists a path no file has, so its record differs from one with no changes.
function changed_paths(project_root: string): ReadonlyArray<string> {
	const listed = [CHANGED_FILES, NEW_FILES].map(
		(git_arguments) => git_spawn_sync.read(git_arguments, { cwd: project_root }) ?? UNREAD,
	)

	const paths = listed.join(PATH_SEPARATOR).split(PATH_SEPARATOR)

	return [...new Set(paths.filter((relative) => relative !== ''))]
}

// The changed files' entries, sorted — nothing when no file differs from HEAD.
function snapshot(project_root: string): string {
	return changed_paths(project_root)
		.map(
			(relative) =>
				`${relative}${ENTRY_SEPARATOR}${content_digest(path.join(project_root, relative))}`,
		)
		.toSorted(by_text)
		.join(LINE_SEPARATOR)
}

// A recorded fingerprint — its first line the daemon's other inputs, the rest `snapshot`'s entries —
// with `relative`'s entry as `current` has it now: the daemon has just read that one file fresh.
function refresh(recorded: string, current: string, relative: string): string {
	const prefix = `${relative}${ENTRY_SEPARATOR}`
	const [inputs = '', ...entries] = lines_of(recorded)
	const others = entries.filter((line) => !line.startsWith(prefix))
	const fresh = lines_of(current).filter((line) => line.startsWith(prefix))

	return [inputs, ...[...others, ...fresh].toSorted(by_text)].join(LINE_SEPARATOR)
}

const eslint_daemon_sources = { refresh, snapshot, LINE_SEPARATOR }

export { eslint_daemon_sources }
