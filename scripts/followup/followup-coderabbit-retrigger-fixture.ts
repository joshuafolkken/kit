// cspell:words coderabbit coderabbitai
import { git_gh_command } from '#scripts/gh/git-gh-command'
import {
	parse_pr_state_snapshot,
	type PrStateSnapshot,
	type RollupCheck,
} from '#scripts/gh/git-pr-checks-parse'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { poll } from '#scripts/lib/poll'
import { afterEach, beforeEach, vi } from 'vitest'
import { followup_coderabbit_retrigger, type PullComment } from './followup-coderabbit-retrigger'
import { followup_coderabbit_wait, type CodeRabbitWait } from './followup-coderabbit-wait'

// The pull request comments, check reads and spies the `followup-coderabbit-retrigger*.test.ts` files
// share. Each test file mocks `parse_pr_state_snapshot` itself (`vi.mock` is hoisted per file).

const SECONDS = 1000
const SECONDS_PER_MINUTE = 60
const MARGIN_SECONDS = 15
const MINUTES = SECONDS_PER_MINUTE * SECONDS
const MARGIN = MARGIN_SECONDS * SECONDS
const NOTICE_AT = '2026-10-28T01:00:00Z'
const NOTICE_AT_MS = Date.parse(NOTICE_AT)
const BRANCH = '5289-lane'
const ONE_MINUTE = '**1 minute**'
const TWO_MINUTES = '**2 minutes**'
const RATE_LIMITED: RollupCheck = {
	name: 'CodeRabbit',
	status: 'pass',
	description: 'Rate limited',
}
const RUNNING: RollupCheck = { name: 'CodeRabbit', status: 'pending', description: 'In progress' }
const DONE: RollupCheck = { name: 'CodeRabbit', status: 'pass', description: 'Review completed' }

function notice(wait: string): string {
	return `> [!WARNING]\n> ## Rate limit exceeded\n>\n> Please wait ${wait} before requesting another review.`
}

function coderabbit(body: string, updated_at = NOTICE_AT): PullComment {
	return { body, author: { login: 'coderabbitai[bot]' }, updatedAt: updated_at }
}

function retrigger_at(updated_at: string): PullComment {
	return { body: followup_coderabbit_retrigger.RETRIGGER_BODY, updatedAt: updated_at }
}

function snapshot(check: RollupCheck): PrStateSnapshot {
	return { rollup: [check], merge_state_status: undefined, review_decision: undefined }
}

function wait_seeing(check: RollupCheck): CodeRabbitWait {
	const wait = followup_coderabbit_wait.new_wait()

	followup_coderabbit_wait.observe(wait, snapshot(check), 0)

	return wait
}

function comments_are(...comments: Array<PullComment>): void {
	vi.mocked(git_gh_command.pr_get_comments).mockResolvedValue(JSON.stringify(comments))
}

function checks_read(...checks: Array<RollupCheck>): void {
	for (const check of checks) {
		vi.mocked(parse_pr_state_snapshot).mockReturnValueOnce(snapshot(check))
	}
}

function use_run_spies(): void {
	beforeEach(() => {
		vi.spyOn(git_gh_command, 'pr_get_comments')
		vi.spyOn(git_gh_command, 'pr_comment').mockResolvedValue('')
		vi.spyOn(git_gh_command, 'pr_get_checks_snapshot').mockResolvedValue({
			pr_number: 1,
			snapshot_json: '{}',
		})
		vi.spyOn(poll, 'sleep').mockResolvedValue()
		vi.spyOn(lane_ledger_write, 'record_stage').mockResolvedValue()
		vi.spyOn(Date, 'now').mockReturnValue(NOTICE_AT_MS)
		vi.spyOn(console, 'info').mockImplementation(vi.fn())
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.mocked(parse_pr_state_snapshot).mockReset()
	})
}

const retrigger_fixture = {
	BRANCH,
	DONE,
	MARGIN,
	MINUTES,
	NOTICE_AT,
	NOTICE_AT_MS,
	ONE_MINUTE,
	RATE_LIMITED,
	RUNNING,
	SECONDS,
	TWO_MINUTES,
	checks_read,
	coderabbit,
	comments_are,
	notice,
	retrigger_at,
	snapshot,
	use_run_spies,
	wait_seeing,
}

export { retrigger_fixture }
