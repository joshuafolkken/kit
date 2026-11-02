import type { JoshResult } from '#scripts/josh/josh-run'
import type { LaneInfo } from '#scripts/lane/lane-registry'
import { describe, expect, it, vi } from 'vitest'
import { run_handoff_lanes, type HandoffIo } from './run-handoff-lanes'

const COST = 'cost --cut'
const CARRY = 'run:carry --cut'
const BOARD = 'run:board --chat'
const HANDOFF = 'run:report --handoff'
const CUT_LINE = 'run:handoff-lanes — cut'

function answer(out: string, code = 0): JoshResult {
	return { code, out }
}

function lane(issue: string, overrides: Partial<LaneInfo> = {}): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output: `/tmp/${issue}.output`,
		is_stranded: false,
		...overrides,
	}
}

interface Harness {
	io: HandoffIo
	ran: () => Array<string>
	printed: () => string
}

function harness(
	answers: ReadonlyArray<[string, JoshResult]>,
	lanes: ReadonlyArray<LaneInfo> = [lane('10')],
): Harness {
	const by_step = new Map(answers)
	const run = vi.fn(
		async (argv: ReadonlyArray<string>) => by_step.get(argv.join(' ')) ?? answer(''),
	)
	const lines: Array<string> = []

	function print(text: string): void {
		lines.push(text)
	}

	return {
		io: { run, lanes: async () => lanes, print },
		ran: () => run.mock.calls.map(([argv]) => argv.join(' ')),
		printed: () => lines.join('\n'),
	}
}

const OVER: [string, JoshResult] = [COST, answer('over')]
const COUNTED: [string, JoshResult] = [CARRY, answer('counted')]

describe('run_handoff_lanes.run — the cost check', () => {
	it('goes back to the loop on under and runs nothing after the check', async () => {
		const { io, ran, printed } = harness([[COST, answer('under')]])

		expect(await run_handoff_lanes.run(io)).toBe(0)
		expect(ran()).toStrictEqual([COST])
		expect(printed()).toContain('run:handoff-lanes — under')
	})

	it('takes over’s branch when the check exits 1 with no answer', async () => {
		const { io, printed } = harness([[COST, answer('', 1)], COUNTED])

		expect(await run_handoff_lanes.run(io)).toBe(0)
		expect(printed()).toContain("cost --cut could not answer (exit 1); taking over's branch")
		expect(printed()).toContain(CUT_LINE)
	})

	it('takes over’s branch when the check prints under but exits 1', async () => {
		const { io, ran, printed } = harness([[COST, answer('under', 1)], COUNTED])

		expect(await run_handoff_lanes.run(io)).toBe(0)
		expect(ran()).toStrictEqual([COST, CARRY, BOARD, HANDOFF])
		expect(printed()).toContain(CUT_LINE)
	})
})

describe('run_handoff_lanes.run — the three verdicts', () => {
	it('cuts when every lane records a path: carry, board, then the hand-off report', async () => {
		const { io, ran, printed } = harness([OVER, COUNTED])

		expect(await run_handoff_lanes.run(io)).toBe(0)
		expect(ran()).toStrictEqual([COST, CARRY, BOARD, HANDOFF])
		expect(printed()).toContain(CUT_LINE)
	})

	it('answers blocked with each lane nobody can poll and never counts the cut', async () => {
		const lanes = [lane('10'), lane('11', { output: undefined }), lane('12', { seat: undefined })]
		const { io, ran, printed } = harness([OVER], lanes)

		expect(await run_handoff_lanes.run(io)).toBe(0)
		expect(ran()).toStrictEqual([COST])
		expect(printed()).toMatch(/run:handoff-lanes — blocked \S*#11\S* \S*#12\S*$/mu)
		expect(printed()).toContain('pnpm josh lane:output 11 <path>')
		expect(printed()).toMatch(/#12\S* is unreadable/u)
	})
})

describe('run_handoff_lanes.run — a lane blocked twice', () => {
	it('names both reasons for a lane with no path and an unreadable seat', async () => {
		const lanes = [lane('14', { output: undefined, seat: undefined })]
		const { io, printed } = harness([OVER], lanes)

		expect(await run_handoff_lanes.run(io)).toBe(0)
		expect(printed()).toMatch(/#14\S* is unreadable and records no path/u)
	})
})

describe('run_handoff_lanes.run — the outcomes after a cut', () => {
	it('answers capped and neither posts the board nor hands off', async () => {
		const { io, ran, printed } = harness([OVER, [CARRY, answer('capped')]])

		expect(await run_handoff_lanes.run(io)).toBe(0)
		expect(ran()).toStrictEqual([COST, CARRY])
		expect(printed()).toContain('run:handoff-lanes — capped')
	})

	it('lets a stranded lane through and names it for lane:prune', async () => {
		const lanes = [lane('10'), lane('13', { is_stranded: true, output: undefined })]
		const { io, printed } = harness([OVER, COUNTED], lanes)

		expect(await run_handoff_lanes.run(io)).toBe(0)
		expect(printed()).toMatch(/stranded: \S*#13/u)
		expect(printed()).toContain(CUT_LINE)
	})
})

describe('run_handoff_lanes.run — a refused step', () => {
	it('stops at the first step after the carry that exits non-zero, with its exit code', async () => {
		const { io, ran, printed } = harness([OVER, COUNTED, [BOARD, answer('', 2)]])

		expect(await run_handoff_lanes.run(io)).toBe(2)
		expect(ran()).not.toContain(HANDOFF)
		expect(printed()).toContain(`stopped at ${BOARD} (exit 2)`)
	})

	it('stops when run:carry --cut refuses', async () => {
		const { io, ran } = harness([OVER, [CARRY, answer('mismatch', 1)]])

		expect(await run_handoff_lanes.run(io)).toBe(1)
		expect(ran()).toStrictEqual([COST, CARRY])
	})
})
