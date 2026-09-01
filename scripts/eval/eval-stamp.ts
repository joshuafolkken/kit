import { createHash } from 'node:crypto'
import {
	existsSync,
	lstatSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PACKAGE_DIR } from '#scripts/init/init-paths'
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

const HASH_ALGORITHM = 'sha256'
const STAMP_PREFIX = 'josh-eval-stamp-'
const STAMP_SUFFIX = '.json'
// Enough of the package path's digest to keep one checkout's record apart from another's in a shared
// temp directory, and short enough to read in a printed path.
const STAMP_KEY_LENGTH = 16
// The path is deterministic — both commands have to reach it without being told where it is — and it
// sits in a directory every account on the host may write to. A mode alone does not make that safe:
// it applies on creation, and a plain write follows a symlink someone else put there.
const STAMP_FILE_MODE = 0o600
// Create-exclusively. Refusing an existing path is what keeps a write from being redirected into a
// file the running user owns; the unlink below is what keeps the normal rewrite working.
const STAMP_WRITE_FLAG = 'wx'

interface EvalStamp {
	started_at: string
	files: Record<string, string>
}

// Bytes rather than a decoded string. UTF-8 decoding is lossy — every invalid sequence collapses to
// the same replacement character — so hashing the decoded form would let two different files under a
// measured path agree, and the check exists precisely to notice that they do not.
function digest(content: Buffer | string): string {
	return createHash(HASH_ALGORITHM).update(content).digest('hex')
}

// The temp directory rather than the repository: this is a handoff between two commands of one
// loop, and a file in the tree would have to be gitignored in kit and in every consumer `josh sync`
// reaches — a distributed ignore entry bought for something nobody is meant to keep.
function stamp_path(): string {
	const key = digest(PACKAGE_DIR).slice(0, STAMP_KEY_LENGTH)

	return path.join(tmpdir(), `${STAMP_PREFIX}${key}${STAMP_SUFFIX}`)
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
		sorted.map((relative) => [relative, digest(readFileSync(path.join(PACKAGE_DIR, relative)))]),
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
// wrote to it would be a second writer nobody declared.
//
// **The write unlinks first, then creates exclusively.** `rmSync` removes a symlink rather than
// following it, and `wx` refuses an existing path outright, so someone who re-creates the path in
// the window between the two can make this write *fail* — never make it land somewhere else. A
// failed write leaves no record, and no record answers `required`, which is the safe direction. On a
// sticky temp directory a file another account owns cannot be unlinked at all, so that case fails
// here too rather than being silently trusted later.
function write_stamp(target: string = stamp_path()): string {
	const stamp: EvalStamp = { started_at: new Date().toISOString(), files: read_tree() }

	rmSync(target, { force: true })
	writeFileSync(target, JSON.stringify(stamp), { flag: STAMP_WRITE_FLAG, mode: STAMP_FILE_MODE })

	return target
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

// The read side of the write's problem. A record is trusted to say a measurement is still current, so a
// planted one answers `skip` and suppresses the re-measure this check exists to force. `lstatSync`
// reports the link rather than what it points at, and it throws where the path is simply absent —
// both of which are "no record". `getuid` is missing on Windows, where a shared temp directory is not
// the same hazard; the check reduces to "is it a regular file" there.
function is_own_regular_file(source: string): boolean {
	const stats = lstatSync(source)

	if (!stats.isFile()) return false

	const uid = process.getuid?.()

	return uid === undefined || stats.uid === uid
}

// `undefined` rather than a throw or an empty record: "there is no record" and "the record says
// nothing changed" are the two answers this module exists to keep apart, and only the first of them
// is a reason to measure again.
function read_stamp(source: string = stamp_path()): EvalStamp | undefined {
	try {
		if (!is_own_regular_file(source)) return undefined

		return parse_stamp(readFileSync(source, 'utf8'))
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
