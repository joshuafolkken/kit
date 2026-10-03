import { describe, expect, it } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'

const { CONFIG, FIRST_CHILD, OFFERED, OFFERED_TOO, POLL_MS, SECOND_CHILD } = backlog_drive_fixture
const { harness, offer, state } = backlog_drive_fixture
const ONE_FREE_LANE = 1
const NO_FREE_LANES = 0

describe('backlog_drive.run_pass — dispatch', () => {
	it('launches every issue a run verdict offers and counts them in flight', async () => {
		const { ports, calls } = harness({ offers: [offer('run', [OFFERED, OFFERED_TOO])] })
		const result = await backlog_drive.run_pass(state(), true, ports)

		expect(calls).toStrictEqual(['offer', `launch ${OFFERED}`, `launch ${OFFERED_TOO}`])
		expect(result.kind === 'continue' && result.state.in_flight).toStrictEqual([
			OFFERED,
			OFFERED_TOO,
		])
	})

	it('hands the running count to the offer so the lane limit stays the offer’s', async () => {
		const { ports, offers } = harness({})

		await backlog_drive.run_pass(state([FIRST_CHILD, SECOND_CHILD]), true, ports)

		expect(offers[0]?.in_flight).toStrictEqual([FIRST_CHILD, SECOND_CHILD])
	})

	it('hands a refused launch back to the parent', async () => {
		const { ports } = harness({ offers: [offer('run', [OFFERED])], failed_launches: [OFFERED] })
		const result = await backlog_drive.run_pass(state(), true, ports)

		expect(result.kind === 'end' && result.end).toStrictEqual({
			reason: 'launch',
			token: undefined,
			issue: OFFERED,
		})
	})
})

// joshuafolkken/kit#3027: the offer lists every ready issue, so the drive caps the launches itself.
describe('backlog_drive.run_pass — the lane limit', () => {
	it('launches no more issues than there are free lanes', async () => {
		const offered = offer('run', [OFFERED, OFFERED_TOO])
		const { ports, calls } = harness({ offers: [offered], free_lanes: [ONE_FREE_LANE] })
		const result = await backlog_drive.run_pass(state(), true, ports)

		expect(calls).toStrictEqual(['offer', `launch ${OFFERED}`])
		expect(result.kind === 'continue' && result.state.in_flight).toStrictEqual([OFFERED])
	})

	it('launches nothing when no lane is free', async () => {
		const offered = offer('run', [OFFERED])
		const { ports, calls } = harness({ offers: [offered], free_lanes: [NO_FREE_LANES] })
		const result = await backlog_drive.run_pass(state(), true, ports)

		expect(calls).toStrictEqual(['offer'])
		expect(result.kind).toBe('continue')
	})

	it('keeps the active stamp when no lane is free, so the idle budget still runs out', async () => {
		const offered = offer('run', [OFFERED])
		const { ports } = harness({ offers: [offered], free_lanes: [NO_FREE_LANES] })
		const before = state()
		const result = await backlog_drive.run_pass(before, true, ports)

		expect(result.kind === 'continue' && result.state.active).toBe(before.active)
	})

	it('waits rather than handing back a launch refused because every lane is taken', async () => {
		const offered = offer('run', [OFFERED])
		const script = { offers: [offered], failed_launches: [OFFERED], free_lanes: [1, 0] }
		const { ports } = harness(script)
		const result = await backlog_drive.run_pass(state(), true, ports)

		expect(result.kind === 'continue' && result.state.in_flight).toStrictEqual([])
	})
})

describe('backlog_drive.run_pass — dispatch throttle', () => {
	it('does not ask the offer when throttled and nothing was collected', async () => {
		const { ports, calls } = harness({})

		await backlog_drive.run_pass(state([FIRST_CHILD]), false, ports)

		expect(calls).toStrictEqual([])
	})

	it('hands back an offer that could not be read', async () => {
		const { ports } = harness({ offers: [undefined] })
		const result = await backlog_drive.run_pass(state(), true, ports)

		expect(result.kind === 'end' && result.end.reason).toBe('offer')
	})
})

describe('backlog_drive.run_pass — collection', () => {
	it('collects a finished child, excludes it and asks the offer for the freed lane', async () => {
		const { ports, calls, offers } = harness({ finished: [FIRST_CHILD] })
		const result = await backlog_drive.run_pass(state([FIRST_CHILD, SECOND_CHILD]), false, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, 'offer'])
		expect(offers[0]?.exclude).toStrictEqual([FIRST_CHILD])
		expect(result.kind === 'continue' && result.state.in_flight).toStrictEqual([SECOND_CHILD])
	})

	it.each(['over', 'human-review', 'environment', 'busy', 'retry'])(
		'hands the merge token %s back without offering',
		async (token) => {
			const { ports, calls } = harness({
				finished: [FIRST_CHILD],
				merges: new Map([[FIRST_CHILD, token]]),
			})
			const result = await backlog_drive.run_pass(state([FIRST_CHILD]), true, ports)

			expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`])
			expect(result.kind === 'end' && result.end).toStrictEqual({
				reason: 'merge',
				token,
				issue: FIRST_CHILD,
			})
		},
	)
})

describe('backlog_drive.run_pass — hand-back state', () => {
	it('hands back a merge that printed no token instead of reading it as collected', async () => {
		const { ports } = harness({ finished: [FIRST_CHILD], merges: new Map([[FIRST_CHILD, '']]) })
		const result = await backlog_drive.run_pass(state([FIRST_CHILD]), true, ports)

		expect(result.kind === 'end' && result.end.reason).toBe('merge')
		expect(result.state.in_flight).toStrictEqual([FIRST_CHILD])
	})

	it('keeps a child collected earlier in the pass when a later one hands back', async () => {
		const { ports } = harness({
			finished: [FIRST_CHILD, SECOND_CHILD],
			merges: new Map([[SECOND_CHILD, 'over']]),
		})
		const result = await backlog_drive.run_pass(state([FIRST_CHILD, SECOND_CHILD]), true, ports)

		expect(result.kind).toBe('end')
		expect(result.state.exclude).toStrictEqual([FIRST_CHILD])
		expect(result.state.in_flight).toStrictEqual([SECOND_CHILD])
	})

	it('keeps a resumed child in flight', async () => {
		const { ports } = harness({
			finished: [FIRST_CHILD],
			merges: new Map([[FIRST_CHILD, 'resumed']]),
		})
		const result = await backlog_drive.run_pass(state([FIRST_CHILD]), false, ports)

		expect(result.kind === 'continue' && result.state.in_flight).toStrictEqual([FIRST_CHILD])
	})
})

describe('backlog_drive.run_pass — verdicts', () => {
	it('stops launching on stop and ends once nothing is in flight', async () => {
		const { ports } = harness({ offers: [offer('stop')] })
		const first = await backlog_drive.run_pass(state([FIRST_CHILD]), true, ports)

		expect(first.kind === 'continue' && first.state.is_stopping).toBe(true)

		const { ports: after, calls } = harness({ finished: [FIRST_CHILD] })
		const stopping = first.kind === 'continue' ? first.state : state()
		const second = await backlog_drive.run_pass(stopping, true, after)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`])
		expect(second.kind === 'end' && second.end.reason).toBe('stop')
	})

	it('hands a drained watch back but waits out a watch with children in flight', async () => {
		const drained = await backlog_drive.run_pass(
			state(),
			true,
			harness({ offers: [{ ...offer('watch'), is_retrospective_owed: true }] }).ports,
		)
		const waiting = await backlog_drive.run_pass(
			state([FIRST_CHILD]),
			true,
			harness({ offers: [{ ...offer('watch'), is_retrospective_owed: true }] }).ports,
		)

		expect(drained.kind === 'end' && drained.end.reason).toBe('watch')
		expect(waiting.kind).toBe('continue')
	})

	it('hands an unknown verdict back as printed', async () => {
		const result = await backlog_drive.run_pass(
			state(),
			true,
			harness({ offers: [offer('odd')] }).ports,
		)

		expect(result.kind === 'end' && result.end.token).toBe('odd')
	})
})

// joshuafolkken/kit#2779: an untriaged candidate is the parent's to judge.
describe('backlog_drive.run_pass — triage', () => {
	it('hands triage back without launching, leaving running children in flight', async () => {
		const { ports, calls } = harness({ offers: [offer('triage')] })
		const result = await backlog_drive.run_pass(state([FIRST_CHILD]), true, ports)

		expect(calls).toStrictEqual(['offer'])
		expect(result.kind === 'end' && result.end).toStrictEqual({
			reason: 'triage',
			token: 'triage',
			issue: undefined,
		})
		expect(result.state.in_flight).toStrictEqual([FIRST_CHILD])
	})
})

describe('backlog_drive.run_loop', () => {
	it('dispatches, collects and ends without the parent until the run stops', async () => {
		const { ports, calls, states } = harness({
			offers: [offer('run', [OFFERED]), offer('stop')],
			finished: [OFFERED],
		})
		const end = await backlog_drive.run_loop(state(), CONFIG, ports)

		expect(calls).toStrictEqual([
			'offer',
			`launch ${OFFERED}`,
			`merge ${OFFERED}`,
			'offer',
			'finish',
		])
		expect(states[0]?.in_flight).toStrictEqual([OFFERED])
		expect(end.reason).toBe('stop')
	})

	it('resumes the lanes a restarted loop was seeded with', async () => {
		const { ports, calls } = harness({
			finished: [FIRST_CHILD],
			offers: [offer('wait'), offer('stop')],
		})
		const end = await backlog_drive.run_loop(state([FIRST_CHILD]), CONFIG, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, 'offer', 'offer', 'finish'])
		expect(end.reason).toBe('stop')
	})
})

it('returns window once the bounded wait is spent', async () => {
	const { ports } = harness({})
	const end = await backlog_drive.run_loop(
		state([FIRST_CHILD]),
		{ ...CONFIG, window_ms: POLL_MS * 2 },
		ports,
	)

	expect(end.reason).toBe('window')
})

// Not owed covers both a retrospective already run and the opt-in switch left off (joshuafolkken/kit#2750).
it('continues the idle watch on a drain that owes no retrospective', async () => {
	const { ports } = harness({ offers: [offer('watch')] })
	const end = await backlog_drive.run_loop(state(), { ...CONFIG, window_ms: POLL_MS }, ports)

	expect(end.reason).toBe('window')
})

it('keeps the budget reason on the first stop verdict', async () => {
	const reason = 'maximum reached'
	const { ports } = harness({ offers: [{ ...offer('stop'), reason }] })
	const end = await backlog_drive.run_loop(state(), CONFIG, ports)

	expect(end.detail).toBe(reason)
})

it('returns the drained stop for a retrospective before ending the carry', async () => {
	const { ports, calls } = harness({
		offers: [{ ...offer('stop'), answer: 'exhausted', is_retrospective_owed: true }],
	})
	const end = await backlog_drive.run_loop(state(), CONFIG, ports)

	expect(end.reason).toBe('retrospective')
	expect(calls).not.toContain('finish')
})

it('ends a drained stop that owes no retrospective without handing it back', async () => {
	const { ports, calls } = harness({ offers: [{ ...offer('stop'), answer: 'exhausted' }] })
	const end = await backlog_drive.run_loop(state(), CONFIG, ports)

	expect(end.reason).toBe('stop')
	expect(calls).toContain('finish')
})

describe('backlog_drive.run_loop — hand-back state', () => {
	it('reports the state an ending pass reached so the resume line keeps it', async () => {
		const { ports, states } = harness({
			finished: [FIRST_CHILD, SECOND_CHILD],
			merges: new Map([[SECOND_CHILD, 'over']]),
		})
		const end = await backlog_drive.run_loop(state([FIRST_CHILD, SECOND_CHILD]), CONFIG, ports)

		expect(end.reason).toBe('merge')
		expect(states.at(-1)?.exclude).toStrictEqual([FIRST_CHILD])
	})
})
