import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_location_environment } from '#scripts/git/git-location-environment'
import { file_map_stamp } from '#scripts/josh/file-map-stamp'
import { review_stamps } from '#scripts/review/review-stamps'
import { run_carry } from '#scripts/run/run-carry'
import { run_review_steps } from '#scripts/run/run-review-steps'
import { execaSync } from 'execa'
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
const GATE_PASSED = 'verification gate passed'
const RECORD = 'review:record'
const SETUP_FAILED = 'setup failed'
const DECOY_DIRECTORY = 'decoy-bin'
const DECOY_EXIT_CODE = 97
const EXECUTABLE_MODE = 0o755
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

// Inside the workspace, so closing the environment removes it.
function decoy_bin(workspace: string): string {
	const directory = path.join(workspace, DECOY_DIRECTORY)

	mkdirSync(directory, { recursive: true })
	writeFileSync(path.join(directory, 'josh'), `#!/bin/sh\nexit ${String(DECOY_EXIT_CODE)}\n`, {
		mode: EXECUTABLE_MODE,
	})

	return directory
}

function ledger_text(directory: string): string {
	return readFileSync(path.join(directory, LEDGER), 'utf8')
}

function carry_target(opened: JoshEnvironment): string {
	const git_directory = execaSync('git', ['rev-parse', '--git-common-dir'], {
		cwd: opened.root,
		env: git_location_environment.location_free_environment(),
	}).stdout

	return run_carry.carry_path(path.resolve(opened.root, git_directory))
}

function run_only_driver(kind: string): void {
	const opened = environment(kind)
	const target = carry_target(opened)

	run_carry.begin_carry(target, 'backlogrun --only', run_carry.owner_of(process.pid))
	const result = josh_harness.run(opened, [
		'backlog:drive',
		'--owner',
		String(process.pid),
		'--only',
	])

	expect(result.exit_code, `${result.stdout}\n${result.stderr}`).toBe(0)
	expect(result.stdout).toContain('stop')
	expect(run_carry.read_carry(target).kind).toBe('none')
}

beforeAll(async () => {
	for (const kind of KINDS) environments.set(kind, await josh_harness.open_environment(kind))
}, SETUP_TIMEOUT_MS)

afterAll(() => {
	for (const opened of environments.values()) josh_harness.close_environment(opened)
})

it('targets the fixture repository even when a push hook supplies GIT_DIR', () => {
	const kit = environment('kit')
	const consumer = environment('consumer')
	const previous = process.env['GIT_DIR']

	try {
		process.env['GIT_DIR'] = path.join(kit.root, '.git')
		expect(carry_target(consumer)).toBe(run_carry.carry_path(path.join(consumer.root, '.git')))
	} finally {
		if (previous === undefined) Reflect.deleteProperty(process.env, 'GIT_DIR')
		else process.env['GIT_DIR'] = previous
	}
})

describe.each(KINDS)('josh harness — the %s environment', (kind) => {
	it(
		'finishes a supervised only-mode backlog through the real driver',
		() => {
			run_only_driver(kind)
		},
		SCENARIO_TIMEOUT_MS,
	)
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

	// The gate runs its checks as `pnpm josh <check>` in the environment; a `josh` that resolved to a
	// global install passed locally and was missing in CI. A decoy `josh` first on PATH that always
	// fails stands in for both, so only the environment's own script can answer.
	it(
		'runs `pnpm josh` through its own script, not a `josh` on PATH',
		() => {
			const opened = environment(kind)
			const decoy_path = decoy_bin(opened.workspace)
			const result = execaSync('pnpm', ['josh', 'help'], {
				cwd: opened.root,
				env: { PATH: `${decoy_path}${path.delimiter}${process.env['PATH'] ?? ''}` },
				reject: false,
			})

			expect(result.exitCode, result.stderr).toBe(0)
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

describe('josh harness — detached consumer gate (#2573)', () => {
	it(
		'uses the consumer script when the lane has no kit source entry',
		async () => {
			const consumer = environment('consumer')

			expect(existsSync(path.join(consumer.root, 'scripts', 'josh', 'josh.ts'))).toBe(false)
			expect(josh_harness.run(consumer, ['lint:related']).exit_code).toBe(0)
			expect(josh_harness.run(consumer, ['test:related']).exit_code).toBe(0)
			const launched = run_review_steps.launch_gate(consumer.root)
			const log_path = run_review_steps.gate_log_path(consumer.root)
			const is_finished = await josh_harness.wait_for(
				() =>
					existsSync(log_path) &&
					/verification gate passed|verification gate failed|ELIFECYCLE/u.test(
						readFileSync(log_path, 'utf8'),
					),
				GATE_TIMEOUT_MS,
			)

			expect(launched.kind).toBe('launched')
			expect(is_finished, readFileSync(log_path, 'utf8')).toBe(true)
			expect(readFileSync(log_path, 'utf8')).toContain(GATE_PASSED)
		},
		GATE_TIMEOUT_MS,
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
			const record = file_map_stamp.create(review_stamps.GATE_PREFIX, kit.root).stamp_path()
			const gate = josh_harness.start(kit, ['gate', '--force'], GATE_TIMEOUT_MS)
			const is_marked = await josh_harness.wait_for(() => existsSync(marker), MARKER_WAIT_MS)
			const join = await josh_harness.start(kit, ['run:review', '--join'], GATE_TIMEOUT_MS)
			const gate_result = await gate

			// A green gate that withheld its record reads red to every join, race or not — asserted
			// before the join so that failure is told from the race and carries the gate's own output.
			expect(
				{ is_marked, exit_code: gate_result.exit_code, is_recorded: existsSync(record) },
				gate_result.stdout,
			).toStrictEqual({ is_marked: true, exit_code: 0, is_recorded: true })
			expect(join.exit_code, join.stdout).toBe(0)
			expect(join.stdout).toContain(GATE_GREEN)
		},
		GATE_TIMEOUT_MS,
	)
})
