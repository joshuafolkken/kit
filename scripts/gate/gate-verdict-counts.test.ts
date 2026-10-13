import { existsSync } from 'node:fs'
import { josh_verdict } from '#scripts/josh/josh-verdict'
import { NOTHING_TO_CHECK_MARKER, SKIP_MARKER } from '#scripts/test/skip-marker'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_test_fixture, type ExecaResult } from './gate-test-fixture'
import { project_checks } from './project-checks'

vi.mock('execa', () => ({
	execa: vi.fn(),
}))

vi.mock('./type-check-step', () => ({
	type_check_step: {
		resolve_type_check_args: async (): Promise<ReadonlyArray<string>> => ['josh', 'check'],
	},
}))

// The last line of `josh gate`, at the granularity a `basic` project's user reads it at: every check
// exits 0, and what tells a gate that checked something from one that checked nothing is the body each
// check printed. The verdict used to be the planned number of checks whichever it was.

const { verification_gate } = await import('./verification-gate')
const GATE_STEPS = await verification_gate.build_gate_steps('/project')
const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)

const { as_execa_implementation, capture_stdout, fake_result } = gate_test_fixture
const RECORDS = gate_test_fixture.suite_records('verdict-counts')
const STEP_TOTAL = GATE_STEPS.length
const RAN_BODY = 'All matched files use Prettier code style!'
const SKIP_NOTICE = `josh eslint: no ESLint configuration was found ${SKIP_MARKER} eslint.`
const PARTLY_SKIPPED = `Checking formatting...\n${RAN_BODY}\n${SKIP_NOTICE}\n`
const BANNER_AND_SKIP = `Warning: safe-chain is not available to protect you.\n${SKIP_NOTICE}\n`
const ALL_SKIPPED: ReadonlyArray<string> = GATE_STEPS.map(() => SKIP_NOTICE)
const NONE_SKIPPED: ReadonlyArray<string> = GATE_STEPS.map(() => RAN_BODY)
const SKIPPED_COUNT = 2
// What `exports` prints in every consumer and `behavior` prints with no transcript: neither is a skip,
// and neither looked at anything.
const NOTHING_TO_CHECK = `josh exports: checks only the kit repository itself — ${NOTHING_TO_CHECK_MARKER} in a consumer project.`
const IDLE_COUNT = 2

// What a spawned check's captured output really opens with: the gate runs each one as
// `pnpm josh <target>`, and pnpm prints the project's `josh` script ahead of whatever the check says.
// A body without it is a shape no real project produces.
function spawned_output(command_args: ReadonlyArray<string>, body: string): string {
	return `$ ${command_args.join(' ')}\n${body}`
}

function mock_bodies(bodies: ReadonlyArray<string>): void {
	async function fake_execa(_file: unknown, arguments_: unknown): Promise<ExecaResult> {
		const command_args = arguments_ as ReadonlyArray<string>
		const index = GATE_STEPS.findIndex((step) => step.command_args.at(-1) === command_args.at(-1))

		return fake_result(0, spawned_output(command_args, bodies[index] ?? ''))
	}

	mocked_execa.mockImplementation(as_execa_implementation(fake_execa))
}

async function run_gate(bodies: ReadonlyArray<string>): Promise<[number, string]> {
	mock_bodies(bodies)
	const stdout = capture_stdout()

	try {
		const code = await verification_gate.run_verification_gate(RECORDS)

		return [code, stdout.text().trimEnd().split('\n').at(-1) ?? '']
	} finally {
		stdout.restore()
	}
}

function with_first(body: string, count: number): ReadonlyArray<string> {
	return GATE_STEPS.map((_step, index) => (index < count ? body : RAN_BODY))
}

const live_runs = vi.spyOn(unit_worker_share, 'live_run_count')

beforeEach(() => {
	vi.clearAllMocks()
	live_runs.mockReturnValue(0)
	RECORDS.clear()
})

afterEach(RECORDS.clear)

describe('josh gate — the verdict of a gate whose every check was skipped', () => {
	it('says the gate is not verified rather than passed', async () => {
		const [, verdict] = await run_gate(ALL_SKIPPED)

		expect(verdict).toMatch(
			new RegExp(
				String.raw`^⚠ verification gate not verified \(0 ran, ${String(STEP_TOTAL)} skipped\) in`,
				'u',
			),
		)
		expect(verdict).not.toContain('passed')
	})

	it('still exits 0, since nothing to check is not a failure', async () => {
		const [code] = await run_gate(ALL_SKIPPED)

		expect(code).toBe(0)
	})

	it('is read as unverified, never as a passed gate', async () => {
		const [, verdict] = await run_gate(ALL_SKIPPED)

		expect(josh_verdict.read_verdict(verdict)).toBe(josh_verdict.UNVERIFIED_VERDICT)
	})

	it('writes no green record', async () => {
		await run_gate(ALL_SKIPPED)

		expect(existsSync(RECORDS.stamp_path)).toBe(false)
	})
})

describe('josh gate — the verdict of a gate whose checks all looked at nothing', () => {
	// The empty `basic` project the report came from: four checks skip, and `exports` and `behavior` run
	// with nothing to check. It read `passed (6 checks)`.
	it('does not count a check with nothing to check as one that ran', async () => {
		const bodies = GATE_STEPS.map((_step, index) =>
			index < IDLE_COUNT ? NOTHING_TO_CHECK : SKIP_NOTICE,
		)
		const [code, verdict] = await run_gate(bodies)

		expect(code).toBe(0)
		expect(verdict).toContain(`not verified (0 ran, ${String(STEP_TOTAL)} skipped)`)
	})

	// The script header alone is no notice: a check that said nothing is not one that said it skipped.
	it('counts a check that printed only the script header as one that ran', async () => {
		const bodies = GATE_STEPS.map((_step, index) => (index === 0 ? '' : SKIP_NOTICE))
		const [, verdict] = await run_gate(bodies)

		expect(verdict).toContain(`passed (1 ran, ${String(STEP_TOTAL - 1)} skipped)`)
	})

	it('counts a check as skipped behind the safe-chain banner', async () => {
		const [, verdict] = await run_gate(GATE_STEPS.map(() => BANNER_AND_SKIP))

		expect(josh_verdict.read_verdict(verdict)).toBe(josh_verdict.UNVERIFIED_VERDICT)
	})
})

describe('josh gate — the verdict of a gate that ran some of its checks', () => {
	it('names how many ran and how many were skipped', async () => {
		const [code, verdict] = await run_gate(with_first(SKIP_NOTICE, SKIPPED_COUNT))
		const ran = String(STEP_TOTAL - SKIPPED_COUNT)

		expect(code).toBe(0)
		expect(verdict).toContain(
			`✔ verification gate passed (${ran} ran, ${String(SKIPPED_COUNT)} skipped) in`,
		)
	})

	// A `basic` project's `lint` runs Prettier and skips eslint: something ran, so it is not counted
	// among the checks that ran nothing.
	it('counts a check that skipped only part of itself as one that ran', async () => {
		const [, verdict] = await run_gate(with_first(PARTLY_SKIPPED, STEP_TOTAL))

		expect(verdict).toContain(`✔ verification gate passed (${String(STEP_TOTAL)} checks) in`)
	})

	// A `basic` project with an ESLint configuration and no Web file: Prettier is skipped and a clean
	// eslint prints nothing of its own, so what `lint` says for it is the notice that it ran.
	it('counts a check whose one tool ran clean beside a skipped one as one that ran', async () => {
		const silent_tool = `${SKIP_NOTICE}\n${project_checks.ran_notice('eslint')}\n`
		const bodies = GATE_STEPS.map((_step, index) => (index === 0 ? silent_tool : SKIP_NOTICE))
		const [, verdict] = await run_gate(bodies)

		expect(verdict).toContain(`passed (1 ran, ${String(STEP_TOTAL - 1)} skipped)`)
	})

	// An ordinary consumer: `exports` has nothing to check on every run, and nothing was skipped.
	it('keeps the line of a gate whose only idle check is one with nothing to check', async () => {
		const [, verdict] = await run_gate(with_first(NOTHING_TO_CHECK, 1))

		expect(verdict).toContain(`✔ verification gate passed (${String(STEP_TOTAL)} checks) in`)
	})

	it('keeps the line a gate with no skip always printed', async () => {
		const [, verdict] = await run_gate(NONE_SKIPPED)

		expect(verdict).toMatch(/^✔ verification gate passed \(\d+ checks\) in \d+\.\ds\.$/u)
	})
})
