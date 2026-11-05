import { RUN_LANE_LABEL, RUN_SOLO_LABEL } from '#scripts/issue/issue-labels'
import { cli_flags } from '#scripts/lib/cli-flags'

const OPTIONS = {
	defect: { type: 'string' },
	verification: { type: 'string' },
	'every-run': { type: 'string' },
} as const
const ANSWERS = new Set(['yes', 'no', 'unknown'])
const USAGE =
	'Usage: josh backlog:triage --decide --defect yes|no|unknown --verification yes|no|unknown --every-run yes|no|unknown'

// Evidence is supplied by the reader: prose cannot prove a failure on main on every run.
// A known missing condition decides lane even when another condition is still unknown.
function decide(answers: ReadonlyArray<string>): string {
	if (answers.includes('no')) return RUN_LANE_LABEL
	if (answers.includes('unknown')) return 'judge'

	return RUN_SOLO_LABEL
}

function is_answer(answer: string | undefined): answer is string {
	return answer !== undefined && ANSWERS.has(answer)
}

function answers_of(argv: ReadonlyArray<string>): ReadonlyArray<string> | undefined {
	const values = cli_flags.values_of(argv, OPTIONS)
	const answers = [values?.defect, values?.verification, values?.['every-run']]

	return answers.every(is_answer) ? answers : undefined
}

function run(argv: ReadonlyArray<string>): number {
	const answers = answers_of(argv)

	if (answers === undefined) {
		console.error(USAGE)

		return 1
	}

	console.info(decide(answers))

	return 0
}

const backlog_triage_decision = { OPTIONS, decide, is_answer, run }

export { backlog_triage_decision }
