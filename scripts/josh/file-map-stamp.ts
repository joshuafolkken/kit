import { process_identity } from './process-identity'
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
	// The other half of that process's identity: when it started (joshuafolkken/kit#1245). **A pid
	// alone names whatever holds that number now**, so a marker left behind by a killed gate began
	// reading as live again the moment the operating system reissued its pid — the brief then reporting
	// a gate running on this tree about a gate that no longer exists. The pair separates them, because
	// a reissued pid necessarily started after the record was written. Written by every record and read
	// only by the one that asserts the present, exactly as `pid` already was; a record written before
	// the field existed carries none, which `process_identity.is_same_process` answers as "cannot tell"
	// rather than as a match.
	process_start?: string
	// The commit the file map is defined against (joshuafolkken/kit#1328). Every reader of these
	// records computes its map as a diff against that commit — the branch's merge base with the
	// default branch since joshuafolkken/kit#1527 — so **the map alone does not describe a tree**:
	// fetch an advanced default branch and rebase onto it, and every digest can stay identical while
	// the rest of the working tree is replaced by code no check has read. The rebase moves `HEAD` and
	// so moves the merge base, which is what this field catches; another lane merging into the shared
	// default branch moves neither, and correctly leaves the record standing. Every reader that acts on
	// a record rather than merely reporting it needs the guarantee: `josh gate`, which reuses a green
	// result instead of re-running it, and since joshuafolkken/kit#1537 the round-1 review snapshot,
	// whose whole use is to name what round 1's fixes changed. A record written without it is refused
	// rather than trusted.
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
	process_start: unknown,
): Partial<FileMapStamp> {
	return {
		...(typeof pid === 'number' && { pid }),
		...(typeof base === 'string' && { base }),
		...(typeof completed_at === 'string' && { completed_at }),
		...(typeof process_start === 'string' && { process_start }),
	}
}

function parse_stamp(raw: string): FileMapStamp | undefined {
	const { taken_at, files, pid, base, completed_at, process_start } = JSON.parse(
		raw,
	) as Partial<FileMapStamp>

	if (typeof taken_at !== 'string' || !is_file_map(files)) return undefined

	return { taken_at, files, ...optional_fields(pid, base, completed_at, process_start) }
}

// Whether the process that wrote this record is still running (joshuafolkken/kit#1245). It takes the
// whole record rather than a pid, because a pid on its own is not a process: asked that way a caller
// could not tell the writing process from whatever the operating system later reissued its number to,
// which is exactly the state the in-flight marker must never describe.
//
// **Three answers, and no record at all is the definite `false`.** `undefined` is "there is a live
// process with that pid and this platform cannot say whether it is the writer" — a record from before
// the field existed, a machine with no `ps`, or a probe that failed under load.
function writer_state(stamp: FileMapStamp | undefined): boolean | undefined {
	if (stamp === undefined) return false

	return process_identity.is_same_process(stamp.pid, stamp.process_start)
}

// **For a claim: only when certain.** `josh review:brief` prints "a gate is running on this tree", so
// an uncertain answer must not become that sentence; it becomes `Not verified`, and the run pays one
// redundant reading of checks it was already running.
function is_writer_running(stamp: FileMapStamp | undefined): boolean {
	return writer_state(stamp) === true
}

// **For a guard: only when certain of the opposite.** `josh bench` deletes caches a running gate is
// reading, so the question it must ask is not "is the writer running" but "am I sure it is gone" — an
// uncertain answer there would clear the caches out from under a live gate, which is the very event
// joshuafolkken/kit#1332 was filed for. The probe is a subprocess and can fail on a loaded machine,
// which is exactly the machine a gate makes, so this is not a theoretical branch.
function is_writer_gone(stamp: FileMapStamp | undefined): boolean {
	return writer_state(stamp) === false
}

// Whether a record may be compared against a map read now (joshuafolkken/kit#1537). Every map here is
// a diff against `change_base`, so two of them taken against **different** bases do not cover the same
// set of paths — and `changed_since` below reports that set difference as though the files had been
// edited. Measured on the resumed runs of #1080 / #1085 / #1147 / #1197: a merge of the default branch
// between the two rounds moved the base, and the round-2 target then named files the branch had never
// touched while omitting files it had.
//
// **A record written before the field existed carries no base, and that reads as "cannot be compared"
// rather than "matches".** The caller's only safe response to an unusable record is to widen its
// round, never to narrow it, so the absent case has to fall on the same side as a mismatch.
//
// **`undefined` on either side is a mismatch, never a match.** A caller that could not resolve the
// base to a commit knows less than one that could, and two unknowns comparing equal is the same
// fail-open the ref-name fallback produces.
function describes_base(stamp: FileMapStamp, base: string | undefined): boolean {
	return base !== undefined && stamp.base === base
}

// Every path in either map is one the caller's reader chose, so an empty result is the positive fact
// "nothing this record covers has changed", never an unread diff.
//
// **It says nothing about two maps read against different bases.** It takes the union of the key
// sets, so a path only one of them covers is reported as changed — a set difference, not an edit.
// Callers guard that with `describes_base` above (joshuafolkken/kit#1537).
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
// **The pid is not the whole of that check either** (joshuafolkken/kit#1245). A record left behind by
// a run that was killed, whose pid this process was later handed, passes `pid === process.pid` — and
// stamping it would describe that dead run as finished, which is the false `skip` the field exists to
// prevent, reached from a third direction. `is_writer_gone` is the added half rather than
// `is_writer_running`, so a record carrying no start time keeps the behavior it had: the run that
// wrote it is the one completing it, and refusing there would answer `required` forever on any
// platform that cannot report a start time.
function is_own_record(stamp: FileMapStamp): boolean {
	return stamp.pid === process.pid && !is_writer_gone(stamp)
}

function complete_at(target: string): string | undefined {
	const stamp = read_at(target)

	if (stamp === undefined) return undefined

	if (!is_own_record(stamp)) return undefined

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
		// `own_fields` is what writes the pid, and since joshuafolkken/kit#1245 the writing process's
		// start time beside it — assembled in one place so no record can carry half an identity.
		write: (files, target = resolve(), base?: string) =>
			stamp_file.write_stamp(target, {
				taken_at: new Date().toISOString(),
				files,
				...process_identity.own_fields(),
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
	describes_base,
	is_file_map,
	is_writer_gone,
	is_writer_running,
	parse_stamp,
	read_at,
}

export type { FileMapStamp, FileMapStampAccess }
export { file_map_stamp }
