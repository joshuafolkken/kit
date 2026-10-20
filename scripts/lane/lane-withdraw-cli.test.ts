import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_withdraw, type WithdrawOutcome } from './lane-withdraw'
import { lane_withdraw_cli } from './lane-withdraw-cli'

// joshuafolkken/kit#3908: `josh lane:withdraw` takes one issue and a non-empty reason, and exits zero
// only once the issue is closed.

const ISSUE = '3769'
const REASON = 'superseded by #3780'
const SUCCESS = 0
const FAILURE = 1
const USAGE = 'Usage: josh lane:withdraw <issue-number> --reason <text>'
const DESCRIBED = 'withdraw described'

const withdraw = vi.spyOn(lane_withdraw, 'withdraw')
const error = vi.spyOn(console, 'error')

vi.spyOn(lane_withdraw, 'describe').mockReturnValue(DESCRIBED)

function withdrawn(is_closed: boolean): WithdrawOutcome {
	return {
		kind: 'withdrawn',
		reaped: 1,
		stash: undefined,
		is_closed,
		had_closed: false,
		lane: 'closed',
		residents: [],
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	error.mockImplementation(vi.fn())
})

describe('lane_withdraw_cli.run — the exit code', () => {
	it('exits zero once the issue is closed, passing the trimmed reason', async () => {
		withdraw.mockResolvedValue(withdrawn(true))

		expect(await lane_withdraw_cli.run([ISSUE, '--reason', ` ${REASON} `])).toBe(SUCCESS)
		expect(withdraw).toHaveBeenCalledWith(ISSUE, REASON)
		expect(error).toHaveBeenCalledWith(DESCRIBED)
	})

	it('exits non-zero when the issue could not be closed', async () => {
		withdraw.mockResolvedValue(withdrawn(false))

		expect(await lane_withdraw_cli.run([ISSUE, `--reason=${REASON}`])).toBe(FAILURE)
	})

	it('exits non-zero on a refusal', async () => {
		withdraw.mockResolvedValue({ kind: 'no-lane' })

		expect(await lane_withdraw_cli.run([ISSUE, '--reason', REASON])).toBe(FAILURE)
	})
})

describe('lane_withdraw_cli.run — the usage', () => {
	it.each([
		['no reason', [ISSUE]],
		['a blank reason', [ISSUE, '--reason', '  ']],
		['no issue', ['--reason', REASON]],
		['two issues', [ISSUE, '3770', '--reason', REASON]],
		['a non-number issue', ['#3769', '--reason', REASON]],
		['an unknown flag', [ISSUE, '--reason', REASON, '--force']],
	])('refuses %s with the usage line, withdrawing nothing', async (_label, argv) => {
		expect(await lane_withdraw_cli.run(argv)).toBe(FAILURE)
		expect(error).toHaveBeenCalledWith(USAGE)
		expect(withdraw).not.toHaveBeenCalled()
	})
})
