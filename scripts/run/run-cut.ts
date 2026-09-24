import { execFileSync } from 'node:child_process'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { CONTEXT_CUT_THRESHOLD } from '#scripts/cost-runtime/context-cut-threshold'
import { git_utilities } from '#scripts/git/constants'
import { git_command } from '#scripts/git/git-command'
import { git_location_environment } from '#scripts/git/git-location-environment'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_child_invocation } from '#scripts/lane/lane-child-invocation'
import { z } from 'zod'
import { run_cut_handoff, type Handoff } from './run-cut-handoff'
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
// **The two phase names are `agent-role-profile.ts`'s** (joshuafolkken/kit#2382): a lane child resumes
// into a phase, and that module resolves the effort the resumed child runs at from the same name. Reading
// them from there rather than restating the literals here is what keeps the phase a cut records and the
// phase the effort table is keyed on from drifting. `PRE_GATE_PHASE` is the boundary before the gate;
// `IMPLEMENTATION_PHASE` (joshuafolkken/kit#1933) drops the thinking accumulated *during* implementation
// and resumes back into implementation (`resumes_into_implementation`); only the pre-gate cut resumes
// into the gate. The setup-phase cut (joshuafolkken/kit#2346) was retired by joshuafolkken/kit#2489.
const { PRE_GATE_PHASE, IMPLEMENTATION_PHASE } = agent_role_profile
// **The measurement is the parent hand-off's, never a second one** (joshuafolkken/kit#1933). The lane
// child decides whether to take this cut with `pnpm josh cost --cut`
// — the same per-request billed-input measurement (`cost_verdict.per_request_cost`) the parent's
// `pnpm josh cost --cut` hand-off uses (`backlogrun-progress.md` → "The hand-off"). The shared
// threshold prevents the scheduler and worker boundaries from drifting apart.
const IMPLEMENTATION_CONTEXT_THRESHOLD = CONTEXT_CUT_THRESHOLD
// **The whole-run bound is `backlog-budget.ts`'s, imported rather than restated** — the same reuse
// `run-carry.ts` makes. A resume is expected within seconds of the cut, so this age is only a backstop
// against a fresh process that never started; an expired record is cleared and replaced by the next
// cut rather than blocking it.
const CUT_MAX_AGE_MS = backlog_budget.WHOLE_RUN_BUDGET_MS
const CUT_MAX_AGE_HOURS = backlog_budget.WHOLE_RUN_BUDGET_HOURS

// The synchronous git read runs inside a `PreToolUse` hook, which holds the tool call for as long as
// it takes; `rev-parse` takes no lock, so anything past a second is a fault rather than slow work.
const GIT_READ_TIMEOUT_MS = 5000

// The two lines `GIT_DIRECTORY_ARGUMENTS` prints, in order: the work tree's own git directory, then the
// common one every lane of a repository shares. `git_directories` reads the same two asynchronously.
const WORKTREE_DIRECTORY_INDEX = 0

const END_COMMAND = 'pnpm josh run:cut --end'
const READ_COMMAND = 'pnpm josh run:cut --json'

// The mechanical bound on the hand-off record's serialized size (joshuafolkken/kit#2346,
// joshuafolkken/kit#2354). The cut is only worth its resume while the record a fresh process reads back
// stays small — a record that grew to carry the conversation would defeat the whole point,
// re-establishing at the resume the context the cut dropped. The scalar fields are each tiny (an issue
// number, a branch name, a phase, an ISO timestamp, a flag); the `handoff` (joshuafolkken/kit#2354)
// carries the user's instruction and a curated list of what is done, left and untouched — the
// irreducible intent, not the conversation, so it stays a few short lines. The cap is set to hold that
// and refuse a field that ever grew unbounded at the write rather than carrying it. `begin_cut`
// enforces it.
const MAX_HANDOFF_BYTES = 8192

interface RunCut {
	// The identity of the run this cut belongs to — `fullrun #<N>`, built through
	// `lane_child_invocation.child_invocation` so it is single-sourced with the dispatch that first launched the
	// child. **It is the resume-matching key, not the relaunch prompt** (joshuafolkken/kit#2022): the
	// relaunch gives the fresh process `lane_child_invocation.resume_invocation` instead, while
	// `is_declared_cut` / `is_adopted_cut` still compare this field against `invocation_for(issue)` to
	// confirm the record belongs to the resuming issue.
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
	// The instruction and work state the run was told to carry across the cut (joshuafolkken/kit#2354).
	// Optional so a record written by the six scalar fields alone still parses — the backward-compatible
	// legacy shape — while a resume into implementation refuses to continue without it (`classify_resume`
	// → `incomplete`), so a session is never silently continued lacking the instruction it needs.
	handoff?: Handoff | undefined
	// Set when `run:merge` found this cut still unadopted after every process of the lane had gone and
	// relaunched its successor itself (joshuafolkken/kit#2484). The fallback fires once per cut: a
	// successor that dies again before adopting is not relaunched a second time, so a lane that keeps
	// failing its resume is parked rather than relaunched forever.
	is_merge_relaunched?: boolean | undefined
}

// The current tree's state, read once and handed to the pure classifier.
interface CutState {
	branch: string
	is_dirty: boolean
	is_held: boolean
}

// The fields a cut is written from, bundled so `begin_cut` stays within the parameter limit. `phase`
// is which boundary the cut was taken at — `PRE_GATE_PHASE` or `IMPLEMENTATION_PHASE` — and it is what
// the resume reads to decide whether the fresh process continues to the gate or back into
// implementation (joshuafolkken/kit#1933).
interface CutSpec {
	issue: string
	branch: string
	phase: string
	// The instruction and work state to carry, absent for a pre-gate cut that resumes into the gate
	// rather than into implementation (joshuafolkken/kit#2354).
	handoff?: Handoff | undefined
}

// What the resume classifier is asked about, gathered from the fresh process's own git state so the
// record can be checked against reality rather than trusted.
interface CutResumeRequest {
	issue: string
	current_branch: string
	is_dirty: boolean
	is_held: boolean
}

// **`resume` carries the run on; `stale` stops it; `handed-off` says a successor already took it.** A
// resume failure — wrong branch, a clean tree, an expired record, no declared cut, or a tree no longer
// under its hold — is `stale`. A record a successor has already adopted — `is_handed_off` spent back to
// `false` — is `handed-off`, so a process woken after its own cut is told to stop rather than sent to
// investigate a tree that is not wrong (joshuafolkken/kit#1935). A record that matches the tree but
// resumes into implementation without an instruction is `incomplete` — the run is not silently
// continued lacking what it was told to do (joshuafolkken/kit#2354).
type CutResume = 'resume' | 'stale' | 'handed-off' | 'incomplete'

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
	handoff: run_cut_handoff.handoff_schema.optional(),
	is_merge_relaunched: z.boolean().optional(),
})

function cut_path(git_directory: string): string {
	return stamp_file.stamp_path(CUT_PREFIX, git_directory)
}

// The work tree's own git directory (index 0), reused from `run-hold.ts` so a cut and the hold it
// resumes under key to exactly the same tree — never a second copy of the index-0 derivation.
const { worktree_directory } = run_hold

// `fullrun #<N>`, validated and formatted once in `lane_child_invocation` so the record and
// the dispatch cannot disagree about what a lane child is.
function invocation_for(issue: string): string {
	return lane_child_invocation.child_invocation(issue)
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

	return { kind: is_expired(cut, now) ? 'expired' : 'carried', cut }
}

function read_cut(target: string, now: Date = new Date()): CutRead {
	return classify(stamp_file.read_stamp_text(target), now)
}

// **The same read as `read_cut(cut_path(await worktree_directory()))`, taken synchronously**
// (joshuafolkken/kit#1864). The pre-gate cut is enforced from a `PreToolUse` guard, and a guard
// answers synchronously or not at all — so the one git call the path derivation needs is made here
// with `git_command.GIT_DIRECTORY_ARGUMENTS`, the same argument list the asynchronous reader uses,
// rather than a second spelling of it. Everything after the path is already shared: `cut_path` keys
// the record and `classify` parses and expires it.
//
// **A fault reads as "no cut was taken", and that direction is deliberate rather than fail-open.** A
// checkout git cannot describe, a record that will not parse and an expired one all come back
// `undefined`, which the pre-gate guard treats as uncut — so it speaks rather than staying silent.
// The alternative errs the other way: a read fault would be taken for "already cut" and the guard
// would go quiet on exactly the run it exists for. The cost of this direction is one refusal a lane
// can answer by reissuing, since that row is delivered once per run.
function git_directories_sync(cwd?: string): ReadonlyArray<string> {
	try {
		// The binary is resolved through `git_utilities` exactly as `git-spawn.ts` resolves it, so this
		// call does not answer to whatever `PATH` happens to hold. It runs the binary directly with an
		// argument array and no `shell` option, and both are internally controlled, never untrusted
		// input.
		const output = execFileSync(
			git_utilities.get_git_command_for_spawn(),
			[...git_command.GIT_DIRECTORY_ARGUMENTS],
			// git's own diagnostics are discarded: a checkout it cannot describe is already the
			// `undefined` below, and a hook that let `fatal: not a git repository` through would print it
			// in front of a tool call that is about to be allowed.
			// A `PreToolUse` hook holds the tool call while it runs, so the read is bounded rather than
			// left to whatever git does.
			// `cwd` is set only by `lane_cut_sync`, which reads another lane's record from the parent.
			// With a `cwd`, the git location variables are cleared so it is what git answers for: a hook
			// exports `GIT_DIR`, which beats `cwd` and would name the hook's checkout instead
			// (joshuafolkken/kit#2515). Without one the environment is kept, so this read resolves the same
			// checkout as the asynchronous `git_directories` that writes the record.
			{
				cwd,
				env:
					cwd === undefined
						? process.env
						: { ...process.env, ...git_location_environment.location_free_environment() },
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
				timeout: GIT_READ_TIMEOUT_MS,
			},
		) // NOSONAR

		return output.split('\n').filter((line) => line !== '')
	} catch {
		return []
	}
}

// The work tree's own git directory (index 0), the same read `git_directories` makes asynchronously —
// the record and the pre-gate guard both key on it.
function worktree_git_directory_sync(): string | undefined {
	return git_directories_sync()[WORKTREE_DIRECTORY_INDEX]
}

// **The directory is injectable so a test never has to write to the live record.** Keyed to the work
// tree, that record is the one a resumed lane child depends on, and a suite that wrote to it would
// erase the very state the guard reads — the unit suite runs inside `pnpm josh gate`, which is the
// call the guard is standing in front of.
function carried_cut_sync(
	now: Date = new Date(),
	directory: string | undefined = worktree_git_directory_sync(),
): RunCut | undefined {
	if (directory === undefined) return undefined

	const read = read_cut(cut_path(directory), now)

	return read.kind === 'carried' ? read.cut : undefined
}

// A lane's carried cut, read from outside the lane (joshuafolkken/kit#2484). The record is keyed to the
// lane's own git directory, so the parent — standing in the main checkout — resolves that directory
// from the lane's path rather than its own, and gets the record path back to mark it.
function lane_cut_sync(lane_directory: string): { target: string; cut: RunCut } | undefined {
	const directory = git_directories_sync(lane_directory)[WORKTREE_DIRECTORY_INDEX]

	if (directory === undefined) return undefined

	const cut = carried_cut_sync(new Date(), directory)

	return cut === undefined ? undefined : { target: cut_path(directory), cut }
}

function fresh_cut(spec: CutSpec, now: Date): RunCut {
	return {
		invocation: invocation_for(spec.issue),
		issue: spec.issue,
		branch: spec.branch,
		phase: spec.phase,
		cut_at: now.toISOString(),
		is_handed_off: true,
		handoff: spec.handoff,
	}
}

// **The implementation cut resumes back into implementation; the pre-gate cut resumes into the gate**
// (joshuafolkken/kit#1933). The resume shape — the `resume-impl` verdict and the record cleared on
// adoption — is named once here rather than spelled as a phase comparison at each call site.
function resumes_into_implementation(phase: string): boolean {
	return phase === IMPLEMENTATION_PHASE
}

// Whether a record serializes within the hand-off bound. The record a fresh process reads back must
// stay small, or the resume re-establishes the very context the cut dropped (joshuafolkken/kit#2346).
function within_handoff_bound(cut: RunCut): boolean {
	return Buffer.byteLength(JSON.stringify(cut), 'utf8') <= MAX_HANDOFF_BYTES
}

// Whether the record a spec would write fits the bound. `load_handoff` bounds the handoff alone, but the
// record also carries the scalar fields, so a handoff just under the cap can still overflow once
// assembled — the caller checks this before `begin_cut` so that case reports `bad-handoff` rather than
// the exclusive-create's `busy` (joshuafolkken/kit#2354).
function record_within_bound(spec: CutSpec, now: Date = new Date()): boolean {
	return within_handoff_bound(fresh_cut(spec, now))
}

// **Create-exclusively, exactly as `run-hold.ts` claims a tree.** A record already here means a cut is
// already in flight for this tree, so `undefined` is "do not launch a second one" rather than an
// error — the exclusive create is what makes a double cut, and so a double relaunch, impossible. A
// record that would not fit the hand-off bound is refused the same way rather than written and carried.
function begin_cut(target: string, spec: CutSpec, now: Date = new Date()): RunCut | undefined {
	const cut = fresh_cut(spec, now)

	if (!within_handoff_bound(cut)) return undefined

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

// A record a successor already adopted — the hand-off spent back to `false` for this issue's
// invocation. It is told apart from a crash record (`is_handed_off` never set) so a process woken after
// its own cut learns the run was carried on rather than being sent to investigate
// (joshuafolkken/kit#1935).
function is_adopted_cut(cut: RunCut, issue: string): boolean {
	return cut.is_handed_off === false && cut.invocation === invocation_for(issue)
}

// A cut that resumes into implementation must carry the instruction; a pre-gate cut resumes into the
// gate and needs none, so it always passes (joshuafolkken/kit#2354).
// It reads a spec as well as a record, so `run:cut` refuses to write the cut its resume would refuse
// (joshuafolkken/kit#2484) with the same predicate the resume answers `incomplete` on.
function has_required_handoff(cut: Pick<RunCut, 'phase' | 'handoff'>): boolean {
	return !resumes_into_implementation(cut.phase) || run_cut_handoff.is_complete_handoff(cut.handoff)
}

// Whether `run:merge` may relaunch the successor of a lane whose processes have all gone
// (joshuafolkken/kit#2484): a cut this issue declared and no successor adopted, carrying what its resume
// needs, and not relaunched by the fallback before. The tree itself is verified by the resume.
function is_relaunchable(cut: RunCut, issue: string): boolean {
	return (
		is_declared_cut(cut, issue) && has_required_handoff(cut) && cut.is_merge_relaunched !== true
	)
}

// Marks the fallback relaunch spent, with the same remove-then-exclusive-create `adopt_cut` uses. A
// later `run:merge` reads the mark and does not relaunch. It does not arbitrate two truly concurrent
// ones — both creates can succeed — so a stray session is refused by the carry ownership check
// `run:merge` asks first.
function mark_merge_relaunched(target: string, cut: RunCut): boolean {
	stamp_file.remove_stamp(target)

	return stamp_file.create_stamp(target, { ...cut, is_merge_relaunched: true })
}

// A resume requires a declared cut, a matching tree, and — for a resume into implementation — the
// instruction. Anything short of a match is `stale`, which stops the run rather than gating a
// half-written or foreign tree, or one no longer under its hold; a match that lacks the instruction is
// `incomplete`, so the run is not silently continued without what it was told to do. A record a
// successor already adopted is `handed-off` — a benign stop rather than a failure.
function classify_resume(cut: RunCut, request: CutResumeRequest): CutResume {
	if (is_adopted_cut(cut, request.issue)) return 'handed-off'

	if (!is_declared_cut(cut, request.issue) || !matches_state(cut, request)) return 'stale'

	return has_required_handoff(cut) ? 'resume' : 'incomplete'
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

// A successor already resumed this cut, so a process that reaches `--resume` after its own hand-off is
// told to stop quietly rather than to investigate a tree that is not wrong (joshuafolkken/kit#1935).
function handed_off_message(cut: RunCut): string {
	return `This cut was already handed off to a successor — ${describe_cut(cut)}. Nothing was resumed here; the run is being carried on by the process that adopted it, so this one has nothing to do.`
}

// The record does not match the tree the fresh process is in — wrong branch, a clean tree, an expired
// record, no declared cut, or a tree no longer under its hold. It is a resume failure, said as such
// rather than reported as a success, so the run stops instead of gating the wrong tree.
function stale_message(cut: RunCut): string {
	return `This cut does not match the current tree — ${describe_cut(cut)}. Resume failed; verify the branch and the uncommitted work, then clear it with \`${END_COMMAND}\` if the run is over.`
}

// The record matches the tree but resumes into implementation without an instruction, so the run would
// be continued blind to what it was told to do — the failure mode joshuafolkken/kit#2354 exists to stop.
// It is reported as a failure rather than a success, so the fresh process recovers the instruction
// rather than restructuring a tree it does not understand.
function incomplete_message(cut: RunCut): string {
	return `This cut carries no instruction to resume on — ${describe_cut(cut)}. Resume was refused rather than continuing without it; recover the run's instruction and work state before implementing, and clear the record with \`${END_COMMAND}\` if the run is over.`
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
	IMPLEMENTATION_CONTEXT_THRESHOLD,
	IMPLEMENTATION_PHASE,
	MAX_HANDOFF_BYTES,
	PRE_GATE_PHASE,
	adopt_cut,
	begin_cut,
	busy_message,
	carried_cut_sync,
	classify,
	classify_resume,
	current_state,
	cut_path,
	describe_cut,
	end_cut,
	fresh_cut,
	handed_off_message,
	has_required_handoff,
	incomplete_message,
	invocation_for,
	is_expired,
	is_relaunchable,
	lane_cut_sync,
	mark_merge_relaunched,
	read_cut,
	record_within_bound,
	resumes_into_implementation,
	stale_message,
	unknown_message,
	unreadable_message,
	within_handoff_bound,
	worktree_directory,
	worktree_git_directory_sync,
}

export type { CutResumeRequest, CutState, RunCut }
export { run_cut }
