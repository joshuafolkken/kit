import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { file_map_stamp } from '#scripts/josh/file-map-stamp'
import { review_stamps } from '#scripts/review/review-stamps'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { josh_harness, type EnvironmentKind, type JoshEnvironment } from './josh-harness'

// Real subprocesses in real directories: each spawn pays a tsx cold start, and the gate scenario runs
// a whole gate, so the budgets are the harness's rather than the unit suite's 10 s default.
const SETUP_TIMEOUT_MS = 30_000
const SCENARIO_TIMEOUT_MS = 60_000
const GATE_TIMEOUT_MS = 180_000
const MARKER_WAIT_MS = 60_000

const LEDGER = path.join('docs', 'observations.md')
const GATE_GREEN = 'Gate green'
const RECORD = 'review:record'
const SETUP_FAILED = 'setup failed'
// The race runs in a kit environment of its own, so the ledger lines the other scenarios wrote are not
// part of the tree its gate checks.
const RACE = 'race'
const KINDS: ReadonlyArray<Exclude<EnvironmentKind, 'packed'>> = ['kit', 'consumer', 'lane']

const environments = new Map<string, JoshEnvironment>()

function environment(kind: string): JoshEnvironment {
	const found = environments.get(kind)
	if (found === undefined) throw new Error(`no ${kind} environment was opened`)

	return found
}

function ledger_text(directory: string): string {
	return readFileSync(path.join(directory, LEDGER), 'utf8')
}

beforeAll(async () => {
	for (const kind of KINDS) environments.set(kind, await josh_harness.open_environment(kind))
}, SETUP_TIMEOUT_MS)

afterAll(() => {
	for (const opened of environments.values()) josh_harness.close_environment(opened)
})

describe.each(KINDS)('josh harness — the %s environment', (kind) => {
	it(
		'records a review round and finds it again',
		() => {
			const opened = environment(kind)

			expect(josh_harness.run(opened, [RECORD, '--issue', '101']).exit_code).toBe(0)
			expect(josh_harness.run(opened, [RECORD, '--check', '--issue', '101']).exit_code).toBe(0)
			expect(ledger_text(opened.primary)).toContain('#101')
		},
		SCENARIO_TIMEOUT_MS,
	)
})

describe('josh harness — scenarios from past defects', () => {
	it(
		'records into a consumer that has no docs directory (#2402)',
		() => {
			const consumer = environment('consumer')
			const result = josh_harness.run(consumer, [RECORD, '--issue', '2402'])

			expect(result.exit_code).toBe(0)
			expect(result.stdout).toContain(path.join(consumer.root, LEDGER))
			expect(ledger_text(consumer.root)).toContain('#2402')
		},
		SCENARIO_TIMEOUT_MS,
	)

	it(
		'records a lane review round in the primary checkout, not the lane (#2419)',
		() => {
			const lane = environment('lane')
			const result = josh_harness.run(lane, [RECORD, '--issue', '2419'])

			expect(result.exit_code).toBe(0)
			expect(result.stdout).toContain(path.join(lane.primary, LEDGER))
			expect(ledger_text(lane.primary)).toContain('#2419')
			expect(existsSync(path.join(lane.root, LEDGER))).toBe(false)
		},
		SCENARIO_TIMEOUT_MS,
	)
})

describe('josh harness — the same command launched twice at once', () => {
	it(
		'keeps both lines',
		async () => {
			const kit = environment('kit')
			const results = await Promise.all([
				josh_harness.start(kit, [RECORD, '--issue', '201']),
				josh_harness.start(kit, [RECORD, '--issue', '202']),
			])

			expect(results.map((result) => result.exit_code)).toStrictEqual([0, 0])
			expect(ledger_text(kit.primary)).toContain('#201')
			expect(ledger_text(kit.primary)).toContain('#202')
		},
		SCENARIO_TIMEOUT_MS,
	)
})

describe('josh harness — a setup that fails', () => {
	it('removes its workspace and rethrows the error', async () => {
		const seen: Array<string> = []
		const failing = josh_harness.in_workspace((workspace) => {
			seen.push(workspace)
			throw new Error(SETUP_FAILED)
		})

		await expect(failing).rejects.toThrow(SETUP_FAILED)
		expect(seen).toHaveLength(1)
		expect(existsSync(seen[0] ?? '')).toBe(false)
	})
})

// #2434: a join that polled while the gate was recording green and clearing its marker saw neither,
// and called a green gate red. The join is launched only once the gate has marked itself running, so
// the two overlap for the whole of the gate's run — the window the race lived in. The tree carries a
// change because a green record is reused only for a tree that differs from its base, as a run's does.
describe('josh harness — the gate and its join race (#2434)', () => {
	beforeAll(async () => {
		const kit = await josh_harness.open_environment('kit')

		environments.set(RACE, kit)
		writeFileSync(path.join(kit.root, 'docs', 'change.md'), '# Change\n', 'utf8')
	}, SETUP_TIMEOUT_MS)

	it(
		'answers green when the join overlaps a gate that goes green',
		async () => {
			const kit = environment(RACE)
			const marker = file_map_stamp.create(review_stamps.IN_FLIGHT_PREFIX, kit.root).stamp_path()
			const gate = josh_harness.start(kit, ['gate', '--force'], GATE_TIMEOUT_MS)
			const is_marked = await josh_harness.wait_for(() => existsSync(marker), MARKER_WAIT_MS)
			const join = await josh_harness.start(kit, ['run:review', '--join'], GATE_TIMEOUT_MS)
			const gate_result = await gate

			expect(is_marked).toBe(true)
			expect(gate_result.exit_code, gate_result.stdout).toBe(0)
			expect(join.exit_code, join.stdout).toBe(0)
			expect(join.stdout).toContain(GATE_GREEN)
		},
		GATE_TIMEOUT_MS,
	)
})
