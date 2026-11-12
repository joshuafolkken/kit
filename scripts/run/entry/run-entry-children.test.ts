import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_entry_children } from './run-entry-children'

// joshuafolkken/kit#5831: `run:entry` times each child it runs under `run:entry › <step>`.

const { record_ship_lap, josh_run } = vi.hoisted(() => ({
	record_ship_lap: vi.fn(async () => undefined),
	josh_run: vi.fn(async () => ({ code: 0, out: '' })),
}))

vi.mock('#scripts/lane/lane-ledger-write', () => ({ lane_ledger_write: { record_ship_lap } }))
vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run } }))

const ISSUE = '5831'

beforeEach(() => {
	record_ship_lap.mockClear()
	josh_run.mockClear()
})

describe('run_entry_children.claim_hold', () => {
	it('forwards the hold lap scope without imposing a timeout on the tree claim', async () => {
		josh_run.mockResolvedValueOnce({ code: 0, out: 'hold' })

		await run_entry_children.within(
			ISSUE,
			async () =>
				await run_entry_children.claim_hold({
					issue_number: ISSUE,
					command: 'fullrun',
					is_adopt: false,
				}),
		)

		expect(josh_run).toHaveBeenCalledWith(['run:hold', ISSUE, '--fullrun'], true, undefined, {
			JOSH_SHIP_LAP_SCOPE: JSON.stringify({
				issue: Number(ISSUE),
				stage: 'run:entry',
				parent: 'run:entry › run:hold',
			}),
		})
	})

	it('refuses a failed or timed out claim despite hold on stdout (ac-cc244c8b)', async () => {
		josh_run.mockResolvedValueOnce({ code: 1, out: 'hold' })

		expect(
			await run_entry_children.claim_hold({
				issue_number: ISSUE,
				command: 'fullrun',
				is_adopt: false,
			}),
		).toBe('unknown')
	})
})

describe('run_entry_children.STEP — the lap names lane:breakdown prints', () => {
	it('keeps each child step name fixed', () => {
		expect(run_entry_children.STEP).toEqual({
			RESUME: 'run:cut --resume',
			STAGE: 'stage read',
			HOLD: 'run:hold',
			COST: 'cost --cut',
			SYNC: 'sync',
			LABEL: 'label',
			PREP: 'run:prep',
			PROBE: 'lane:plan probe',
			LANE_PLAN: 'lane:plan',
			BASELINE: 'issue baseline',
			REPORT: 'report',
		})
	})
})

describe('run_entry_children.within — the entry scope', () => {
	it('records a step timed within it as `run:entry › <step>`', async () => {
		const result = await run_entry_children.within(
			ISSUE,
			async () => await run_entry_children.timed(run_entry_children.STEP.PREP, async () => 'read'),
		)

		expect(result).toBe('read')
		expect(record_ship_lap).toHaveBeenCalledWith(
			expect.objectContaining({
				issue: Number(ISSUE),
				stage: 'run:entry',
				step: 'run:entry › run:prep',
			}),
		)
	})

	it('records nothing for a step timed outside it', async () => {
		await run_entry_children.timed(run_entry_children.STEP.PREP, async () => 'read')

		expect(record_ship_lap).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#5953: `run:cut --resume` prints the section it acts on after its token, which
// `run:entry` relays rather than dropping with the rest of the output.
describe('run_entry_children.ask_resume — the token and the section after it', () => {
	it('splits the token from the section printed after it', async () => {
		josh_run.mockResolvedValueOnce({ code: 0, out: 'resume\n## Resuming\n\nbody\n' })

		expect(await run_entry_children.ask_resume(ISSUE)).toStrictEqual({
			token: 'resume',
			code: 0,
			section: '## Resuming\n\nbody',
		})
	})

	it('answers an empty section on a bare token', async () => {
		josh_run.mockResolvedValueOnce({ code: 0, out: 'fresh\n' })

		expect(await run_entry_children.ask_resume(ISSUE)).toStrictEqual({
			token: 'fresh',
			code: 0,
			section: '',
		})
	})
})
