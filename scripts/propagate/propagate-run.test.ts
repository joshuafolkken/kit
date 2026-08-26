import { describe, expect, it } from 'vitest'
import { propagate_run, type StepResult } from './propagate-run'
import type { PropagateTarget } from './propagate-targets'

const APP_KIT = 'joshuafolkken/app-kit'
const GAME_KIT = 'joshuafolkken/game-kit'
const SITE = 'joshuafolkken/joshuafolkken-com'
const LEFTOVER = 'left uncommitted'

function ready(repo: string): PropagateTarget {
	return { repo, path: `/Users/example/Development/${repo}`, state: 'ready' }
}

function all_pass(_target: PropagateTarget, step: string): StepResult {
	return { step, is_ok: true }
}

// Fails the named step for the named repository only, so a test can assert the blast radius of one
// consumer's failure.
function fail_step(failing_repo: string, failing_step: string) {
	return (target: PropagateTarget, step: string): StepResult =>
		step === failing_step && target.repo === failing_repo
			? { step, is_ok: false, detail: 'exit 1' }
			: { step, is_ok: true }
}

describe('propagate_run.run_target', () => {
	it('runs the four steps in order when everything passes', () => {
		const result = propagate_run.run_target(ready(APP_KIT), all_pass)

		expect(result.outcome).toBe('propagated')
		expect(result.steps.map((step) => step.step)).toEqual([...propagate_run.STEP_ORDER])
	})

	it('does not open a pull request when the verification gate fails', () => {
		const result = propagate_run.run_target(
			ready(APP_KIT),
			fail_step(APP_KIT, propagate_run.STEP_VERIFY),
		)

		expect(result.outcome).toBe('failed')
		expect(result.steps.map((step) => step.step)).not.toContain(propagate_run.STEP_PR)
	})

	// A consumer left with uncommitted upgrade and sync changes is one the *next* run's pre-check
	// will refuse. Not saying so is how a consumer silently stops receiving releases.
	it('warns that changes were left behind when the failure came after a write', () => {
		const result = propagate_run.run_target(
			ready(APP_KIT),
			fail_step(APP_KIT, propagate_run.STEP_VERIFY),
		)

		expect(result.reason).toContain(LEFTOVER)
	})

	it('does not warn about leftovers when the working tree check refused the consumer', () => {
		const result = propagate_run.run_target(
			ready(APP_KIT),
			fail_step(APP_KIT, propagate_run.STEP_PRECHECK),
		)

		expect(result.reason).not.toContain(LEFTOVER)
	})
})

describe('propagate_run.run_target — how a failure is reported', () => {
	it('names the failing step and its detail in the reason', () => {
		const result = propagate_run.run_target(
			ready(APP_KIT),
			fail_step(APP_KIT, propagate_run.STEP_SYNC),
		)

		expect(result.reason).toContain(propagate_run.STEP_SYNC)
		expect(result.reason).toContain('exit 1')
	})
})

describe('propagate_run.run_target — where a failure stops', () => {
	it('stops at the failing step rather than running the rest', () => {
		const result = propagate_run.run_target(
			ready(APP_KIT),
			fail_step(APP_KIT, propagate_run.STEP_UPGRADE),
		)
		const last = result.steps.at(-1)

		expect(last?.step).toBe(propagate_run.STEP_UPGRADE)
		expect(result.steps).toHaveLength(2)
	})

	// Everything after the pre-check writes into the consumer, so a refused tree must cost nothing.
	it('runs nothing at all when the working tree check refuses the consumer', () => {
		const result = propagate_run.run_target(
			ready(APP_KIT),
			fail_step(APP_KIT, propagate_run.STEP_PRECHECK),
		)

		expect(result.steps).toHaveLength(1)
		expect(result.outcome).toBe('failed')
	})
})

describe('propagate_run.run_targets — one failure does not stop the rest', () => {
	const targets = [ready(APP_KIT), ready(GAME_KIT), ready(SITE)]

	it('keeps processing the consumers after a failing one', () => {
		const results = propagate_run.run_targets(
			targets,
			fail_step(GAME_KIT, propagate_run.STEP_VERIFY),
		)

		expect(results.map((result) => result.outcome)).toEqual(['propagated', 'failed', 'propagated'])
	})

	it('reports the run as failed when any consumer failed', () => {
		const results = propagate_run.run_targets(
			targets,
			fail_step(GAME_KIT, propagate_run.STEP_VERIFY),
		)

		expect(propagate_run.has_failure(results)).toBe(true)
	})

	it('reports the run as successful when every consumer passed', () => {
		expect(propagate_run.has_failure(propagate_run.run_targets(targets, all_pass))).toBe(false)
	})
})

describe('propagate_run.run_targets — candidates that are not processed', () => {
	it('skips a consumer that already carries the release, and says so', () => {
		const target: PropagateTarget = { repo: APP_KIT, path: '/x', state: 'up_to_date' }
		const [result] = propagate_run.run_targets([target], all_pass)

		expect(result?.outcome).toBe('skipped')
		expect(result?.reason).toContain('already carries')
	})

	it('reports a missing checkout as a skip rather than cloning it', () => {
		const target: PropagateTarget = { repo: APP_KIT, path: '/x', state: 'missing_checkout' }
		const [result] = propagate_run.run_targets([target], all_pass)

		expect(result?.outcome).toBe('skipped')
		expect(result?.reason).toContain('not cloned')
	})

	it('does not describe a repository that is not a Node project as damaged', () => {
		const target: PropagateTarget = { repo: APP_KIT, path: '/x', state: 'not_downstream' }
		const [result] = propagate_run.run_targets([target], all_pass)

		expect(result?.reason).toBe('does not depend on this package')
	})

	it('runs no step at all for a candidate that is not downstream', () => {
		const target: PropagateTarget = { repo: APP_KIT, path: '/x', state: 'not_downstream' }
		const [result] = propagate_run.run_targets([target], all_pass)

		expect(result?.steps).toEqual([])
	})

	it('does not count a skip as a failure', () => {
		const target: PropagateTarget = { repo: APP_KIT, path: '/x', state: 'up_to_date' }

		expect(propagate_run.has_failure(propagate_run.run_targets([target], all_pass))).toBe(false)
	})
})

describe('propagate_run.format_report', () => {
	it('accounts for every consumer in one block', () => {
		const results = propagate_run.run_targets(
			[ready(APP_KIT), { repo: GAME_KIT, path: '/x', state: 'up_to_date' }],
			all_pass,
		)
		const report = propagate_run.format_report(results)

		expect(report).toContain(APP_KIT)
		expect(report).toContain(GAME_KIT)
	})

	it('says so rather than printing nothing when no repository was considered', () => {
		expect(propagate_run.format_report([])).toContain('No repositories')
	})
})
