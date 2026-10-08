import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CONTEXT_CUT_THRESHOLD } from '#scripts/cost-runtime/context-cut-threshold'
import type { CostVerdict } from '#scripts/cost-runtime/cost-cli'
import { cost_format } from '#scripts/cost-runtime/cost-format'
import { cost_verdict } from '#scripts/cost-runtime/cost-verdict'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_headless } from './run-headless'
import { run_parent_cut_hook, type ParentCutState } from './run-parent-cut-hook'

// joshuafolkken/kit#2947: a `backlogrun` parent past the shared threshold is steered to the hand-off at
// its next call, not only at a merge.

const NOW_MS = 1_800_000_000_000
const AFTER_QUIET_MS = NOW_MS + run_parent_cut_hook.QUIET_WINDOW_MS
const INSIDE_QUIET_MS = AFTER_QUIET_MS - 1

function carry(overrides: Partial<RunCarry> = {}): RunCarry {
	return {
		invocation: 'backlogrun',
		started_at: '2026-10-02T08:00:00.000Z',
		merged: 0,
		filed: 0,
		cuts: 0,
		failures: 0,
		outages: 0,
		...overrides,
	}
}

function state(record: RunCarry | undefined, verdict: CostVerdict): ParentCutState {
	return { carry: async (): Promise<RunCarry | undefined> => record, verdict: () => verdict }
}

// A driving parent priced through the real verdict on a per-request billed-input sequence.
function priced_on(billed: ReadonlyArray<number>): ParentCutState {
	const measurement = { billed_input_per_request: billed }

	return {
		carry: async (): Promise<RunCarry> => carry(),
		verdict: (): CostVerdict => cost_verdict.classify(measurement, CONTEXT_CUT_THRESHOLD),
	}
}

// A payload naming a transcript in a fresh directory, so each test starts with no refusal recorded.
function fresh_payload(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'parent-cut-'))

	return JSON.stringify({ transcript_path: path.join(directory, 'session.jsonl') })
}

async function reason_once(
	record: RunCarry | undefined,
	verdict: CostVerdict,
): Promise<string | undefined> {
	return await run_parent_cut_hook.parent_cut_reason(
		fresh_payload(),
		NOW_MS,
		state(record, verdict),
	)
}

// A gate run inside a headless lane inherits the mark, which exempts the cut cap
// (`run_headless.is_cut_capped`); every case here is an attached parent.
beforeEach(() => {
	vi.stubEnv(run_headless.HEADLESS_ENV_KEY, '')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_parent_cut_hook.parent_cut_reason — who is refused', () => {
	it('refuses the driving parent whose verdict is over', async () => {
		const record = carry()

		expect(await reason_once(record, 'over')).toBe(run_parent_cut_hook.PARENT_CUT_REASON)
	})

	it('lets an under or unmeasurable parent through', async () => {
		const record = carry()

		expect(await reason_once(record, 'under')).toBeUndefined()
		expect(await reason_once(record, 'unmeasurable')).toBeUndefined()
	})

	it('lets a session that drives no record through — a lane child, a person, a handed-off parent', async () => {
		expect(await reason_once(undefined, 'over')).toBeUndefined()
	})

	it('lets a parent at the cut cap through, since it has no cut left to take', async () => {
		const capped = carry({ cuts: run_carry.MAX_CUTS })

		expect(await reason_once(capped, 'over')).toBeUndefined()
	})

	it('is off when its switch is disabled', async () => {
		vi.stubEnv(run_parent_cut_hook.SWITCH_ENV_KEY, '0')
		const record = carry()

		expect(await reason_once(record, 'over')).toBeUndefined()
	})

	it('lets a payload with no transcript through', async () => {
		const reason = await run_parent_cut_hook.parent_cut_reason('{}', NOW_MS, state(carry(), 'over'))

		expect(reason).toBeUndefined()
	})
})

describe('run_parent_cut_hook.parent_cut_reason — a delegated unit', () => {
	it("lets a unit's call through, though it names the parent's transcript", async () => {
		const parent = JSON.parse(fresh_payload()) as Record<string, unknown>
		const unit_call = JSON.stringify({
			...parent,
			agent_id: 'unit-1',
			tool_name: 'Bash',
			tool_input: { command: 'ls' },
		})

		const reason = await run_parent_cut_hook.parent_cut_reason(
			unit_call,
			NOW_MS,
			state(carry(), 'over'),
		)

		expect(reason).toBeUndefined()
	})
})

describe('run_parent_cut_hook.parent_cut_reason — the quiet window', () => {
	it('stays quiet inside the window so the hand-off calls pass, and asks again after it', async () => {
		const over = state(carry(), 'over')
		const payload = fresh_payload()

		expect(await run_parent_cut_hook.parent_cut_reason(payload, NOW_MS, over)).toBeDefined()
		expect(
			await run_parent_cut_hook.parent_cut_reason(payload, INSIDE_QUIET_MS, over),
		).toBeUndefined()
		expect(await run_parent_cut_hook.parent_cut_reason(payload, AFTER_QUIET_MS, over)).toBe(
			run_parent_cut_hook.PARENT_CUT_REASON,
		)
	})

	it('does not price the session inside the window', async () => {
		const verdict = vi.fn((): CostVerdict => 'over')
		const priced: ParentCutState = { carry: async (): Promise<RunCarry> => carry(), verdict }
		const payload = fresh_payload()

		await run_parent_cut_hook.parent_cut_reason(payload, NOW_MS, priced)
		await run_parent_cut_hook.parent_cut_reason(payload, INSIDE_QUIET_MS, priced)

		expect(verdict).toHaveBeenCalledTimes(1)
	})
})

// joshuafolkken/kit#3224: priced through the real verdict, the parent is refused at the first request
// past the threshold, not once a ten-request average that trails a growing context catches up.
describe('run_parent_cut_hook.parent_cut_reason — priced on the newest request', () => {
	const STEP = 1000
	const UNDER_STEPS = [3, 2, 1]
	const before_crossing = UNDER_STEPS.map((steps) => CONTEXT_CUT_THRESHOLD - steps * STEP)

	it('refuses at the request that crosses the threshold while the average is still under', async () => {
		const growing = [...before_crossing, CONTEXT_CUT_THRESHOLD + 1]
		const reason = await run_parent_cut_hook.parent_cut_reason(
			fresh_payload(),
			NOW_MS,
			priced_on(growing),
		)

		expect(reason).toBe(run_parent_cut_hook.PARENT_CUT_REASON)
	})

	it('lets the parent through while the newest request is under the threshold', async () => {
		const reason = await run_parent_cut_hook.parent_cut_reason(
			fresh_payload(),
			NOW_MS,
			priced_on(before_crossing),
		)

		expect(reason).toBeUndefined()
	})
})

describe('run_parent_cut_hook.PARENT_CUT_REASON', () => {
	it('names the hand-off command and the procedure', () => {
		expect(run_parent_cut_hook.PARENT_CUT_REASON).toContain('pnpm josh run:carry --cut')
		expect(run_parent_cut_hook.PARENT_CUT_REASON).toContain('backlogrun-progress.md')
	})

	it('builds the threshold from the shared constant rather than spelling it', () => {
		expect(run_parent_cut_hook.PARENT_CUT_REASON).toContain(
			cost_format.format_tokens(CONTEXT_CUT_THRESHOLD),
		)
	})
})
