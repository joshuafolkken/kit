import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_followup_cleanup, type CleanupStep } from './git-followup-cleanup'

const RUN_REPORT = 'The run report'
const HOLD_RELEASE = 'The working-tree hold release'
const RELEASE_COMMAND = 'pnpm josh run:release'

function warned_text(): string {
	return vi
		.mocked(console.warn)
		.mock.calls.map(([line]) => String(line))
		.join('\n')
}

function failing_step(label: string, recovery?: string): CleanupStep {
	return {
		label,
		recovery,
		run: async () => {
			await Promise.resolve()

			throw new Error(`${label} exploded`)
		},
	}
}

function passing_step(label: string): { step: CleanupStep; run: () => Promise<void> } {
	const run = vi.fn<() => Promise<void>>().mockResolvedValue()

	return { step: { label, recovery: undefined, run }, run }
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

// joshuafolkken/kit#1539. The steps of a run's tail are independent, and the merge they follow cannot
// be taken back — so one of them failing must not take the ones after it down with it.
describe('git_followup_cleanup.run_step — a step that completes', () => {
	it('runs the step and reports success', async () => {
		const { step, run } = passing_step(RUN_REPORT)

		await expect(git_followup_cleanup.run_step(step)).resolves.toBe(true)
		expect(run).toHaveBeenCalledOnce()
	})
})

describe('git_followup_cleanup.run_step — a step that throws', () => {
	it('answers false instead of throwing', async () => {
		await expect(git_followup_cleanup.run_step(failing_step(RUN_REPORT))).resolves.toBe(false)
	})

	it('names the step and the reason, so a failed cleanup is never silent', async () => {
		await git_followup_cleanup.run_step(failing_step(RUN_REPORT))

		expect(warned_text()).toContain(RUN_REPORT)
		expect(warned_text()).toContain(`${RUN_REPORT} exploded`)
	})

	it('prints the command that finishes the step by hand', async () => {
		await git_followup_cleanup.run_step(failing_step(HOLD_RELEASE, RELEASE_COMMAND))

		expect(warned_text()).toContain(RELEASE_COMMAND)
	})
})

describe('git_followup_cleanup.run_guarded_steps — the steps after a failure', () => {
	it('runs every step even when the first one throws', async () => {
		const { step, run } = passing_step(HOLD_RELEASE)

		await git_followup_cleanup.run_guarded_steps(true, [failing_step(RUN_REPORT), step])

		expect(run).toHaveBeenCalledOnce()
	})

	it('answers false when any step failed', async () => {
		const { step } = passing_step(HOLD_RELEASE)

		await expect(
			git_followup_cleanup.run_guarded_steps(true, [failing_step(RUN_REPORT), step]),
		).resolves.toBe(false)
	})

	it('answers true when every step completed', async () => {
		const first = passing_step(RUN_REPORT)
		const second = passing_step(HOLD_RELEASE)

		await expect(
			git_followup_cleanup.run_guarded_steps(true, [first.step, second.step]),
		).resolves.toBe(true)
	})
})

describe('git_followup_cleanup.run_guarded_steps — the order of the tail', () => {
	it('keeps the steps in the order they were given', async () => {
		const order: Array<string> = []
		const push_step = (label: string): CleanupStep => ({
			label,
			recovery: undefined,
			run: async () => {
				await Promise.resolve()
				order.push(label)
			},
		})

		await git_followup_cleanup.run_guarded_steps(true, [
			push_step(RUN_REPORT),
			push_step(HOLD_RELEASE),
		])

		expect(order).toStrictEqual([RUN_REPORT, HOLD_RELEASE])
	})
})

// Before a merge nothing irreversible has happened, so a failure there is a failure of the run: the
// guard is what the merge earned, and an unguarded step still ends the run it belongs to.
describe('git_followup_cleanup — the unguarded form', () => {
	it('rethrows a failing step instead of reporting it', async () => {
		await expect(
			git_followup_cleanup.run_guarded_step(false, failing_step(RUN_REPORT)),
		).rejects.toThrow(`${RUN_REPORT} exploded`)
	})

	it('stops the remaining steps when one throws', async () => {
		const { step, run } = passing_step(HOLD_RELEASE)

		await expect(
			git_followup_cleanup.run_guarded_steps(false, [failing_step(RUN_REPORT), step]),
		).rejects.toThrow(`${RUN_REPORT} exploded`)
		expect(run).not.toHaveBeenCalled()
	})

	it('reports nothing, because nothing was swallowed', async () => {
		await expect(
			git_followup_cleanup.run_guarded_step(false, failing_step(RUN_REPORT)),
		).rejects.toThrow()
		expect(console.warn).not.toHaveBeenCalled()
	})
})
