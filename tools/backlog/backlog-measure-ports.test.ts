import { readFileSync } from 'node:fs'
import path from 'node:path'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { run_startup } from '#scripts/run/startup/run-startup'
import { temporary_directory } from '#tools/test/temporary-directory'
import { expect, test } from 'vitest'
import { backlog_measure_ports } from './backlog-measure-ports'
import { backlog_measure_schema, type MeasureBoundary } from './backlog-measure-schema'

const directory = temporary_directory()
const SCENARIO = backlog_measure_schema.scenario_schema.parse({
	name: 'ports',
	mode: 'cold',
	repetitions: 1,
	reads: [],
	free_lanes: 1,
})

test('substitutes a worker in its own destination and rejects duplicate startup', async () => {
	const root = directory('measure-workers-')
	const records: Array<MeasureBoundary> = []
	const ports = backlog_measure_ports.ports_of(SCENARIO, root, records)

	expect(await ports.launch('1')).toBe('launched')
	await expect(ports.launch('1')).rejects.toThrow('Duplicate worker')
	expect(readFileSync(path.join(root, '1'), 'utf8')).toBe('launched')
	expect(records).toEqual([{ attempt: '', source: 'replacement', operation: 'worker 1: launched' }])
})

test('keeps concurrent trial launch state independent', async () => {
	const roots = [directory('measure-a-'), directory('measure-b-')]
	const ports = roots.map((root) => backlog_measure_ports.ports_of(SCENARIO, root, []))

	expect(await Promise.all(ports.map(async (item) => await item.launch('1')))).toEqual([
		'launched',
		'launched',
	])
})

test('refuses a worker path that could escape the isolated destination', async () => {
	const ports = backlog_measure_ports.ports_of(SCENARIO, directory('measure-path-'), [])

	await expect(ports.launch('../outside')).rejects.toThrow('Invalid worker issue')
})

test('refuses an unspecified lifecycle boundary rather than running it', () => {
	const ports = backlog_measure_ports.ports_of(SCENARIO, directory('measure-lifecycle-'), [])

	expect(() => ports.retrospective()).toThrow(
		'Measurement reached an unspecified lifecycle boundary',
	)
})

test.each([
	['launched', 'done'],
	['waiting', 'waiting'],
	['failed', 'failed'],
])('persists a substitute %s outcome as a %s startup edge', async (outcome, edge) => {
	const root = directory('measure-edge-')
	const destination = path.join(root, 'startup.jsonl')
	const scenario = backlog_measure_schema.scenario_schema.parse({
		...SCENARIO,
		outcomes: { '1': outcome },
	})
	const ports = backlog_measure_ports.ports_of(scenario, path.join(root, 'workers'), [])

	await run_startup.within(
		{ run: 'test', attempt: 'test', destination },
		async () => await ports.launch('1'),
	)

	expect(lane_ledger.read_entries(destination)).toContainEqual(
		expect.objectContaining({ phase: 'simulated worker', issue: '1', edge }),
	)
})
