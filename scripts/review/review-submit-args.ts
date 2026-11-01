import { parseArgs } from 'node:util'
import { review_attest, type ReviewSlot } from './review-attest'
import { review_brief_cli } from './review-brief-cli'

// The arguments of `josh review:submit`. `--review <file>` names the reviewer's markdown review, which
// the submit lints in the same call as it checks the findings (joshuafolkken/kit#5627); `--round`
// picks the rubric shape it is linted against, so it means nothing without `--review`.

const ROUND_FLAG = '--round'
const OPTIONS = {
	interaction: { type: 'boolean' },
	none: { type: 'boolean' },
	review: { type: 'string' },
	round: { type: 'string' },
} as const

interface SubmitValues {
	interaction?: boolean
	none?: boolean
	review?: string
	round?: string
}

interface ReviewToLint {
	path: string
	round: number
}

interface Submission {
	slot: ReviewSlot
	is_none: boolean
	review: ReviewToLint | undefined
}

// `undefined` on an unknown flag, a positional, a missing value or a flag given twice.
function values_of(argv: ReadonlyArray<string>): SubmitValues | undefined {
	try {
		const { values, tokens } = parseArgs({ args: [...argv], options: OPTIONS, tokens: true })
		const names = tokens.filter((token) => token.kind === 'option').map((token) => token.name)

		return new Set(names).size === names.length ? values : undefined
	} catch {
		return undefined
	}
}

// `undefined` on a round the rubric has no shape for.
function round_of(raw_round: string | undefined): number | undefined {
	return review_brief_cli.parse_round(raw_round === undefined ? [] : [ROUND_FLAG, raw_round])
}

// A `--round` without `--review` has nothing to lint, so it is refused rather than ignored.
function is_valid(values: SubmitValues): boolean {
	if (values.round === undefined) return true

	return values.review !== undefined && round_of(values.round) !== undefined
}

function review_of(values: SubmitValues): ReviewToLint | undefined {
	const round = round_of(values.round)
	if (round === undefined || values.review === undefined) return undefined

	return { path: values.review, round }
}

function submission_of(argv: ReadonlyArray<string>): Submission | undefined {
	const values = values_of(argv)
	if (values === undefined || !is_valid(values)) return undefined

	const { CODE, INTERACTION } = review_attest.REVIEW_SLOT

	return {
		slot: values.interaction === true ? INTERACTION : CODE,
		is_none: values.none === true,
		review: review_of(values),
	}
}

const review_submit_args = { submission_of }

export { review_submit_args }
export type { Submission }
