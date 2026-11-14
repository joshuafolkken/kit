import path from 'node:path'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { agent_safe_text } from '#scripts/agent/agent-safe-text'
import { document_section_cli } from '#scripts/document/document-section-cli'
import { josh_command } from '#scripts/josh/josh-run'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_step_section_driver } from '#scripts/run/run-step-section-driver'
import { run_step_section_table } from '#scripts/run/run-step-section-table'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { run_wake_driver } from './run-wake-driver'

const make_directory = temporary_directory()

const INVOCATION = 'backlogrun #2509 --max 5 --only'
const OUTPUT = 'merge over #2509\nresume: --owner 1 --exclude 2509'
const LONG_STDERR_REPEAT = 1000
// The claim's stage and the driver's run, ahead of whatever the result adds.
const HAND_OFF_STEPS = 2
const EPIC_OUTPUT = 'epic #1\nresume: --owner 1'
const WINDOW_OUTPUT = 'window\nresume: --owner 1'
const WINDOW_PASSES = 2
const BUSY_OUTPUT = 'merge busy #2509\nresume: --owner 1'
const TRIAGE_OUTPUT = 'triage\nresume: --owner 1'
const WATCH_OUTPUT = 'watch\nresume: --owner 1'
const OWNER = String(process.pid)
const BESIDE_NOTE = "the carry record stays the supervisor's"
const HAND_BACK = 'then end the turn, which hands the loop back'
const ALREADY_CLAIMED =
	"the carry record is already this session's, so run no pnpm josh run:carry --begin;"
const DEFAULT_NEXT = `${ALREADY_CLAIMED} act on the result by the sections below, ${HAND_BACK}`
const scratch = { directory: '', target: '' }

beforeEach(() => {
	scratch.directory = make_directory('josh-wake-driver-')
	scratch.target = path.join(scratch.directory, 'carry.json')
	run_carry.begin_carry(scratch.target, INVOCATION, run_carry.NO_OWNER, new Date())
	// The stage a claim writes goes to the checkout's own stream, which is a live run's: never from a test.
	vi.spyOn(run_event_setup, 'emit').mockResolvedValue()
})

afterEach(() => {
	vi.restoreAllMocks()
})

test('passes validated budget flags to the driver and leaves named issues in the carry record', () => {
	expect(run_wake_driver.driver_args(INVOCATION)).toStrictEqual([
		'backlog:drive',
		'--owner',
		String(process.pid),
		'--window',
		'5',
		'--max',
		'5',
		'--only',
	])
	expect(run_wake_driver.driver_args('backlogrun #2509 --evil')).toBeUndefined()
})

test('claims the carry record and supplies a judgment branch with its resume material', async () => {
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({
		code: 0,
		out: OUTPUT,
		err: 'budget spent',
	})

	const result = await run_wake_driver.drive(scratch.target)

	expect(result).toStrictEqual({
		kind: 'judgment',
		material: `Driver result: ${OUTPUT}\nNext: ${DEFAULT_NEXT}\n${run_step_section_driver.driver_sections('merge over #2509')}\nDetails: budget spent`,
	})
	expect(run_carry.read_carry(scratch.target)).toMatchObject({
		kind: 'carried',
		carry: { owner_pid: process.pid, is_handed_off: false },
	})
})

test.each(['anthropic', 'openai'] as const)(
	'keeps scheduler %s while the supervisor claims the driver window',
	async (provider) => {
		run_carry.end_carry(scratch.target)
		run_carry.begin_carry(scratch.target, INVOCATION, { provider })
		vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: OUTPUT })

		await run_wake_driver.drive(scratch.target)

		expect(run_carry.read_carry(scratch.target)).toMatchObject({
			carry: { owner_pid: process.pid, scheduler_provider: provider },
		})
	},
)

// joshuafolkken/kit#3696: the supervisor taking the run over is a stage `run:board` draws.
test('says the run is handing off once the claim holds, before the driver runs', async () => {
	const order: Array<string> = []

	vi.mocked(run_event_setup.emit).mockImplementation(async (text) => {
		order.push(text)
	})
	vi.spyOn(josh_command, 'josh_run').mockImplementation(async () => {
		order.push('driver')

		return { code: 0, out: OUTPUT }
	})

	await run_wake_driver.drive(scratch.target)

	expect(order.slice(0, HAND_OFF_STEPS)).toStrictEqual([
		run_event_setup.STAGE.HANDING_OFF,
		'driver',
	])
})

// joshuafolkken/kit#3731: a result only a session can act on is drawn as that, not as a run still
// handing off.
test('says the run waits on judgment once the driver hands an epic back', async () => {
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: EPIC_OUTPUT })

	expect(await run_wake_driver.drive(scratch.target)).toMatchObject({ kind: 'judgment' })
	expect(vi.mocked(run_event_setup.emit).mock.calls).toStrictEqual([
		[run_event_setup.STAGE.HANDING_OFF],
		[run_event_setup.STAGE.JUDGING],
	])
})

test('says nothing of a judgment when the driver failed', async () => {
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 1, out: 'error boom' })

	expect(await run_wake_driver.drive(scratch.target)).toMatchObject({ kind: 'failed' })
	expect(run_event_setup.emit).not.toHaveBeenCalledWith(run_event_setup.STAGE.JUDGING)
})

test('says nothing of a hand-off the driver could not claim', async () => {
	run_carry.end_carry(scratch.target)

	expect(await run_wake_driver.drive(scratch.target)).toMatchObject({ kind: 'failed' })
	expect(run_event_setup.emit).not.toHaveBeenCalled()
})

test('finishes without a judgment when the driver ends the carry record', async () => {
	vi.spyOn(josh_command, 'josh_run').mockImplementation(async () => {
		run_carry.end_carry(scratch.target)

		return { code: 0, out: 'stop\nresume: --owner 1' }
	})

	expect(await run_wake_driver.drive(scratch.target)).toStrictEqual({ kind: 'finished' })
	expect(run_event_setup.emit).not.toHaveBeenCalledWith(run_event_setup.STAGE.JUDGING)
})

test('hands on only the tail of a long stderr, after the verdict, resume line and epic note', () => {
	const result = run_wake_driver.driver_result(
		EPIC_OUTPUT,
		{ kind: 'none' },
		`${'early output\n'.repeat(LONG_STDERR_REPEAT)}why it stopped`,
	)

	expect(result.kind).toBe('judgment')
	if (result.kind !== 'judgment') return
	expect(result.material.length).toBeLessThan(agent_safe_text.MAX_PROMPT_LENGTH)
	expect(result.material).toMatch(
		/^Driver result: epic #1\nresume: --owner 1\nThe named item is an epic/u,
	)
	expect(result.material.endsWith('why it stopped')).toBe(true)
})

test('leads a failed drive note with the driver stdout error line, then the stderr tail', async () => {
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({
		code: 1,
		out: 'launch #3234\nerror spawn git ENOENT',
		err: `${'early output\n'.repeat(LONG_STDERR_REPEAT)}[ELIFECYCLE] Command failed`,
	})

	const result = await run_wake_driver.drive(scratch.target)

	expect(result.kind).toBe('failed')
	if (result.kind !== 'failed') return
	expect(result.note).toMatch(/^error spawn git ENOENT\n\.\.\. /u)
	expect(result.note.endsWith('[ELIFECYCLE] Command failed')).toBe(true)
	expect(result.note.length).toBeLessThan(agent_role_profile.MAX_VALUE_LENGTH)
})

test('falls back to the driver stdout when a failed drive printed no error line', async () => {
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 1, out: 'stop', err: '' })

	expect(await run_wake_driver.drive(scratch.target)).toStrictEqual({
		kind: 'failed',
		note: 'stop',
	})
})

test('refuses an incomplete driver result without waking an agent', () => {
	expect(run_wake_driver.driver_result('', { kind: 'none' })).toMatchObject({
		kind: 'failed',
	})
})

test('tells an epic judgment session how to advance the named carry', () => {
	const result = run_wake_driver.driver_result(EPIC_OUTPUT, { kind: 'none' })

	expect(result).toMatchObject({ kind: 'judgment' })
	if (result.kind !== 'judgment') return
	expect(result.material).toContain('run:carry --done <epic-number> before')
	expect(result.material).toContain('Follow backlogrun-steps.md named epic procedure')
})

test.each([
	['launch #2500\nresume: --owner 1', HAND_BACK],
	[
		'retrospective\nresume: --owner 1',
		'prints (the retrospective below), close it with pnpm josh run:carry --retrospective --summary "<result>", ',
	],
	[
		'merge human-review #2500\nresume: --owner 1',
		'stopped before its commit for a person (the section below)',
	],
	[EPIC_OUTPUT, 'follow the named-issue sections below'],
])('names the next move without a claim for a judgment branch: %j', (out, next) => {
	const result = run_wake_driver.driver_result(out, { kind: 'none' })

	expect(result.kind).toBe('judgment')
	if (result.kind !== 'judgment') return
	expect(result.material).toContain(`\nNext: ${ALREADY_CLAIMED} `)
	expect(result.material).not.toContain('--resume')
	expect(result.material.slice(result.material.indexOf('\nNext: '))).toContain(next)
})

// joshuafolkken/kit#5920: the woken session spends no `doc:section` turn — each governing section's
// text rides in the hand-off, after the next move and before the details.
test.each([
	...run_step_section_table.DRIVER_SECTIONS.map(
		([prefix, sections]) => [`${prefix}1`, sections] as const,
	),
	['offer', [{ document: 'backlogrun-steps.md', heading: 'The loop' }]] as const,
])('carries the governing sections of a %j hand-off', (verdict, sections) => {
	const result = run_wake_driver.driver_result(
		`${verdict}\nresume: --owner 1`,
		{ kind: 'none' },
		'x',
	)
	const material = result.kind === 'judgment' ? result.material : ''

	for (const section of sections) {
		const text = document_section_cli.section_text(section.document, section.heading)

		expect(text).toBeDefined()
		expect(material.indexOf(text ?? '')).toBeLessThan(material.indexOf('\nDetails: '))
		expect(material.indexOf(text ?? '')).toBeGreaterThan(material.indexOf('\nNext: '))
	}
})

async function no_pause(): Promise<void> {
	await Promise.resolve()
}

// joshuafolkken/kit#4509: a spent window goes back to the supervisor's pass boundary, where it checks
// its code, rather than being re-driven here.
test('releases a spent window to the supervisor instead of re-driving it', async () => {
	const subprocess = vi
		.spyOn(josh_command, 'josh_run')
		.mockResolvedValue({ code: 0, out: WINDOW_OUTPUT, err: 'observations:flush skipped: failed' })

	expect(await run_wake_driver.drive(scratch.target, no_pause)).toStrictEqual({ kind: 'released' })
	expect(await run_wake_driver.drive(scratch.target, no_pause)).toStrictEqual({ kind: 'released' })
	expect(subprocess).toHaveBeenCalledTimes(WINDOW_PASSES)
	expect(run_event_setup.emit).not.toHaveBeenCalledWith(run_event_setup.STAGE.JUDGING)
})

// joshuafolkken/kit#5516: the launched parent labels the pool while it plans, so a session woken for the
// same `triage` would label the same issues beside it.
test('leaves triage to the launched parent while it plans', async () => {
	const subprocess = vi
		.spyOn(josh_command, 'josh_run')
		.mockResolvedValue({ code: 0, out: TRIAGE_OUTPUT })
	const wait = vi.fn(no_pause)

	const result = await run_wake_driver.drive(scratch.target, wait, () => true)

	expect(result).toStrictEqual({ kind: 'released' })
	expect(subprocess).toHaveBeenCalledOnce()
	expect(wait).toHaveBeenCalledOnce()
	expect(run_event_setup.emit).not.toHaveBeenCalledWith(run_event_setup.STAGE.JUDGING)
})

// joshuafolkken/kit#7120: the triage session is woken beside the driver, so it is told the record
// stays the supervisor's rather than that it is already its own.
test('wakes a triage session beside the driver once no launched parent is planning', async () => {
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: TRIAGE_OUTPUT })

	const result = await run_wake_driver.drive(scratch.target, no_pause, () => false)
	const material = result.kind === 'triage' ? result.material : ''

	expect(result.kind).toBe('triage')
	expect(material).toContain(BESIDE_NOTE)
	expect(material).not.toContain(ALREADY_CLAIMED)
})

// joshuafolkken/kit#7506: a drain's retrospective session runs beside the driver, so the supervisor
// re-drives at once and an issue filed meanwhile is dispatched while the session still runs.
test('wakes a drain retrospective beside the driver, closed under the supervisor owner', async () => {
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: WATCH_OUTPUT })

	const result = await run_wake_driver.drive(scratch.target, no_pause)
	const material = result.kind === 'triage' ? result.material : ''

	expect(result.kind).toBe('triage')
	expect(material).toContain(BESIDE_NOTE)
	expect(material).toContain(`run:carry --retrospective --summary "<result>" --owner ${OWNER}`)
	expect(material).not.toContain(ALREADY_CLAIMED)
	expect(run_event_setup.emit).not.toHaveBeenCalledWith(run_event_setup.STAGE.JUDGING)
})

test.each(['merge busy #2509', 'merge retry #2509'])(
	're-drives a %j verdict instead of waking a session, then hands on the judgment',
	async (verdict) => {
		const subprocess = vi
			.spyOn(josh_command, 'josh_run')
			.mockResolvedValueOnce({ code: 0, out: `${verdict}\nresume: --owner 1` })
			.mockResolvedValueOnce({ code: 0, out: OUTPUT })

		const result = await run_wake_driver.drive(scratch.target, no_pause)

		expect(subprocess).toHaveBeenCalledTimes(2)
		expect(result).toMatchObject({ kind: 'judgment' })
		if (result.kind !== 'judgment') return
		expect(result.material).toMatch(/^Driver result: merge over #2509\n/u)
	},
)

test('wakes a session for the mechanical verdict once the re-drive limit is reached', async () => {
	const subprocess = vi
		.spyOn(josh_command, 'josh_run')
		.mockResolvedValue({ code: 0, out: BUSY_OUTPUT })

	const result = await run_wake_driver.drive(scratch.target, no_pause)

	expect(subprocess).toHaveBeenCalledTimes(run_wake_driver.RERUN_LIMIT + 1)
	expect(result).toMatchObject({ kind: 'judgment' })
})

test('does not re-drive once the carry record ends during the pause', async () => {
	const subprocess = vi
		.spyOn(josh_command, 'josh_run')
		.mockResolvedValue({ code: 0, out: BUSY_OUTPUT })

	const result = await run_wake_driver.drive(scratch.target, async () => {
		await Promise.resolve()
		run_carry.end_carry(scratch.target)
	})

	expect(subprocess).toHaveBeenCalledOnce()
	expect(result).toStrictEqual({ kind: 'released' })
})

test('does not re-drive a failed driver run', async () => {
	const subprocess = vi
		.spyOn(josh_command, 'josh_run')
		.mockResolvedValue({ code: 1, out: 'merge busy', err: '' })

	expect(await run_wake_driver.drive(scratch.target, no_pause)).toMatchObject({ kind: 'failed' })
	expect(subprocess).toHaveBeenCalledOnce()
})

test('does not take a live owner over on supervisor restart', async () => {
	run_carry.end_carry(scratch.target)
	run_carry.begin_carry(scratch.target, INVOCATION, run_carry.owner_of(process.ppid))
	const subprocess = vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: OUTPUT })

	expect(await run_wake_driver.drive(scratch.target)).toMatchObject({ kind: 'failed' })
	expect(subprocess).not.toHaveBeenCalled()
})

// joshuafolkken/kit#3701: a failed driver leaves the record adopted for this process and not handed
// off, and refusing that claim left the restarted supervisor with nothing it could drive.
test('claims a record this process already owns and drives it again', async () => {
	run_carry.end_carry(scratch.target)
	run_carry.begin_carry(scratch.target, INVOCATION, run_carry.owner_of(process.pid))
	const subprocess = vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: OUTPUT })

	expect(await run_wake_driver.drive(scratch.target)).toMatchObject({ kind: 'judgment' })
	expect(subprocess).toHaveBeenCalledOnce()
})
