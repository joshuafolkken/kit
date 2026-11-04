type Round = '1' | '2'
const FULL_CHANGE_FLAG = '--full-change'
const FINAL_LINE = 'Review round: 2 — final, whole change, read only.'
const SECOND_ROUND = 2
const ROUND_ARGUMENT_COUNT = 2

function numbered_round(argv: ReadonlyArray<string>): number | undefined {
	if (argv.length !== ROUND_ARGUMENT_COUNT || argv[0] !== '--round') return undefined
	const round = Number(argv[1])

	return round === 1 || round === SECOND_ROUND ? round : undefined
}

function parse_round(argv: ReadonlyArray<string>): number | undefined {
	if (argv.length === 0) return 1
	if (argv.length === 1) return argv[0] === FULL_CHANGE_FLAG ? SECOND_ROUND : undefined

	return numbered_round(argv)
}

function from_brief(brief: string, fallback: Round = '1'): Round {
	return brief.split('\n').includes(FINAL_LINE) ? '2' : fallback
}

const review_round = {
	from_brief,
	parse_round,
	FINAL_LINE,
	FULL_CHANGE_FLAG,
	SECOND_ROUND,
}

export type { Round }
export { review_round }
