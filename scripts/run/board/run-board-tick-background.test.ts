import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import type { ClosedAnswer } from './run-board-closed'
import { run_board_fixture } from './run-board-fixture'
import { run_board_labels } from './run-board-labels'
import type { BoardPlan } from './run-board-layout'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#3455: a live board draws its first frame from the local reads alone, turns a
// spinner after ⏳ while the plan read is in flight, and draws the plan on the redraw after it lands.

const { LOCAL, SPINNING, START, WORDS, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, MACHINE_SAMPLE_MS, tick } = run_board_tick
const { spinner_of } = run_board_labels
const LOADING = '⏳'
// The progress line's count, not its bare icon: the legend draws ✅ too whenever a layout exists.
const PROGRESS = /✅ +\d+\/\d+/u
const CHILD = 3439
const LAUNCH = {
	pos: 1,
	at: '2026-10-08T08:00:00.000Z',
	kind: 'child-launch',
	text: `#${String(CHILD)} a`,
}
const LOCAL_CLOSED = { ...LOCAL, events: [LAUNCH] }
// A listing read whole that no longer holds the launched child, so the board asks whether it closed.
const OPEN_NONE: BoardPlan = {
	...plan_titled('a'),
	context: { repo: 'joshuafolkken/kit', titles: new Map(), open_numbers: new Set() },
}

// Lets a pending read's continuation run, as the sleep between two redraws does.
async function flush(): Promise<void> {
	await new Promise((resolve) => {
		setImmediate(resolve)
	})
}

// A read that never answers.
async function never(): Promise<never> {
	return await new Promise(() => undefined)
}

// A plan read that answers once the test flushes.
async function answering(): Promise<BoardPlan | undefined> {
	await flush()

	return plan_titled('a')
}

async function rejecting(): Promise<BoardPlan | undefined> {
	await flush()

	throw new Error('offline')
}

function title_of(frame = ''): string {
	return stripVTControlCharacters(frame).split('\n', 1)[0] ?? ''
}

// The two frames drawn on either side of a read that lands between them.
async function across_landing(read: () => Promise<BoardPlan | undefined>): Promise<Array<string>> {
	const { ports, frames } = harness(LOCAL, [])
	const live = { ...ports, read_plan: read }
	const first = await tick(FRESH_STATE, live, 'background')

	await flush()
	await tick(first, live, 'background')

	return frames
}

describe('run_board_tick.tick in the background', () => {
	it('draws the first frame before the plan read lands, the spinner turning after ⏳', async () => {
		const { ports, frames } = harness(LOCAL, [])

		await tick(FRESH_STATE, { ...ports, read_plan: never }, 'background')

		expect(frames).toHaveLength(1)
		expect(title_of(frames[0])).toContain(`${LOADING} ${spinner_of(START)}`)
		expect(frames[0]).not.toMatch(PROGRESS)
	})

	it('keeps the clock moving while the read is in flight and launches it once', async () => {
		const read_plan = vi.fn(never)
		const { ports, frames, clock } = harness(LOCAL, [])
		const live = { ...ports, read_plan }
		const first = await tick(FRESH_STATE, live, 'background')

		clock.now_ms += MACHINE_SAMPLE_MS
		await tick(first, live, 'background')

		expect(frames[0]).toContain('⏱ 00:00')
		expect(frames[1]).toContain('⏱ 00:01')
		expect(read_plan).toHaveBeenCalledOnce()
	})
})

describe('run_board_tick.tick in the background, once the read lands', () => {
	it('draws the plan on the redraw after the read lands and stops the spinner', async () => {
		const [loading, landed] = await across_landing(answering)

		expect(loading).not.toMatch(PROGRESS)
		expect(landed).toMatch(PROGRESS)
		expect(title_of(landed)).not.toMatch(SPINNING)
	})

	it('warns as for a failed read when the read rejects', async () => {
		const [, landed] = await across_landing(rejecting)

		expect(title_of(landed)).toContain(`⚠ ${WORDS.plan}`)
		expect(title_of(landed)).not.toMatch(SPINNING)
	})
})

describe('run_board_tick.tick in the background, closed children', () => {
	it('keeps redrawing while the closed children are read once the plan has landed', async () => {
		const read_closed = vi.fn(async (): Promise<ClosedAnswer> => await never())
		const { ports, frames } = harness(LOCAL_CLOSED, [OPEN_NONE])
		const first = await tick(FRESH_STATE, { ...ports, read_closed }, 'background')
		const second = await tick(first, { ...ports, read_closed }, 'background')

		await tick(second, { ...ports, read_closed }, 'background')

		expect(frames).toHaveLength(3)
		expect(read_closed).toHaveBeenCalledOnce()
	})
})

describe('run_board_tick.tick settled', () => {
	it('waits for the plan and draws no loading spinner', async () => {
		const { ports, frames } = harness(LOCAL, [plan_titled('a')])

		await tick(FRESH_STATE, ports)

		expect(frames[0]).toMatch(PROGRESS)
		expect(title_of(frames[0])).not.toMatch(SPINNING)
	})
})
