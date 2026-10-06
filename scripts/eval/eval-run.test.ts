import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eval_report } from './eval-report'
import { eval_run } from './eval-run'
import { eval_runner } from './eval-runner'
import { scenario_with } from './eval-scenario-fixture'

// joshuafolkken/kit#3253: the command around the eval run had no test, because importing it started
// a real suite. The selection and the startup refusals are what decide which Claude sessions a run
// pays for, so they are pinned here without spawning one.

const ALPHA = scenario_with({ name: 'alpha' })
const BETA = scenario_with({ name: 'beta' })
const SCENARIOS = [ALPHA, BETA]
const UNKNOWN_NAME = 'no-such-scenario'

describe('eval_run.selected — which scenarios a run takes', () => {
	it('takes every scenario when no name is given', () => {
		expect(eval_run.selected(SCENARIOS, [])).toEqual(SCENARIOS)
	})

	it('takes only the named scenarios', () => {
		expect(eval_run.selected(SCENARIOS, ['beta'])).toEqual([BETA])
	})
})

describe('eval_run.unknown_scenarios — a typo answered with the names to pick from', () => {
	it('answers nothing when every name is known', () => {
		expect(eval_run.unknown_scenarios(['alpha'], SCENARIOS)).toBeUndefined()
	})

	it('names the unknown scenario and lists the known ones', () => {
		expect(eval_run.unknown_scenarios(['alpha', UNKNOWN_NAME], SCENARIOS)).toBe(
			`unknown scenario(s): ${UNKNOWN_NAME}\nknown: alpha, beta`,
		)
	})
})

describe('eval_run.main — an unknown name stops the run before any session', () => {
	const original_argv = process.argv

	beforeEach(() => {
		process.argv = ['node', 'scripts/eval/eval-run.ts', UNKNOWN_NAME]
		vi.stubEnv(eval_runner.CONCURRENCY_ENV_KEY, '')
		vi.spyOn(console, 'error').mockImplementation(() => undefined)
	})

	afterEach(() => {
		process.argv = original_argv
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it('reports the run as not run and starts no scenario', async () => {
		const report_not_run = vi.spyOn(eval_report, 'report_not_run')
		const run_all = vi.spyOn(eval_runner, 'run_all')

		expect(await eval_run.main()).toBe(false)
		expect(report_not_run).toHaveBeenCalledOnce()
		expect(run_all).not.toHaveBeenCalled()
	})
})
