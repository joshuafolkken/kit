import { shell_quote } from '#scripts/lib/shell-quote'
import { review_record_cli } from '#scripts/review/review-record-cli'
import { review_record_slot } from '#scripts/review/review-record-slot'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { run_chain, type ChainStage, type HoldStop, type StageHold } from './run-chain'
import { run_chain_recheck } from './run-chain-recheck'
import { run_chain_review_fix } from './run-chain-review-fix'

// The half of `josh run:chain` after the review (joshuafolkken/kit#5735): `run:review --join`,
// `review:attest --check`, `review:record --from-slot` and the recheck of the recorded tree
// (`run-chain-recheck.ts`), over the stage runner the half before it
// uses. The review subagent cannot run inside a command, so this half is its own call, `--join`. The
// attested round holds on any finding in the code slot — each one is fixed or disposed of before it is
// recorded — and its next action asks for round 2 where a High or a Medium is among them
// (`chain-rule.md` → "Run the review-to-merge chain", step 4). A slot the verdict cannot read is left
// to `review:record`, whose refusal names it.

const RUN_REVIEW = 'run:review'
const ATTEST = 'review:attest'
const RECORD = 'review:record'
const JOIN = '--join'
// The chain's join returns `pending` before the prompt cache expires; the stop's `next:` is the same
// command (joshuafolkken/kit#8309).
const CHUNK = '--chunk'
const FIXING = '--fixing'
const SHIP = '--ship'
const ROUND_TWO_SEVERITIES: ReadonlySet<string> = new Set(['high', 'medium'])
// The code slot: the interaction pass is recorded beside round 1 on its own call.
const is_interaction = false

function record_call(issue: string): string {
	return `\`pnpm josh ${RECORD} --from-slot --issue ${issue}\``
}

function severity_of(spec: string): string {
	return review_record_cli.parse_finding(review_record_slot.unmarked(spec))?.severity ?? ''
}

// The fixed tree is rechecked before the ship (`run-chain-recheck.ts`); under `--ship` the rerun ships
// itself, so no second ship is named beside the detached one.
function recheck_then(issue: string, mode: ReadonlyArray<string>, ship: string): string {
	const rerun = run_chain.rerun(issue, run_chain_recheck.RECHECK, mode)

	return mode.includes(SHIP) ? `${rerun}, which ships` : `${rerun}, then ${ship}`
}

function round_two_next(mode: ReadonlyArray<string>): (issue: string) => string {
	return (issue) =>
		`fix each finding, record each disposition with ${record_call(issue)} (\`<n>=<disposition>\`: its usage), ${recheck_then(issue, mode, 'ship with `--review`')} — a High or a Medium makes round 2 due (\`chain-rule.md\` → "Run the review-to-merge chain", step 4)`
}

function low_only_next(mode: ReadonlyArray<string>): (issue: string) => string {
	return (issue) =>
		`fix, file or drop each Low with a one-line reason, record each disposition with ${record_call(issue)} (\`<n>=<disposition>\`: its usage), ${recheck_then(issue, mode, 'ship')} — no round 2 is due`
}

// A lane child past the cut threshold takes the fix to a fresh session (`run-chain-review-fix.ts`).
function findings_stop(
	issue: string,
	specs: ReadonlyArray<string>,
	mode: ReadonlyArray<string>,
): HoldStop {
	const is_round_two = specs.some((spec) => ROUND_TWO_SEVERITIES.has(severity_of(spec)))
	const notice = `attested; ${String(specs.length)} finding(s) to settle before the record`
	const fix_next = is_round_two ? round_two_next(mode) : low_only_next(mode)

	return { notice, next: run_chain_review_fix.route(issue, specs, fix_next) }
}

function slot_stop(issue: string, mode: ReadonlyArray<string>): HoldStop | undefined {
	const verdict = run_ship_review.read_verdict(review_record_slot.slot_text(is_interaction))

	if (verdict.kind === run_ship_review.VERDICT.INVALID) return undefined

	return verdict.specs.length === 0 ? undefined : findings_stop(issue, verdict.specs, mode)
}

function findings_hold(mode: ReadonlyArray<string>): StageHold {
	return async (issue) => slot_stop(issue, mode)
}

function attest_stage(mode: ReadonlyArray<string>): ChainStage {
	return {
		name: ATTEST,
		argv: [ATTEST, '--check'],
		next: (target) =>
			`a \`missing\` or \`mismatch\` round does not count: rerun the review against the brief's checkout, ${run_chain.rerun(target, ATTEST, mode)}`,
		hold: findings_hold(mode),
	}
}

function ship_stage(title: string, mode: ReadonlyArray<string>): ChainStage {
	return {
		name: 'ship',
		argv: ['ship', '--detach', '--review', title],
		next: (target) => `settle what \`ship\` refused, ${run_chain.rerun(target, 'ship', mode)}`,
	}
}

function join_mode(is_fixing: boolean, title: string | undefined): ReadonlyArray<string> {
	return [
		JOIN,
		...(is_fixing ? [FIXING] : []),
		...(title === undefined ? [] : [SHIP, shell_quote.word(title)]),
	]
}

// Printed resumptions preserve the selected mode and quote the title as one shell word.
function join_stages(issue: string, is_fixing: boolean, title?: string): ReadonlyArray<ChainStage> {
	const mode = join_mode(is_fixing, title)

	return [
		{
			name: RUN_REVIEW,
			argv: [RUN_REVIEW, JOIN, ...(is_fixing ? [FIXING] : []), CHUNK],
			next: (target) =>
				`settle what \`${RUN_REVIEW} ${JOIN}\` reported (\`chain-rule.md\` → "Run the review-to-merge chain", step 2), ${run_chain.rerun(target, undefined, mode)}`,
		},
		attest_stage(mode),
		{
			name: RECORD,
			argv: [RECORD, '--from-slot', '--issue', issue],
			next: (target) =>
				`settle what \`${RECORD}\` refused, ${run_chain.rerun(target, RECORD, mode)}`,
		},
		run_chain_recheck.stage(mode),
		...(title === undefined ? [] : [ship_stage(title, mode)]),
	]
}

const run_chain_join = { join_stages }

export { run_chain_join }
