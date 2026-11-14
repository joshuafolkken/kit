import child_process from 'node:child_process'
import { temporary_directory } from '#tools/test/temporary-directory'
import { expect, test } from 'vitest'
import { backlog_measure_guard } from './backlog-measure-guard'
import { backlog_measure_schema, type MeasureBoundary } from './backlog-measure-schema'

const directory = temporary_directory()
const ENDPOINT = 'repos/owner/repository/issues'
const DISPATCH = 'lane:dispatch'
const SCENARIO = backlog_measure_schema.scenario_schema.parse({
	name: 'guard',
	mode: 'cold',
	repetitions: 1,
	reads: [],
	free_lanes: 1,
	live_get: [ENDPOINT],
})
const REFUSED = [
	['gh', ['api', ENDPOINT, '-X', 'POST']],
	['gh', ['issue', 'edit', '1', '--add-label', 'auto-ok']],
	['gh', ['api', 'graphql', '-f', 'query=mutation { x }']],
	['pnpm', ['josh', DISPATCH, '1']],
	['git', ['worktree', 'add', '/live', 'main']],
	['git', ['log', '--output=/live']],
]

test.each(REFUSED)('rejects a production write or worker: %s %j', (file, args) => {
	const root = directory('measure-guard-')

	expect(backlog_measure_guard.allowed([file, args, { cwd: root }], SCENARIO, root)).toBe(false)
})

test('keeps an explicitly allowed actual GET and refuses shell or outside cwd', () => {
	const root = directory('measure-read-')
	const args = ['api', SCENARIO.live_get[0]]

	expect(backlog_measure_guard.allowed(['gh', args, { cwd: root }], SCENARIO, root)).toBe(true)
	expect(
		backlog_measure_guard.allowed(['gh', args, { cwd: root, shell: true }], SCENARIO, root),
	).toBe(false)
	expect(backlog_measure_guard.allowed(['gh', args, { cwd: '/' }], SCENARIO, root)).toBe(false)
	expect(
		backlog_measure_guard.allowed(
			['gh', ['api', '--include', ENDPOINT, '--jq', '.'], { cwd: root }],
			SCENARIO,
			root,
		),
	).toBe(true)
})

test('blocks a native spawn and records the refusal before it can start a worker', () => {
	const records: Array<MeasureBoundary> = []
	const restore = backlog_measure_guard.install(SCENARIO, process.cwd(), records)

	try {
		expect(() => child_process.spawn('pnpm', ['josh', DISPATCH, '1'])).toThrow('refused')
		expect(records).toContainEqual(expect.objectContaining({ source: 'denied' }))
	} finally {
		restore()
	}
})
