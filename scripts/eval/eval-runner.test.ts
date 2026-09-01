import { describe, expect, it } from 'vitest'
import type { Verdict } from './eval-judge'
import { eval_runner, type RunnerDependencies } from './eval-runner'
import type { Scenario } from './eval-scenario'
import { scenario_with } from './eval-scenario-fixture'

function verdict(name: string, is_pass: boolean, is_inconclusive: boolean): Verdict {
	return {
		name,
		rule: 'a rule',
		is_pass,
		is_inconclusive,
		note: undefined,
		failures: [],
		calls: [],
	}
}

function scenarios(count: number): Array<Scenario> {
	return Array.from({ length: count }, (_, index) =>
		scenario_with({ name: `probe-${String(index)}` }),
	)
}

interface Harness {
	deps: RunnerDependencies
	reported: Array<string>
	logged: Array<string>
	waits: Array<number>
	attempts: Array<string>
}

// `run_once` is handed in, so the loop under test spawns no Claude session and no pause is ever
// waited out — the suite it drives costs minutes per scenario, and its own tests must cost none.
function harness(
	answer: (scenario: Scenario, attempt: number) => Verdict,
	concurrency = 5,
): Harness {
	const reported: Array<string> = []
	const logged: Array<string> = []
	const waits: Array<number> = []
	const attempts: Array<string> = []

	return {
		attempts,
		deps: {
			concurrency,
			log: (message) => {
				logged.push(message)
			},
			pause: async (duration_ms) => {
				waits.push(duration_ms)
			},
			report: (result) => {
				reported.push(result.name)
			},
			run_once: async (scenario) => {
				const attempt = attempts.filter((name) => name === scenario.name).length

				attempts.push(scenario.name)

				return answer(scenario, attempt)
			},
		},
		logged,
		reported,
		waits,
	}
}

const WIDTH = 2

interface Flight {
	in_flight: number
	peak: number
}

// The pool's cap is what keeps a suite that grows from fanning out to as many real sessions as it
// happens to hold, so the width is asserted rather than assumed.
function counting(deps: RunnerDependencies, flight: Flight): RunnerDependencies {
	return {
		...deps,
		run_once: async (scenario) => {
			flight.in_flight += 1
			flight.peak = Math.max(flight.peak, flight.in_flight)
			await Promise.resolve()
			flight.in_flight -= 1

			return verdict(scenario.name, true, false)
		},
	}
}

describe('eval_runner.read_concurrency', () => {
	it('uses the default when the variable is unset', () => {
		expect(eval_runner.read_concurrency(undefined)).toStrictEqual({
			kind: 'limit',
			limit: eval_runner.DEFAULT_CONCURRENCY,
		})
	})

	it('uses the default when the variable is blank', () => {
		expect(eval_runner.read_concurrency('  ')).toStrictEqual({
			kind: 'limit',
			limit: eval_runner.DEFAULT_CONCURRENCY,
		})
	})

	it('reads a positive integer', () => {
		expect(eval_runner.read_concurrency('3')).toStrictEqual({ kind: 'limit', limit: 3 })
	})

	// A width the caller asked for and did not get would make the run a measurement of something
	// nobody requested — and the next act is to compare it against another run.
	it.each(['0', '-2', '2.5', 'many'])('refuses %s rather than falling back', (raw) => {
		const choice = eval_runner.read_concurrency(raw)

		expect(choice.kind).toBe('problem')
		expect(choice).toHaveProperty(
			'problem',
			expect.stringContaining(eval_runner.CONCURRENCY_ENV_KEY),
		)
	})
})

describe('eval_runner.run_scenario', () => {
	it('does not retry a scenario that measured a failure', async () => {
		const test = harness(() => verdict('probe', false, false))

		await eval_runner.run_scenario(scenario_with(), test.deps)

		expect(test.attempts).toHaveLength(1)
		expect(test.waits).toStrictEqual([])
	})

	it('does not retry a scenario that held', async () => {
		const test = harness(() => verdict('probe', true, false))

		await eval_runner.run_scenario(scenario_with(), test.deps)

		expect(test.attempts).toHaveLength(1)
	})

	it('retries an inconclusive scenario once, after waiting', async () => {
		const test = harness((scenario, attempt) => verdict(scenario.name, attempt > 0, attempt === 0))
		const result = await eval_runner.run_scenario(scenario_with(), test.deps)

		expect(test.attempts).toHaveLength(2)
		expect(test.waits).toStrictEqual([eval_runner.RETRY_PAUSE_MS])
		expect(result.is_pass).toBe(true)
	})

	// Retrying until it passes would turn the suite into a slot machine, so the cap holds even when
	// every attempt measures nothing.
	it('stops at the retry cap when every attempt is inconclusive', async () => {
		const test = harness((scenario) => verdict(scenario.name, false, true))
		const result = await eval_runner.run_scenario(scenario_with(), test.deps)

		expect(test.attempts).toHaveLength(eval_runner.INCONCLUSIVE_RETRIES + 1)
		expect(result.is_inconclusive).toBe(true)
	})
})

describe('eval_runner.run_all', () => {
	it('aggregates every scenario in the order they were selected', async () => {
		const test = harness((scenario) => verdict(scenario.name, true, false))
		const verdicts = await eval_runner.run_all(scenarios(4), test.deps)

		expect(verdicts.map((result) => result.name)).toStrictEqual([
			'probe-0',
			'probe-1',
			'probe-2',
			'probe-3',
		])
	})

	it('reports every verdict exactly once', async () => {
		const test = harness((scenario) => verdict(scenario.name, true, false))

		await eval_runner.run_all(scenarios(3), test.deps)

		expect(test.reported.toSorted((left, right) => left.localeCompare(right))).toStrictEqual([
			'probe-0',
			'probe-1',
			'probe-2',
		])
	})

	it('never runs more scenarios at once than the configured width', async () => {
		const flight = { in_flight: 0, peak: 0 }
		const test = harness((scenario) => verdict(scenario.name, true, false), WIDTH)

		await eval_runner.run_all(scenarios(6), counting(test.deps, flight))

		expect(flight.peak).toBe(WIDTH)
	})
})

describe('eval_runner.run_all aggregation', () => {
	// A failing scenario must not take its neighbors' verdicts with it: the summary is a count out of
	// the whole selection, and a partial one would read as a smaller suite rather than as a failure.
	it('keeps a failed scenario beside the ones that held', async () => {
		const test = harness((scenario) => verdict(scenario.name, scenario.name !== 'probe-1', false))
		const verdicts = await eval_runner.run_all(scenarios(3), test.deps)

		expect(verdicts.map((result) => result.is_pass)).toStrictEqual([true, false, true])
	})

	it('announces each scenario before it runs', async () => {
		const test = harness((scenario) => verdict(scenario.name, true, false))

		await eval_runner.run_all(scenarios(2), test.deps)

		expect(test.logged).toContain('  ▸ probe-0 (1/2)')
		expect(test.logged).toContain('  ▸ probe-1 (2/2)')
	})
})
