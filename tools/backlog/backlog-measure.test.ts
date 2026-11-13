import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { temporary_directory } from '#tools/test/temporary-directory'
import { execa } from 'execa'
import { afterEach, expect, test, vi } from 'vitest'
import { backlog_measure } from './backlog-measure'
import { backlog_measure_schema } from './backlog-measure-schema'

const directory = temporary_directory()
const REPETITIONS = 2
const TIMEOUT_MS = 30_000
const PARTS = 2
const RESULT_FILE = 'result-0.json'
const STATUS_FILE = 'status.json'
const INPUT_FILE = 'input.json'
const INPUT = {
	name: 'empty',
	mode: 'cold',
	repetitions: REPETITIONS,
	free_lanes: 1,
	reads: [
		{
			method: 'gh.issue_list_by_label_summary',
			args: ['auto-ok', 200],
			value: { json: '[]', is_capped: false },
		},
		{
			method: 'gh.issue_list_by_label',
			args: ['not-before', 200],
			value: { json: '[]', is_capped: false },
		},
	],
}

vi.mock('execa', async (importOriginal) => {
	const original = await importOriginal<{ execa: typeof execa }>()

	return { ...original, execa: vi.fn(original.execa) }
})

afterEach(() => vi.unstubAllEnvs())

function read_json(root: string, name: string): unknown {
	return JSON.parse(readFileSync(path.join(root, name), 'utf8'))
}

function assert_repetitions(root: string, mode: string): void {
	const trial = path.join(root, '0')

	if (mode === 'cold') {
		expect(readdirSync(root)).toEqual(['0', '1'])
		expect(read_json(trial, RESULT_FILE)).toMatchObject({ warmup: false })
	} else {
		expect(read_json(trial, RESULT_FILE)).toMatchObject({ warmup: true })
		expect(read_json(trial, 'result-2.json')).toMatchObject({ warmup: false })
	}
}

test('uses independent state and cache roots and clears carried scope and git location', () => {
	const environment = backlog_measure.environment('/measurement')

	expect(environment).toMatchObject({
		JOSH_TEMP_ROOT: '/measurement/state',
		XDG_CACHE_HOME: '/measurement/cache',
		JOSH_STARTUP_SCOPE: '',
		NODE_OPTIONS: '',
		GIT_DIR: undefined,
		GIT_WORK_TREE: undefined,
	})
	expect(backlog_measure.environment('/other')['JOSH_TEMP_ROOT']).not.toBe(
		environment['JOSH_TEMP_ROOT'],
	)
})

test('rejects an invalid input before starting a trial', async () => {
	await expect(backlog_measure.run({ repetitions: 0 })).rejects.toThrow()
})

test.each(['cold', 'warm'])(
	'executes %s repetitions in isolated processes with persisted raw records',
	async (mode) => {
		vi.stubEnv('TMPDIR', directory('measure-trials-'))
		const result = await backlog_measure.run({ ...INPUT, mode })
		const trial = path.join(result.root, '0')

		expect(result.succeeded).toBe(true)
		expect(execa).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(Array),
			expect.objectContaining({ extendEnv: false }),
		)
		expect(read_json(trial, STATUS_FILE)).toMatchObject({ status: 'completed', exit: 0 })
		assert_repetitions(result.root, mode)
		expect(readFileSync(path.join(trial, 'startup.jsonl'), 'utf8')).toContain('"attempt":"empty:0"')
	},
	TIMEOUT_MS,
)

test(
	'records an interrupted child as failed and retains its raw trial input',
	async () => {
		vi.stubEnv('TMPDIR', directory('measure-interrupted-'))
		const result = await backlog_measure.run({ ...INPUT, repetitions: 1, timeout_ms: 1 })
		const trial = path.join(result.root, '0')

		expect(result.succeeded).toBe(false)
		expect(read_json(trial, STATUS_FILE)).toMatchObject({ status: 'failed', timed_out: true })
		expect(read_json(trial, INPUT_FILE)).toMatchObject({ name: INPUT.name, timeout_ms: 1 })
	},
	TIMEOUT_MS,
)

test(
	'executes the documented one-candidate five-waiting recipe without tracker or worker effects',
	async () => {
		vi.stubEnv('TMPDIR', directory('measure-recipe-'))
		const document = readFileSync('docs/backlog-measurement.md', 'utf8')
		const input: unknown = JSON.parse(
			document.split('```json\n', PARTS)[1]?.split('```', 1)[0] ?? '',
		)
		const scenario = backlog_measure_schema.scenario_schema.parse(input)
		const result = await backlog_measure.run({ ...scenario, repetitions: 1 })

		expect(result.succeeded).toBe(true)
		expect(read_json(path.join(result.root, '0'), RESULT_FILE)).toMatchObject({
			result: { answer: { issues: ['901'] }, pass: { state: { in_flight: ['901'] } } },
		})
	},
	TIMEOUT_MS,
)

test.each([0, 1])('reports CLI success or interrupted failure with exit code %i', async (exit) => {
	const root = directory('measure-cli-')
	const input = path.join(root, INPUT_FILE)
	const scenario = { ...INPUT, repetitions: 1, timeout_ms: exit === 0 ? TIMEOUT_MS : 1 }

	writeFileSync(input, JSON.stringify(scenario))
	const child = await execa(
		process.execPath,
		[
			'--import',
			import.meta.resolve('tsx/esm'),
			fileURLToPath(new URL('backlog-measure.ts', import.meta.url)),
			input,
		],
		{ env: { TMPDIR: root }, reject: false, timeout: TIMEOUT_MS },
	)

	expect(child.exitCode).toBe(exit)
	expect(JSON.parse(child.stdout)).toMatchObject({ succeeded: exit === 0 })
})
