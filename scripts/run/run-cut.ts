import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { git_command } from '#scripts/git/git-command'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_dispatch } from '#scripts/lane/lane-dispatch'
import { z } from 'zod'
import { run_hold } from './run-hold'

// joshuafolkken/kit#1839: a lane child is a detached `fullrun #<N>` process, and the thinking it
// accumulates while implementing rides on every later API call in the same session — measured at 176K
// of 204K output on joshuafolkken/kit#1837. This record lets that child **end its process before the
// gate** and have a fresh one resume from the gate onward, so the accumulated thinking is dropped
// rather than carried. The conversation is not persisted: joshuafolkken/kit#1567 found a compaction
// does not reduce billing, so the fresh session reads the plan and the recorded decisions back off
// GitHub and finds the implementation still sitting in the lane's own working tree.
//
// **The unit is the working tree, exactly as `run-hold.ts` keys itself** — one branch and one
// uncommitted diff, a single lane — so the key is the work tree's own git directory (index 0), reused
// from `run-hold.ts` rather than re-derived. The two records sit side by side: `run-hold` guards the
// tree, and this one carries a single child's pre-gate resume point across the process boundary.
//
// **The working tree is not in the record, because it never left the disk.** Ending the process does
// not touch the lane directory: the branch and the uncommitted implementation are still there when
// the fresh process starts in the same directory. The record carries only what a fresh process cannot
// recover on its own — which issue, which branch, and that a declared cut (not a crash) put it here —
// and the resume *verifies* the tree against it rather than restoring it.
//
// **No owner is recorded, and that is deliberate** (joshuafolkken/kit#1839 review). A cut relaunches
// exactly one fresh process — `begin_cut`'s exclusive create refuses a second cut — so there is no
// live owner a resume must be blocked against, and recording the cutting session's pid would only
// stall the resume against a process that is on its way out. **Resume uniqueness rests on the
// hand-off instead**: `adopt_cut` spends `is_handed_off`, so a second resume reads a record no longer
// handed off and is refused `stale`, and its exclusive create refuses a truly concurrent second
// adopter.

const CUT_PREFIX = 'josh-run-cut-'
const PRE_GATE_PHASE = 'pre-gate'
// **The whole-run bound is `backlog-budget.ts`'s, imported rather than restated** — the same reuse
// `run-carry.ts` makes. A resume is expected within seconds of the cut, so this age is only a backstop
// against a fresh process that never started; an expired record is cleared and replaced by the next
// cut rather than blocking it.
const CUT_MAX_AGE_MS = backlog_budget.WHOLE_RUN_BUDGET_MS
const CUT_MAX_AGE_HOURS = backlog_budget.WHOLE_RUN_BUDGET_HOURS

const END_COMMAND = 'pnpm josh run:cut --end'
const READ_COMMAND = 'pnpm josh run:cut --json'

interface RunCut {
	// The command the fresh process runs — `fullrun #<N>`, built through `lane_dispatch.child_invocation`
	// so the format is single-sourced with the dispatch that first launched the child.
	invocation: string
	issue: string
	// The branch the implementation sits on. The resume refuses to continue on any other branch, so a
	// fresh process that started in the wrong tree is caught rather than gating someone else's work.
	branch: string
	// Where in the run the cut happened. One boundary exists today (`pre-gate`); the field is here so a
	// second one can be told apart rather than guessed.
	phase: string
	cut_at: string
	// Set by the cut, and spent by the adoption. A crash never sets it, which is what makes a declared
	// cut the only state that resumes, and spending it is what makes a resume unique.
	is_handed_off?: boolean | undefined
}

// The current tree's state, read once and handed to the pure classifier.
interface CutState {
	branch: string
	is_dirty: boolean
	is_held: boolean
}

// The two fields a cut is written from, bundled so `begin_cut` stays within the parameter limit.
interface CutSpec {
	issue: string
	branch: string
}

// What the resume classifier is asked about, gathered from the fresh process's own git state so the
// record can be checked against reality rather than trusted.
interface CutResumeRequest {
	issue: string
	current_branch: string
	is_dirty: boolean
	is_held: boolean
}

// **`resume` carries the run on; `stale` stops it.** A resume failure — wrong branch, a clean tree, an
// expired record, no declared cut, or a tree no longer under its hold — is `stale` rather than run.
type CutResume = 'resume' | 'stale'

type CutRead =
	| { kind: 'none' }
	| { kind: 'carried'; cut: RunCut }
	| { kind: 'expired'; cut: RunCut }
	| { kind: 'unreadable' }

const NONE_READ: CutRead = { kind: 'none' }
const UNREADABLE_READ: CutRead = { kind: 'unreadable' }

const run_cut_schema = z.object({
	invocation: z.string(),
	issue: z.string(),
	branch: z.string(),
	phase: z.string(),
	cut_at: z.string(),
	is_handed_off: z.boolean().optional(),
})

function cut_path(git_directory: string): string {
	return stamp_file.stamp_path(CUT_PREFIX, git_directory)
}

// The work tree's own git directory (index 0), reused from `run-hold.ts` so a cut and the hold it
// resumes under key to exactly the same tree — never a second copy of the index-0 derivation.
const { worktree_directory } = run_hold

// `fullrun #<N>`, validated and formatted once in `lane_dispatch.child_invocation` so the record and
// the dispatch cannot disagree about what a lane child is.
function invocation_for(issue: string): string {
	return lane_dispatch.child_invocation(issue)
}

function parse_cut(raw: string): RunCut | undefined {
	try {
		const parsed = run_cut_schema.safeParse(JSON.parse(raw))

		return parsed.success ? parsed.data : undefined
	} catch {
		return undefined
	}
}

// A `cut_at` that is not a date is read as expired, for the reason `run-carry.ts` reads an unparsable
// `started_at` that way: a record nothing can ever expire is the one state the bound exists to
// prevent.
function is_expired(cut: RunCut, now: Date): boolean {
	const started = Date.parse(cut.cut_at)

	if (Number.isNaN(started)) return true

	return now.getTime() - started > CUT_MAX_AGE_MS
}

function classify(raw: string | undefined, now: Date): CutRead {
	if (raw === undefined) return NONE_READ

	const cut = parse_cut(raw)

	if (cut === undefined) return UNREADABLE_READ

	return is_expired(cut, now) ? { kind: 'expired', cut } : { kind: 'carried', cut }
}

function read_cut(target: string, now: Date = new Date()): CutRead {
	return classify(stamp_file.read_stamp_text(target), now)
}

function fresh_cut(spec: CutSpec, now: Date): RunCut {
	return {
		invocation: invocation_for(spec.issue),
		issue: spec.issue,
		branch: spec.branch,
		phase: PRE_GATE_PHASE,
		cut_at: now.toISOString(),
		is_handed_off: true,
	}
}

// **Create-exclusively, exactly as `run-hold.ts` claims a tree.** A record already here means a cut is
// already in flight for this tree, so `undefined` is "do not launch a second one" rather than an
// error — the exclusive create is what makes a double cut, and so a double relaunch, impossible.
function begin_cut(target: string, spec: CutSpec, now: Date = new Date()): RunCut | undefined {
	const cut = fresh_cut(spec, now)

	return stamp_file.create_stamp(target, cut) ? cut : undefined
}

// A declared cut for exactly this invocation. A crash leaves `is_handed_off` unset, so it never
// matches; a record left by another issue's run names a different invocation; and a spent hand-off —
// the mark an adoption already took — is no longer a declared cut, which is what stops a second
// resume.
function is_declared_cut(cut: RunCut, issue: string): boolean {
	return cut.is_handed_off === true && cut.invocation === invocation_for(issue)
}

// The tree the fresh process is standing in matches the one the cut recorded: same branch, same
// issue, the implementation still uncommitted, and still under the hold the cutting run held. A clean
// tree means the work is gone; a tree with no hold is not the one the cut was taken in.
function matches_state(cut: RunCut, request: CutResumeRequest): boolean {
	return (
		cut.branch === request.current_branch &&
		cut.issue === request.issue &&
		request.is_dirty &&
		request.is_held
	)
}

// A resume requires both a declared cut and a matching tree; anything short of that is `stale`, which
// stops the run rather than gating a half-written or foreign tree, or one no longer under its hold.
function classify_resume(cut: RunCut, request: CutResumeRequest): CutResume {
	if (!is_declared_cut(cut, request.issue)) return 'stale'

	return matches_state(cut, request) ? 'resume' : 'stale'
}

// Taking the hand-off over spends it, so a second `--resume` reads `is_handed_off: false` and is
// refused `stale`. It removes and then creates exclusively, so two truly concurrent resumes cannot
// both win the create.
function adopt_cut(target: string, cut: RunCut): RunCut | undefined {
	const next: RunCut = { ...cut, is_handed_off: false }

	stamp_file.remove_stamp(target)

	return stamp_file.create_stamp(target, next) ? next : undefined
}

function end_cut(target: string): void {
	stamp_file.remove_stamp(target)
}

// Whether a run hold still stands over this tree — present as `held` or as an aged-out `stale`, but
// present. A tree with no hold at all is not the one a cut was taken in, so the resume refuses it.
function tree_is_held(directory: string | undefined): boolean {
	if (directory === undefined) return false

	const read = run_hold.read_hold(run_hold.hold_path(directory))

	return read.kind === 'held' || read.kind === 'stale'
}

async function current_state(): Promise<CutState> {
	const branch = await git_command.branch()
	const is_dirty = await run_hold.is_tree_dirty()
	const directory = await worktree_directory()

	return { branch, is_dirty, is_held: tree_is_held(directory) }
}

function describe_cut(cut: RunCut): string {
	return `${cut.invocation} cut at ${cut.cut_at} on ${cut.branch} (${cut.phase})`
}

// With no owner recorded, a `busy` can only be the exclusive create losing: another process adopted
// this cut first. It is the double-launch signal a resume reports rather than a live-owner refusal.
function busy_message(cut: RunCut): string {
	return `Another process already resumed this cut — ${describe_cut(cut)}. Nothing was resumed here; a double launch was detected.`
}

// The record does not match the tree the fresh process is in — wrong branch, a clean tree, an expired
// record, no declared cut, or a tree no longer under its hold. It is a resume failure, said as such
// rather than reported as a success, so the run stops instead of gating the wrong tree.
function stale_message(cut: RunCut): string {
	return `This cut does not match the current tree — ${describe_cut(cut)}. Resume failed; verify the branch and the uncommitted work, then clear it with \`${END_COMMAND}\` if the run is over.`
}

function unreadable_message(): string {
	return `A cut record is here but could not be read; clear it with \`${END_COMMAND}\` once you know no run is using it. Read it with \`${READ_COMMAND}\`.`
}

function unknown_message(): string {
	return 'This working tree’s git directory could not be read, so no cut record was acted on.'
}

const run_cut = {
	CUT_MAX_AGE_HOURS,
	CUT_MAX_AGE_MS,
	END_COMMAND,
	PRE_GATE_PHASE,
	adopt_cut,
	begin_cut,
	busy_message,
	classify,
	classify_resume,
	current_state,
	cut_path,
	describe_cut,
	end_cut,
	fresh_cut,
	invocation_for,
	is_expired,
	read_cut,
	stale_message,
	unknown_message,
	unreadable_message,
	worktree_directory,
}

export type { CutRead, CutResume, CutResumeRequest, CutSpec, CutState, RunCut }
export { run_cut }
