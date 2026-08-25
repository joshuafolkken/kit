import path from 'node:path'
import { PACKAGE_DIR } from '#scripts/init/init-paths'
import { describe, expect, it } from 'vitest'
import { eval_scenario } from './eval-scenario'
import { FIXTURE_FILE_NAME, MINIMAL_SCENARIO } from './eval-scenario-fixture'

const SCENARIO_DIRECTORY = path.join(PACKAGE_DIR, 'evals/scenarios')

// kit#855's acceptance bar: at least four scenarios, each judged on observable behavior rather than
// on wording. Both halves are asserted against the shipped suite, because a scenario file that
// declares no expectation passes every run and reads as coverage.
const MINIMUM_SCENARIOS = 4

function parse(body: Record<string, unknown>): ReturnType<typeof eval_scenario.parse_scenario> {
	return eval_scenario.parse_scenario(FIXTURE_FILE_NAME, JSON.stringify(body))
}

const VALID = MINIMAL_SCENARIO

describe('eval_scenario.parse_scenario', () => {
	it('fills the optional halves so a minimal scenario is still complete', () => {
		const scenario = parse(VALID)

		expect(scenario.should_call).toStrictEqual([])
		expect(scenario.max_turns).toBeGreaterThan(0)
	})

	it.each([
		['a missing name', { rule: 'r', prompt: 'p' }],
		['a missing rule', { name: 'n', prompt: 'p' }],
		['a missing prompt', { name: 'n', rule: 'r' }],
		['an empty prompt', { ...VALID, prompt: '' }],
		['a zero turn limit', { ...VALID, max_turns: 0 }],
		['an expectation with no tool', { ...VALID, should_call: [{ because: 'b' }] }],
		// Without it a red run says "Edit was called" and nothing about which rule that broke, which
		// is the whole difference between a suite you can act on and a number.
		['an expectation with no reason', { ...VALID, should_call: [{ tool: 'Edit' }] }],
	])('rejects %s', (_label, body) => {
		expect(() => parse(body)).toThrow()
	})

	it('names the file in the error, since scenarios are read as a batch', () => {
		expect(() => parse({ rule: 'r', prompt: 'p' })).toThrow(new RegExp(FIXTURE_FILE_NAME, 'u'))
	})
})

describe('the shipped scenario suite', () => {
	const scenarios = eval_scenario.load_scenarios(SCENARIO_DIRECTORY)

	it('carries at least the four the issue asks for', () => {
		expect(scenarios.length).toBeGreaterThanOrEqual(MINIMUM_SCENARIOS)
	})

	it('gives every scenario a distinct name, since a name selects one to run', () => {
		expect(new Set(scenarios.map((scenario) => scenario.name)).size).toBe(scenarios.length)
	})

	it.each(scenarios.map((scenario) => [scenario.name, scenario]))(
		'%s judges on observable behavior',
		(_name, scenario) => {
			const expectations =
				scenario.should_call.length +
				scenario.should_not_call.length +
				scenario.should_call_in_order.length

			expect(expectations).toBeGreaterThan(0)
		},
	)

	it.each(scenarios.map((scenario) => [scenario.name, scenario]))(
		'%s names the rule it measures',
		(_name, scenario) => {
			expect(scenario.rule.length).toBeGreaterThan(0)
		},
	)
})
