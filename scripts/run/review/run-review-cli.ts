#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { review_attest, type ReviewSlot } from '#scripts/review/review-attest'
import { review_brief_cli } from '#scripts/review/review-brief-cli'
import { review_interaction } from '#scripts/review/review-interaction'
import { review_stamps } from '#scripts/review/review-stamps'
import { test_pinned_record } from '#scripts/test/test-pinned-record'
import { run_review, type GateState, type ReviewTiming } from './run-review'
import { run_review_pinned } from './run-review-pinned'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_steps } from './run-review-steps'

// `josh run:review` — one call that leaves `josh gate` running in the background and prints the whole
// `/code-review` brief, so a lane child launches the two together and they overlap.
// It composes `josh gate` and `josh review:brief` and changes neither: the gate is the same command
// spawned detached, and the brief is `review:brief` run unchanged, so the nonce/checkout contract
// `review:attest --check` enforces is minted exactly as a standalone brief mints it.
//
// `josh test:pinned` runs in the background beside the pair, and the join stops on an unpinned change;
// `--unpinned-ok "<reason>"` checks in place before the pair instead (`run-review-pinned.ts`).
//
// **The default mode opens the pair; `--join` closes it.** The child runs the default, reads the brief
// off stdout, launches the review subagent, and — once it returns — runs `--join`, which waits for the
// gate and the check to finish, records the overlap, and exits non-zero if the gate came back red or
// the check found an unpinned change. That exit code is
// what makes "a red gate is not adopted over" a mechanical guarantee rather than an ordering
// (`run-review.ts` → `adopt_verdict`).
//
// **Where the interaction review is due and not yet recorded, its brief follows code's**
// (joshuafolkken/kit#4802), so the child's round 1 reviews both and `josh ship` reuses both rather than
// running the interaction pass alone after it. `--code-only` is the ship's own open, which mints the
// interaction brief itself.

const ARGV_OFFSET = 2
const JOIN_FLAG = '--join'
const INTERACTION_FLAG = '--interaction'
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh run:review [--code-only] [--unpinned-ok "<reason>"] | --join'
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
	'Gate is running in the background. Launch the /code-review subagent as the `reviewer` agent type (`kit:reviewer` in a consumer) with the brief above; when it returns, run `pnpm josh run:review --join` to join the gate and test:pinned and check their verdicts before committing.'

const INTERACTION_HEADER =
	'=== Interaction review brief — a second `reviewer`, launched beside the first with the brief below ==='
const INTERACTION_HINT =
	'Two briefs above: launch one `reviewer` per brief side by side, and once both are attested record the interaction pass with `pnpm josh review:record --interaction --issue <N> [<finding> ...]` beside round 1.'

// The slots this branch's issue owes round 1. A branch that names no issue, or the ship's own open,
// briefs code alone.
async function brief_slots(is_code_only: boolean): Promise<ReadonlyArray<ReviewSlot>> {
	if (is_code_only) return [CODE]
	const issue = git_branch.issue_from_branch(await git_command.branch())
	if (issue === undefined) return [CODE]

	return review_interaction.round_one_slots(await review_interaction.status(issue))
}

function no_note(): void {
	// Nothing follows code's brief unless `--unpinned-ok` has an accepted list for its reviewer.
}

// Code's brief, `after_code`'s note for its reviewer, then the interaction brief under its header —
// never after a code brief that refused.
async function print_briefs(
	slots: ReadonlyArray<ReviewSlot>,
	after_code: () => void,
): Promise<number> {
	const code = await review_brief_cli.run([])

	if (code !== SUCCESS_EXIT_CODE) return code
	after_code()
	if (!slots.includes(INTERACTION)) return code

	process.stdout.write(`${INTERACTION_HEADER}\n`)

	return await review_brief_cli.run([INTERACTION_FLAG])
}

function join_hint(slots: ReadonlyArray<ReviewSlot>): string {
	return slots.includes(INTERACTION) ? `${JOIN_HINT}\n${INTERACTION_HINT}` : JOIN_HINT
}

async function start_pair(
	slots: ReadonlyArray<ReviewSlot>,
	after_code: () => void = no_note,
): Promise<number> {
	const gate_started_at = now_iso()
	const launch = run_review_steps.launch_gate()

	if (launch.kind === 'failed') {
		process.stderr.write(`the background gate could not be started: ${launch.note}\n`)

		return FAILURE_EXIT_CODE
	}

	await run_review_steps.mark_gate_starting()
	run_review_steps.write_timing_start({ gate_started_at, review_started_at: now_iso() })
	const code = await print_briefs(slots, after_code)

	// The hint follows a printed brief and nothing else: a brief that refused (a tree the scoped pair
	// has not been green on) exits non-zero, and a "gate running, launch the review" line under that
	// refusal would send the child to review a tree there is no brief for.
	if (code === SUCCESS_EXIT_CODE) process.stderr.write(`${join_hint(slots)}\n`)

	return code
}

// `josh test:pinned` runs in the background beside the pair, and the join stops on what it finds. A
// check that could not be launched fails open, as one that could not run does.
async function start_beside(slots: ReadonlyArray<ReviewSlot>): Promise<number> {
	const launched = run_review_pinned_steps.launch()

	if (launched.kind === 'failed') {
		process.stderr.write(test_pinned_record.not_run_summary(new Error(launched.note)).text)
	}

	return await start_pair(slots)
}

// `--unpinned-ok` checks in place first, because the accepted list follows code's brief on stdout —
// before the interaction header — where the code reviewer reads it; when no code brief printed, or
// nothing was unpinned, the report goes to stderr beside the other run notes.
async function start_after_check(
	slots: ReadonlyArray<ReviewSlot>,
	reason: string,
): Promise<number> {
	const pinned = await run_review_pinned.check(reason)
	const shown = { is: false }

	function show_accepted(): void {
		if (pinned.kind !== 'accepted') return
		process.stdout.write(pinned.text)
		shown.is = true
	}

	const code = await start_pair(slots, show_accepted)

	if (!shown.is) process.stderr.write(pinned.text)

	return code
}

async function run_start(slots: ReadonlyArray<ReviewSlot>, reason?: string): Promise<number> {
	run_review_pinned_steps.clear()

	return reason === undefined ? await start_beside(slots) : await start_after_check(slots, reason)
}

// The background check's answer, on stderr where the start printed it before it ran beside the pair.
async function join_pinned(): Promise<boolean> {
	const summary = await run_review_pinned_steps.wait_for_answer()

	if (summary === undefined) return false

	const verdict = run_review_pinned.verdict_of(summary, undefined)

	process.stderr.write(verdict.text)

	return verdict.kind === 'stop'
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

async function run_join(): Promise<number> {
	const state = await run_review_steps.wait_for_gate_finish()
	const timing = run_review_steps.complete_timing({
		gate_ended_at: gate_ended_at(settled_note(state) !== undefined),
		review_ended_at: now_iso(),
	})

	report_gate(state)
	report_timing(timing)

	// An unpinned change stops the round whatever the gate answered.
	const is_unpinned = await join_pinned()

	return is_unpinned ? run_review.UNPINNED_EXIT_CODE : join_exit_code(state)
}

// The open's arguments after `--code-only`: none, or `--unpinned-ok "<reason>"`.
async function run_open(is_code_only: boolean, argv: ReadonlyArray<string>): Promise<number> {
	const reason = run_review_pinned.ok_reason_of(argv)

	if (reason === undefined && argv.length > 0) {
		process.stderr.write(`${USAGE}\n`)

		return FAILURE_EXIT_CODE
	}

	return await run_start(await brief_slots(is_code_only), reason)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length === 1 && argv[0] === JOIN_FLAG) return await run_join()
	const is_code_only = argv[0] === run_review.CODE_ONLY_FLAG

	return await run_open(is_code_only, argv.slice(is_code_only ? 1 : 0))
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_review_cli = {
	INTERACTION_HEADER,
	INTERACTION_HINT,
	JOIN_HINT,
	join_exit_code,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_review_cli }
