import { agent_headless } from '#scripts/agent/agent-headless'
import { backlog_ready } from '#scripts/backlog/backlog-ready'
import { backlog_stalled_detect } from '#scripts/backlog/backlog-stalled-detect'
import { repo_party } from '#scripts/discovery/repo-party'
import { hook_decision } from '#scripts/josh/hook-decision'
import { session_language } from '#scripts/josh/session-language'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_handoff } from '#scripts/lane/lane-handoff'
import { lane_background } from '#scripts/rules/lane-background'
import { stop_rules } from '#scripts/rules/stop-rules'
import { run_carry, type CarryRead } from '#scripts/run/carry/run-carry'
import { run_cut } from '#scripts/run/cut/run-cut'
import { run_hold, type HoldRead } from '#scripts/run/hold/run-hold'
import { run_headless } from '#scripts/run/run-headless'
import { run_stranded_detect } from '#scripts/run/run-stranded-detect'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { stop_guard, write_stop_decision } from './stop-guard'

const SWITCH_KEY = stop_rules.SWITCH_ENV_KEY
const LANG_KEY = session_language.ENV_KEY
const UNREAD_TRANSCRIPT = 'transcript-not-read'

afterEach(() => {
	Reflect.deleteProperty(process.env, SWITCH_KEY)
	Reflect.deleteProperty(process.env, LANG_KEY)
	vi.restoreAllMocks()
})

describe('stop_guard — fail open', () => {
	it('returns no outcome on a payload that is not JSON', async () => {
		expect(await stop_guard.outcome_of('not json')).toEqual(stop_rules.NO_OUTCOME)
	})

	it('returns no outcome when the guard switch is off, before any world read', async () => {
		process.env[SWITCH_KEY] = 'off'
		const payload = JSON.stringify({
			transcript_path: UNREAD_TRANSCRIPT,
			stop_hook_active: true,
		})

		expect(await stop_guard.stop_outcome_for_payload(payload)).toEqual(stop_rules.NO_OUTCOME)
	})
})

const CARRY = run_carry.fresh_carry('backlogrun', run_carry.NO_OWNER, new Date())

// The two report checks of one stop on a repository whose carry record reads as `read`.
async function report_checks_on(read: CarryRead): Promise<ReadonlyArray<MockInstance>> {
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(process.cwd())
	vi.spyOn(run_carry, 'read_carry').mockReturnValue(read)
	const stall = vi.spyOn(backlog_stalled_detect, 'run_stall_check').mockResolvedValue(undefined)
	const strand = vi.spyOn(run_stranded_detect, 'run_stranded_check').mockResolvedValue(undefined)

	await write_stop_decision('not json')

	return [stall, strand]
}

// joshuafolkken/kit#2995: the stall and strand checks are about a carried run, so a stop without one
// pays for neither.
describe('write_stop_decision — the report checks are gated on a run record', () => {
	it.each<CarryRead>([{ kind: 'none' }, { kind: 'unreadable' }, { kind: 'expired', carry: CARRY }])(
		'runs neither check when the carry record reads as $kind',
		async (read) => {
			const [stall, strand] = await report_checks_on(read)

			expect(stall).not.toHaveBeenCalled()
			expect(strand).not.toHaveBeenCalled()
		},
	)

	it('runs neither check outside a repository', async () => {
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)
		const stall = vi.spyOn(backlog_stalled_detect, 'run_stall_check').mockResolvedValue(undefined)

		await write_stop_decision('not json')

		expect(stall).not.toHaveBeenCalled()
	})

	it('runs neither check, and still resolves, when the git read fails', async () => {
		vi.spyOn(run_carry, 'repository_directory').mockRejectedValue(new Error('not a git repository'))
		const stall = vi.spyOn(backlog_stalled_detect, 'run_stall_check').mockResolvedValue(undefined)

		await expect(write_stop_decision('not json')).resolves.toBeUndefined()
		expect(stall).not.toHaveBeenCalled()
	})

	it('runs both checks while a run is carried, handing the stall its ready ports', async () => {
		const [stall, strand] = await report_checks_on({ kind: 'carried', carry: CARRY })

		expect(run_carry.read_carry).toHaveBeenCalledWith(run_carry.carry_path(process.cwd()))
		expect(stall).toHaveBeenCalledWith(backlog_ready.DEFAULT_PORTS)
		expect(strand).toHaveBeenCalledOnce()
	})
})

// A quiet world: no hold, no cut, no backlog — so the reply is all that is judged.
function quiet_world(): void {
	vi.spyOn(backlog_stalled_detect, 'run_stall_check').mockResolvedValue(undefined)
	vi.spyOn(run_stranded_detect, 'run_stranded_check').mockResolvedValue(undefined)
	vi.spyOn(run_hold, 'worktree_directory').mockResolvedValue(undefined)
	vi.spyOn(run_hold, 'is_tree_dirty').mockResolvedValue(true)
	vi.spyOn(run_cut, 'carried_cut_sync').mockReturnValue(undefined)
	vi.spyOn(run_headless, 'must_keep_waiting').mockResolvedValue(false)
	vi.spyOn(run_headless, 'is_backlog_parent').mockResolvedValue(false)
	vi.spyOn(run_headless, 'is_headless').mockReturnValue(true)
	vi.spyOn(time_density_hook, 'read_tail').mockReturnValue('')
	vi.spyOn(repo_party, 'current_owner').mockReturnValue('joshuafolkken')
}

it('keeps a named epic session waiting when its child lane is in flight', async () => {
	quiet_world()
	vi.mocked(run_headless.must_keep_waiting).mockResolvedValue(true)
	const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	const payload = JSON.stringify({ transcript_path: UNREAD_TRANSCRIPT })

	await write_stop_decision(payload)

	expect(String(write.mock.calls[0]?.[0])).toContain('⛔ headless parent:')
})

// The stdout writes of one stop decision on `message`, in a session configured for `lang`.
async function decide_in(lang: string, message: string): Promise<Array<string>> {
	quiet_world()
	process.env[LANG_KEY] = lang
	const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	const payload = JSON.stringify({
		transcript_path: UNREAD_TRANSCRIPT,
		last_assistant_message: message,
	})

	await write_stop_decision(payload)

	return write.mock.calls.map((call) => String(call[0]))
}

// joshuafolkken/kit#2470: the configured language reaches both the check and the refusal's wording.
// `en` rather than the `ja` default, so a hard-coded default could not pass.
describe('write_stop_decision — the session language is wired', () => {
	beforeEach(() => {
		vi.spyOn(hook_decision, 'load_environment_file').mockReturnValue(undefined)
		// The suite may itself run inside a kit-launched agent, whose mark would stand the rule aside.
		vi.stubEnv(agent_headless.KEY, undefined)
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('sends back a Japanese reply in an en session, naming en', async () => {
		const written = await decide_in(
			'en',
			'ゲートは通過し、PR を作成しました。レビューで修正すべき指摘はありませんでした。',
		)

		expect(written.join('')).toContain('⛔ session language')
		expect(written.join('')).toContain('JOSH_SESSION_LANG: en')
	})

	it('lets an English reply in an en session stop', async () => {
		const written = await decide_in(
			'en',
			'The gate passed and the pull request is open; nothing is left to fix.',
		)

		expect(written).toEqual([])
	})
})

// The stdout writes of one stop decision in a lane child whose transcript tail has `pending` tasks.
async function decide_in_lane(pending: ReadonlyArray<string>): Promise<string> {
	quiet_world()
	vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(true)
	vi.spyOn(lane_background, 'pending_background_ids').mockReturnValue(pending)
	const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

	await write_stop_decision(JSON.stringify({ transcript_path: UNREAD_TRANSCRIPT }))

	return write.mock.calls.map((call) => String(call[0])).join('')
}

const HELD: HoldRead = {
	kind: 'held',
	hold: { issue: '2962', taken_at: '2026-10-03T00:00:00.000Z', pid: process.pid },
}

// The stdout writes of one stop decision on a held tree, with the ship hand-off reading `is_handed_off`.
async function decide_held(is_handed_off: boolean): Promise<string> {
	quiet_world()
	vi.spyOn(run_hold, 'worktree_directory').mockResolvedValue(process.cwd())
	vi.spyOn(run_hold, 'read_hold').mockReturnValue(HELD)
	vi.spyOn(lane_handoff, 'is_handed_off').mockReturnValue(is_handed_off)
	const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

	await write_stop_decision(JSON.stringify({ transcript_path: UNREAD_TRANSCRIPT }))

	return write.mock.calls.map((call) => String(call[0])).join('')
}

// joshuafolkken/kit#2962: the hand-off reading reaches the stop rule, so a handed-off lane stops quietly.
describe('write_stop_decision — the ship hand-off is wired', () => {
	beforeEach(() => {
		vi.spyOn(hook_decision, 'load_environment_file').mockReturnValue(undefined)
	})

	it('lets a held lane handed to the detached ship stop without a notify', async () => {
		expect(await decide_held(true)).toBe('')
	})

	it('still demands the notify on a held tree that was not handed off', async () => {
		expect(await decide_held(false)).toContain('mid-workflow stop notification')
	})
})

// joshuafolkken/kit#2704: the lane mark and the transcript's pending tasks both reach the stop rule.
describe('write_stop_decision — the lane background wait is wired', () => {
	beforeEach(() => {
		vi.spyOn(hook_decision, 'load_environment_file').mockReturnValue(undefined)
	})

	it('sends a lane child with a task still running back to wait', async () => {
		expect(await decide_in_lane(['bxj18z032'])).toContain(
			lane_background.LANE_BACKGROUND_STOP_REASON,
		)
	})

	it('lets a lane child with no task running stop', async () => {
		expect(await decide_in_lane([])).not.toContain(lane_background.LANE_BACKGROUND_STOP_REASON)
	})
})
