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
	// The commit the file map is defined against (joshuafolkken/kit#1328). Every reader of these
	// records computes its map as a diff against that commit — the branch's merge base with the
	// default branch since joshuafolkken/kit#1527 — so **the map alone does not describe a tree**:
	// fetch an advanced default branch and rebase onto it, and every digest can stay identical while
	// the rest of the working tree is replaced by code no check has read. The rebase moves `HEAD` and
	// so moves the merge base, which is what this field catches; another lane merging into the shared
	// default branch moves neither, and correctly leaves the record standing. Only a reader that acts
	// on the record — `josh gate`, which reuses a green result instead of re-running it — needs the
	// guarantee, so it is the one that writes and compares this.
	base?: string
	// When the run that wrote this record reached its verdict (joshuafolkken/kit#1164). Written only
	// by `complete`, so it is absent on a record whose run was interrupted or threw — which is the
	// whole difference between "a run measured this tree" and "a run measured this tree and
	// finished". Only a reader that acts on the *verdict* needs the second, so `josh eval` writes and
	// reads it and the two `josh review:brief` records, which assert a completed past fact by
	// existing at all, neither write nor read it.
	completed_at?: string
}

// Takes `unknown` rather than the declared field type, because the declared type is an assertion
// over whatever was on disk: the file is written by one command and read by another, and a truncated
// or hand-edited one has to answer "no record" rather than reach the comparison as a lie.
function is_file_map(value: unknown): value is Record<string, string> {
	if (typeof value !== 'object' || value === null) return false

	return Object.values(value).every((entry) => typeof entry === 'string')
}

// An optional field of the wrong type is dropped rather than rejected: the records that never read
// one were written without it before joshuafolkken/kit#1242 and joshuafolkken/kit#1328, and every
// reader treats an absent field as the safe answer — "not running" for a `pid`, "cannot be reused"
// for a `base`. Spread rather than assigned, because `exactOptionalPropertyTypes` makes an explicit
// `undefined` a different thing from an absent key.
function optional_fields(
	pid: unknown,
	base: unknown,
	completed_at: unknown,
): Partial<FileMapStamp> {
	return {
		...(typeof pid === 'number' && { pid }),
		...(typeof base === 'string' && { base }),
		...(typeof completed_at === 'string' && { completed_at }),
	}
}

function parse_stamp(raw: string): FileMapStamp | undefined {
	const { taken_at, files, pid, base, completed_at } = JSON.parse(raw) as Partial<FileMapStamp>

	if (typeof taken_at !== 'string' || !is_file_map(files)) return undefined

	return { taken_at, files, ...optional_fields(pid, base, completed_at) }
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
	// `base` is written by the one record that is acted on rather than merely reported —
	// joshuafolkken/kit#1328's green-gate reuse. The others omit it and are unaffected.
	write: (files: Record<string, string>, target?: string, base?: string) => string
	// Marks an existing record as belonging to a run that finished (joshuafolkken/kit#1164). It
	// amends rather than rewrites, and answers `undefined` where there is no record to amend: a run
	// whose record never got written has nothing to assert a completion about, and inventing one here
	// would manufacture the very vouching the field exists to withhold.
	complete: (target?: string) => string | undefined
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

// Amending is the whole point, and re-writing would defeat it: `write` stamps a fresh `taken_at` and
// takes a fresh file map, so calling it again at the end of a run would claim the tree as the run
// *left* it was the tree the run measured — the record would then vouch for a comparison of that
// tree against itself, which is the one answer it exists to withhold (joshuafolkken/kit#1164).
//
// **It completes only a record this process wrote**, which the `pid` already in the payload is what
// says. The path is deterministic per checkout, so a second whole-suite run started beside the first
// overwrites it with its own record — and a completion stamped onto that one would describe a run
// that is still going, or was killed, as finished: the false `skip` this field exists to prevent,
// reintroduced from the other side. A foreign record answers `undefined`, which every caller already
// reads as "no completion", which is `required`.
//
// The write is of the *parsed* record, so it carries exactly the fields `parse_stamp` knows. That is
// deliberate but total-by-assumption: a field added to `write` without a matching entry in
// `parse_stamp` and `optional_fields` would be dropped by any `complete`, so the two are extended
// together.
function complete_at(target: string): string | undefined {
	const stamp = read_at(target)

	if (stamp === undefined) return undefined

	if (stamp.pid !== process.pid) return undefined

	return stamp_file.write_stamp(target, { ...stamp, completed_at: new Date().toISOString() })
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
		// `base` goes into the payload undefined and all — `JSON.stringify` drops an undefined value,
		// so a caller that has no base writes exactly the record it wrote before this field existed.
		write: (files, target = resolve(), base?: string) =>
			stamp_file.write_stamp(target, {
				taken_at: new Date().toISOString(),
				files,
				pid: process.pid,
				base,
			}),
		complete: (target = resolve()) => complete_at(target),
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
