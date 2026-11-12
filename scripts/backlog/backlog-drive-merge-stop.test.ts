import { describe, expect, it } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'

// A `stop` from `run:merge` is the offer's `stop` reached through a merge: the child is collected,
// nothing more starts, and the children still in flight are collected before the loop ends
// (joshuafolkken/kit#2881).

const { CONFIG, FIRST_CHILD, OFFERED, SECOND_CHILD } = backlog_drive_fixture
const { harness, offer, state } = backlog_drive_fixture
const STOP = 'stop'

describe('backlog_drive.run_pass — a merge that answers stop', () => {
	it('collects the child and keeps the run going for the one still in flight', async () => {
		const { ports, calls } = harness({
			finished: [FIRST_CHILD],
			merges: new Map([[FIRST_CHILD, STOP]]),
		})
		const result = await backlog_drive.run_pass(state([FIRST_CHILD, SECOND_CHILD]), true, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`])
		expect(result.kind).toBe('continue')
		expect(result.state.is_stopping).toBe(true)
		expect(result.state.in_flight).toStrictEqual([SECOND_CHILD])
		expect(result.state.exclude).toStrictEqual([FIRST_CHILD])
		expect(result.state.stopped_by).toBe(FIRST_CHILD)
	})

	it('starts nothing new after a hand-back resumes the stop it carried', async () => {
		const { ports, calls } = harness({ offers: [offer('run', [OFFERED])] })
		const resumed = backlog_drive.merge_stopped(FIRST_CHILD, state([SECOND_CHILD]))
		const result = await backlog_drive.run_pass(resumed, true, ports)

		expect(calls).toStrictEqual([])
		expect(result.state.is_stopping).toBe(true)
	})

	it('ends as stop at once when the stopping child was the last in flight', async () => {
		const { ports } = harness({ finished: [FIRST_CHILD], merges: new Map([[FIRST_CHILD, STOP]]) })
		const result = await backlog_drive.run_pass(state([FIRST_CHILD]), true, ports)

		expect(result.kind === 'end' && result.end.reason).toBe(STOP)
		expect(result.kind === 'end' && result.end.detail).toContain(`#${FIRST_CHILD}`)
	})

	it('keeps the reason of a stop an offer already gave', async () => {
		const { ports } = harness({ finished: [FIRST_CHILD], merges: new Map([[FIRST_CHILD, STOP]]) })
		const stopping = { ...state([FIRST_CHILD]), is_stopping: true, stop_reason: 'budget' }
		const result = await backlog_drive.run_pass(stopping, true, ports)

		expect(result.kind === 'end' && result.end.detail).toBe('budget')
	})
})

// A guard stop must release the hold even when no offer follows it (joshuafolkken/kit#4571).
describe('backlog_drive.run_pass — the hold a merge stop releases', () => {
	it('releases the hold once when the collection turns the run to stopping', async () => {
		const { ports, holds } = harness({
			finished: [FIRST_CHILD],
			merges: new Map([[FIRST_CHILD, STOP]]),
		})
		const stopping = await backlog_drive.run_pass(state([FIRST_CHILD, SECOND_CHILD]), true, ports)

		await backlog_drive.run_pass(stopping.state, true, ports)

		expect(holds).toStrictEqual([undefined])
	})

	it('releases nothing when the run was already stopping', async () => {
		const { ports, holds } = harness({
			finished: [FIRST_CHILD],
			merges: new Map([[FIRST_CHILD, STOP]]),
		})
		const stopping = { ...state([FIRST_CHILD, SECOND_CHILD]), is_stopping: true }

		await backlog_drive.run_pass(stopping, true, ports)

		expect(holds).toStrictEqual([])
	})
})

describe('backlog_drive.run_loop — a merge that answers stop', () => {
	it('waits for the child still in flight, starts nothing new, then finishes', async () => {
		const { ports, calls, states } = harness({
			finished: [FIRST_CHILD, SECOND_CHILD],
			merges: new Map([[FIRST_CHILD, STOP]]),
			offers: [offer('run', [OFFERED])],
		})
		const end = await backlog_drive.run_loop(state([FIRST_CHILD, SECOND_CHILD]), CONFIG, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, `merge ${SECOND_CHILD}`, 'finish'])
		expect(end.reason).toBe(STOP)
		expect(states.at(-1)?.exclude).toStrictEqual([FIRST_CHILD, SECOND_CHILD])
	})
})

// The offer `run:merge` passes through answers `stop` when only person-waiting issues are left. That is
// the idle watch's to decide through `backlog:offer`, never a stop of the merge (joshuafolkken/kit#3781).
const OFFERED_STOP = { merges: new Map([[FIRST_CHILD, STOP]]), offered: [FIRST_CHILD] }

describe('backlog_drive.run_pass — an offer stop passed through a merge', () => {
	it('asks backlog:offer instead of ending, and keeps the run on its watch', async () => {
		const { ports, calls } = harness({
			...OFFERED_STOP,
			finished: [FIRST_CHILD],
			offers: [offer('watch')],
		})
		const result = await backlog_drive.run_pass(state([FIRST_CHILD]), false, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, 'offer'])
		expect(result.kind).toBe('continue')
		expect(result.state.is_stopping).toBe(false)
		expect(result.state.stopped_by).toBeUndefined()
	})

	it('collects the child when the offer answers retry instead of handing the merge back', async () => {
		const { ports, calls } = harness({
			merges: new Map([[FIRST_CHILD, 'retry']]),
			offered: [FIRST_CHILD],
			finished: [FIRST_CHILD],
			offers: [offer('watch')],
		})
		const result = await backlog_drive.run_pass(state([FIRST_CHILD]), false, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, 'offer'])
		expect(result.kind).toBe('continue')
		expect(result.state.in_flight).toStrictEqual([])
	})
})

describe('backlog_drive — the watch an offer stop leaves to backlog:budget', () => {
	it('ends when backlog:budget answers stop — the watch off or the maximum reached', async () => {
		const budget_stop = { ...offer(STOP), reason: 'idle' }
		const { ports, calls } = harness({
			...OFFERED_STOP,
			finished: [FIRST_CHILD],
			offers: [budget_stop],
		})
		const end = await backlog_drive.run_loop(state([FIRST_CHILD]), CONFIG, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, 'offer', 'finish'])
		expect(end).toMatchObject({ reason: STOP, detail: 'idle' })
	})

	it('launches the issue a person released while the run was watching', async () => {
		const { ports, calls } = harness({
			...OFFERED_STOP,
			finished: [FIRST_CHILD],
			offers: [offer('watch'), offer('run', [OFFERED])],
		})
		const watching = await backlog_drive.run_pass(state([FIRST_CHILD]), false, ports)
		const released = await backlog_drive.run_pass(watching.state, true, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, 'offer', 'offer', `launch ${OFFERED}`])
		expect(released.state.in_flight).toStrictEqual([OFFERED])
	})
})

describe('backlog_drive.run_loop — the children a merge stop waits on', () => {
	it('collects a child that finishes on a later pass before finishing', async () => {
		const { ports, calls } = harness({
			finished: [FIRST_CHILD],
			merges: new Map([[FIRST_CHILD, STOP]]),
		})
		let passes = 0
		const { is_finished } = ports

		ports.is_finished = (issue: string): boolean => {
			if (issue === SECOND_CHILD) passes += 1

			return issue === SECOND_CHILD ? passes > 1 : is_finished(issue)
		}

		const end = await backlog_drive.run_loop(state([FIRST_CHILD, SECOND_CHILD]), CONFIG, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, `merge ${SECOND_CHILD}`, 'finish'])
		expect(end.reason).toBe(STOP)
	})

	it('still hands over back at once while a stop is collecting', async () => {
		const { ports, calls } = harness({
			finished: [FIRST_CHILD, SECOND_CHILD],
			merges: new Map([
				[FIRST_CHILD, STOP],
				[SECOND_CHILD, 'over'],
			]),
		})
		const end = await backlog_drive.run_loop(state([FIRST_CHILD, SECOND_CHILD]), CONFIG, ports)

		expect(calls).not.toContain('finish')
		expect(end).toStrictEqual({ reason: 'merge', token: 'over', issue: SECOND_CHILD })
	})
})
