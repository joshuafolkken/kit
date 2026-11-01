import { review_record_slot } from '#scripts/review/review-record-slot'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_chain_cli } from './run-chain-cli'

const josh_run_mock = vi.hoisted(() =>
	vi.fn(async (_argv: ReadonlyArray<string>) => ({ code: 0, out: '' })),
)

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))

const ISSUE = '5735'
const JOIN = '--join'
const FROM = '--from'
const RUN_REVIEW = 'run:review'
const ATTEST = 'review:attest'
const RECORD_ARGV = ['review:record', '--from-slot', '--issue', ISSUE]
const JOIN_LINE = [[RUN_REVIEW, JOIN], [ATTEST, '--check'], RECORD_ARGV]
const STOP_EXIT = 2
const LOW_FINDING = 'bug-risks:low:scripts/a.ts — a nit'
const MEDIUM_FINDING = 'fixed bug-risks:medium:scripts/b.ts — fixed in place'
const SHIP_REVIEW = 'then ship with `--review`'

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
	josh_run_mock.mockReset()
	josh_run_mock.mockResolvedValue({ code: 0, out: '' })
	slot_holds('')
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
