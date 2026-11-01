import { plan_consumers_section } from '#scripts/issue/plan-consumers-section'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanePlan } from './lane-plan'

const { run_mock } = vi.hoisted(() => ({
	run_mock: vi.fn<(plan: LanePlan, directory: string) => Promise<number>>(),
}))

vi.mock(import('./lane-plan-check'), async (import_original) => {
	const { lane_plan_check } = await import_original()

	return {
		lane_plan_check: { ...lane_plan_check, check_plan: run_mock, placed: (plan: LanePlan) => plan },
	}
})

const { lane_plan_auto } = await import('./lane-plan-auto')

// The paths `lane:plan`'s check was handed.
function checked_paths(): ReadonlyArray<string> | undefined {
	return run_mock.mock.calls[0]?.[0].paths
}

// joshuafolkken/kit#5738: a lane child's recorded plan runs `lane:plan` on its own paths, so the child
// spends no second call copying them.

const ISSUE = '5738'
const DIRECTORY = 'lane-checkout'
const EDITED = ['scripts/lane/lane-plan-auto.ts', 'docs/josh-commands-run.md']
const CONSUMER = 'scripts/run/run-step-cli.ts'
const YIELD_EXIT_CODE = 2

function plan_naming(edited: ReadonlyArray<string>): string {
	const changes = edited.map((path) => `- \`${path}\` を変更する`).join('\n')

	return `## 計画\n\n${changes}\n\n${plan_consumers_section.HEADING}\n\n- \`${CONSUMER}\` — 影響なし\n`
}

const printed: Array<string> = []

beforeEach(() => {
	printed.length = 0
	vi.clearAllMocks()
	run_mock.mockResolvedValue(0)
	vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
		printed.push(String(line))
	})
})

describe('lane_plan_auto.run_from_plan', () => {
	it('runs lane:plan with the plan’s paths and returns its code', async () => {
		run_mock.mockResolvedValue(YIELD_EXIT_CODE)

		expect(await lane_plan_auto.run_from_plan(ISSUE, plan_naming(EDITED), DIRECTORY)).toBe(
			YIELD_EXIT_CODE,
		)
		expect(checked_paths()).toStrictEqual(EDITED)
		expect(run_mock.mock.calls[0]?.[1]).toBe(DIRECTORY)
		expect(printed).toStrictEqual([`pnpm josh lane:plan ${ISSUE} ${EDITED.join(' ')}`])
	})

	it('leaves the consumers section’s paths out', async () => {
		await lane_plan_auto.run_from_plan(ISSUE, plan_naming(EDITED), DIRECTORY)

		expect(checked_paths()).not.toContain(CONSUMER)
	})

	it('prints the command for the child to finish when the plan names no path', async () => {
		expect(await lane_plan_auto.run_from_plan(ISSUE, plan_naming([]), DIRECTORY)).toBe(0)
		expect(run_mock).not.toHaveBeenCalled()
		expect(printed).toStrictEqual([`pnpm josh lane:plan ${ISSUE} <path>...`])
	})
})

describe('lane_plan_auto.command_of', () => {
	it('quotes a path the shell would read as syntax', () => {
		expect(lane_plan_auto.command_of(ISSUE, ['src/routes/(app)/+layout.svelte'])).toBe(
			`pnpm josh lane:plan ${ISSUE} 'src/routes/(app)/+layout.svelte'`,
		)
	})
})
