import { describe, expect, it } from 'vitest'
import { release_step_time, type StepClock } from './release-step-time'

const STARTED_MS = 1000
const ELAPSED_MS = 12_345
const STEP = 'push'
const FAILURE = 'pre-push hook failed'

function stepping_clock(): StepClock & { lines: Array<string> } {
	const readings = [STARTED_MS, STARTED_MS + ELAPSED_MS]
	const lines: Array<string> = []

	return {
		lines,
		now: (): number => readings.shift() ?? 0,
		print: (line: string): void => {
			lines.push(line)
		},
	}
}

describe('release_step_time.timed', () => {
	it('prints the step with its elapsed seconds and returns the step result', async () => {
		const clock = stepping_clock()

		const result = await release_step_time.timed(STEP, async () => 'ok', clock)

		expect(result).toBe('ok')
		expect(clock.lines).toEqual(['⏱️ Release push: 12.3 s'])
	})

	it('prints the time until a failed step failed, then passes its error on', async () => {
		const clock = stepping_clock()

		await expect(
			release_step_time.timed(
				STEP,
				async () => {
					throw new Error(FAILURE)
				},
				clock,
			),
		).rejects.toThrow(FAILURE)
		expect(clock.lines).toEqual(['⏱️ Release push: 12.3 s (failed)'])
	})
})
