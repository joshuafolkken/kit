import { stamp_file } from '#scripts/josh/stamp-file'
import { review_attest } from './review-attest'

type Round = '1' | '2'
const FULL_CHANGE_FLAG = '--full-change'
const FINAL_LINE = 'Review round: 2 — final, whole change, read only.'
const SECOND_ROUND = 2
const ROUND_ARGUMENT_COUNT = 2
const ROUND_PREFIX = 'josh-review-round-'

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

function record(round: number, root?: string): void {
	const pointer = review_attest.read_pointer(root)

	if (pointer === undefined) return
	stamp_file.write_text_stamp(stamp_file.stamp_path(ROUND_PREFIX, pointer.nonce), String(round))
}

function current(root?: string): Round {
	const pointer = review_attest.read_pointer(root)
	const text =
		pointer === undefined
			? undefined
			: stamp_file.read_stamp_text(stamp_file.stamp_path(ROUND_PREFIX, pointer.nonce))

	return text === '2' ? '2' : '1'
}

const review_round = {
	current,
	from_brief,
	record,
	parse_round,
	FINAL_LINE,
	FULL_CHANGE_FLAG,
	SECOND_ROUND,
}

export type { Round }
export { review_round }
