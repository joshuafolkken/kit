import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#7078: the failure guard's check of `main`. Green files nothing and the run goes on;
// red files one `run:solo` Issue, which holds every other launch until it merges, and a streak still red
// before the next merge files no second one.

const execa_mock = vi.hoisted(() => vi.fn())
const events_mock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execa: execa_mock }))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { current_events: events_mock },
}))

const { run_merge_health } = await import('./run-merge-health')

const CHILD = '7000'
const GREEN = { exitCode: 0, all: '' }
const RED = { exitCode: 1, all: 'gate failed' }
const FILE_COMMAND = 'issue:file'

function filings(): ReadonlyArray<unknown> {
	return execa_mock.mock.calls.filter((call) => (call[1] as Array<string>).includes(FILE_COMMAND))
}

beforeEach(() => {
	execa_mock.mockReset().mockResolvedValue(GREEN)
	events_mock.mockReset().mockResolvedValue([])
})

describe('run_merge_health.check', () => {
	it('answers green and files nothing when the gate passes on main', async () => {
		expect(await run_merge_health.check(CHILD)).toBe(true)
		expect(filings()).toHaveLength(0)
	})

	it('runs CI whole-tree verification rather than the changed-file gate', async () => {
		await run_merge_health.check(CHILD)

		expect(execa_mock).toHaveBeenCalledWith(
			'pnpm',
			['josh', 'gate', '--no-unit'],
			expect.objectContaining({ env: { CI: 'true' } }),
		)
		expect(execa_mock).toHaveBeenCalledWith('pnpm', ['josh', 'test:unit'], expect.anything())
	})

	it('answers green and files nothing when the second run passes', async () => {
		execa_mock.mockResolvedValueOnce(RED)

		expect(await run_merge_health.check(CHILD)).toBe(true)
		expect(filings()).toHaveLength(0)
	})

	it('files one run:solo Issue when the verification fails twice on main', async () => {
		execa_mock.mockResolvedValueOnce(RED).mockResolvedValueOnce(RED)

		expect(await run_merge_health.check(CHILD)).toBe(false)
		expect(filings()).toHaveLength(1)
		expect(execa_mock).toHaveBeenLastCalledWith(
			'pnpm',
			expect.arrayContaining([FILE_COMMAND, run_merge_health.TITLE, 'run:solo']),
			expect.anything(),
		)
	})
})

describe('run_merge_health.check — main red twice', () => {
	beforeEach(() => {
		execa_mock.mockResolvedValueOnce(RED).mockResolvedValueOnce(RED)
	})

	it('logs a refused filing to stderr', async () => {
		const error_mock = vi.spyOn(console, 'error').mockImplementation(vi.fn())

		execa_mock.mockResolvedValueOnce({ exitCode: 1, all: 'refused' })
		await run_merge_health.check(CHILD)

		expect(error_mock).toHaveBeenCalledWith(expect.stringContaining('refused'))
	})

	it('files no second Issue before the next merge', async () => {
		events_mock.mockResolvedValue([
			{ kind: 'filed', text: `#7100[bug][run] ${run_merge_health.TITLE}` },
		])

		await run_merge_health.check(CHILD)

		expect(filings()).toHaveLength(0)
	})

	it('files again once a merge followed the earlier filing', async () => {
		events_mock.mockResolvedValue([
			{ kind: 'filed', text: `#7100[bug][run] ${run_merge_health.TITLE}` },
			{ kind: 'merge', text: '#7100 merged' },
		])

		await run_merge_health.check(CHILD)

		expect(filings()).toHaveLength(1)
	})
})
