import { shell_quote } from '#scripts/lib/shell-quote'
import { review_record_cli } from '#scripts/review/review-record-cli'
import { review_record_slot } from '#scripts/review/review-record-slot'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { run_chain, type ChainStage, type HoldStop } from './run-chain'
import { run_chain_review_fix } from './run-chain-review-fix'

// The half of `josh run:chain` after the review (joshuafolkken/kit#5735): `run:review --join`,
// `review:attest --check` and `review:record --from-slot`, over the stage runner the half before it
// uses. The review subagent cannot run inside a command, so this half is its own call, `--join`. The
// attested round holds on any finding in the code slot — each one is fixed or disposed of before it is
// recorded — and its next action asks for round 2 where a High or a Medium is among them
// (`chain-rule.md` → "Run the review-to-merge chain", step 4). A slot the verdict cannot read is left
// to `review:record`, whose refusal names it.

const RUN_REVIEW = 'run:review'
const ATTEST = 'review:attest'
const RECORD = 'review:record'
const JOIN = '--join'
const FIXING = '--fixing'
const ROUND_TWO_SEVERITIES: ReadonlySet<string> = new Set(['high', 'medium'])
// The code slot: the interaction pass is recorded beside round 1 on its own call.
const is_interaction = false

function record_call(issue: string): string {
	return `\`pnpm josh ${RECORD} --from-slot --issue ${issue}\``
}

function severity_of(spec: string): string {
	return review_record_cli.parse_finding(review_record_slot.unmarked(spec))?.severity ?? ''
}

function round_two_next(issue: string): string {
	return `fix each finding, record each disposition with ${record_call(issue)} (\`<n>=<disposition>\`: its usage), then ship with \`--review\` — a High or a Medium makes round 2 due (\`chain-rule.md\` → "Run the review-to-merge chain", step 4)`
}

function low_only_next(issue: string): string {
	return `fix, file or drop each Low with a one-line reason, record each disposition with ${record_call(issue)} (\`<n>=<disposition>\`: its usage), then ship — no round 2 is due`
}

// A lane child takes the fix to a fresh session (`run-chain-review-fix.ts`).
function findings_stop(issue: string, specs: ReadonlyArray<string>): HoldStop {
	const is_round_two = specs.some((spec) => ROUND_TWO_SEVERITIES.has(severity_of(spec)))
	const notice = `attested; ${String(specs.length)} finding(s) to settle before the record`
	const fix_next = is_round_two ? round_two_next : low_only_next

	return { notice, next: run_chain_review_fix.route(issue, specs, fix_next) }
}

function slot_stop(issue: string): HoldStop | undefined {
	const verdict = run_ship_review.read_verdict(review_record_slot.slot_text(is_interaction))

	if (verdict.kind === run_ship_review.VERDICT.INVALID) return undefined

	return verdict.specs.length === 0 ? undefined : findings_stop(issue, verdict.specs)
}

async function findings_hold(issue: string): Promise<HoldStop | undefined> {
	return slot_stop(issue)
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
		...(title === undefined ? [] : ['--ship', shell_quote.word(title)]),
	]
}

// Printed resumptions preserve the selected mode and quote the title as one shell word.
function join_stages(issue: string, is_fixing: boolean, title?: string): ReadonlyArray<ChainStage> {
	const mode = join_mode(is_fixing, title)

	return [
		{
			name: RUN_REVIEW,
			argv: [RUN_REVIEW, JOIN, ...(is_fixing ? [FIXING] : [])],
			next: (target) =>
				`settle what \`${RUN_REVIEW} ${JOIN}\` reported (\`chain-rule.md\` → "Run the review-to-merge chain", step 2), ${run_chain.rerun(target, undefined, mode)}`,
		},
		{
			name: ATTEST,
			argv: [ATTEST, '--check'],
			next: (target) =>
				`a \`missing\` or \`mismatch\` round does not count: rerun the review against the brief's checkout, ${run_chain.rerun(target, ATTEST, mode)}`,
			hold: findings_hold,
		},
		{
			name: RECORD,
			argv: [RECORD, '--from-slot', '--issue', issue],
			next: (target) =>
				`settle what \`${RECORD}\` refused, ${run_chain.rerun(target, RECORD, mode)}`,
		},
		...(title === undefined ? [] : [ship_stage(title, mode)]),
	]
}

const run_chain_join = { join_stages }

export { run_chain_join }
