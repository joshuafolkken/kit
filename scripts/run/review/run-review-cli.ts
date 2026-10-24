#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { review_brief_cli } from '#scripts/review/review-brief-cli'
import { review_stamps } from '#scripts/review/review-stamps'
import { run_review, type GateState, type ReviewTiming } from './run-review'
import { run_review_pinned } from './run-review-pinned'
import { run_review_steps } from './run-review-steps'

// `josh run:review` — one call that leaves `josh gate` running in the background and prints the whole
// `/code-review` brief, so a lane child launches the two together and they overlap.
// It composes `josh gate` and `josh review:brief` and changes neither: the gate is the same command
// spawned detached, and the brief is `review:brief` run unchanged, so the nonce/checkout contract
// `review:attest --check` enforces is minted exactly as a standalone brief mints it.
//
// The pair opens only after `josh test:pinned` finds every changed place pinned, or the implementer
// accepts the rest with `--unpinned-ok "<reason>"` (`run-review-pinned.ts`).
//
// **The default mode opens the pair; `--join` closes it.** The child runs the default, reads the brief
// off stdout, launches the review subagent, and — once it returns — runs `--join`, which waits for the
// gate to finish, records the overlap, and exits non-zero if the gate came back red. That exit code is
// what makes "a red gate is not adopted over" a mechanical guarantee rather than an ordering
// (`run-review.ts` → `adopt_verdict`).

const ARGV_OFFSET = 2
const JOIN_FLAG = '--join'
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh run:review [--unpinned-ok "<reason>" | --join]'

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
	'Gate is running in the background. Launch the /code-review subagent as the `reviewer` agent type (`kit:reviewer` in a consumer) with the brief above; when it returns, run `pnpm josh run:review --join` to join the gate and check its verdict before committing.'

async function start_pair(): Promise<number> {
	const gate_started_at = now_iso()
	const launch = run_review_steps.launch_gate()

	if (launch.kind === 'failed') {
		process.stderr.write(`the background gate could not be started: ${launch.note}\n`)

		return FAILURE_EXIT_CODE
	}

	await run_review_steps.mark_gate_starting()
	run_review_steps.write_timing_start({ gate_started_at, review_started_at: now_iso() })
	const code = await review_brief_cli.run([])

	// The hint follows a printed brief and nothing else: a brief that refused (a tree the scoped pair
	// has not been green on) exits non-zero, and a "gate running, launch the review" line under that
	// refusal would send the child to review a tree there is no brief for.
	if (code === SUCCESS_EXIT_CODE) process.stderr.write(`${JOIN_HINT}\n`)

	return code
}

// `josh test:pinned` runs first, so an unpinned change stops before the gate and the brief. An accepted
// one is printed after the brief on stdout, where the reviewer reads it; otherwise — or when the pair
// failed to open, so no brief follows — the report goes to stderr beside the other run notes.
async function run_start(reason?: string): Promise<number> {
	const pinned = await run_review_pinned.check(reason)

	if (pinned.kind === 'stop') {
		process.stderr.write(pinned.text)

		return FAILURE_EXIT_CODE
	}

	const code = await start_pair()
	const is_briefed = code === SUCCESS_EXIT_CODE && pinned.kind === 'accepted'
	const sink = is_briefed ? process.stdout : process.stderr

	sink.write(pinned.text)

	return code
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

	return join_exit_code(state)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length === 0) return await run_start()
	if (argv.length === 1 && argv[0] === JOIN_FLAG) return await run_join()
	const reason = run_review_pinned.ok_reason_of(argv)
	if (reason !== undefined) return await run_start(reason)

	process.stderr.write(`${USAGE}\n`)

	return FAILURE_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_review_cli = {
	JOIN_HINT,
	join_exit_code,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_review_cli }
