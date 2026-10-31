import { describe, expect, it, vi } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'

// joshuafolkken/kit#4621: an offered issue its measurement declaration closed takes no lane — it is not
// in flight, it is excluded from the run's later offers, and the next offered issue still launches.
const { ACTIVE, OFFERED, OFFERED_TOO, harness, offer, state } = backlog_drive_fixture
const EARLIER = '2026-09-23T00:00:00.000Z'
const LAUNCH_THREW = 'the launch threw'

describe('backlog_drive.run_pass — a measured close', () => {
	it('keeps the measured issue out of flight and out of later offers', async () => {
		const { ports, calls } = harness({
			offers: [offer('run', [OFFERED, OFFERED_TOO])],
			measured_launches: [OFFERED],
		})
		const result = await backlog_drive.run_pass(state(), true, ports)

		expect(calls).toContain(`launch ${OFFERED}`)
		expect(result.state.in_flight).toStrictEqual([OFFERED_TOO])
		expect(result.state.exclude).toStrictEqual([OFFERED])
	})

	it('counts a measured close alone as activity', async () => {
		const { ports } = harness({
			offers: [offer('run', [OFFERED])],
			measured_launches: [OFFERED],
		})
		const result = await backlog_drive.run_pass(
			backlog_drive.initial_state([], EARLIER),
			true,
			ports,
		)

		expect(result.kind).toBe('continue')
		expect(result.state.in_flight).toStrictEqual([])
		expect(result.state.active).toBe(ACTIVE)
	})
})

// A launch that ends only once every launch of the pass has started — never, launched one by one.
function gated_launch(count: number): (issue: string) => Promise<'launched'> {
	const started: Array<string> = []
	const gate = { open: (): void => undefined }
	const all_started = new Promise<void>((resolve) => {
		gate.open = resolve
	})

	return async (issue) => {
		started.push(issue)
		if (started.length === count) gate.open()
		await all_started

		return 'launched'
	}
}

// joshuafolkken/kit#5519: four lanes launched one after another took 49 s.
describe('backlog_drive.run_pass — launches side by side', () => {
	it('starts every launch of the pass before any of them ends', async () => {
		const offered = [OFFERED, OFFERED_TOO]
		const { ports } = harness({ offers: [offer('run', offered)] })

		vi.spyOn(ports, 'launch').mockImplementation(gated_launch(offered.length))
		const result = await backlog_drive.run_pass(state(), true, ports)

		expect(result.state.in_flight).toStrictEqual(offered)
	})

	it('keeps a lane that launched in flight when another of the pass refused', async () => {
		const { ports } = harness({
			offers: [offer('run', [OFFERED, OFFERED_TOO])],
			failed_launches: [OFFERED],
		})
		const result = await backlog_drive.run_pass(state(), true, ports)

		expect(result.kind === 'end' && result.end.issue).toBe(OFFERED)
		expect(result.state.in_flight).toStrictEqual([OFFERED_TOO])
	})

	it('throws a failed launch only once every launch of the pass has ended', async () => {
		const ended: Array<string> = []
		const { ports } = harness({ offers: [offer('run', [OFFERED, OFFERED_TOO])] })

		vi.spyOn(ports, 'launch').mockImplementation(async (issue) => {
			if (issue === OFFERED) throw new Error(LAUNCH_THREW)
			await Promise.resolve()
			ended.push(issue)

			return 'launched'
		})

		await expect(backlog_drive.run_pass(state(), true, ports)).rejects.toThrow(LAUNCH_THREW)
		expect(ended).toStrictEqual([OFFERED_TOO])
	})
})
