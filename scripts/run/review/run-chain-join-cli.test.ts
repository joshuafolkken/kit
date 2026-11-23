import { metrics_totals } from '#scripts/gate/metrics-totals'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { review_record_slot } from '#scripts/review/review-record-slot'
import { run_ship_pre_detach_pinned } from '#scripts/run/ship/run-ship-pre-detach-pinned'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_chain_cli } from './run-chain-cli'
import { run_chain_review_fix } from './run-chain-review-fix'
import { run_chain_worker_fixture } from './run-chain-worker-fixture'
import { run_review_pinned_accepted } from './run-review-pinned-accepted'

const josh_run_mock = vi.hoisted(() =>
	vi.fn(async (_argv: ReadonlyArray<string>) => ({ code: 0, out: '' })),
)

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))

const ISSUE = '5735'
const JOIN = '--join'
const FROM = '--from'
const RUN_REVIEW = 'run:review'
const ATTEST = 'review:attest'
const RECORD = 'review:record'
const RECORD_ARGV = [RECORD, '--from-slot', '--issue', ISSUE]
// The join's `run:review` waits in full: its worker already runs past the prompt cache's chunk
// (joshuafolkken/kit#8761), so a chunked wait would only end the worker pending.
const JOIN_LINE = [[RUN_REVIEW, JOIN], [ATTEST, '--check'], RECORD_ARGV]
const STOP_EXIT = 2
const LOW_FINDING = 'bug-risks:low:scripts/a.ts — a nit'
const MEDIUM_FINDING = 'fixed bug-risks:medium:scripts/b.ts — fixed in place'
const SHIP_REVIEW = 'then ship with `--review`'
const SHIP = 'ship'
const TITLE = 'Extend clean join #5735'
const SHIPPING = [ISSUE, JOIN, '--ship', TITLE]
const SHIP_LINE = [...JOIN_LINE, [SHIP, '--detach', '--review', TITLE]]

const error_lines: Array<string> = []

function ran(): ReadonlyArray<ReadonlyArray<string>> {
	return josh_run_mock.mock.calls.map(([argv]) => argv)
}

function stop_at(name: string): void {
	josh_run_mock.mockImplementation(async (argv) => ({
		code: argv[0] === name ? STOP_EXIT : 0,
		out: '',
	}))
}

function slot_holds(text: string | undefined): void {
	vi.spyOn(review_record_slot, 'slot_text').mockReturnValue(text)
}

function errors(): string {
	return error_lines.join('\n')
}

beforeEach(() => {
	run_chain_worker_fixture.run_worker_in_place(run_chain_cli.run)
	josh_run_mock.mockReset()
	josh_run_mock.mockResolvedValue({ code: 0, out: '' })
	slot_holds('')
	vi.spyOn(metrics_totals, 'totals_check').mockResolvedValue(undefined)
	vi.spyOn(run_review_pinned_accepted, 'recorded_reason').mockResolvedValue(undefined)
	vi.spyOn(run_ship_pre_detach_pinned, 'pinned_check').mockResolvedValue({ code: 0, out: '' })
	error_lines.length = 0
	vi.spyOn(console, 'info').mockReturnValue(undefined)
	vi.spyOn(console, 'error').mockImplementation((line: string) => {
		error_lines.push(line)
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_chain_cli.run --join — a clean round', () => {
	it('joins, attests and records a round with no findings', async () => {
		await expect(run_chain_cli.run([ISSUE, JOIN])).resolves.toBe(0)

		expect(ran()).toStrictEqual(JOIN_LINE)
	})

	it('forwards --fixing to the join', async () => {
		await run_chain_cli.run([ISSUE, JOIN, '--fixing'])

		expect(ran()[0]).toStrictEqual([RUN_REVIEW, JOIN, '--fixing'])
	})

	it('leaves an unreadable slot to review:record, whose refusal names it', async () => {
		slot_holds(undefined)

		await expect(run_chain_cli.run([ISSUE, JOIN])).resolves.toBe(0)

		expect(ran()).toStrictEqual(JOIN_LINE)
	})

	it('resumes at the stage --from names', async () => {
		await run_chain_cli.run([ISSUE, JOIN, FROM, ATTEST])

		expect(ran()).toStrictEqual(JOIN_LINE.slice(1))
	})
})

describe('run_chain_cli.run --join — stops', () => {
	it('stops on a red join before the attest and resumes the join', async () => {
		stop_at(RUN_REVIEW)

		await expect(run_chain_cli.run([ISSUE, JOIN])).resolves.toBe(1)

		expect(ran()).toStrictEqual(JOIN_LINE.slice(0, 1))
		expect(errors()).toContain('then rerun `pnpm josh run:chain 5735 --join`')
	})

	it('stops on a missing or mismatched attest and resumes at the attest', async () => {
		stop_at(ATTEST)

		await expect(run_chain_cli.run([ISSUE, JOIN])).resolves.toBe(1)

		expect(ran()).toStrictEqual(JOIN_LINE.slice(0, 2))
		expect(errors()).toContain('`missing` or `mismatch`')
		expect(errors()).toContain('then rerun `pnpm josh run:chain 5735 --join --from review:attest`')
	})

	it('keeps --fixing in the rerun a --join --fixing stop prints', async () => {
		stop_at(ATTEST)

		await expect(run_chain_cli.run([ISSUE, JOIN, '--fixing'])).resolves.toBe(1)

		expect(errors()).toContain(
			'then rerun `pnpm josh run:chain 5735 --join --fixing --from review:attest`',
		)
	})
})

describe('run_chain_cli.run --join — findings held for the record', () => {
	it('holds a Low-only round for its dispositions, with no round 2', async () => {
		slot_holds(LOW_FINDING)

		await expect(run_chain_cli.run([ISSUE, JOIN])).resolves.toBe(1)

		expect(ran()).toStrictEqual(JOIN_LINE.slice(0, 2))
		expect(errors()).toContain(
			'stopped at review:attest (attested; 1 finding(s) to settle before the record)',
		)
		expect(errors()).toContain('`pnpm josh review:record --from-slot --issue 5735`')
		expect(errors()).not.toContain(SHIP_REVIEW)
	})

	it('names ship --review once a Medium is among the findings, even fixed', async () => {
		slot_holds(`${LOW_FINDING}\n${MEDIUM_FINDING}`)

		await expect(run_chain_cli.run([ISSUE, JOIN])).resolves.toBe(1)

		expect(errors()).toContain('2 finding(s)')
		expect(errors()).toContain(SHIP_REVIEW)
	})
})

describe('run_chain_cli.run --join — the recheck the held round asks for', () => {
	it('asks for the recheck of the fixed tree, which ships, naming no second ship', async () => {
		slot_holds(MEDIUM_FINDING)

		await run_chain_cli.run(SHIPPING)

		expect(errors()).toContain(`--join --ship '${TITLE}' --from recheck\`, which ships`)
		expect(errors()).not.toContain(SHIP_REVIEW)
	})

	it('names the ship after the recheck when the chain was not given one', async () => {
		slot_holds(MEDIUM_FINDING)

		await run_chain_cli.run([ISSUE, JOIN])

		expect(errors()).toContain(`--join --from recheck\`, ${SHIP_REVIEW}`)
	})
})

describe('run_chain_cli.run --join — the held round routed for its fix', () => {
	it('routes the held round through the review-fix next action (ac-c38296ce)', async () => {
		const route = vi.spyOn(run_chain_review_fix, 'route').mockReturnValue(() => 'cut now')

		slot_holds(MEDIUM_FINDING)

		await expect(run_chain_cli.run([ISSUE, JOIN])).resolves.toBe(1)

		expect(route).toHaveBeenCalledWith(
			ISSUE,
			[expect.stringContaining('bug-risks:medium:scripts/b.ts')],
			expect.any(Function),
		)
		expect(errors()).toContain('cut now')
	})
})

// joshuafolkken/kit#7024: a stage that exited 0 on its hold notice is a `hold`, not an `exit`.
describe('run_chain_cli.run --join — the ledger line', () => {
	it('records the held round as a hold at the attest on the join', async () => {
		const record = vi.spyOn(lane_ledger_write, 'record_chain').mockResolvedValue()

		slot_holds(LOW_FINDING)
		await run_chain_cli.run([ISSUE, JOIN])

		expect(record).toHaveBeenCalledWith(
			expect.objectContaining({ issue: 5735, join: true, stage: ATTEST, reason: 'hold' }),
		)
	})
})

describe('run_chain_cli.run --join --ship', () => {
	it('ships only after the clean record succeeds (ac-b6f5ca5d)', async () => {
		await expect(run_chain_cli.run(SHIPPING)).resolves.toBe(0)

		expect(ran()).toStrictEqual(SHIP_LINE)
	})

	it.each([LOW_FINDING, MEDIUM_FINDING, 'bug-risks:high:scripts/c.ts — a bug'])(
		'holds every finding before recording or shipping: %s (ac-9572a35f)',
		async (finding) => {
			slot_holds(finding)

			await expect(run_chain_cli.run(SHIPPING)).resolves.toBe(1)

			expect(ran()).toStrictEqual(JOIN_LINE.slice(0, 2))
			expect(errors()).toContain('next: fix')
		},
	)

	it.each([RUN_REVIEW, ATTEST, RECORD, SHIP])(
		'stops at a failed %s and retains the shipping mode (ac-92775e31)',
		async (stage) => {
			stop_at(stage)

			await expect(run_chain_cli.run([...SHIPPING, '--fixing'])).resolves.toBe(1)

			const stop_index = SHIP_LINE.findIndex(([name]) => name === stage)

			expect(ran()).toHaveLength(stop_index + 1)
			expect(ran().at(-1)?.[0]).toBe(stage)
			expect(errors()).toContain(`--join --fixing --ship '${TITLE}'`)
		},
	)
})

describe('run_chain_cli.run --join --ship — resume', () => {
	it.each([ATTEST, RECORD, SHIP])('resumes at %s with the ship stage', async (stage) => {
		await expect(run_chain_cli.run([...SHIPPING, FROM, stage])).resolves.toBe(0)

		const start = SHIP_LINE.findIndex(([name]) => name === stage)

		expect(ran()).toStrictEqual(SHIP_LINE.slice(start))
	})

	it('quotes shell metacharacters in the resume title', async () => {
		stop_at(SHIP)
		const title = "Don't expand $(touch /tmp/no) `cmd` #5735"

		await run_chain_cli.run([ISSUE, JOIN, '--ship', title])

		expect(ran().at(-1)).toStrictEqual([SHIP, '--detach', '--review', title])
		expect(errors()).toContain("--ship 'Don'\\''t expand $(touch /tmp/no) `cmd` #5735' --from ship")
	})
})
