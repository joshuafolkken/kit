import { describe, expect, it } from 'vitest'
import { backlog_drive, type DriveState, type LoopPorts, type OfferRead } from './backlog-drive'

const ACTIVE = '2026-09-24T00:00:00.000Z'
const START_MS = Date.parse(ACTIVE)
const POLL_MS = 5000
const OFFER_MS = 60_000
const CONFIG = { poll_ms: POLL_MS, offer_ms: OFFER_MS, window_ms: undefined }
const FIRST_CHILD = '2400'
const SECOND_CHILD = '2401'
const OFFERED = '2500'
const OFFERED_TOO = '2501'
// The next-issue token `run:merge` prints after an ordinary merge.
const NEXT_TOKEN = '2600'

interface Harness {
	ports: LoopPorts
	calls: Array<string>
	offers: Array<DriveState>
	states: Array<DriveState>
}

interface Script {
	finished?: ReadonlyArray<string>
	merges?: ReadonlyMap<string, string>
	offers?: ReadonlyArray<OfferRead | undefined>
	failed_launches?: ReadonlyArray<string>
}

function offer(verdict: string, issues: ReadonlyArray<string> = []): OfferRead {
	return { verdict, issues, retries: 0 }
}

// The child-facing ports: a finished child is merged once and then reads as gone.
function child_ports(
	script: Script,
	calls: Array<string>,
): Pick<LoopPorts, 'is_finished' | 'merge'> {
	const finished = new Set(script.finished)

	return {
		is_finished: (issue) => finished.has(issue),
		merge: async (issue) => {
			calls.push(`merge ${issue}`)
			finished.delete(issue)

			return script.merges?.get(issue) ?? NEXT_TOKEN
		},
	}
}

function harness(script: Script): Harness {
	const calls: Array<string> = []
	const offers: Array<DriveState> = []
	const states: Array<DriveState> = []
	const queue = [...(script.offers ?? [])]
	let now_ms = START_MS

	return {
		calls,
		offers,
		states,
		ports: {
			...child_ports(script, calls),
			offer: async (asked) => {
				calls.push('offer')
				offers.push(asked)

				return queue.length === 0 ? offer('wait') : queue.shift()
			},
			launch: async (issue) => {
				calls.push(`launch ${issue}`)

				return !(script.failed_launches ?? []).includes(issue)
			},
			now: () => new Date(now_ms),
			sleep: async (milliseconds) => {
				now_ms += milliseconds
			},
			on_state: (next) => {
				states.push(next)
			},
		},
	}
}

function state(in_flight: ReadonlyArray<string> = []): DriveState {
	return backlog_drive.initial_state(in_flight, ACTIVE)
}

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

	it.each(['over', 'human-review', 'stop', 'environment', 'busy', 'retry'])(
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
			harness({ offers: [offer('watch')] }).ports,
		)
		const waiting = await backlog_drive.run_pass(
			state([FIRST_CHILD]),
			true,
			harness({ offers: [offer('watch')] }).ports,
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

describe('backlog_drive.run_loop', () => {
	it('dispatches, collects and ends without the parent until the run stops', async () => {
		const { ports, calls, states } = harness({
			offers: [offer('run', [OFFERED]), offer('stop')],
			finished: [OFFERED],
		})
		const end = await backlog_drive.run_loop(state(), CONFIG, ports)

		expect(calls).toStrictEqual(['offer', `launch ${OFFERED}`, `merge ${OFFERED}`, 'offer'])
		expect(states[0]?.in_flight).toStrictEqual([OFFERED])
		expect(end.reason).toBe('stop')
	})

	it('resumes the lanes a restarted loop was seeded with', async () => {
		const { ports, calls } = harness({
			finished: [FIRST_CHILD],
			offers: [offer('wait'), offer('stop')],
		})
		const end = await backlog_drive.run_loop(state([FIRST_CHILD]), CONFIG, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, 'offer', 'offer'])
		expect(end.reason).toBe('stop')
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
