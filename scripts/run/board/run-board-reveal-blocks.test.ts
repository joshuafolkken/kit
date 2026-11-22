import { describe, expect, it } from 'vitest'
import { run_board_label_pair } from './run-board-label-pair'
import { run_board_reveal_blocks } from './run-board-reveal-blocks'

// joshuafolkken/kit#8224: the WarGames reveal writes each line of its first frame a block at a time —
// the four lines the issue agreed on fix how a line is cut, their titles cut as the board cuts them.
// cspell:ignore DISPLA

const { LINE_MS, beats_of, blocks_of } = run_board_reveal_blocks
const { TITLE_MARK: MARK, untitled } = run_board_label_pair
const CYAN = '\u{1B}[36m'
const DEFAULT = '\u{1B}[39m'

const AGREED = [
	{
		name: 'the throughput rule',
		line: 'V    THROUGHPUT ----------------- PW /H - AC ACTIVE - OK DONE - ^ PEAK ---------- RN NOW ------',
		blocks: [
			'V',
			'    THROUGHPUT',
			' -----------------',
			' PW /H',
			' -',
			' AC ACTIVE',
			' -',
			' OK DONE',
			' -',
			' ^ PEAK',
			' ----------',
			' RN NOW',
			' ------',
		],
	},
	{
		name: 'a lane row',
		line: `│   BD   30′52″   44′31″  6.5 ■■---  3.2 ■■■■■  0.7 ■---- 8159 P1 FT ${MARK}RUN THE RUN:BOARD GITHUB, THANKS AND SNAPSHOT R…  ET 17:05 +12′  >    41″`,
		blocks: [
			'│',
			'   BD',
			'   30′52″',
			'   44′31″',
			'  6.5 ■■---',
			'  3.2 ■■■■■',
			'  0.7 ■----',
			' 8159 P1 FT',
			' RUN THE RUN:BOARD GITHUB, THANKS AND SNAPSHOT R…',
			'  ET 17:05 +12′',
			'  >',
			'    41″',
		],
	},
	{
		name: 'a needs-person row',
		line: `    NB EVIDENCE    7400       ${MARK}EVALUATE POST-ROLLOUT IMPACT OF OVERLAPPING CI …  OBSERVATION EVIDENCE REQUIRED: MULTI-SLOT, SAME-HEAD, COMPARISON, COST`,
		blocks: [
			'    NB EVIDENCE',
			'    7400',
			'       EVALUATE POST-ROLLOUT IMPACT OF OVERLAPPING CI …',
			'  OBSERVATION EVIDENCE REQUIRED: MULTI-SLOT, SAME-HEAD, COMPARISON, COST',
		],
	},
	{
		name: 'a queued row',
		line: `    NS             8179 P2 FT ${MARK}ROUTE RUN:BOARD REDRAWN THROUGH ASSEMBLE_DISPLA…  LK 8158`,
		blocks: [
			'    NS',
			'             8179 P2 FT',
			' ROUTE RUN:BOARD REDRAWN THROUGH ASSEMBLE_DISPLA…',
			'  LK 8158',
		],
	},
]

describe('run_board_reveal_blocks.blocks_of the agreed lines', () => {
	it.each(AGREED)('cuts $name as agreed', ({ line, blocks }) => {
		expect(blocks_of(line)).toStrictEqual(blocks)
	})

	it.each(AGREED)('joins the blocks of $name back into the line without its mark', ({ line }) => {
		expect(blocks_of(line).join('')).toBe(untitled(line))
	})
})

describe('run_board_reveal_blocks.blocks_of rules and gauges', () => {
	it.each([
		{ line: 'A - B', blocks: ['A', ' -', ' B'] },
		{ line: 'A ----- B', blocks: ['A', ' -----', ' B'] },
		{ line: '----- A', blocks: ['-----', ' A'] },
		{ line: 'A -----', blocks: ['A', ' -----'] },
	])('draws a run of `-` blank-bounded as a block of its own: $line', ({ line, blocks }) => {
		expect(blocks_of(line)).toStrictEqual(blocks)
	})

	it('keeps a `-` within a word in the word', () => {
		const words = 'POST-ROLLOUT A-B'

		expect(blocks_of(words)).toStrictEqual([words])
	})

	it('ends a block at a gauge', () => {
		expect(blocks_of('0.7 ■---- 8159 P1')).toStrictEqual(['0.7 ■----', ' 8159 P1'])
	})
})

describe('run_board_reveal_blocks.blocks_of a title', () => {
	it('keeps a title one block, a rule within it kept', () => {
		expect(blocks_of(`8159 P1 ${MARK}FIX - THE ■ BOARD  ET`)).toStrictEqual([
			'8159 P1',
			' FIX - THE ■ BOARD',
			'  ET',
		])
	})

	it('cuts at a mark that follows an escape', () => {
		expect(blocks_of(`8159 ${CYAN}${MARK}A TITLE${DEFAULT}  ET`)).toStrictEqual([
			'8159',
			` ${CYAN}A TITLE${DEFAULT}`,
			'  ET',
		])
	})
})

describe('run_board_reveal_blocks.blocks_of escapes and blanks', () => {
	it('never cuts an escape, and weighs it nothing', () => {
		expect(blocks_of(`${CYAN}AB${DEFAULT}  ${CYAN}CD ${DEFAULT}`)).toStrictEqual([
			`${CYAN}AB${DEFAULT}`,
			`  ${CYAN}CD ${DEFAULT}`,
		])
	})

	it('writes the blanks a line ends on with its last block', () => {
		expect(blocks_of('AB  CD   ')).toStrictEqual(['AB', '  CD   '])
	})

	it('cuts an empty line into no blocks', () => {
		expect(blocks_of('')).toStrictEqual([])
	})
})

function total(line: string): number {
	return beats_of(line).reduce((sum, beat) => sum + beat.ms, 0)
}

describe('run_board_reveal_blocks.beats_of', () => {
	it.each([
		{ line: 'AB', count: 1 },
		{ line: 'AB  CD  EF', count: 3 },
	])('shares the line beat evenly between $count block(s)', ({ line, count }) => {
		const beats = beats_of(line)

		expect(beats).toHaveLength(count)
		expect(new Set(beats.map((beat) => beat.ms))).toStrictEqual(new Set([LINE_MS / count]))
		expect(total(line)).toBe(LINE_MS)
	})

	it('gives an empty line one beat of the line', () => {
		expect(beats_of('')).toStrictEqual([{ text: '', ms: LINE_MS }])
	})

	it('holds a line 75 ms', () => {
		expect(LINE_MS).toBe(75)
	})
})
