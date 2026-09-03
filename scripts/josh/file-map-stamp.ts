import { stamp_file } from './stamp-file'

// A stamp whose payload is "when this was taken, and the digest of every file it covers"
// (joshuafolkken/kit#1241).
//
// `scripts/eval/eval-stamp.ts` was the only holder of this shape. `josh review:brief` needs two more
// records of exactly the same kind — the gate's result, and the snapshot round 1 takes so round 2
// can name the fix delta — and copying the payload type, its validation, the guarded read and the
// comparison into a second module is the clone `CLAUDE.md` prohibits. What genuinely differs between
// the three is **which tree is read**, so that stays with each caller and everything else lives here.
//
// The record is deliberately not a `git diff`: the implementation and a review's fixes are
// uncommitted in the same tree, so a diff cannot say which side of the review a change fell on —
// which is the one question both readers ask.

interface FileMapStamp {
	taken_at: string
	files: Record<string, string>
	// The process that wrote it. Only a record whose meaning is "this is happening **now**" needs it —
	// the in-flight gate marker (joshuafolkken/kit#1242). The other two assert a completed past fact,
	// which stays true however long the file sits there, so they carry it and never read it.
	pid?: number
}

// Takes `unknown` rather than the declared field type, because the declared type is an assertion
// over whatever was on disk: the file is written by one command and read by another, and a truncated
// or hand-edited one has to answer "no record" rather than reach the comparison as a lie.
function is_file_map(value: unknown): value is Record<string, string> {
	if (typeof value !== 'object' || value === null) return false

	return Object.values(value).every((entry) => typeof entry === 'string')
}

// A `pid` that is not a number is dropped rather than rejected: the two records that never read one
// were written without it before joshuafolkken/kit#1242, and a reader that needs it treats its
// absence as "not running", which is the safe direction anyway.
function parse_stamp(raw: string): FileMapStamp | undefined {
	const { taken_at, files, pid } = JSON.parse(raw) as Partial<FileMapStamp>

	if (typeof taken_at !== 'string' || !is_file_map(files)) return undefined
	if (typeof pid !== 'number') return { taken_at, files }

	return { taken_at, files, pid }
}

// `signal 0` runs every permission check and delivers nothing, so it is the standard liveness probe:
// it throws `ESRCH` where the process is gone. `EPERM` means it exists but belongs to someone else,
// which cannot happen for a record this process wrote into its own temp path — and answering "not
// running" there is the safe direction regardless.
function is_process_alive(pid: number | undefined): boolean {
	if (pid === undefined) return false

	try {
		process.kill(pid, 0)

		return true
	} catch {
		return false
	}
}

// Every path in either map is one the caller's reader chose, so an empty result is the positive fact
// "nothing this record covers has changed", never an unread diff.
function changed_since(stamp: FileMapStamp, tree: Record<string, string>): ReadonlyArray<string> {
	const names = new Set([...Object.keys(stamp.files), ...Object.keys(tree)])

	return [...names]
		.filter((name) => stamp.files[name] !== tree[name])
		.toSorted((left, right) => left.localeCompare(right))
}

interface FileMapStampAccess {
	stamp_path: () => string
	write: (files: Record<string, string>, target?: string) => string
	read: (source?: string) => FileMapStamp | undefined
	// For a record whose meaning is its existence rather than its contents — the in-flight gate marker
	// (joshuafolkken/kit#1242). A record nobody removes would go on asserting a gate that ended.
	remove: (target?: string) => void
}

// `undefined` rather than a throw or an empty record: "there is no record" and "the record says
// nothing changed" are the two answers these stamps exist to keep apart, and only the first of them
// is a reason to act. A planted record would answer the safe-looking way, which is why the read is
// the guarded one in `stamp-file`.
function read_at(source: string): FileMapStamp | undefined {
	const raw = stamp_file.read_stamp_text(source)

	if (raw === undefined) return undefined

	try {
		return parse_stamp(raw)
	} catch {
		return undefined
	}
}

// The destination is a parameter on both sides so a test can exercise the round trip without
// overwriting the record a real run may be relying on — two commands share one path by design, and a
// suite that wrote to it would be a second writer nobody declared.
function create(prefix: string, root?: string): FileMapStampAccess {
	function resolve(): string {
		return stamp_file.stamp_path(prefix, root)
	}

	return {
		stamp_path: resolve,
		write: (files, target = resolve()) =>
			stamp_file.write_stamp(target, {
				taken_at: new Date().toISOString(),
				files,
				pid: process.pid,
			}),
		read: (source = resolve()) => read_at(source),
		remove: (target = resolve()) => {
			stamp_file.remove_stamp(target)
		},
	}
}

const file_map_stamp = {
	changed_since,
	create,
	is_file_map,
	is_process_alive,
	parse_stamp,
	read_at,
}

export type { FileMapStamp, FileMapStampAccess }
export { file_map_stamp }
