import { agent_headless } from '#scripts/agent/agent-headless'
import { backlog_ready } from '#scripts/backlog/backlog-ready'
import { backlog_stalled_detect } from '#scripts/backlog/backlog-stalled-detect'
import { git_gh_repo } from '#scripts/gh/git-gh-repo'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { session_language } from '#scripts/josh/session-language'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_handoff } from '#scripts/lane/lane-handoff'
import { telegram_test } from '#scripts/notify/telegram-test'
import { lane_background } from '#scripts/rules/lane-background'
import { stop_rules } from '#scripts/rules/stop-rules'
import { stop_rules_fixture } from '#scripts/rules/stop-rules-fixture'
import { run_carry, type CarryRead } from '#scripts/run/carry/run-carry'
import { run_cut_report } from '#scripts/run/cut/run-cut-report'
import { run_hold, type HoldRead } from '#scripts/run/hold/run-hold'
import { run_hold_cli } from '#scripts/run/hold/run-hold-cli'
import { run_hold_session } from '#scripts/run/hold/run-hold-session'
import { run_headless } from '#scripts/run/run-headless'
import { run_stranded_detect } from '#scripts/run/run-stranded-detect'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { stop_guard, write_stop_decision } from './stop-guard'
import { stop_guard_fixture } from './stop-guard-fixture'

const SWITCH_KEY = stop_rules.SWITCH_ENV_KEY
const LANG_KEY = session_language.ENV_KEY
const { UNREAD_TRANSCRIPT, decide_in, quiet_world } = stop_guard_fixture

afterEach(() => {
	Reflect.deleteProperty(process.env, SWITCH_KEY)
	Reflect.deleteProperty(process.env, LANG_KEY)
	vi.unstubAllEnvs()
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
async function report_checks_on(
	read: CarryRead,
	is_owner_live = true,
): Promise<ReadonlyArray<MockInstance>> {
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(process.cwd())
	vi.spyOn(run_carry, 'read_carry').mockReturnValue(read)
	vi.spyOn(run_carry, 'is_owner_live').mockReturnValue(is_owner_live)
	const stall = vi.spyOn(backlog_stalled_detect, 'run_stall_check').mockResolvedValue(undefined)
	const strand = vi.spyOn(run_stranded_detect, 'run_stranded_check').mockResolvedValue(undefined)

	await write_stop_decision('not json')

	return [stall, strand]
}

// joshuafolkken/kit#2995: the stall and strand checks are about a carried run, so a stop without one
// pays for neither.
describe('write_stop_decision — the report checks are gated on a run record', () => {
	it.each<CarryRead>([{ kind: 'none' }, { kind: 'unreadable' }])(
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

	// joshuafolkken/kit#3687: a record no longer expires, so a crashed run's stands until a person
	// clears it — and its stall probe must not ride every stop in the repository meanwhile.
	it('leaves the stall probe out, and still asks the strand, when the record owner is gone', async () => {
		const [stall, strand] = await report_checks_on({ kind: 'carried', carry: CARRY }, false)

		expect(stall).not.toHaveBeenCalled()
		expect(strand).toHaveBeenCalledOnce()
	})
})

it('keeps a named epic session waiting when its child lane is in flight', async () => {
	quiet_world()
	vi.mocked(run_headless.must_keep_waiting).mockResolvedValue(true)
	const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	const payload = JSON.stringify({ transcript_path: UNREAD_TRANSCRIPT })

	await write_stop_decision(payload)

	expect(String(write.mock.calls[0]?.[0])).toContain('⛔ headless parent:')
})

// joshuafolkken/kit#2470: the configured language reaches both the check and the refusal's wording.
// `en` rather than the `ja` default, so a hard-coded default could not pass.
describe('write_stop_decision — the session language is wired', () => {
	beforeEach(() => {
		// The suite may itself run inside a kit-launched agent, whose mark would stand the rule aside.
		vi.stubEnv(agent_headless.KEY, undefined)
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('sends back a Japanese reply in an en session, naming en', async () => {
		const written = await decide_in(
			write_stop_decision,
			'en',
			'ゲートは通過し、PR を作成しました。レビューで修正すべき指摘はありませんでした。',
		)

		expect(written.join('')).toContain('⛔ session language')
		expect(written.join('')).toContain('JOSH_SESSION_LANG: en')
	})

	it('lets an English reply in an en session stop', async () => {
		const written = await decide_in(
			write_stop_decision,
			'en',
			'The gate passed and the pull request is open; nothing is left to fix.',
		)

		expect(written).toEqual([])
	})
})

// The stdout writes of one stop decision in a lane child whose transcript tail has `pending` tasks,
// with `arrange` laid over the quiet world.
async function decide_in_lane(
	pending: ReadonlyArray<string>,
	arrange: () => void = () => undefined,
): Promise<string> {
	quiet_world()
	vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(true)
	vi.spyOn(lane_background, 'pending_background_ids').mockReturnValue(pending)
	vi.spyOn(lane_background, 'pending_command_ids').mockReturnValue(pending)
	arrange()
	const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

	await write_stop_decision(JSON.stringify({ transcript_path: UNREAD_TRANSCRIPT }))

	return write.mock.calls.map((call) => String(call[0])).join('')
}

// A tail whose only unfinished tasks are subagents.
function no_command_pending(): void {
	vi.spyOn(lane_background, 'pending_command_ids').mockReturnValue([])
}

// A carried run whose strand check prints its skipped-notify line on stdout, as the #4091 one did.
function strand_prints_skip_line(): void {
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(process.cwd())
	vi.spyOn(run_carry, 'read_carry').mockReturnValue({ kind: 'carried', carry: CARRY })
	vi.spyOn(run_carry, 'is_owner_live').mockReturnValue(false)
	vi.spyOn(process.stderr, 'write').mockReturnValue(true)
	vi.spyOn(run_stranded_detect, 'run_stranded_check').mockImplementation(async () => {
		await Promise.resolve(process.stdout.write('🔕 planning notifications are not opted in\n'))
	})
}

const HELD: HoldRead = {
	kind: 'held',
	hold: { issue: '2962', taken_at: '2026-10-03T00:00:00.000Z', pid: process.pid },
}

// A quiet world on a tree held as `read`, whose transcript tail reads `tail`. The session is `en`
// and not headless, so the English decision reply passes the language rule whatever launched the suite.
function held_world(is_handed_off: boolean, tail: string, read: HoldRead): void {
	quiet_world()
	process.env[LANG_KEY] = 'en'
	vi.stubEnv(agent_headless.KEY, undefined)
	vi.mocked(time_density_hook.read_tail).mockReturnValue(tail)
	vi.spyOn(run_hold, 'worktree_directory').mockResolvedValue(process.cwd())
	vi.spyOn(run_hold, 'read_hold').mockReturnValue(read)
	vi.spyOn(run_hold_session, 'mark_notified').mockReturnValue(undefined)
	vi.spyOn(lane_handoff, 'is_handed_off').mockReturnValue(is_handed_off)
	vi.spyOn(git_gh_repo, 'repo_get_name_with_owner').mockResolvedValue('joshuafolkken/kit')
}

// The stdout writes of one stop decision on a tree held as `read`, with the ship hand-off reading
// `is_handed_off` and the hook's own notify sending, or failing when `is_send_failing`, over the
// transcript `tail`. The reply names a decision, so a held stop of this session's own is announced.
async function decide_held(
	is_handed_off: boolean,
	is_send_failing = false,
	tail = '',
	read: HoldRead = HELD,
): Promise<string> {
	held_world(is_handed_off, tail, read)
	const send = vi.spyOn(telegram_test, 'send_values')
	if (is_send_failing) send.mockRejectedValue(new Error('telegram down'))
	else send.mockResolvedValue(undefined)
	const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	const message = stop_rules_fixture.DECISION_MESSAGE

	await write_stop_decision(
		JSON.stringify({ transcript_path: UNREAD_TRANSCRIPT, last_assistant_message: message }),
	)

	return write.mock.calls.map((call) => String(call[0])).join('')
}

// joshuafolkken/kit#2962: the hand-off reading reaches the stop rule, so a handed-off lane stops quietly.
describe('write_stop_decision — the ship hand-off is wired', () => {
	it('lets a held lane handed to the detached ship stop without a notify', async () => {
		expect(await decide_held(true)).toBe('')
	})

	// joshuafolkken/kit#3919: the hook sends it itself and lets the stop through.
	it('sends the notify itself on a held tree that was not handed off', async () => {
		const written: unknown = JSON.parse(await decide_held(false))

		const [values] = vi.mocked(telegram_test.send_values).mock.calls[0] ?? []

		expect(written).toHaveProperty('systemMessage')
		expect(values?.['issue-url']).toBe('https://github.com/joshuafolkken/kit/issues/2962')
	})

	it('falls back to demanding the notify when the send fails', async () => {
		expect(await decide_held(false, true)).toContain('mid-workflow stop notification')
	})
})

// The cut tail is read from a typed prompt and a `run:cut` call whose result relaunched its successor.
const { BRANCH } = time_transcript_fixture
const PROMPT_LINE = time_transcript_fixture.prompt_line(0, BRANCH)
const RELAUNCHED_CUT_LINE = [
	time_transcript_fixture.josh_call_line(1, BRANCH, 'pnpm josh run:cut --impl 2962', 'call-cut'),
	time_transcript_fixture.result_line(
		2,
		BRANCH,
		'call-cut',
		`${run_cut_report.RELAUNCHED_CUT_MARKER}\ncut`,
	),
].join('\n')
// A turn that only printed the marker — a source read, a grep — relaunched nothing.
const QUOTED_MARKER_LINE = [
	time_transcript_fixture.josh_call_line(1, BRANCH, 'grep -rn cut-relaunched scripts', 'call-grep'),
	time_transcript_fixture.result_line(2, BRANCH, 'call-grep', run_cut_report.RELAUNCHED_CUT_MARKER),
].join('\n')

// joshuafolkken/kit#3936: the successor's resume clears the record before the old session's turn ends,
// so the record reads absent while the hold stands — the cut is read off the turn instead.
describe('write_stop_decision — a relaunched cut whose record the successor already cleared', () => {
	it('sends no notify and demands none when this turn relaunched the successor', async () => {
		const written = await decide_held(false, false, [PROMPT_LINE, RELAUNCHED_CUT_LINE].join('\n'))

		expect(written).toBe('')
		expect(telegram_test.send_values).not.toHaveBeenCalled()
	})

	it('still notifies when the relaunched cut belongs to an earlier turn', async () => {
		await decide_held(false, false, [RELAUNCHED_CUT_LINE, PROMPT_LINE].join('\n'))

		expect(telegram_test.send_values).toHaveBeenCalledOnce()
	})

	it('still notifies when this turn only printed the marker outside a run:cut call', async () => {
		await decide_held(false, false, [PROMPT_LINE, QUOTED_MARKER_LINE].join('\n'))

		expect(telegram_test.send_values).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#3961: another session's hold, and a pause already announced, send nothing.
describe('write_stop_decision — only this session’s unannounced pause is sent', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('neither notifies nor releases a clean tree another session holds', async () => {
		vi.stubEnv(agent_session_environment.AGENT_PID_KEY, String(process.pid))
		const release = vi.spyOn(run_hold_cli, 'run').mockResolvedValue(0)
		const foreign: HoldRead = { kind: 'held', hold: { ...HELD.hold, owner_pid: 1 } }

		const written = await decide_held(false, false, PROMPT_LINE, foreign)

		expect(written).toBe('')
		expect(telegram_test.send_values).not.toHaveBeenCalled()
		expect(release).not.toHaveBeenCalled()
	})

	it('sends nothing when the hold records a send after the last prompt', async () => {
		const notified: HoldRead = {
			kind: 'held',
			hold: { ...HELD.hold, notified_at: '2099-01-01T00:00:00.000Z' },
		}

		await decide_held(false, false, PROMPT_LINE, notified)

		expect(telegram_test.send_values).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#2704: the lane mark and the transcript's pending tasks both reach the stop rule.
describe('write_stop_decision — the lane background wait is wired', () => {
	it('sends a lane child with a task still running back to wait', async () => {
		expect(await decide_in_lane(['bxj18z032'])).toContain(
			lane_background.LANE_BACKGROUND_STOP_REASON,
		)
	})

	// joshuafolkken/kit#4803: with no command left, the refusal names the wait that receives the answer.
	it('sends a lane child with only a subagent running to the subagent wait', async () => {
		const written = await decide_in_lane(['ac544c5a36c3f6f13'], no_command_pending)

		expect(written).toContain(lane_background.LANE_AGENT_STOP_REASON)
	})

	it('lets a lane child with no task running stop', async () => {
		const written = await decide_in_lane([])

		expect(written).not.toContain(lane_background.LANE_BACKGROUND_STOP_REASON)
		expect(written).not.toContain(lane_background.LANE_AGENT_STOP_REASON)
	})

	// joshuafolkken/kit#4101: the strand check's skipped-notify line went out ahead of the #4091 child's
	// refusal, and the harness dropped the block it could no longer parse.
	it('keeps what the report checks print off stdout, so the refusal is the whole of it', async () => {
		const written = await decide_in_lane(['b21bxb7uh'], strand_prints_skip_line)

		expect(JSON.parse(written)).toHaveProperty('decision', 'block')
	})
})
