import { cost_cli } from '#scripts/cost-runtime/cost-cli'
import { git_command } from '#scripts/git/git-command'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_body_draft } from './run-ship-body-draft'
import { run_ship_cli } from './run-ship-cli'
import { run_ship_conflict_probe } from './run-ship-conflict-probe'
import { run_ship_detach } from './run-ship-detach'
import { run_ship_handover } from './run-ship-handover'
import { run_ship_pre_detach_timed } from './run-ship-pre-detach-timed'
import { run_ship_preflight } from './run-ship-preflight'
import { run_ship_probe } from './run-ship-probe'
import { run_ship_recorded_fixture } from './run-ship-recorded-fixture'
import { run_ship_wait_cli } from './run-ship-wait-cli'

// joshuafolkken/kit#5228: a passed preflight left the red pre-detach checks unrecorded, so `lane:stats`
// never counted the stop a red `test:pinned` made. The kinds themselves are pinned in
// `run-ship-pre-detach.test.ts`; here the checks are stubbed.

const OK = 0
const FAILED = 1
const ISSUE = 5228
const TITLE = `Record ship pre-detach stops on unpinned places #${String(ISSUE)}`
const UNPINNED = 'unpinned'
const PRE_DETACH = 'pre-detach'
const LIVE_EVIDENCE = 'live-evidence'

// The ship's record and the stages before the hand-off: a fresh record, a passing preflight and checks.
function stub_stages(): void {
	vi.spyOn(run_ship_body_draft, 'with_draft').mockImplementation(async (args) => args)
	vi.spyOn(run_ship_probe, 'record_target').mockResolvedValue(undefined)
	vi.spyOn(run_ship_probe, 'read_state').mockResolvedValue({
		is_committed: false,
		is_pushed: false,
		is_merged: false,
	})
	vi.spyOn(run_ship_handover, 'watch').mockResolvedValue(async () => false)
	vi.spyOn(run_ship_preflight, 'stage').mockResolvedValue({ code: OK, out: 'ready' })
	vi.spyOn(run_ship_pre_detach_timed, 'checks').mockResolvedValue({ code: OK, out: 'passed' })
	vi.spyOn(run_ship_conflict_probe, 'probe').mockResolvedValue(undefined)
	vi.spyOn(run_ship_detach, 'detach').mockResolvedValue({ verdict: 'launched', note: 'pid 1' })
}

beforeEach(() => {
	stub_stages()
	vi.spyOn(lane_ledger_write, 'record_stop').mockResolvedValue()
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
	run_ship_recorded_fixture.isolate()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('josh ship --detach — red pre-detach checks behind a passed preflight', () => {
	it('returns a scoped failure before conflict and pinned probes or a detached push', async () => {
		const failure = 'scripts/review-fix.test.ts:9: too many statements'

		vi.spyOn(run_ship_preflight, 'stage').mockResolvedValue({
			code: FAILED,
			out: failure,
			preconditions: [run_ship_preflight.SCOPED_PRECONDITION],
		})

		expect(await run_ship_cli.run([TITLE, '--detach', '--review'])).toBe(FAILED)
		expect(run_ship_conflict_probe.probe).not.toHaveBeenCalled()
		expect(run_ship_pre_detach_timed.checks).not.toHaveBeenCalled()
		expect(run_ship_detach.detach).not.toHaveBeenCalled()
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining(failure))
		expect(lane_ledger_write.record_stop).toHaveBeenCalledWith(
			expect.objectContaining({ preconditions: ['scoped'] }),
		)
	})

	it('records the stop under the preflight as unpinned', async () => {
		vi.spyOn(run_ship_pre_detach_timed, 'checks').mockResolvedValue({
			code: FAILED,
			out: 'unpinned scripts/a.ts:3',
			preconditions: [UNPINNED],
		})

		expect(await run_ship_cli.run([TITLE, '--detach', '--review'])).toBe(FAILED)
		expect(vi.mocked(lane_ledger_write.record_stop).mock.calls).toStrictEqual([
			[{ issue: ISSUE, reason: 'preflight', cause: 'check', preconditions: [UNPINNED] }],
		])
		expect(run_ship_detach.detach).not.toHaveBeenCalled()
	})

	it('records no stop when the checks passed too', async () => {
		expect(await run_ship_cli.run([TITLE, '--detach'])).toBe(OK)
		expect(lane_ledger_write.record_stop).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#5815: on a branch origin does not have, the launched detach waited live on it.
describe('josh ship --detach — a branch origin does not have', () => {
	it('detaches without a live wait from a session measured under the cut', async () => {
		vi.spyOn(git_command, 'branch').mockResolvedValue('observations/no-such-branch-5815')
		vi.spyOn(cost_cli, 'session_verdict').mockReturnValue('under')
		run_ship_recorded_fixture.isolate()
		const wait = vi.spyOn(run_ship_wait_cli, 'run').mockResolvedValue(OK)

		expect(await run_ship_cli.run([TITLE, '--detach'])).toBe(OK)
		expect(wait).not.toHaveBeenCalled()
		expect(console.info).toHaveBeenCalledWith('cost --cut: unmeasurable')
	})
})

// joshuafolkken/kit#4478: the preflight's refusal records the red checks' kinds beside its own.
describe('josh ship --detach — red pre-detach checks beside a refused preflight', () => {
	it('records the red pre-detach checks beside the unmet preconditions', async () => {
		vi.spyOn(run_ship_preflight, 'stage').mockResolvedValue({
			code: FAILED,
			out: 'refused',
			preconditions: [LIVE_EVIDENCE],
		})
		vi.spyOn(run_ship_pre_detach_timed, 'checks').mockResolvedValue({
			code: FAILED,
			out: 'red',
			preconditions: [PRE_DETACH, UNPINNED],
		})

		await run_ship_cli.run([TITLE, '--detach', '--review'])

		expect(vi.mocked(lane_ledger_write.record_stop).mock.calls[0]?.[0].preconditions).toStrictEqual(
			[LIVE_EVIDENCE, PRE_DETACH, UNPINNED],
		)
	})
})
