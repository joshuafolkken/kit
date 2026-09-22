#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { review_brief_cli } from '#scripts/review/review-brief-cli'
import { review_stamps } from '#scripts/review/review-stamps'
import { run_review, type GateState, type ReviewTiming } from './run-review'
import { run_review_steps } from './run-review-steps'

// `josh run:review` — one call that leaves `josh gate` running in the background and prints the whole
// `/code-review` brief, so a lane child launches the two together and they overlap
// (joshuafolkken/kit#2179). It composes `josh gate` and `josh review:brief` and changes neither: the
// gate is the same command spawned detached, and the brief is `review:brief` run unchanged, so the
// nonce/checkout contract `review:attest --check` enforces is minted exactly as before.
//
// **The default mode opens the pair; `--join` closes it.** The child runs the default, reads the brief
// off stdout, launches the review subagent, and — once it returns — runs `--join`, which waits for the
// gate to finish, records the overlap, and exits non-zero if the gate came back red. That exit code is
// what makes "a red gate is not adopted over" a mechanical guarantee rather than an ordering the child
// used to get for free (`run-review.ts` → `adopt_verdict`).

const ARGV_OFFSET = 2
const JOIN_FLAG = '--join'
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh run:review [--join]'

function now_iso(): string {
	return new Date().toISOString()
}

// The join exits 0 only on a green gate. `--join` is run before the review verdict is acted on, so a
// non-zero exit here is what stops a run adopting a review over a red gate.
function join_exit_code(state: GateState): number {
	return run_review.adopt_verdict(state === run_review.GATE_GREEN) === run_review.ADOPT
		? SUCCESS_EXIT_CODE
		: FAILURE_EXIT_CODE
}

const JOIN_HINT =
	'Gate is running in the background. Launch the /code-review subagent with the brief above; when it returns, run `pnpm josh run:review --join` to join the gate and check its verdict before committing.'

async function run_start(): Promise<number> {
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

// The gate's own green stamp carries the moment it finished; a red gate leaves none, so the join's own
// clock is the end there — the review overlapped a gate that ran up to this point either way.
function gate_ended_at(is_green: boolean): string {
	if (!is_green) return now_iso()

	return review_stamps.gate_stamp.read()?.taken_at ?? now_iso()
}

const GREEN_NOTE = 'Gate green — the review verdict may be adopted.'
const RED_NOTE =
	'Gate RED — the review verdict is blocked; fix the gate and re-run it before committing.'

function report_gate(state: GateState): void {
	if (state === run_review.GATE_GREEN) {
		process.stdout.write(`${GREEN_NOTE}\n`)

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
		gate_ended_at: gate_ended_at(state === run_review.GATE_GREEN),
		review_ended_at: now_iso(),
	})

	report_gate(state)
	report_timing(timing)

	return join_exit_code(state)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length === 0) return await run_start()
	if (argv.length === 1 && argv[0] === JOIN_FLAG) return await run_join()

	process.stderr.write(`${USAGE}\n`)

	return FAILURE_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_review_cli = {
	JOIN_FLAG,
	USAGE,
	join_exit_code,
	main,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_review_cli }
