import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { backlog_drive } from '#scripts/backlog/backlog-drive'
import { backlog_drive_named_offer } from '#scripts/backlog/backlog-drive-named-offer'
import { gh_core_rate_limit } from '#scripts/gh/gh-core-rate-limit'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_board_roots } from '#scripts/run/board/run-board-roots'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_carry_cli } from '#scripts/run/carry/run-carry-cli'
import { run_carry_cli_fixture } from '#scripts/run/carry/run-carry-cli-fixture'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_headless } from '#scripts/run/run-headless'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, expect, test, vi, type MockInstance } from 'vitest'
import { run_wake } from './run-wake'
import type { WakeContext } from './run-wake-describe'
import { run_wake_loop } from './run-wake-loop'
import { run_wake_ports } from './run-wake-ports'
import { run_wake_restart } from './run-wake-restart'
import { run_wake_session } from './run-wake-session'

const make_directory = temporary_directory()
const PROFILE = agent_role_profile.OPENAI_PROFILES.scheduler
const INVOCATION = 'backlogrun --max 5 --idle 30'
const SID = '11111111-1111-4111-8111-111111111111'
const scratch = { directory: '' }
const NAMED_RUN = 'backlogrun #101 #102 --max 5 --idle 30 --only'
const SECOND_WAIT = 2
const SUCCESS_EVENT = '{"type":"turn.completed"}\n'
const FAILED_EVENT = '{"type":"turn.failed","error":{"message":"quota exhausted"}}\n'
const FAILURE_REASON = 'quota exhausted'
const MISSING_CARRY = 'Missing carry'

function context(): WakeContext {
	return {
		carry_target: path.join(scratch.directory, 'carry.json'),
		ended_target: path.join(scratch.directory, 'ended.json'),
		wake_target: path.join(scratch.directory, 'wake.json'),
		log_target: path.join(scratch.directory, 'wake.log'),
		event_target: path.join(scratch.directory, 'events.jsonl'),
		git_directory: path.join(scratch.directory, '.git'),
		worktree: scratch.directory,
	}
}

function ports(): ReturnType<typeof run_wake_ports.ports_for> {
	return run_wake_ports.ports_for(context(), PROFILE)
}

beforeEach(() => {
	scratch.directory = make_directory('josh-wake-codex-')
	run_carry.begin_carry(context().carry_target, INVOCATION, { provider: 'openai' })
	vi.spyOn(run_wake_session, 'wake_argv').mockReturnValue({
		kind: 'argv',
		argv: { command: 'codex', args: ['exec'], ends_with_prompt: true },
		profile: PROFILE,
	})
	vi.spyOn(run_wake_session, 'launch').mockReturnValue({ kind: 'launched', pid: process.ppid })
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

test('tracks a Codex judgment through its launched process during a long silent turn (ac-20a647f6)', () => {
	ports().hand_off(SID)
	ports().wake(INVOCATION, SID, 'judge')

	expect(ports().is_owner_live(ports().read_carry())).toBe(true)
	expect(ports().read_carry()).toMatchObject({ carry: { owner_pid: process.ppid } })
})

test('authenticates the launched Codex session without accepting a foreign owner', () => {
	ports().hand_off(SID)
	ports().wake(INVOCATION, SID, 'judge')
	vi.stubEnv('JOSH_CARRY_SESSION', SID)
	const read = ports().read_carry()
	if (read.kind !== 'carried') throw new Error(MISSING_CARRY)

	expect(run_carry.is_count_refused(read.carry, run_carry.session_owner())).toBe(false)
	vi.stubEnv('JOSH_CARRY_SESSION', 'another-session')
	expect(run_carry.is_count_refused(read.carry, run_carry.session_owner())).toBe(true)
})

test('recovers a completed legacy pid-less judgment even with an exhausted wake mark', () => {
	const legacy = { provider: 'openai', is_headless: true } as const
	const carry = run_carry.begin_carry(
		path.join(scratch.directory, 'legacy.json'),
		INVOCATION,
		legacy,
	)

	stamp_file.replace_stamp(context().carry_target, carry)
	const wake = {
		...run_wake.fresh_wake(INVOCATION, new Date(), PROFILE),
		woke_at: '2020-01-01T00:00:00.000Z',
		attempts: run_wake.MAX_WAKE_ATTEMPTS,
		woke_pid: process.ppid,
	}

	run_wake.write_wake(context().wake_target, wake)
	writeFileSync(
		context().log_target,
		'=== 2020-01-01T00:00:00.000Z · started by process 1 ===\n{"type":"turn.completed"}\n',
	)
	vi.spyOn(process_identity, 'is_same_process').mockImplementation((pid) => pid === process.pid)

	expect(ports().read_carry()).toMatchObject({ carry: { is_handed_off: true, cuts: 1 } })
	expect(run_wake.read_wake(context().wake_target)).toMatchObject({ woke: 1 })
	expect(run_wake.read_wake(context().wake_target)?.woke_at).toBeUndefined()
})

function ended_log(text: string): void {
	writeFileSync(`${context().log_target}.${SID}`, text)
	vi.spyOn(process_identity, 'is_same_process').mockImplementation((pid) => pid === process.pid)
}

function authenticate_here(): void {
	vi.stubEnv('JOSH_CARRY_SESSION', SID)
	vi.stubEnv('JOSH_RUN_HEADLESS', '1')
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(scratch.directory)
	vi.spyOn(run_carry, 'carry_path').mockReturnValue(context().carry_target)
	vi.spyOn(run_event_setup, 'emit').mockResolvedValue()
	run_carry_cli_fixture.hold_verdict()
}

test('counts from the authenticated CLI and hands back at normal turn end', async () => {
	ports().hand_off(SID)
	ports().wake(INVOCATION, SID, 'judge')
	authenticate_here()

	expect(await run_carry_cli.run(['--resume', INVOCATION])).toBe(0)
	expect(ports().read_carry()).toMatchObject({ carry: { owner_pid: process.ppid } })
	expect(await run_carry_cli.run(['--done', '101'])).toBe(0)
	expect(await run_headless.hand_back_at_turn_end()).toBe(false)
	expect(ports().read_carry()).toMatchObject({
		carry: { done: [101], cuts: 1, is_handed_off: true },
	})
})

test.each([undefined, true])(
	'keeps an unknown or live execution without a duplicate wake (%s)',
	(live) => {
		ports().hand_off(SID)
		ports().wake(INVOCATION, SID, 'judge')
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(live)

		expect(ports().is_owner_live(ports().read_carry())).toBe(true)
		expect(ports().session_failure?.()).toBeUndefined()
	},
)

test('does not consume a result from another launch generation', () => {
	ports().hand_off(SID)
	ports().wake(INVOCATION, SID, 'judge')
	writeFileSync(context().log_target, SUCCESS_EVENT)
	ended_log(FAILED_EVENT)

	expect(ports().read_carry()).toMatchObject({ carry: { is_handed_off: false } })
	expect(ports().session_failure?.()).toContain(FAILURE_REASON)
})

test('bounds restarts of an abnormal judgment without relaunching it (ac-d91f680f)', async () => {
	ports().hand_off(SID)
	ports().wake(INVOCATION, SID, 'judge')
	ended_log(FAILED_EVENT)
	run_wake.write_wake(context().wake_target, run_wake.fresh_wake(INVOCATION, new Date(), PROFILE))
	const production = {
		...ports(),
		retry_closes: async () => undefined,
		sleep: async () => undefined,
	}
	const stop = await run_wake_restart.supervise({
		pass: async () => await run_wake_loop.run_loop(context().wake_target, production, 0),
		is_resumable: () => true,
		pause: async () => undefined,
		note: () => undefined,
	})

	expect(stop.reason).toBe('failed')
	expect(stop.note).toContain(FAILURE_REASON)
	expect(stop.note).toContain(`after ${String(run_wake_restart.RESTART_LIMIT)} automatic restarts`)
	expect(run_wake_session.launch).toHaveBeenCalledOnce()
})

async function select_after_resume(args: ReadonlyArray<string>): Promise<JoshResult> {
	const read = ports().read_carry()
	if (read.kind !== 'carried') throw new Error('Missing resumed carry')
	expect(args).toEqual(
		expect.arrayContaining(['--max', '5', '--idle', '30', '--only', '--exclude', '103']),
	)
	expect(read.carry).toMatchObject({ invocation: NAMED_RUN, done: [101], merged: 1 })
	const selected = await backlog_drive_named_offer.read(
		read.carry,
		backlog_drive.initial_state([], read.carry.started_at),
		{ is_only: true, forwarded: ['--max', '5'], owner: String(process.pid) },
	)

	expect(selected.offer).toMatchObject({ verdict: 'run', issues: ['102'] })
	run_carry.end_carry(context().carry_target)

	return { code: 0, out: 'stop' }
}

function orchestration_driver(): MockInstance<typeof josh_command.josh_run> {
	vi.spyOn(run_event_setup, 'emit').mockResolvedValue()
	vi.spyOn(gh_core_rate_limit, 'read_core').mockResolvedValue(undefined)
	vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({
		kind: 'state',
		state: { state: 'OPEN', labels: ['auto-ok', 'run:lane'], is_human_review: false },
	})

	return vi
		.spyOn(josh_command, 'josh_run')
		.mockResolvedValueOnce({ code: 0, out: 'watch\nresume: --owner 1 --exclude 103' })
		.mockImplementation(select_after_resume)
}

test('resumes the driver and selects its queued fixture (ac-6398dd1a) (ac-67545614)', async () => {
	const read = ports().read_carry()
	if (read.kind !== 'carried') throw new Error(MISSING_CARRY)
	stamp_file.replace_stamp(context().carry_target, {
		...read.carry,
		invocation: NAMED_RUN,
		done: [101],
		merged: 1,
	})
	run_wake.write_wake(context().wake_target, run_wake.fresh_wake(NAMED_RUN, new Date(), PROFILE))
	const driver = orchestration_driver()
	let waits = 0
	const production = {
		...ports(),
		new_session_id: () => SID,
		retry_closes: async () => undefined,
		sleep: async () => {
			waits += 1
			expect(waits).toBeLessThanOrEqual(SECOND_WAIT)
			if (waits === SECOND_WAIT) ended_log(SUCCESS_EVENT)
		},
		now: () => new Date(Date.now() + waits * run_wake.WAKE_GRACE_MS),
	}

	expect(await run_wake_loop.run_loop(context().wake_target, production, 0)).toMatchObject({
		reason: 'ended',
	})
	expect(driver).toHaveBeenCalledTimes(SECOND_WAIT)
	expect(run_wake_session.launch).toHaveBeenCalledOnce()
})

test('supplies an active board session only for the matching live generation (ac-f5d68a18)', () => {
	ports().hand_off(SID)
	ports().wake(INVOCATION, SID, 'judge')
	const read = ports().read_carry()

	expect(run_board_roots.session_is_active(context().git_directory, read, () => true)).toBe(true)
	expect(run_board_roots.session_is_active(context().git_directory, read, () => false)).toBe(false)
	ended_log(SUCCESS_EVENT)
	expect(
		run_board_roots.session_is_active(context().git_directory, ports().read_carry(), () => true),
	).toBe(false)
})

test.each(['', '{"type":"turn.failed"}\n'])(
	'keeps an ended execution without successful evidence failed: %s',
	(output) => {
		ports().hand_off(SID)
		ports().wake(INVOCATION, SID, 'judge')
		ended_log(output)

		expect(ports().read_carry()).toMatchObject({ carry: { is_handed_off: false, cuts: 0 } })
		expect(ports().session_failure?.()).toContain('without a successful result')
	},
)
