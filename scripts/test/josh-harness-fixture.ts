import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_location_environment } from '#scripts/git/git-location-environment'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { run_carry } from '#scripts/run/run-carry'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { josh_harness, type EnvironmentKind, type JoshEnvironment } from './josh-harness'

// The harness suites are split by the environments they open (joshuafolkken/kit#3083): each file
// pays only for its own, and the files run in parallel instead of one file holding the unit suite's
// critical path. What they share lives here, so no suite carries its own copy.

// Real subprocesses in real directories: each spawn pays a tsx cold start, and the gate scenarios run
// a whole gate, so the budgets are the harness's rather than the unit suite's 10 s default.
const SETUP_TIMEOUT_MS = 30_000
const SCENARIO_TIMEOUT_MS = 60_000
const GATE_TIMEOUT_MS = 180_000

const RECORD = 'review:record'
const DECOY_DIRECTORY = 'decoy-bin'
const DECOY_EXIT_CODE = 97
const EXECUTABLE_MODE = 0o755
const ROUND_ISSUE = 101

type FixtureKind = Exclude<EnvironmentKind, 'packed'>
type EnvironmentLookup = (kind: FixtureKind) => JoshEnvironment

// After each test, kills every process tree the test left running (joshuafolkken/kit#3309). A test
// vitest timed out is still awaiting its child, so the leftovers are named in the failure — the
// command and how long it ran — rather than writing on into a workspace about to be removed.
function stop_leftovers_after_each(): void {
	afterEach(() => {
		const leftovers = josh_harness.stop_all()

		if (leftovers.length > 0) {
			throw new Error(`harness subprocesses were still running:\n${leftovers.join('\n')}`)
		}
	})
}

// Opens one environment per kind before the file's tests and removes them all after. The map is the
// calling file's own, so a worker that runs several files without isolation never shares one.
function open_environments(kinds: ReadonlyArray<FixtureKind>): EnvironmentLookup {
	const environments = new Map<FixtureKind, JoshEnvironment>()

	beforeAll(async () => {
		// eslint-disable-next-line no-await-in-loop -- a failed open leaves the earlier environments registered for afterAll
		for (const kind of kinds) environments.set(kind, await josh_harness.open_environment(kind))
	}, SETUP_TIMEOUT_MS)

	stop_leftovers_after_each()

	afterAll(() => {
		josh_harness.stop_all()
		for (const opened of environments.values()) josh_harness.close_environment(opened)
	})

	return function environment(kind: FixtureKind): JoshEnvironment {
		const found = environments.get(kind)
		if (found === undefined) throw new Error(`no ${kind} environment was opened`)

		return found
	}
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

function ledger_at(directory: string, issue: number): string {
	return path.join(directory, observation_ledger.ledger_file(issue))
}

function ledger_text(directory: string, issue: number): string {
	return readFileSync(ledger_at(directory, issue), 'utf8')
}

async function carry_target(opened: JoshEnvironment): Promise<string> {
	const { stdout } = await josh_harness.run_command('git', ['rev-parse', '--git-common-dir'], {
		cwd: opened.root,
		env: git_location_environment.location_free_environment(),
		timeout_ms: josh_harness.DEFAULT_TIMEOUT_MS,
	})

	return run_carry.carry_path(path.resolve(opened.root, stdout))
}

async function run_only_driver(opened: JoshEnvironment): Promise<void> {
	const target = await carry_target(opened)

	run_carry.begin_carry(target, 'backlogrun --only', run_carry.owner_of(process.pid))
	const result = await josh_harness.run(opened, [
		'backlog:drive',
		'--owner',
		String(process.pid),
		'--only',
	])

	expect(result.exit_code, `${result.stdout}\n${result.stderr}`).toBe(0)
	expect(result.stdout).toContain('stop')
	expect(run_carry.read_carry(target).kind).toBe('none')
}

async function record_round(opened: JoshEnvironment): Promise<void> {
	const issue = String(ROUND_ISSUE)

	const recorded = await josh_harness.run(opened, [RECORD, '--issue', issue])
	const checked = await josh_harness.run(opened, [RECORD, '--check', '--issue', issue])

	expect([recorded.exit_code, checked.exit_code]).toStrictEqual([0, 0])
	expect(ledger_text(opened.root, ROUND_ISSUE)).toContain(`#${issue}`)
}

// The gate runs its checks as `pnpm josh <check>` in the environment; a `josh` that resolved to a
// global install passed locally and was missing in CI. A decoy `josh` first on PATH that always
// fails stands in for both, so only the environment's own script can answer.
async function run_own_script(opened: JoshEnvironment): Promise<void> {
	const decoy_path = decoy_bin(opened.workspace)
	const result = await josh_harness.run_command('pnpm', ['josh', 'help'], {
		cwd: opened.root,
		env: { PATH: `${decoy_path}${path.delimiter}${process.env['PATH'] ?? ''}` },
		timeout_ms: josh_harness.DEFAULT_TIMEOUT_MS,
	})

	expect(result.exit_code, result.stderr).toBe(0)
}

// The scenarios every state-writing environment has to pass, registered once per kind by the file
// that opened it.
function describe_environment(kind: FixtureKind, environment: EnvironmentLookup): void {
	describe(`josh harness — the ${kind} environment`, () => {
		it(
			'finishes a supervised only-mode backlog through the real driver',
			async () => {
				await run_only_driver(environment(kind))
			},
			SCENARIO_TIMEOUT_MS,
		)
		it(
			'records a review round and finds it again',
			async () => {
				await record_round(environment(kind))
			},
			SCENARIO_TIMEOUT_MS,
		)
		it(
			'runs `pnpm josh` through its own script, not a `josh` on PATH',
			async () => {
				await run_own_script(environment(kind))
			},
			SCENARIO_TIMEOUT_MS,
		)
	})
}

const josh_harness_fixture = {
	GATE_TIMEOUT_MS,
	RECORD,
	SCENARIO_TIMEOUT_MS,
	SETUP_TIMEOUT_MS,
	carry_target,
	describe_environment,
	ledger_at,
	ledger_text,
	open_environments,
	stop_leftovers_after_each,
}

export type { EnvironmentLookup, FixtureKind }
export { josh_harness_fixture }
