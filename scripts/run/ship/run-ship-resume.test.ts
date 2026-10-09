import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { josh_command } from '#scripts/josh/josh-run'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { run_ship_scoped as real_scoped } from './run-ship-scoped'
import type { ShipState } from './run-ship-stage'

const josh_run_mock = vi.hoisted(() => vi.fn<typeof josh_command.josh_run>())
const probe = vi.hoisted(() => ({
	read_state: vi.fn(),
	record_target: vi.fn(),
	repository_directory: vi.fn(),
}))
const emit_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('./run-ship-probe', () => ({ run_ship_probe: probe }))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: emit_mock },
}))
// The preflight's own branches are pinned in `run-ship-preflight.test.ts`; here it passes.
vi.mock('./run-ship-preflight', () => ({
	run_ship_preflight: { stage: vi.fn().mockResolvedValue({ code: 0, out: 'ready' }) },
}))
vi.mock('./run-ship-scoped', async (import_original) => {
	const actual = await import_original<{ run_ship_scoped: typeof real_scoped }>()
	const scoped_pair = vi
		.fn<typeof real_scoped.scoped_pair>()
		.mockResolvedValue({ code: 0, out: '' })

	// The real `scoped_gate` calls its own module's pair, so it is rebuilt around the mocked one.
	async function scoped_gate(): ReturnType<typeof real_scoped.scoped_gate> {
		return await actual.run_ship_scoped.run_phases([
			scoped_pair,
			async () => await josh_run_mock(['gate'], true),
		])
	}

	return { run_ship_scoped: { ...actual.run_ship_scoped, scoped_gate, scoped_pair } }
})
// The sync stage's merge of the default branch is pinned in `run-ship-sync.test.ts`; here it is
// current, so no test ever merges into the checkout it runs in.
vi.mock('#scripts/git/main-merge', () => ({
	main_merge: { merge: vi.fn().mockResolvedValue({ kind: 'current', branch: 'main' }) },
}))
vi.mock('#scripts/gh/git-gh-pr-read', () => ({
	git_gh_pr_read: { pr_get_merge_state: vi.fn().mockResolvedValue(undefined) },
}))
// Outside a lane, so a gate run inside a lane child never hands these ships to a real supervisor.
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: vi.fn().mockReturnValue(false) },
}))

const { run_ship_cli } = await import('./run-ship-cli')
const { run_ship_detach } = await import('./run-ship-detach')
const { run_ship_stage } = await import('./run-ship-stage')

// joshuafolkken/kit#2426: a ship re-run after it died resumes rather than restarts. The stage record is
// the real file module writing to a temp path, so each restart reads what the previous call left; the
// repository state and the four josh steps are the seams.

const OK = 0
const FAILED = 1
const TITLE = 'Make ship resumable #2426'
const REPORT = 'run:tail 2426'
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-ship-resume-'))
const NOTHING: ShipState = { is_committed: false, is_pushed: false, is_merged: false }
const COMMITTED: ShipState = { ...NOTHING, is_committed: true }
const SHIPPED: ShipState = { ...COMMITTED, is_pushed: true }
const MERGED: ShipState = { ...SHIPPED, is_merged: true }

const current = { target: '' }

function commands(): ReadonlyArray<string> {
	return josh_run_mock.mock.calls.map((call) => call[0].join(' '))
}

// The gate passes and the commit is refused, so the ship stops with its record kept.
function refuse_the_push(): void {
	josh_run_mock.mockResolvedValueOnce({ code: OK, out: '' }).mockResolvedValueOnce({
		code: FAILED,
		out: 'push rejected',
	})
}

async function ship_to_a_refused_push(): Promise<void> {
	refuse_the_push()
	await run_ship_cli.run([TITLE])
	emit_mock.mockClear()
}

function events(): ReadonlyArray<string> {
	return emit_mock.mock.calls.map((call) => `${String(call[0])} ${String(call[1])}`)
}

beforeEach(() => {
	current.target = path.join(TEMPORARY, `${randomUUID()}.json`)
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	emit_mock.mockReset()
	probe.record_target.mockResolvedValue(current.target)
	probe.read_state.mockResolvedValue(NOTHING)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	// A gate run by a detached ship supervisor inherits its mark; left set, `run` would hand control back.
	vi.stubEnv(run_ship_detach.SUPERVISED_KEY, undefined)
})

afterEach(() => {
	vi.unstubAllEnvs()
})

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

describe('josh ship — a restart with a record', () => {
	it('resumes after a failed followup without re-running the gate or the commit', async () => {
		josh_run_mock
			.mockResolvedValueOnce({ code: OK, out: '' })
			.mockResolvedValueOnce({ code: OK, out: '' })
			.mockResolvedValueOnce({ code: FAILED, out: 'CI red' })

		expect(await run_ship_cli.run([TITLE])).toBe(FAILED)

		josh_run_mock.mockClear()
		probe.read_state.mockResolvedValue(SHIPPED)

		expect(await run_ship_cli.run([TITLE])).toBe(OK)
		expect(commands()).toStrictEqual([`followup ${TITLE}`, REPORT])
	})

	it('clears the record once the report completes, so the next ship starts from the gate', async () => {
		await run_ship_cli.run([TITLE])

		expect(existsSync(current.target)).toBe(false)
	})

	it('keeps the record when a stage fails, naming the stopped step', async () => {
		refuse_the_push()

		expect(await run_ship_cli.run([TITLE])).toBe(FAILED)
		expect([...run_ship_stage.read_done(current.target)]).toStrictEqual([
			'preflight',
			'sync',
			'gate',
		])
	})
})

describe('josh ship — a restart with no record', () => {
	it('never commits twice: a committed tree resumes with the commit skipped', async () => {
		probe.read_state.mockResolvedValue(COMMITTED)

		await run_ship_cli.run([TITLE])

		expect(commands()[0]).toBe(`git -y --skip-commit ${TITLE}`)
	})

	it('never pushes twice: a pushed tree resumes with the commit and push skipped', async () => {
		probe.read_state.mockResolvedValue(SHIPPED)

		await run_ship_cli.run([TITLE])

		expect(commands()[0]).toBe(`git -y --skip-commit --skip-push ${TITLE}`)
	})

	it('never merges twice: a merged pull request resumes at the report', async () => {
		probe.read_state.mockResolvedValue(MERGED)

		expect(await run_ship_cli.run([TITLE])).toBe(OK)
		expect(commands()).toStrictEqual([REPORT])
	})

	it('still runs the gate on uncommitted work', async () => {
		josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: 'lint red' })

		expect(await run_ship_cli.run([TITLE])).toBe(FAILED)
		expect(commands()).toStrictEqual(['gate'])
	})
})

describe('josh ship — the stage trace on the event stream', () => {
	it('records each stage start and success, and each skip', async () => {
		probe.read_state.mockResolvedValue(MERGED)

		await run_ship_cli.run([TITLE])

		expect(events()).toStrictEqual([
			'ship-stage #2426 preflight skipped',
			'ship-stage #2426 sync skipped',
			'ship-stage #2426 gate skipped',
			'ship-stage #2426 commit skipped',
			'ship-stage #2426 followup skipped',
			'ship-stage #2426 report start report',
			'ship-stage #2426 report done report',
		])
	})

	it('records the failed stage', async () => {
		josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: 'lint red' })

		await run_ship_cli.run([TITLE])

		expect(events()).toStrictEqual([
			'ship-stage #2426 preflight start preflight',
			'ship-stage #2426 preflight done preflight',
			'ship-stage #2426 sync start preflight,sync',
			'ship-stage #2426 sync done preflight,sync',
			'ship-stage #2426 gate start preflight,sync,gate',
			'ship-stage #2426 gate failed preflight,sync,gate',
		])
	})
})

// joshuafolkken/kit#3552: every line carries the stages this attempt has started, never a passed-over one;
// the attempt outlives a supervisor that ended without a stop, and a stop ends it.
describe('josh ship — the attempt each stage line carries', () => {
	const resumed_only = 'ship-stage #2426 report done commit,followup,report'

	it('lists only the stages a resumed ship started', async () => {
		probe.read_state.mockResolvedValue(SHIPPED)

		await run_ship_cli.run([TITLE])

		expect(events().at(-1)).toBe(resumed_only)
	})

	it('keeps the stages a ship that ended without a stop started', async () => {
		await ship_to_a_refused_push()
		probe.read_state.mockResolvedValue(SHIPPED)

		await run_ship_cli.run([TITLE])

		expect(events().at(-1)).toBe(
			'ship-stage #2426 report done preflight,sync,gate,commit,followup,report',
		)
	})

	it('lists afresh after a supervised stop', async () => {
		vi.stubEnv(run_ship_detach.SUPERVISED_KEY, '1')
		await ship_to_a_refused_push()
		vi.stubEnv(run_ship_detach.SUPERVISED_KEY, undefined)
		probe.read_state.mockResolvedValue(SHIPPED)

		await run_ship_cli.run([TITLE])

		expect(events().at(-1)).toBe(resumed_only)
	})
})

describe('josh ship — the report', () => {
	it('shows a skipped stage under its header in the report', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		probe.read_state.mockResolvedValue(MERGED)
		await run_ship_cli.run([TITLE])

		expect(String(info.mock.calls[0]?.[0])).toContain('=== gate ===\nskipped — already done')
	})
})
