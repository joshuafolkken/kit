#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_session_broker } from '#scripts/lane/lane-session-broker'
import { review_attest, type ReviewSlot } from '#scripts/review/review-attest'
import { review_brief_cli } from '#scripts/review/review-brief-cli'
import { review_interaction } from '#scripts/review/review-interaction'
import { review_lane_handover } from '#scripts/review/review-lane-handover'
import { review_stamps } from '#scripts/review/review-stamps'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { test_pinned_record, type PinnedSummary } from '#scripts/test/test-pinned-record'
import { run_review, type GateState, type ReviewTiming } from './run-review'
import { run_review_early_push } from './run-review-early-push'
import { run_review_join_read, type JoinVerdict } from './run-review-join-read'
import { run_review_pinned } from './run-review-pinned'
import { run_review_pinned_accepted } from './run-review-pinned-accepted'
import { run_review_pinned_join } from './run-review-pinned-join'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_pinned_tree } from './run-review-pinned-tree'
import { run_review_steps } from './run-review-steps'

// `josh run:review` — one call that leaves `josh gate` running in the background and writes the
// `/code-review` brief to a file, printing its path, so a lane child launches the two together and they
// overlap.
// It composes `josh gate` and `josh review:brief` and changes neither: the gate is the same command
// spawned detached, and the brief is `review:brief` run unchanged, so the nonce/checkout contract
// `review:attest --check` enforces is minted exactly as a standalone brief mints it.
//
// `josh test:pinned` runs in the background beside the pair, and the join stops on an unpinned change;
// under `--unpinned-ok "<reason>"` it runs there too and the join carries on (`run-review-pinned.ts`).
//
// **The default mode opens the pair; `--join` closes it.** The child runs the default, reads the brief
// path off stdout, launches the review subagent, and — once it returns — runs `--join`, which waits for the
// gate and the check to finish, records the overlap, and exits non-zero if the gate came back red or
// the check found an unpinned change. That exit code is
// what makes "a red gate is not adopted over" a mechanical guarantee rather than an ordering
// (`run-review.ts` → `adopt_verdict`).
//
// **Where the interaction review is due and not yet recorded, its brief follows code's**
// (joshuafolkken/kit#4802), so the child's round 1 reviews both and `josh ship` reuses both rather than
// running the interaction pass alone after it. `--code-only` is the ship's own open, which mints the
// interaction brief itself.
//
// **`--pinned` reads the check alone** (joshuafolkken/kit#4834): `josh review:record` (or a lane child's
// `josh check:related` before its round is recorded, joshuafolkken/kit#4948) starts it again on a tree a round-1 fix
// moved, after the join has closed the pair, and reads its answer without joining a gate that already
// settled. The ship's pre-detach reads that answer anyway, so a lane need not
// (joshuafolkken/kit#4895), and a lane child's `--pinned` returns at once rather than wait in the
// foreground (joshuafolkken/kit#5293). **`--join --fixing` waits no grace on the check**: round 1's fixes will move
// its tree. **A lane child's open commits first and `--push` pushes at the green gate**
// (`run-review-early-push.ts`).

const ARGV_OFFSET = 2
const JOIN_FLAG = '--join'
const FIXING_FLAG = '--fixing'
const PINNED_FLAG = '--pinned'
const LANE_PINNED_NOTE =
	"Lane child — not waiting on test:pinned; the ship's pre-detach joins this check."
const INTERACTION_FLAG = '--interaction'
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE =
	'Usage: josh run:review [--code-only] [--unpinned-ok "<reason>"] | --join [--fixing] | --pinned | --push'
const { CODE, INTERACTION } = review_attest.REVIEW_SLOT

function now_iso(): string {
	return new Date().toISOString()
}

// The join exits 0 only on a green gate. `--join` is run before the review verdict is acted on, so a
// non-zero exit here is what stops a run adopting a review over a red gate. A gate that passed on a tree
// that has since moved exits with its own code, so `josh ship` tells it from a red gate by the code
// rather than by a findings file the reviewer may have misnamed (joshuafolkken/kit#4774).
function join_exit_code(state: GateState): number {
	if (state === run_review.GATE_MOVED) return run_review.MOVED_EXIT_CODE

	return run_review.adopt_verdict(state === run_review.GATE_GREEN) === run_review.ADOPT
		? SUCCESS_EXIT_CODE
		: FAILURE_EXIT_CODE
}

const JOIN_HINT =
	'Gate is running in the background. Launch the /code-review subagent as the `reviewer` agent type (`kit:reviewer` in a consumer), with the prompt printed under its brief file, verbatim; when it returns, run `pnpm josh run:review --join` to join the gate and test:pinned and check their verdicts before committing.'

const INTERACTION_HINT =
	'Two brief files above: launch one `reviewer` per brief side by side, each with its own printed prompt, and once both are attested record the interaction pass with `pnpm josh review:record --interaction --issue <N> [<finding> ...]` beside round 1.'

// The briefs an open writes: the slots this branch's issue owes round 1, and whether this is the ship's
// own `--code-only` open, which prints code's brief instead.
interface BriefPlan {
	is_code_only: boolean
	slots: ReadonlyArray<ReviewSlot>
}

const SLOT_ARGV: Readonly<Record<ReviewSlot, ReadonlyArray<string>>> = {
	code: [],
	interaction: [INTERACTION_FLAG],
}

// The slots this branch's issue owes round 1. A branch that names no issue, or the ship's own open,
// briefs code alone.
async function brief_slots(is_code_only: boolean): Promise<ReadonlyArray<ReviewSlot>> {
	if (is_code_only) return [CODE]
	const issue = git_branch.issue_from_branch(await git_command.branch())
	if (issue === undefined) return [CODE]

	return review_interaction.round_one_slots(await review_interaction.status(issue))
}

// A lane child's reopen after a round 1 the ship reuses is refused before anything is launched
// (`review-lane-handover.ts`); the ship's own `--code-only` open is never refused.
async function handover_refusal(is_code_only: boolean): Promise<string | undefined> {
	if (is_code_only) return undefined
	const issue = git_branch.issue_from_branch(await git_command.branch())
	if (issue === undefined) return undefined

	return (await review_lane_handover.is_handed_over(issue))
		? review_lane_handover.refusal(issue)
		: undefined
}

// One slot's brief, written to the file `josh ship` hands that slot's reviewer, with only its path on
// stdout: the two briefs together exceed the Bash output cap, and a truncated brief sent the lane back
// to `review:brief`, whose new code nonce dropped the interaction slot (joshuafolkken/kit#4863). Its
// launch prompt follows, the one `josh ship` opens a reviewer with: the brief no longer travels in the
// prompt, and `/code-review` beside `review:attest` is how the time and cost readers tell a review.
function save_brief(slot: ReviewSlot, text: string): void {
	const { brief } = lane_session_broker.review_paths(PROJECT_ROOT, slot)

	stamp_file.write_text_stamp(brief, `${text}\n`)
	process.stdout.write(
		`${slot} brief: ${brief}\n${slot} prompt: ${run_ship_review.round_one_opening(brief)}\n`,
	)
}

async function write_brief(slot: ReviewSlot): Promise<number> {
	const texts: Array<string> = []
	const code = await review_brief_cli.run_to(SLOT_ARGV[slot], (text) => {
		texts.push(text)
	})

	if (code === SUCCESS_EXIT_CODE) save_brief(slot, texts.join('\n'))

	return code
}

// Code's brief, then the interaction brief — never after a code brief that refused. `--code-only`, the
// ship's own open, prints code's brief: the ship reads it off stdout and writes that file itself.
async function open_briefs(plan: BriefPlan): Promise<number> {
	if (plan.is_code_only) return await review_brief_cli.run([])
	const code = await write_brief(CODE)

	if (code !== SUCCESS_EXIT_CODE || !plan.slots.includes(INTERACTION)) return code

	return await write_brief(INTERACTION)
}

function join_hint(slots: ReadonlyArray<ReviewSlot>): string {
	return slots.includes(INTERACTION) ? `${JOIN_HINT}\n${INTERACTION_HINT}` : JOIN_HINT
}

// The early push waits on the gate this pair launched, so it follows a written brief alone.
function follow_brief(slots: ReadonlyArray<ReviewSlot>, is_early_push: boolean): void {
	process.stderr.write(`${join_hint(slots)}\n`)
	if (is_early_push) run_review_early_push.launch()
}

async function start_pair(plan: BriefPlan, is_early_push: boolean): Promise<number> {
	const gate_started_at = now_iso()
	const launch = run_review_steps.launch_gate()

	if (launch.kind === 'failed') {
		process.stderr.write(`the background gate could not be started: ${launch.note}\n`)

		return FAILURE_EXIT_CODE
	}

	await run_review_steps.mark_gate_starting()
	run_review_steps.write_timing_start({ gate_started_at, review_started_at: now_iso() })
	const code = await open_briefs(plan)

	// The hint follows a written brief and nothing else: a brief that refused (a tree the scoped pair
	// has not been green on) exits non-zero, and a "gate running, launch the review" line under that
	// refusal would send the child to review a tree there is no brief for.
	if (code === SUCCESS_EXIT_CODE) follow_brief(plan.slots, is_early_push)

	return code
}

// A fresh `josh test:pinned` on this tree in place of the last one.
async function launch_pinned(reason: string | undefined): Promise<void> {
	const tree = await run_review_pinned_tree.key()

	run_review_pinned_steps.clear()
	const launched = run_review_pinned_steps.launch(PROJECT_ROOT, reason, tree)

	if (launched.kind === 'failed') {
		process.stderr.write(test_pinned_record.not_run_summary(new Error(launched.note)).text)
	}
}

// `josh test:pinned` runs in the background beside the pair, `--unpinned-ok` or not, so the pair never
// waits on it (joshuafolkken/kit#4793); the join judges its answer by the reason it was launched with.
// A check that could not be launched fails open, as one that could not run does. A tree the scoped
// pair has not been green on is refused before either is launched, so a refused start leaves nothing
// running (joshuafolkken/kit#4828).
async function run_start(plan: BriefPlan, reason?: string): Promise<number> {
	const refusal = await review_brief_cli.scoped_refusal()

	if (refusal !== undefined) return review_brief_cli.report_error(refusal)
	const is_early_push = await run_review_early_push.prepare(plan)

	await launch_pinned(reason)
	run_review_join_read.mark_due()

	return await start_pair(plan, is_early_push)
}

// The background check's answer, on stderr beside the other run notes. The join waits as the end of
// the pair; `--pinned` waits for a check started moments before (`run_review_pinned_steps.wait_alone`).
async function show_pinned(read: Promise<JoinVerdict | undefined>): Promise<boolean> {
	const joined = await read

	if (joined === undefined) return false
	process.stderr.write(joined.text)

	return joined.is_stop
}

// The gate's own green stamp carries the moment it finished; a red gate leaves none, so the join's own
// clock is the end there — the review overlapped a gate that ran up to this point either way.
function gate_ended_at(is_green: boolean): string {
	if (!is_green) return now_iso()

	return review_stamps.gate_stamp.read()?.taken_at ?? now_iso()
}

const GREEN_NOTE = 'Gate green — the review verdict may be adopted.'
const RED_NOTE =
	'Gate RED — the review verdict is blocked; fix the gate and re-run it before committing.'
const MOVED_NOTE =
	'Gate passed on an earlier tree — the tree moved after it (a review fix in place); re-run the gate on this tree before committing.'

// A moved tree's gate passed, so its log is no failure to show.
function settled_note(state: GateState): string | undefined {
	if (state === run_review.GATE_GREEN) return GREEN_NOTE
	if (state === run_review.GATE_MOVED) return MOVED_NOTE

	return undefined
}

function report_gate(state: GateState): void {
	const settled = settled_note(state)

	if (settled !== undefined) {
		process.stdout.write(`${settled}\n`)

		return
	}

	const log = run_review_steps.read_gate_log()

	if (log !== undefined) process.stdout.write(`${log}\n`)
	process.stdout.write(`${RED_NOTE}\n`)
}

function report_timing(timing: ReviewTiming | undefined): void {
	if (timing === undefined) return

	process.stdout.write(`${run_review.format_timing(timing)}\n`)
}

async function run_join(is_fixing = false): Promise<number> {
	const state = await run_review_steps.wait_for_gate_finish()
	const timing = run_review_steps.complete_timing({
		gate_ended_at: gate_ended_at(settled_note(state) !== undefined),
		review_ended_at: now_iso(),
	})

	report_gate(state)
	report_timing(timing)

	// An unpinned change stops the round whatever the gate answered; a tree a fix moved is checked again.
	const is_unpinned = await show_pinned(run_review_join_read.read(PROJECT_ROOT, is_fixing))

	return is_unpinned ? run_review.UNPINNED_EXIT_CODE : join_exit_code(state)
}

// `--join --fixing`: round 1 has fixes to make, so the join waits no grace on test:pinned
// (joshuafolkken/kit#4895).
async function run_join_fixing(): Promise<number> {
	return await run_join(true)
}

const REUSED_NOTE =
	'Judged the finished test:pinned answer on this tree and its green gate with the reason; nothing ran again — go on as after a join that passed.'
const RECHECK_NOTE =
	'The finished test:pinned answer stopped at its first unpinned place, so the reason launched the check of the whole change under it; the gate and the pair did not run again — go on as after a join that passed (`pnpm josh ship --review` reads its answer).'

// The answer the join stopped on: unpinned places, judged with no reason. A clear answer, or one
// launched under a reason, stopped nothing, so a reopen there is a new round that needs its brief.
function is_stopped_answer(summary: PinnedSummary): boolean {
	return summary.unpinned.length > 0 && run_review_pinned_steps.launched_reason() === undefined
}

// An answer cut at its first unpinned hunk (joshuafolkken/kit#5153) is not every place, so the reason
// launches the whole check under it on this tree, and the pair, green on it already, does not run again.
async function recheck_whole(reason: string): Promise<number> {
	await launch_pinned(reason)
	process.stderr.write(`${RECHECK_NOTE}\n`)

	return SUCCESS_EXIT_CODE
}

// The finished check's stopped answer on this tree, when the pair's gate is green on it too.
async function finished_pair(): Promise<PinnedSummary | undefined> {
	const summary = await run_review_pinned_join.finished_on_tree()
	if (summary === undefined || !is_stopped_answer(summary)) return undefined

	return (await run_review_steps.read_gate_state()) === run_review.GATE_GREEN ? summary : undefined
}

// `--unpinned-ok` given after the join stopped, on the tree it stopped on, judges the finished check
// with the reason and re-runs neither it nor the pair (joshuafolkken/kit#4920). `undefined` where the
// tree moved, no answer was left, the answer stopped nothing or the gate is not green: the open runs as
// before. The ship's own `--code-only` open needs the brief, so it never takes this path.
async function accept_finished(
	is_code_only: boolean,
	reason: string | undefined,
): Promise<number | undefined> {
	if (reason === undefined || is_code_only) return undefined
	const summary = await finished_pair()
	if (summary === undefined) return undefined
	if (summary.is_cut === true) return await recheck_whole(reason)

	run_review_pinned_steps.carry_reason(reason)
	const verdict = await run_review_pinned_accepted.judge(summary, reason)

	process.stderr.write(`${verdict.text}${REUSED_NOTE}\n`)

	return SUCCESS_EXIT_CODE
}

function refuse(text: string): number {
	process.stderr.write(`${text}\n`)

	return FAILURE_EXIT_CODE
}

// The open's arguments after `--code-only`: none, or `--unpinned-ok "<reason>"`.
async function run_open(is_code_only: boolean, argv: ReadonlyArray<string>): Promise<number> {
	const reason = run_review_pinned.ok_reason_of(argv)

	if (reason === undefined && argv.length > 0) return refuse(USAGE)
	const accepted = await accept_finished(is_code_only, reason)

	if (accepted !== undefined) return accepted
	const handover = await handover_refusal(is_code_only)

	if (handover !== undefined) return refuse(handover)

	return await run_start({ is_code_only, slots: await brief_slots(is_code_only) }, reason)
}

async function run_pinned(): Promise<number> {
	if (lane_child_marker.is_child_of(process.cwd())) {
		process.stdout.write(`${LANE_PINNED_NOTE}\n`)

		return SUCCESS_EXIT_CODE
	}

	const is_unpinned = await show_pinned(
		run_review_join_read.read_with(run_review_pinned_steps.wait_alone),
	)

	return is_unpinned ? run_review.UNPINNED_EXIT_CODE : SUCCESS_EXIT_CODE
}

// The modes a whole argv selects; a `Map`, so no prototype key reads as a mode.
const LONE_MODES: ReadonlyMap<string, () => Promise<number>> = new Map([
	[JOIN_FLAG, run_join],
	[`${JOIN_FLAG} ${FIXING_FLAG}`, run_join_fixing],
	[PINNED_FLAG, run_pinned],
	[run_review_early_push.PUSH_FLAG, run_review_early_push.push],
])

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const lone = LONE_MODES.get(argv.join(' '))

	if (lone !== undefined) return await lone()
	const is_code_only = argv[0] === run_review.CODE_ONLY_FLAG

	return await run_open(is_code_only, argv.slice(is_code_only ? 1 : 0))
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_review_cli = {
	INTERACTION_HINT,
	JOIN_HINT,
	join_exit_code,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_review_cli }
