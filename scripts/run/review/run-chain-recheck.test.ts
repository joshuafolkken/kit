import { metrics_totals } from '#scripts/gate/metrics-totals'
import { review_record_slot } from '#scripts/review/review-record-slot'
import { run_review_pinned_accepted } from '#scripts/run/review/run-review-pinned-accepted'
import { run_ship_pre_detach_pinned } from '#scripts/run/ship/run-ship-pre-detach-pinned'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_chain_cli } from './run-chain-cli'

const josh_run_mock = vi.hoisted(() =>
	vi.fn(async (_argv: ReadonlyArray<string>) => ({ code: 0, out: '' })),
)

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))

const ISSUE = '7730'
const TITLE = 'Recheck the fixed tree #7730'
const SHIPPING = [ISSUE, '--join', '--ship', TITLE]
const SHIP = 'ship'
const GROWTH = 'ai_cost.on_demand_bytes merge-base 366026 → current 366149 (+123)'
const UNPINNED = 'unpinned scripts/backlog/backlog-triage-cli.ts:237'
const RESUME = `--join --ship '${TITLE}' --from recheck`
const STOPPED = 1
const REASON = 'no test can pin a log line'

const printed: Array<string> = []

function ran(): ReadonlyArray<string | undefined> {
	return josh_run_mock.mock.calls.map(([argv]) => argv[0])
}

function output(): string {
	return printed.join('\n')
}

function totals_refuse(refusal: string | undefined): ReturnType<typeof vi.spyOn> {
	return vi.spyOn(metrics_totals, 'totals_refusal').mockResolvedValue(refusal)
}

function pinned_answers(code: number, out: string): ReturnType<typeof vi.spyOn> {
	return vi.spyOn(run_ship_pre_detach_pinned, 'pinned_check').mockResolvedValue({ code, out })
}

beforeEach(() => {
	josh_run_mock.mockReset()
	josh_run_mock.mockResolvedValue({ code: 0, out: '' })
	vi.spyOn(review_record_slot, 'slot_text').mockReturnValue('')
	vi.spyOn(run_review_pinned_accepted, 'recorded_reason').mockResolvedValue(undefined)
	totals_refuse(undefined)
	pinned_answers(0, '')
	printed.length = 0

	for (const channel of ['info', 'error'] as const) {
		vi.spyOn(console, channel).mockImplementation((line: string) => {
			printed.push(line)
		})
	}
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_chain_cli.run --join — the recheck before the ship', () => {
	it('stops on a metrics growth the fix made, naming it, before the ship (ac-fce1718f)', async () => {
		totals_refuse(`run:review refused: josh metrics --totals-only did not pass\n${GROWTH}`)

		await expect(run_chain_cli.run(SHIPPING)).resolves.toBe(STOPPED)

		expect(ran()).not.toContain(SHIP)
		expect(output()).toContain(GROWTH)
		expect(output()).toContain('stopped at recheck (a metrics total grew past its approval)')
		expect(output()).toContain('`pnpm josh metrics --accept --reason "<why>"`')
		expect(output()).toContain(RESUME)
	})

	it('stops on an unpinned place the fix made, naming it, before the ship (ac-3a49fce5)', async () => {
		pinned_answers(1, `${UNPINNED} — reverting it left every related test green\n`)

		await expect(run_chain_cli.run(SHIPPING)).resolves.toBe(STOPPED)

		expect(ran()).not.toContain(SHIP)
		expect(output()).toContain(UNPINNED)
		expect(output()).toContain('stopped at recheck (a changed place no test pins)')
		expect(output()).toContain('`--unpinned-ok "<reason>"`')
	})

	it('ships when both judgments pass, running no command of its own', async () => {
		await expect(run_chain_cli.run(SHIPPING)).resolves.toBe(0)

		expect(ran()).toStrictEqual(['run:review', 'review:attest', 'review:record', SHIP])
	})

	it('resumes at the recheck straight into the ship', async () => {
		await expect(run_chain_cli.run([...SHIPPING, '--from', 'recheck'])).resolves.toBe(0)

		expect(ran()).toStrictEqual([SHIP])
	})
})

// The same functions the ship's pre-detach asks, under what this branch already accepted.
describe('run_chain_cli.run --join — the judgments the ship asks (ac-fd7735c5)', () => {
	it('asks the totals the metrics refusal of run:review and the ship reads', async () => {
		const totals = totals_refuse(undefined)

		await run_chain_cli.run(SHIPPING)

		expect(totals).toHaveBeenCalledOnce()
	})

	it('asks the pinned check for the issue', async () => {
		const pinned = pinned_answers(0, '')

		await run_chain_cli.run(SHIPPING)

		expect(pinned).toHaveBeenCalledWith(expect.objectContaining({ number: ISSUE }))
	})
})

describe('run_chain_cli.run --join — the recheck under what the branch accepted', () => {
	it.each([
		['the reason this branch recorded', REASON, ['--unpinned-ok', REASON]],
		['no reason when none is recorded', undefined, []],
	])('passes %s to the pinned check', async (_label, reason, unpinned_ok) => {
		vi.spyOn(run_review_pinned_accepted, 'recorded_reason').mockResolvedValue(reason)
		const pinned = pinned_answers(0, '')

		await run_chain_cli.run(SHIPPING)

		expect(pinned).toHaveBeenCalledWith({ number: ISSUE, unpinned_ok })
	})
})
