import { file_map_stamp, type FileMapStampAccess } from '#scripts/josh/file-map-stamp'
import { hook_decision } from '#scripts/josh/hook-decision'
import { gate_tree, type GateTree } from './gate-tree'
import { review_brief } from './review/review-brief'
import { review_stamps } from './review/review-stamps'

// Whether the two scoped checks have been green on *this exact tree* by the time the review is
// briefed (joshuafolkken/kit#1511).
//
// **The commands were already shipped; what was missing was when they run.** joshuafolkken/kit#1298
// and joshuafolkken/kit#1257 gave the run `lint:related` and `test:related`, and
// joshuafolkken/kit#1383 and joshuafolkken/kit#1246 stopped it re-running the whole gate per edit.
// None of them says the pair has to have answered before the review starts, and `fullrun #1503` is
// what that costs: the gate and round 1 were started on a tree neither check had ever read, three
// findings then arrived on three separate round trips with fourteen edits between them, and the
// rework ran 282 seconds — 31% of a 905-second run. The same run proves the cheap half: the one call
// that ran both checks together took 13.8 seconds and produced two of the three findings at once.
//
// **It fixes when the checks run, never whether they run, and never what they check.** Nothing here
// skips a check, narrows one, or reinterprets its output — a green record buys ordering and nothing
// else, and `josh gate` still runs its four checks exactly as before. That is the boundary
// joshuafolkken/kit#1420 sits on the far side of: that issue asked to *reuse* a scoped check's result
// instead of re-running it and was closed as not needed, and this record does not revive it.
//
// **The judgement is the gate's own, not a second one.** "There is a record and nothing it covers has
// moved" is `review_brief.matching_stamp` plus the base equality `gate_skip.reusable_green_gate`
// already compares, over the same `FileMapStamp` shape written to the same kind of file. A second
// definition of "this tree is unchanged" is the clone `CLAUDE.md` prohibits, and it is exactly where
// two commands would start disagreeing about one working tree.
//
// **It refuses `josh review:brief` rather than `josh gate`, and CI is why.** `.github/workflows/ci.yml`
// runs `pnpm josh gate --verbose --no-unit`, with no scoped check in front of it, so a gate that
// refused would refuse CI. The brief is run by no CI job and no lefthook hook — and it is where
// `review:attest` mints the nonce a round is counted against, so there is no path to a countable
// review round that does not pass through it.

// The escape hatch, on by default like every other distributed guard: a convention nobody can turn
// off is one a person cannot get past on the day the record is wrong about their tree.
const SWITCH_ENV_KEY = 'JOSH_SCOPED_GREEN'

const SUCCESS_EXIT_CODE = 0

const LINT_COMMAND = 'pnpm josh lint:related'
const TEST_COMMAND = 'pnpm josh test:related'

interface ScopedCheck {
	command: string
	stamp: FileMapStampAccess
	// Present and `undefined` rather than optional: under `exactOptionalPropertyTypes` an absent
	// property and one holding `undefined` are different types, and the value here comes from an
	// optional field of `ScopedSources`.
	source: string | undefined
}

// The record paths, overridable so a test can plant one without overwriting the record a real run in
// this checkout relies on — the same reason `gate_skip.reusable_green_gate` takes a `source`.
interface ScopedSources {
	lint?: string
	test?: string
}

function checks_of(sources: ScopedSources): ReadonlyArray<ScopedCheck> {
	return [
		{ command: LINT_COMMAND, stamp: review_stamps.lint_related_stamp, source: sources.lint },
		{ command: TEST_COMMAND, stamp: review_stamps.test_related_stamp, source: sources.test },
	]
}

// **An unreadable record reads as an absent one, and that is the safe direction.** `read` swallows a
// malformed or foreign file and answers `undefined`, so the two cases are indistinguishable here —
// and the consequence of treating one as the other is a single 14-second scoped run, against the
// alternative of briefing a review on a tree nothing has checked.
function describes_tree(check: ScopedCheck, tree: Record<string, string>, base: string): boolean {
	const stamp = review_brief.matching_stamp(check.stamp.read(check.source), tree)

	return stamp !== undefined && file_map_stamp.describes_base(stamp, base)
}

// **Whether there is a tree to speak about at all**, asked once and used from both ends: the reader
// refuses nothing when it is false, and the writer records nothing. Two copies of it would be two
// answers to one question — the reader could then refuse over a tree the writer had declined to
// vouch for, which is a wedge with no way out.
//
// An empty file map is a tree with nothing for a scoped check to read, and a base that could not be
// resolved is git failing to answer rather than evidence about the tree.
function is_describable(files: Record<string, string>, base: string | undefined): base is string {
	return base !== undefined && Object.keys(files).length > 0
}

// **The switch is the third state that must never refuse**, and it is a person's decision rather than
// a reading — so it sits on the reader alone. A run with the guard turned off still records, which is
// what lets turning it back on take effect immediately.
function is_answerable(tree: Record<string, string>, base: string | undefined): base is string {
	if (!hook_decision.is_switch_enabled(SWITCH_ENV_KEY)) return false

	return is_describable(tree, base)
}

function missing_checks(
	tree: Record<string, string>,
	base: string | undefined,
	sources: ScopedSources = {},
): ReadonlyArray<string> {
	if (!is_answerable(tree, base)) return []

	return checks_of(sources)
		.filter((check) => !describes_tree(check, tree, base))
		.map((check) => check.command)
}

const REFUSAL_HEADLINE = '⛔ scoped checks not green on this tree'

// **The way out travels with the refusal.** A message saying only "not verified" leaves the caller
// holding the same question and no sanctioned answer, which is how the checks ended up after the
// review in the first place. So the text names the one command that closes it, what it costs, and
// that reissuing this call is the expected next move.
function refusal(missing: ReadonlyArray<string>): string {
	return (
		`${REFUSAL_HEADLINE}: ${missing.join(' and ')} ` +
		'have not passed on the files this branch changed. The gate and review round 1 start together, ' +
		'so a brief composed now describes a tree neither check has read — joshuafolkken/kit#1503 spent ' +
		'282 seconds, 31% of the run, picking up one lint rule and one failing test at a time after its ' +
		'review had already started. Run them in one call — ' +
		`\`${LINT_COMMAND} && ${TEST_COMMAND}\`, measured at 13.8 seconds — and reissue this command. ` +
		'The record fixes when the checks run and never whether they run: nothing is skipped, narrowed ' +
		'or reused because of it. `prompts/review.md` → "The scoped checks answer on the last edit".'
	)
}

function refusal_for(
	tree: Record<string, string>,
	base: string | undefined,
	sources: ScopedSources = {},
): string | undefined {
	const missing = missing_checks(tree, base, sources)

	return missing.length === 0 ? undefined : refusal(missing)
}

// **A record is written only by a bare invocation, and any argument at all withholds it.** A path
// narrows which files were read; a flag can narrow just as hard behind a spelling that looks like
// every other flag — `--shard`, `--project`, `--testNamePattern` and `--exclude` all exit 0 having
// run a fraction of the suite. Telling a narrowing flag from a reporter flag would be a judgement
// maintained per runner, and getting it wrong writes a full green record for a partial run. Requiring
// a bare invocation costs at most one extra scoped run and cannot fail in the unsafe direction.
function is_recordable_scope(command_arguments: ReadonlyArray<string>): boolean {
	return command_arguments.length === 0
}

// Read *before* the checks start, so what they were green on can be compared with what the tree looked
// like when they finished — and read at all only when a record could follow it.
async function read_before(
	command_arguments: ReadonlyArray<string>,
): Promise<GateTree | undefined> {
	if (!is_recordable_scope(command_arguments)) return undefined

	return await gate_tree.read_gate_tree()
}

// **A tree that moved while the checks were in flight is not the tree they read** — an editor save,
// or the `PostToolUse` formatter rewriting a file mid-run. This is the comparison `record_green_gate`
// makes for the gate's own record, asked here for the same reason: without it a record vouches for
// bytes no check ever saw, it does so silently, and it does so in the unsafe direction.
function is_unmoved(before: GateTree, after: GateTree): boolean {
	if (before.base !== after.base) return false

	return JSON.stringify(before.files) === JSON.stringify(after.files)
}

function record_green(stamp: FileMapStampAccess, tree: GateTree, target?: string): void {
	if (!is_describable(tree.files, tree.base)) return

	try {
		stamp.write(tree.files, target, tree.base)
	} catch {
		/* a record that could not be written re-runs the checks rather than skipping them */
	}
}

// `before` is `undefined` both when the arguments ruled a record out and when the caller decided the
// run was inconclusive — a vitest the guard skipped rather than ran, say. Either way there is nothing
// to vouch for, and the two do not need telling apart here.
interface GreenRecord {
	before: GateTree | undefined
	exit_code: number
	// Where the record lands, defaulted by the stamp itself. It exists for the same reason
	// `record_green` and `gate_skip.reusable_green_gate` take one: without it this function can only
	// write the real per-checkout record, so a suite exercising it would vouch for the surrounding
	// run's own tree — the second-writer trap joshuafolkken/kit#1437 and joshuafolkken/kit#1441
	// closed for the gate and round-1 records.
	target?: string
}

async function record_if_green(stamp: FileMapStampAccess, record: GreenRecord): Promise<void> {
	const { before, exit_code, target } = record

	if (before === undefined || exit_code !== SUCCESS_EXIT_CODE) return
	if (!is_unmoved(before, await gate_tree.read_gate_tree())) return

	record_green(stamp, before, target)
}

const scoped_green = {
	LINT_COMMAND,
	REFUSAL_HEADLINE,
	SWITCH_ENV_KEY,
	TEST_COMMAND,
	is_recordable_scope,
	is_unmoved,
	missing_checks,
	read_before,
	record_green,
	record_if_green,
	refusal,
	refusal_for,
}

export type { GreenRecord, ScopedSources }
export { scoped_green }
