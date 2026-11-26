import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { lane_dispatch_dependency } from '#scripts/lane/lane-dispatch-dependency'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import type { CarryAddition } from '#scripts/run/carry/run-carry-added'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive, type OfferRead } from './backlog-drive'
import { backlog_drive_named_gate } from './backlog-drive-named-gate'
import { backlog_drive_named_launch } from './backlog-drive-named-launch'
import { backlog_drive_named_offer } from './backlog-drive-named-offer'
import { backlog_drive_named_rank } from './backlog-drive-named-rank'
import { backlog_drive_rate_limit } from './backlog-drive-rate-limit'

// joshuafolkken/kit#9002: the issues `run:add` handed a named run are offered in the pool's rank order,
// each chunk of additions on its own, while the declared issues keep the typed order.

const CRITICAL = 'priority:critical'
const HIGH = 'priority:high'
const UNREADABLE = '99'
const GARBLED = '98'
const BLOCKED = '21'
const DECLARED = 'backlogrun #5 #6'
const WAIT: OfferRead = { verdict: 'wait', issues: [], retries: 0 }

function carry_of(invocation: string, added: ReadonlyArray<CarryAddition>): RunCarry {
	return {
		invocation,
		started_at: new Date().toISOString(),
		merged: 0,
		filed: 0,
		cuts: 0,
		failures: 0,
		outages: 0,
		added,
	}
}

function ahead(...issues: ReadonlyArray<number>): Array<CarryAddition> {
	return issues.map((issue) => ({ issue, is_priority: true }))
}

function behind(...issues: ReadonlyArray<number>): Array<CarryAddition> {
	return issues.map((issue) => ({ issue, is_priority: false }))
}

function labelled(labels: Readonly<Record<string, string>>): ReturnType<typeof vi.spyOn> {
	return vi
		.spyOn(git_gh_command, 'issue_view_json_classified')
		.mockImplementation(async (issue) => {
			if (issue === UNREADABLE) return await { kind: 'missing' }
			if (issue === GARBLED) return await { kind: 'read', json: '{' }
			const names = labels[issue] === undefined ? [] : [{ name: labels[issue] }]

			return await { kind: 'read', json: JSON.stringify({ labels: names, body: '' }) }
		})
}

async function ranked(
	issues: ReadonlyArray<string>,
	added: ReadonlyArray<CarryAddition>,
): Promise<Array<string>> {
	return await backlog_drive_named_rank.ranked(issues, carry_of(DECLARED, added))
}

async function gather(
	issues: ReadonlyArray<string>,
	carry: RunCarry,
): ReturnType<typeof backlog_drive_named_launch.gather> {
	const state = backlog_drive.initial_state([], new Date().toISOString())

	return await backlog_drive_named_launch.gather(issues, state, 'owner', carry)
}

beforeEach(() => {
	vi.spyOn(backlog_drive_rate_limit, 'held').mockResolvedValue(undefined)
	vi.spyOn(backlog_drive_named_gate, 'admitted').mockImplementation(
		async (plain) => await plain.map((issue) => issue.number),
	)
	vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({
		kind: 'state',
		state: { state: 'OPEN', labels: [], is_human_review: false },
	})
	vi.spyOn(lane_dispatch_dependency, 'unfinished').mockImplementation(
		async (issue) =>
			await (issue === BLOCKED
				? [{ number: 1, repo: 'r', state: 'OPEN', labels: [], blocked_by: [] }]
				: []),
	)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('backlog_drive_named_rank.ranked — additions in rank order', () => {
	it('offers a priority:critical addition before a priority:high one added earlier', async () => {
		labelled({ 1: HIGH, 2: CRITICAL })

		expect(await ranked(['1', '2', '5', '6'], ahead(1, 2))).toStrictEqual(['2', '1', '5', '6'])
	})

	it('keeps additions of equal rank in the order they were added', async () => {
		labelled({ 3: HIGH, 1: HIGH, 2: CRITICAL })

		expect(await ranked(['3', '1', '2', '5'], ahead(3, 1, 2))).toStrictEqual(['2', '3', '1', '5'])
	})

	it('keeps an unreadable addition in the order it was added among its equals', async () => {
		labelled({ 2: CRITICAL })

		expect(await ranked(['99', '1', '2'], ahead(99, 1, 2))).toStrictEqual(['2', '99', '1'])
	})

	it('keeps an addition whose read is not JSON in the order it was added among its equals', async () => {
		labelled({ 2: CRITICAL })

		expect(await ranked([GARBLED, '1', '2'], ahead(98, 1, 2))).toStrictEqual(['2', GARBLED, '1'])
	})

	it('ranks the --no-priority chunk on its own, behind the declared issues', async () => {
		labelled({ 7: HIGH, 8: CRITICAL, 6: CRITICAL })

		expect(await ranked(['1', '5', '6', '7', '8'], [...ahead(1), ...behind(7, 8)])).toStrictEqual([
			'1',
			'5',
			'6',
			'8',
			'7',
		])
	})

	it('keeps the declared issues in their typed order, reading none of them', async () => {
		const read = labelled({ 6: CRITICAL })

		expect(await ranked(['5', '6', '1'], behind(1, 6))).toStrictEqual(['5', '6', '1'])
		expect(read).not.toHaveBeenCalled()
	})
})

describe('backlog_drive_named_rank.ranked — then gathered', () => {
	it('offers the additions in rank order, the declared issues after them', async () => {
		labelled({ 1: HIGH, 2: CRITICAL })
		const carry = carry_of(DECLARED, ahead(1, 2))

		expect(await gather(['1', '2', '5', '6'], carry)).toStrictEqual({
			offer: { verdict: 'run', issues: ['2', '1', '5', '6'], retries: 0 },
			passed: [],
		})
	})

	it('passes a higher-ranked addition whose blockers are unfinished and offers the next', async () => {
		labelled({ 21: CRITICAL, 1: HIGH })
		const carry = carry_of(DECLARED, ahead(1, Number(BLOCKED)))

		expect(await gather(['1', BLOCKED, '5', '6'], carry)).toStrictEqual({
			offer: { verdict: 'run', issues: ['1', '5', '6'], retries: 0 },
			passed: [BLOCKED],
		})
	})

	it('reads no addition while the allowance is held below its floor', async () => {
		const read = labelled({ 2: CRITICAL })

		vi.spyOn(backlog_drive_rate_limit, 'held').mockResolvedValue(WAIT)

		const added = ahead(1, 2)
		const carry = carry_of('backlogrun --only', added)

		expect(await gather(['1', '2'], carry)).toStrictEqual({
			offer: WAIT,
			passed: [],
		})
		expect(read).not.toHaveBeenCalled()
	})
})

describe('backlog_drive_named_offer.read — the run carry ranks the additions', () => {
	it('offers a critical addition before a high one added earlier', async () => {
		labelled({ 1: HIGH, 2: CRITICAL })
		const state = backlog_drive.initial_state([], new Date().toISOString())
		const context = { is_only: false, forwarded: [], owner: String(process.pid) }
		const carry = carry_of(DECLARED, ahead(1, 2))

		const { offer } = await backlog_drive_named_offer.read(carry, state, context)

		expect(offer).toMatchObject({ verdict: 'run', issues: ['2', '1', '5', '6'] })
	})
})
