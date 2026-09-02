import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { PACKAGE_DIR } from '#scripts/init/init-paths'
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

interface EvalStamp {
	started_at: string
	files: Record<string, string>
}

// The path, the guarded write and the guarded read are `#scripts/josh/stamp-file`'s since
// joshuafolkken/kit#1215 — `josh latest:scope` keeps the same kind of record, and a second copy of
// the symlink and ownership defenses would let the two drift. What stays here is the payload and the
// question asked of it.
function stamp_path(): string {
	return stamp_file.stamp_path(STAMP_PREFIX)
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

// The destination is a parameter so a test can exercise the round trip without overwriting the
// record a real run may be relying on — the two commands share one path by design, and a suite that
// wrote to it would be a second writer nobody declared. A failed write leaves no record, and no
// record answers `required`, which is the safe direction.
function write_stamp(target: string = stamp_path()): string {
	const stamp: EvalStamp = { started_at: new Date().toISOString(), files: read_tree() }

	return stamp_file.write_stamp(target, stamp)
}

// Takes `unknown` rather than the declared field type, because the declared type is an assertion
// over whatever was on disk: the file is written by one command and read by another, and a truncated
// or hand-edited one has to answer "no record" rather than reach the comparison as a lie.
function is_file_map(value: unknown): value is Record<string, string> {
	if (typeof value !== 'object' || value === null) return false

	return Object.values(value).every((entry) => typeof entry === 'string')
}

function parse_stamp(raw: string): EvalStamp | undefined {
	const { started_at, files } = JSON.parse(raw) as Partial<EvalStamp>

	if (typeof started_at !== 'string' || !is_file_map(files)) return undefined

	return { started_at, files }
}

// `undefined` rather than a throw or an empty record: "there is no record" and "the record says
// nothing changed" are the two answers this module exists to keep apart, and only the first of them
// is a reason to measure again. A planted record would answer `skip` and suppress the re-measure the
// check exists to force, which is why the read is the guarded one in `stamp-file`.
function read_stamp(source: string = stamp_path()): EvalStamp | undefined {
	const raw = stamp_file.read_stamp_text(source)

	if (raw === undefined) return undefined

	try {
		return parse_stamp(raw)
	} catch {
		return undefined
	}
}

// Every path here is a measured one by construction — the tree is walked from the trigger's own list
// — so an empty result is the positive fact "nothing the scenarios can see has changed", never an
// unread diff. That is the distinction `eval_trigger.scope_for_measured_changes` is named for.
function changed_since(stamp: EvalStamp, tree: Record<string, string>): Array<string> {
	const names = new Set([...Object.keys(stamp.files), ...Object.keys(tree)])

	return [...names]
		.filter((name) => stamp.files[name] !== tree[name])
		.toSorted((left, right) => left.localeCompare(right))
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
