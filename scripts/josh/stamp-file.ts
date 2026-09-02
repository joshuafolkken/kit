import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PACKAGE_DIR } from '#scripts/init/init-paths'

// A small record one josh command writes and another reads, kept per checkout in the temp directory.
//
// Extracted from `scripts/eval/eval-stamp.ts` when `josh latest:scope` needed the same handoff
// (joshuafolkken/kit#1215). The mechanics below are not boilerplate — the symlink defense on the
// write, the ownership check on the read, and the deterministic per-checkout path are each load
// bearing — so a second copy of them is the clone `CLAUDE.md` prohibits. What differs between the
// two records is their *payload* and the question asked of it, and that is all either module keeps.

const HASH_ALGORITHM = 'sha256'
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

// Bytes rather than a decoded string. UTF-8 decoding is lossy — every invalid sequence collapses to
// the same replacement character — so hashing the decoded form would let two different files agree,
// and the checks built on this exist precisely to notice that they do not.
function digest(content: Buffer | string): string {
	return createHash(HASH_ALGORITHM).update(content).digest('hex')
}

// The temp directory rather than the repository: this is a handoff between two commands of one
// loop, and a file in the tree would have to be gitignored in kit and in every consumer `josh sync`
// reaches — a distributed ignore entry bought for something nobody is meant to keep.
//
// **`root` is what the record is keyed to, and the right answer differs per caller.** `PACKAGE_DIR`
// is the default because `josh eval` measures the kit package's own files. A record about the
// *project* must key on `PROJECT_ROOT` instead: a globally installed `josh` has one `PACKAGE_DIR`
// for every project on the machine, so keying on it would let a run in one project answer for
// another (joshuafolkken/kit#1215).
function stamp_path(prefix: string, root: string = PACKAGE_DIR): string {
	const key = digest(root).slice(0, STAMP_KEY_LENGTH)

	return path.join(tmpdir(), `${prefix}${key}${STAMP_SUFFIX}`)
}

// **The write unlinks first, then creates exclusively.** `rmSync` removes a symlink rather than
// following it, and `wx` refuses an existing path outright, so someone who re-creates the path in
// the window between the two can make this write *fail* — never make it land somewhere else. A
// failed write leaves no record, and no record is the safe answer for every reader here. On a sticky
// temp directory a file another account owns cannot be unlinked at all, so that case fails here too
// rather than being silently trusted later.
function write_stamp(target: string, payload: unknown): string {
	rmSync(target, { force: true })
	writeFileSync(target, JSON.stringify(payload), { flag: STAMP_WRITE_FLAG, mode: STAMP_FILE_MODE })

	return target
}

// The read side of the write's problem. A record is trusted to say something is still current, so a
// planted one suppresses the work the check exists to force. `lstatSync` reports the link rather than
// what it points at, and it throws where the path is simply absent — both of which are "no record".
// `getuid` is missing on Windows, where a shared temp directory is not the same hazard; the check
// reduces to "is it a regular file" there.
function is_own_regular_file(source: string): boolean {
	const stats = lstatSync(source)

	if (!stats.isFile()) return false

	const uid = process.getuid?.()

	return uid === undefined || stats.uid === uid
}

// `undefined` rather than a throw or an empty string: "there is no record" and "the record says
// nothing has to be done" are two different answers, and only the first of them is a reason to act.
function read_stamp_text(source: string): string | undefined {
	try {
		if (!is_own_regular_file(source)) return undefined

		return readFileSync(source, 'utf8')
	} catch {
		return undefined
	}
}

const stamp_file = {
	digest,
	is_own_regular_file,
	read_stamp_text,
	stamp_path,
	write_stamp,
}

export { stamp_file }
