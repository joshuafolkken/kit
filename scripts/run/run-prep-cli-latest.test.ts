import { git_stash } from '#scripts/git/stash/git-stash'
import { issue_read_cli } from '#scripts/issue/issue-read-cli'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_ship_preflight } from '#scripts/run/ship/run-ship-preflight'
import { latest_scope_cli } from '#scripts/version/latest-scope-cli'
import { latest_stamp } from '#scripts/version/latest-stamp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_investigation_record } from './run-investigation-record'
import { run_prep_cli } from './run-prep-cli'
import { run_prep_locate } from './run-prep-locate'
import { run_step } from './run-step'

const ISSUE = '6258'
const PRIMARY_CWD = '/Users/dev/kit'
const LANE_CWD = '/Users/dev/.kit-lanes/6258'

beforeEach(() => {
	vi.spyOn(issue_read_cli, 'read_block').mockResolvedValue({ kind: 'missing' })
	vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({
		kind: 'state',
		state: { state: 'OPEN', labels: [], is_human_review: false },
	})
	vi.spyOn(run_prep_locate, 'locate').mockResolvedValue('')
	vi.spyOn(run_ship_preflight, 'ahead').mockResolvedValue([])
	vi.spyOn(run_investigation_record, 'load').mockResolvedValue(undefined)
	vi.spyOn(git_stash, 'has_stashable_changes').mockResolvedValue(false)
})

beforeEach(() => {
	vi.spyOn(process, 'cwd').mockReturnValue(LANE_CWD)
	vi.spyOn(latest_stamp, 'read_stamp').mockReturnValue(undefined)
	vi.stubEnv(lane_child_marker.KEY, '')
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

async function prep_verdict(): Promise<string> {
	const reads = await run_prep_cli.gather(ISSUE)
	const parts = run_prep_cli.to_parts(ISSUE, reads)

	return run_step.pre_verdict({
		state: parts.state?.state,
		is_human_review: false,
		latest_scope: parts.latest_scope,
		has_changes: parts.has_changes,
	})
}

describe('run prep dependency scope across checkout contexts', () => {
	it('matches the update command in a directly invoked lane without a stamp', async () => {
		const reads = await run_prep_cli.gather(ISSUE)

		expect(reads.latest).toStrictEqual(latest_scope_cli.scope_decision())
		expect(reads.latest.scope).toBe(latest_scope_cli.SKIPPED_SCOPE)
		expect(latest_stamp.read_stamp).not.toHaveBeenCalled()
		expect(await prep_verdict()).toBe(run_step.IMPLEMENT)
	})

	it('leaves dependency preparation to the parent of a dispatched child', async () => {
		vi.stubEnv(lane_child_marker.KEY, ISSUE)
		const reads = await run_prep_cli.gather(ISSUE)

		expect(reads.latest.scope).toBe('not asked')
		expect(latest_stamp.read_stamp).not.toHaveBeenCalled()
		expect(await prep_verdict()).toBe(run_step.IMPLEMENT)
	})

	it('requires an update in a normal checkout without a stamp', async () => {
		vi.spyOn(process, 'cwd').mockReturnValue(PRIMARY_CWD)
		const reads = await run_prep_cli.gather(ISSUE)

		expect(reads.latest).toStrictEqual(latest_scope_cli.scope_decision())
		expect(reads.latest.scope).toBe(latest_scope_cli.REQUIRED_SCOPE)
		expect(await prep_verdict()).toBe(run_step.UPDATE_DEPS)
	})
})
