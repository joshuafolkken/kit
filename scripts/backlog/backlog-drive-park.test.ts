import { run_merge_token } from '#scripts/run/merge/run-merge-token'
import { describe, expect, it, vi } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_fixture, type Harness, type Script } from './backlog-drive-fixture'

const { FIRST_CHILD, OFFERED, SECOND_CHILD, harness, offer, state } = backlog_drive_fixture

it('launches the next child in a free lane after collecting a human-review stop', async () => {
	const { ports, calls } = harness({
		finished: [FIRST_CHILD],
		human_review: [FIRST_CHILD],
		offers: [offer('run', [SECOND_CHILD])],
		free_lanes: [1],
	})
	const result = await backlog_drive.run_pass(state([FIRST_CHILD]), true, ports)

	expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, 'offer', `launch ${SECOND_CHILD}`])
	expect(result.kind === 'continue' && result.state.in_flight).toStrictEqual([SECOND_CHILD])
	expect(result.state.exclude).toStrictEqual([])
})

// joshuafolkken/kit#3041: a parked child stayed excluded for the rest of the driver's process, so one a
// person released from `needs-decision` was never offered again until the driver restarted.
describe('backlog_drive — a parked child is not excluded', () => {
	it('leaves a child run:merge parked out of the exclude list', async () => {
		const { ports, offers } = harness({ finished: [FIRST_CHILD], parked: [FIRST_CHILD] })
		const result = await backlog_drive.run_pass(state([FIRST_CHILD]), false, ports)

		expect(offers[0]?.exclude).toStrictEqual([])
		expect(result.state.exclude).toStrictEqual([])
		expect(result.state.in_flight).toStrictEqual([])
		expect(result.kind === 'end' && result.end.reason).toBe('triage')
	})

	it('still excludes a merged child beside a parked one', async () => {
		const { ports } = harness({ finished: [FIRST_CHILD, SECOND_CHILD], parked: [SECOND_CHILD] })
		const result = await backlog_drive.run_pass(state([FIRST_CHILD, SECOND_CHILD]), false, ports)

		expect(result.state.exclude).toStrictEqual([FIRST_CHILD])
	})

	it('launches a parked child again once a later offer returns it', async () => {
		const { ports, calls, offers } = harness({
			finished: [FIRST_CHILD],
			parked: [FIRST_CHILD],
			offers: [offer('wait'), offer('run', [FIRST_CHILD])],
		})
		const parked = await backlog_drive.run_pass(state([FIRST_CHILD]), false, ports)
		const released = await backlog_drive.run_pass(parked.state, true, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, 'offer', 'offer', `launch ${FIRST_CHILD}`])
		expect(offers[1]?.exclude).toStrictEqual([])
		expect(released.kind === 'continue' && released.state.in_flight).toStrictEqual([FIRST_CHILD])
	})
})

describe('backlog_drive — parked-child triage rounds', () => {
	it('hands back one triage after collecting every parked child in the round', async () => {
		const children = [FIRST_CHILD, SECOND_CHILD]
		const { ports, calls } = harness({ finished: children, parked: children })
		const result = await backlog_drive.run_pass(state(children), true, ports)

		expect(calls).toStrictEqual([...children.map((issue) => `merge ${issue}`), 'offer'])
		expect(result.state.in_flight).toStrictEqual([])
		expect(result.kind === 'end' && result.end.token).toBe('triage')
	})

	it('does not repeat a completed triage when the parent resumes', async () => {
		const { ports } = harness({ finished: [FIRST_CHILD], parked: [FIRST_CHILD] })
		const round = await backlog_drive.run_pass(state([FIRST_CHILD]), true, ports)
		const resumed = await backlog_drive.run_pass(round.state, true, ports)

		expect(resumed.kind).toBe('continue')
	})

	it('does not request triage when no child parked', async () => {
		const { ports } = harness({ finished: [FIRST_CHILD] })
		const result = await backlog_drive.run_pass(state([FIRST_CHILD]), true, ports)

		expect(result.kind).toBe('continue')
	})

	it('triages a failure newly parked by collection rather than already labelled', async () => {
		const { ports } = harness({ finished: [FIRST_CHILD] })

		ports.merge = vi.fn(async (): ReturnType<typeof ports.merge> => ({
			token: 'deferred',
			is_offer: true,
			outcome: 'failed',
			is_parked: true,
		}))
		const result = await backlog_drive.run_pass(state([FIRST_CHILD]), true, ports)

		expect(result.kind === 'end' && result.end.reason).toBe('triage')
	})
})

// joshuafolkken/kit#6871: a park ended the pass with `triage` before the offer, so a free lane stayed
// empty through the judgment session while triaged candidates waited.
function parked_harness(script: Partial<Script>): Harness {
	return harness({ finished: [FIRST_CHILD], parked: [FIRST_CHILD], ...script })
}

// The parked child beside one still running.
const BESIDE_RUNNING = [FIRST_CHILD, SECOND_CHILD]

describe('backlog_drive — a parked child fills free lanes before triage', () => {
	it('launches the triaged candidate before handing triage back', async () => {
		const { ports, calls } = parked_harness({ offers: [offer('run', [OFFERED])] })
		const result = await backlog_drive.run_pass(state(BESIDE_RUNNING), false, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, 'offer', `launch ${OFFERED}`])
		expect(result.kind === 'end' && result.end.token).toBe('triage')
		expect(result.state).toMatchObject({
			in_flight: [SECOND_CHILD, OFFERED],
			is_triage_owed: false,
		})
	})

	it('does not relaunch the parked child in the same pass', async () => {
		const { ports, calls, offers } = parked_harness({ offers: [offer('run', [OFFERED])] })

		await backlog_drive.run_pass(state(BESIDE_RUNNING), false, ports)

		expect(offers[0]?.in_flight).toStrictEqual([SECOND_CHILD])
		expect(calls).not.toContain(`launch ${FIRST_CHILD}`)
	})

	it('offers on a pass whose only park was a resumed cut', async () => {
		const { ports, calls } = parked_harness({
			merges: new Map([[FIRST_CHILD, run_merge_token.MERGE_TOKEN.RESUMED]]),
			offers: [offer('run', [OFFERED])],
		})
		const result = await backlog_drive.run_pass(state([FIRST_CHILD]), false, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, 'offer', `launch ${OFFERED}`])
		expect(result.kind === 'end' && result.end.reason).toBe('triage')
	})
})

describe('backlog_drive — a parked child with nothing to launch', () => {
	it('hands triage back with no offer hold when nothing is runnable', async () => {
		const pool = parked_harness({ offers: [offer('watch')] })
		const result = await backlog_drive.run_pass(state(BESIDE_RUNNING), false, pool.ports)

		expect(pool.calls).toStrictEqual([`merge ${FIRST_CHILD}`, 'offer'])
		expect(pool.holds).toStrictEqual([])
		expect(result.kind === 'end' && result.end.reason).toBe('triage')
	})

	it('hands triage back without an offer when no lane is free', async () => {
		const { ports, calls } = parked_harness({ free_lanes: [0] })
		const result = await backlog_drive.run_pass(state(BESIDE_RUNNING), true, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`])
		expect(result.kind === 'end' && result.end.reason).toBe('triage')
	})
})

// The judge, the drain and the retrospective read any answer but `run` — none of them may run ahead of
// the parent's triage, so the offer counts the park as running even when nothing else is in flight.
describe('backlog_drive — a parked child owes triage before the drain', () => {
	it('fills a free lane when the park left nothing else in flight', async () => {
		const { ports, calls } = parked_harness({ offers: [offer('run', [OFFERED])] })
		const result = await backlog_drive.run_pass(state([FIRST_CHILD]), false, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, 'offer', `launch ${OFFERED}`])
		expect(result.kind === 'end' && result.end.reason).toBe('triage')
	})

	it('hands triage back on a stop answer without running the retrospective unit', async () => {
		const { ports, calls } = parked_harness({ offers: [offer('stop')] })
		const result = await backlog_drive.run_pass(state(BESIDE_RUNNING), false, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, 'offer'])
		expect(result.kind === 'end' && result.end.reason).toBe('triage')
	})

	it('hands triage back when the offer fails', async () => {
		const { ports } = parked_harness({ offers: [undefined] })
		const result = await backlog_drive.run_pass(state(BESIDE_RUNNING), false, ports)

		expect(result.kind === 'end' && result.end.reason).toBe('triage')
		expect(result.state.is_triage_owed).toBe(false)
	})
})

// joshuafolkken/kit#4365: `lane:withdraw` leaves the issue open, so the drive keeps it out of this run.
describe('backlog_drive — a withdrawn child is excluded', () => {
	it('excludes a child run:merge booked withdrawn from the next offer', async () => {
		const { ports, offers } = harness({ finished: [FIRST_CHILD], withdrawn: [FIRST_CHILD] })
		const result = await backlog_drive.run_pass(state([FIRST_CHILD]), false, ports)

		expect(offers[0]?.exclude).toStrictEqual([FIRST_CHILD])
		expect(result.state.exclude).toStrictEqual([FIRST_CHILD])
	})
})

// joshuafolkken/kit#4926: a child that gave its lane back stays in the run — its retained plan, not the
// exclusion, holds it back until the holder ends.
describe('backlog_drive — a yielded child is not excluded', () => {
	it('leaves a child run:merge booked yielded out of the exclude list', async () => {
		const { ports, offers } = harness({ finished: [FIRST_CHILD], yielded: [FIRST_CHILD] })
		const result = await backlog_drive.run_pass(state([FIRST_CHILD]), false, ports)

		expect(offers[0]?.exclude).toStrictEqual([])
		expect(result.state.exclude).toStrictEqual([])
	})
})
