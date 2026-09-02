import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { PACKAGE_DIR } from '#scripts/init/init-paths'
import { file_map_stamp, type FileMapStamp } from '#scripts/josh/file-map-stamp'
import { stamp_file } from '#scripts/josh/stamp-file'
import { eval_trigger } from './eval-trigger'

// What a `josh eval` run measured, and when (joshuafolkken/kit#1152).
//
// `/code-review` and `josh eval` both only *read* the working tree — a review's fixes are applied
// after it reports — so the suite can start when the review does instead of following it. What that
// overlap costs is certainty: the run measures the documents as they stood when it started, and a
// review that then edits a measured path leaves the result describing a tree that no longer exists.
//
// This module is the record that makes the difference readable. A content hash per measured file,
// taken before the first session, rather than a git diff — the implementation and the review's fixes
// are uncommitted in the same tree, so `git diff` cannot say which side of the review a change fell
// on, which is exactly the question the staleness check asks.

const STAMP_PREFIX = 'josh-eval-stamp-'

// The payload, its validation, the guarded read and the comparison are
// `#scripts/josh/file-map-stamp`'s since joshuafolkken/kit#1241 — `josh review:brief` keeps two more
// records of exactly this shape, and a second copy of them would let the three drift. Those in turn
// build on `#scripts/josh/stamp-file`, which has held the path, the symlink defense and the
// ownership check since joshuafolkken/kit#1215. **What stays here is the one thing that differs: which
// tree is read.**
type EvalStamp = FileMapStamp

const access = file_map_stamp.create(STAMP_PREFIX)

function stamp_path(): string {
	return access.stamp_path()
}

function is_directory(relative: string): boolean {
	return statSync(path.join(PACKAGE_DIR, relative)).isDirectory()
}

// The measured entries are files and directories alike, so each is expanded to the files beneath it.
// A missing entry contributes nothing rather than throwing: an installed kit need not carry every
// path this repository does, and a record that refused to be taken would answer `required` forever.
function files_under(entry: string): Array<string> {
	const absolute = path.join(PACKAGE_DIR, entry)

	if (!existsSync(absolute)) return []

	if (!is_directory(entry)) return [entry]

	return readdirSync(absolute, { encoding: 'utf8', recursive: true })
		.map((child) => `${entry}/${child.replaceAll(path.sep, '/')}`)
		.filter((relative) => !is_directory(relative))
}

// Sorted so two readings of one tree produce the same record byte for byte, which is what lets a
// stored stamp be compared against a fresh reading without a normalization step in between.
function read_tree(): Record<string, string> {
	const relatives = eval_trigger.MEASURED_PATHS.flatMap((entry) => files_under(entry))
	const sorted = relatives.toSorted((left, right) => left.localeCompare(right))

	return Object.fromEntries(
		sorted.map((relative) => [
			relative,
			stamp_file.digest(readFileSync(path.join(PACKAGE_DIR, relative))),
		]),
	)
}

// The reading is fallible in exactly the situation this module was written for: a review applying
// its fixes can delete or rename a measured file between the walk and the read. `undefined` — "the
// tree could not be read" — travels the same way a missing record does, so the caller answers
// `required`. Letting the throw escape would kill the process before anything reached stdout, and a
// caller capturing `$(pnpm josh eval:scope --since-eval)` would read an empty string where the whole
// point of the command is to insist on a measurement.
function try_read_tree(
	read: () => Record<string, string> = read_tree,
): Record<string, string> | undefined {
	try {
		return read()
	} catch {
		return undefined
	}
}

// A failed write leaves no record, and no record answers `required`, which is the safe direction.
function write_stamp(target: string = stamp_path()): string {
	return access.write(read_tree(), target)
}

function read_stamp(source: string = stamp_path()): EvalStamp | undefined {
	return access.read(source)
}

// Every path here is a measured one by construction — the tree is walked from the trigger's own list
// — so an empty result is the positive fact "nothing the scenarios can see has changed", never an
// unread diff. That is the distinction `eval_trigger.scope_for_measured_changes` is named for.
function changed_since(stamp: EvalStamp, tree: Record<string, string>): ReadonlyArray<string> {
	return file_map_stamp.changed_since(stamp, tree)
}

const eval_stamp = {
	changed_since,
	files_under,
	read_stamp,
	read_tree,
	stamp_path,
	try_read_tree,
	write_stamp,
}

export type { EvalStamp }
export { eval_stamp }
