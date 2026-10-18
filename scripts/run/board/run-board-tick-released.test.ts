import type { EpicChild } from '#scripts/epic/epic-graph'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_labels } from './run-board-labels'
import type { BoardPlan } from './run-board-layout'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#4080: a parked child a person released by removing `needs-decision` stayed drawn 💤
// and counted in the header's `💤 N`. Read open without the label, it is drawn where the plan places
// it — here waiting on its declared start time.

const { LOCAL, WORDS, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const ISSUE = 4067
const TITLE = 'Measure the gate unit leg'
const REPO = 'joshuafolkken/kit'
const FUTURE = '2026-10-24T23:29Z'
const RELEASED_LABELS = ['auto-ok', 'run:lane']

function event_of(pos: number, at: string, kind: string, verb: string): RunEvent {
	return { pos, at, kind, text: `#${String(ISSUE)} ${verb}` }
}

const LAUNCH = event_of(1, '2026-10-07T04:00:00.000Z', 'child-launch', 'launched')

// Parked before the board's clock, so the listing the board reads is read after the park.
function local_parked(verb: string): typeof LOCAL {
	return { ...LOCAL, events: [LAUNCH, event_of(2, '2026-10-07T04:24:00.000Z', 'park', verb)] }
}

const LOCAL_PARKED = local_parked('parked (needs-decision)')

function plan_with(labels: ReadonlyArray<string>): BoardPlan {
	const child: EpicChild = {
		number: ISSUE,
		repo: REPO,
		state: 'OPEN',
		labels,
		blocked_by: [],
		body: `## 背景\n\n- 実施可能日: ${FUTURE}\n`,
	}

	return {
		waves: { waves: [], unreached: [child] },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map([[ISSUE, TITLE]]), open_numbers: new Set([ISSUE]) },
		labels: new Map([[ISSUE, labels]]),
	}
}

async function frame_with(
	labels: ReadonlyArray<string>,
	local = LOCAL_PARKED,
): Promise<Array<string>> {
	const { ports, frames } = harness(local, [plan_with(labels)])

	await tick(FRESH_STATE, ports)

	return (frames.at(-1) ?? '').split('\n')
}

function row_of(lines: ReadonlyArray<string>): string | undefined {
	return lines.find((line) => line.includes(String(ISSUE)))
}

describe('run_board_tick.tick — a parked child a person released', () => {
	it('draws it waiting on its start time and leaves it out of the parked count', async () => {
		const lines = await frame_with(RELEASED_LABELS)
		const not_before = `not before ${run_board_labels.date_minute_of(Date.parse(FUTURE))}`
		const row = row_of(lines)

		expect(row).not.toContain('💤')
		expect(row).toContain(not_before)
		expect(lines.indexOf(row ?? '')).toBeGreaterThan(
			lines.findIndex((line) => line.includes(`🔗 ${WORDS.waiting}`)),
		)
		expect(lines[0]).toContain('💤 0')
	})

	// joshuafolkken/kit#4099: drawn 🙋 and counted as remaining, as it still waits on a decision.
	it('keeps a child still carrying needs-decision on a decision and counted as remaining', async () => {
		const lines = await frame_with([...RELEASED_LABELS, 'needs-decision'])

		expect(row_of(lines)).toContain(`🙋 ${String(ISSUE)}`)
		expect(lines[0]).toContain('⏳ 1  💤 0')
	})

	// joshuafolkken/kit#4127: the findings section read the park off the stream and kept saying it.
	it('leaves its park out of the findings section', async () => {
		const lines = await frame_with(RELEASED_LABELS, local_parked('waiting on #4065'))

		expect(lines.join('\n')).not.toContain('(waiting on #4065)')
		expect(lines.filter((line) => line.includes('💤'))).toStrictEqual([lines[0]])
	})
})
