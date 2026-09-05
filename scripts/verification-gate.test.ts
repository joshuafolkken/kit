import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_plan, type GatePlan } from './gate-plan'
import { gate_test_fixture, type ExecaResult } from './gate-test-fixture'
import { josh_verdict } from './josh-verdict'
import { test_unit_guard } from './test-unit-guard'
import type { GateStep } from './verification-gate'

vi.mock('execa', () => ({
	execa: vi.fn(),
}))

// The per-project resolution of the type-check step is `type-check-step.test.ts`'s subject. Here it
// returns a value the default could never produce, so an assertion below fails if the gate stops
// asking the resolver and goes back to a hardcoded `josh check`.
const RESOLVED_TYPE_CHECK: ReadonlyArray<string> = ['josh-app', 'check:ci']

vi.mock('./type-check-step', () => ({
	type_check_step: {
		resolve_type_check_args: async (): Promise<ReadonlyArray<string>> => RESOLVED_TYPE_CHECK,
	},
}))

const PROJECT_ROOT = '/project'

const { verification_gate } = await import('./verification-gate')
const GATE_STEPS = await verification_gate.build_gate_steps(PROJECT_ROOT)
const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)

const PASS = 0
const FAIL = 1
const ALL_PASS: ReadonlyArray<number> = [PASS, PASS, PASS, PASS]
const REFUSAL_MESSAGE = 'josh gate takes no extra arguments'

const { as_execa_implementation, capture_stdout, fake_result, FORWARDED_FLAG } = gate_test_fixture

function step_command(step: GateStep): string {
	return step.command_args.at(-1) ?? ''
}

function step_output(step: GateStep): string {
	return `output of ${step_command(step)}`
}

// The step whose command matches the call decides the result, so the mock does not depend on the
// order `Promise.all` happens to start the four processes in.
function mock_steps(exit_codes: ReadonlyArray<number>): void {
	async function fake_execa(_file: unknown, arguments_: unknown): Promise<ExecaResult> {
		const sub_command = (arguments_ as ReadonlyArray<string>).at(-1) ?? ''
		const index = GATE_STEPS.findIndex((step) => step_command(step) === sub_command)

		return fake_result(exit_codes[index] ?? PASS, `output of ${sub_command}`)
	}

	mocked_execa.mockImplementation(as_execa_implementation(fake_execa))
}

async function run_capturing(
	exit_codes: ReadonlyArray<number>,
	is_verbose = false,
): Promise<[number, string]> {
	mock_steps(exit_codes)
	const stdout = capture_stdout()

	try {
		const code = await verification_gate.run_verification_gate({ is_verbose })

		return [code, stdout.text()]
	} finally {
		stdout.restore()
	}
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('run_verification_gate', () => {
	it('returns 0 when every check passes', async () => {
		const [code] = await run_capturing(ALL_PASS)

		expect(code).toBe(0)
	})

	it.each(GATE_STEPS.map((step, index) => [step.label, index]))(
		'returns 1 when %s fails',
		async (_label, failing_index) => {
			const exit_codes = ALL_PASS.map((code, index) => (index === failing_index ? FAIL : code))

			const [code] = await run_capturing(exit_codes)

			expect(code).toBe(1)
		},
	)

	// The serial gate reported one failure per round trip; reporting every failing check at once is
	// the second half of what this command is for.
	it('names every failing check in one summary', async () => {
		const [code, output] = await run_capturing([FAIL, PASS, FAIL, PASS])

		expect(code).toBe(1)
		expect(output).toContain('verification gate failed: lint, cspell')
	})

	// A step that aborts its siblings would leave the same one-failure-per-round-trip behavior in
	// place under a concurrent name.
	// Counted by which sub-command was spawned rather than by how many spawns there were: since
	// joshuafolkken/kit#1241 the gate also reads the changed tree through git, so a bare call count
	// would drift with every reading the gate takes for its own bookkeeping.
	it('runs every check even when the first one fails', async () => {
		await run_capturing([FAIL, PASS, PASS, PASS])

		const check_calls = mocked_execa.mock.calls.filter(([, arguments_]) =>
			GATE_STEPS.some(
				(step) => step_command(step) === (arguments_ as ReadonlyArray<string>).at(-1),
			),
		)

		expect(check_calls).toHaveLength(GATE_STEPS.length)
	})

	// Concurrent processes writing as they go would interleave; the buffered output is what makes
	// the result readable, and printing in declaration order is what makes it scannable twice.
	// Anchored on the section headers rather than the bodies: joshuafolkken/kit#967 stopped printing
	// a passing check's body, and the property being asserted — sections in declaration order, so a
	// reader can scroll to the same place twice — is about the headers.
	// The label alone is not the anchor: the plan line joshuafolkken/kit#1258 prints above the checks
	// carries `checks` and `test:unit` in its own prose, so a bare `indexOf(label)` finds the plan
	// rather than the header it is meant to be about.
	it('prints each check as one block, in declaration order', async () => {
		const [, output] = await run_capturing(ALL_PASS)

		const positions = GATE_STEPS.map((step) => output.indexOf(`${step.label} (pnpm`))

		expect(positions).toEqual([...positions].toSorted((left, right) => left - right))
		expect(positions.every((position) => position >= 0)).toBe(true)
	})
})

describe('the type check follows the resolver', () => {
	it('runs the resolved command as the check step', async () => {
		const steps = await verification_gate.build_gate_steps(PROJECT_ROOT)

		expect(steps[1]?.command_args).toEqual(RESOLVED_TYPE_CHECK)
	})

	// A failure on the `check` step is only reproducible if the header names what actually ran; the
	// label alone points at `pnpm josh check`, which is not the command on a SvelteKit project.
	it('names the command that ran, not only the label', async () => {
		const [, output] = await run_capturing(ALL_PASS)

		expect(output).toContain('check (pnpm josh-app check:ci)')
	})
})

describe('run_gate_command', () => {
	// `gate` forwards nothing to its four sub-commands, so an appended flag would vanish silently —
	// the hole the composite-argument guard closes for `sh -c` entries.
	it('refuses extra arguments and names where they belong', async () => {
		const stderr: Array<string> = []
		const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
			stderr.push(String(chunk))

			return true
		})

		try {
			const code = await verification_gate.run_gate_command([FORWARDED_FLAG])

			expect(code).toBe(1)
			expect(stderr.join('')).toContain(REFUSAL_MESSAGE)
			expect(mocked_execa).not.toHaveBeenCalled()
		} finally {
			spy.mockRestore()
		}
	})

	it('runs the gate when no extra argument is given', async () => {
		mock_steps(ALL_PASS)
		const stdout = capture_stdout()

		try {
			expect(await verification_gate.run_gate_command([])).toBe(0)
		} finally {
			stdout.restore()
		}
	})
})

// The documents that must route an AI to this command are asserted in
// `gate-command-document-rule.test.ts`, which needs none of the scaffolding above.

// joshuafolkken/kit#967: a passing check's body is never read — the summary line already says the
// gate passed — and it lands in the conversation to be re-read on every later turn. A failing
// check's body is the one time it is the answer.
const FIRST_FAILS: ReadonlyArray<number> = [FAIL, PASS, PASS, PASS]

function every_step_output(): ReadonlyArray<string> {
	return GATE_STEPS.map((step) => step_output(step))
}

describe('run_verification_gate — what it prints', () => {
	it('prints no output body when every check passes', async () => {
		const [code, text] = await run_capturing(ALL_PASS)

		expect(code).toBe(0)
		for (const output of every_step_output()) expect(text).not.toContain(output)
	})

	it('still names every check that ran', async () => {
		const [, text] = await run_capturing(ALL_PASS)

		for (const step of GATE_STEPS) expect(text).toContain(step.label)
	})

	it('prints the output body of the check that failed', async () => {
		const [code, text] = await run_capturing(FIRST_FAILS)
		const [failed] = GATE_STEPS

		// Asserted rather than defaulted: `toContain('')` passes against any output at all, so an
		// empty step list would disable this guard instead of failing it.
		if (failed === undefined) throw new Error('the gate declares no steps')

		expect(code).toBe(1)
		expect(text).toContain(step_output(failed))
	})

	// One failure must not drag the other three bodies back in — that is the whole saving.
	it('prints no body for the checks that passed alongside a failure', async () => {
		const [, text] = await run_capturing(FIRST_FAILS)

		for (const step of GATE_STEPS.slice(1)) expect(text).not.toContain(step_output(step))
	})

	it('prints every body when asked to be verbose', async () => {
		const [code, text] = await run_capturing(ALL_PASS, true)

		expect(code).toBe(0)
		for (const output of every_step_output()) expect(text).toContain(output)
	})
})

// Two passing cases keep their body, and the two were asserted by two copies of the same block.
// A check that passed *without running* — `test-unit-guard` exits 0 with a notice when vitest is
// absent — must not print what a full run prints. And `lint-parallel` runs eslint without
// `--max-warnings 0`, so a check can exit 0 with warnings in it, which suppressing would hide
// behind a green gate.
const SKIP_NOTICE = `josh test:unit: vitest is not installed ${test_unit_guard.SKIP_MARKER} vitest unit tests.`
const WARNING_NOTICE = 'src/a.ts:1:1  warning  Unexpected console statement'

async function run_printing(body: string): Promise<string> {
	mock_steps(ALL_PASS)
	mocked_execa.mockImplementation(as_execa_implementation(async () => fake_result(PASS, body)))
	const stdout = capture_stdout()

	try {
		await verification_gate.run_verification_gate()

		return stdout.text()
	} finally {
		stdout.restore()
	}
}

describe('run_verification_gate — a passing check with something to say', () => {
	it.each([
		['passed without running', SKIP_NOTICE],
		['passed with warnings', WARNING_NOTICE],
	])('prints the body of a check that %s', async (_case, body) => {
		expect(await run_printing(body)).toContain(body)
	})
})

describe('run_gate_command — the verbose flag', () => {
	it('accepts the flag it consumes itself', async () => {
		mock_steps(ALL_PASS)
		const stdout = capture_stdout()

		try {
			expect(await verification_gate.run_gate_command([verification_gate.VERBOSE_FLAG])).toBe(0)
			for (const output of every_step_output()) expect(stdout.text()).toContain(output)
		} finally {
			stdout.restore()
		}
	})

	// The refusal exists because a forwarded flag vanishes into the sub-commands; consuming one flag
	// here must not stop the others being refused.
	it('still refuses an argument it would have to forward', async () => {
		mock_steps(ALL_PASS)
		const stderr: Array<string> = []
		const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
			stderr.push(String(chunk))

			return true
		})

		try {
			const code = await verification_gate.run_gate_command([
				verification_gate.VERBOSE_FLAG,
				FORWARDED_FLAG,
			])

			expect(code).toBe(1)
			expect(stderr.join('')).toContain(REFUSAL_MESSAGE)
		} finally {
			spy.mockRestore()
		}
	})
})

// joshuafolkken/kit#1248: the gate said which check failed and never how long anything took, so
// "which of the four is the long pole" could only be answered by timing each one by hand outside
// the command — which is how the same figure came to be re-measured by hand twice on #1153.
// No quantifier at all, so there is nothing for `sonarjs/super-linear-regex` to backtrack over:
// every duration this formatter emits ends `<digit>.<digit>s`, whatever its magnitude, and this
// pattern asks only whether a line carries one. The three patterns below keep `\d+` because a
// literal prefix anchors them.
const DURATION_PATTERN = /\d\.\ds/u
const RESULT_ICONS: ReadonlyArray<string> = ['✔', '✗']
// The summary line, counted alongside the four check headers.
const SUMMARY_LINE_COUNT = 1

function result_lines(text: string): Array<string> {
	return text.split('\n').filter((line) => RESULT_ICONS.some((icon) => line.startsWith(icon)))
}

describe('run_verification_gate — how long each check took', () => {
	it('puts a duration on every check header and on the summary', async () => {
		const [, text] = await run_capturing(ALL_PASS)
		const lines = result_lines(text)

		expect(lines).toHaveLength(GATE_STEPS.length + SUMMARY_LINE_COUNT)
		for (const line of lines) expect(line).toMatch(DURATION_PATTERN)
	})

	// The header's first job is naming the one command to re-run while fixing, so the duration goes
	// behind it rather than between the label and the command.
	it('keeps the duration behind the command the header names', async () => {
		const [, text] = await run_capturing(ALL_PASS)

		expect(text).toMatch(/check \(pnpm josh-app check:ci\) \d+\.\ds/u)
	})

	it('reports the total on a passing gate', async () => {
		const [, text] = await run_capturing(ALL_PASS)

		expect(text).toMatch(/verification gate passed \(\d+ checks\) in \d+\.\ds\./u)
	})

	// The failing summary names every failing check first and takes the total after them: a reader
	// scanning for what broke must not have to step over a number to find it.
	it('reports the total on a failing gate, after the checks it names', async () => {
		const [, text] = await run_capturing([FAIL, PASS, FAIL, PASS])

		expect(text).toMatch(/verification gate failed: lint, cspell \(\d+\.\ds\)/u)
	})

	// joshuafolkken/kit#1374: `josh time` tells a green gate from the third-party warning bodies it
	// forwards by reading this line, so what the gate prints has to be what the reader matches. The
	// two are built from one prefix; these assertions are what fails if they ever stop being.
	it('prints a passing summary the verdict reader recognizes', async () => {
		const [, text] = await run_capturing(ALL_PASS)
		const verdicts = text.split('\n').map((line) => josh_verdict.read_verdict(line))

		expect(verdicts).toContain(josh_verdict.PASSED_VERDICT)
		expect(verdicts).not.toContain(josh_verdict.FAILED_VERDICT)
	})

	it('prints a failing summary the verdict reader recognizes', async () => {
		const [, text] = await run_capturing([FAIL, PASS, FAIL, PASS])
		const verdicts = text.split('\n').map((line) => josh_verdict.read_verdict(line))

		expect(verdicts).toContain(josh_verdict.FAILED_VERDICT)
	})
})

// joshuafolkken/kit#1258: the plan decides how many checks run at once and how wide the unit suite
// fans out. `gate-plan.test.ts` owns the numbers; what is asserted here is that the gate obeys them.
const JOSH = 'josh'
const UNIT_CAP = 7
const NARROWEST_CONCURRENCY = 1
const CAPPED_PLAN: GatePlan = { concurrency: GATE_STEPS.length, unit_worker_cap: UNIT_CAP }
const UNCAPPED_PLAN: GatePlan = { concurrency: GATE_STEPS.length, unit_worker_cap: undefined }
// The narrowest plan any machine produces. Everything still has to run.
const SERIAL_PLAN: GatePlan = { concurrency: NARROWEST_CONCURRENCY, unit_worker_cap: undefined }

function unit_step_args(steps: ReadonlyArray<GateStep>): ReadonlyArray<string> | undefined {
	return steps.find((step) => step.label === gate_plan.UNIT_LABEL)?.command_args
}

describe('the gate follows the plan', () => {
	it('hands the unit suite the worker cap the plan resolved', async () => {
		const steps = await verification_gate.build_gate_steps(PROJECT_ROOT, CAPPED_PLAN)

		expect(unit_step_args(steps)).toEqual([
			JOSH,
			gate_plan.UNIT_LABEL,
			`${verification_gate.UNIT_WORKER_FLAG}=${String(UNIT_CAP)}`,
		])
	})

	// The cap is the unit suite's alone: the other three are one or two processes each and have no
	// worker pool for the flag to mean anything to.
	it('appends nothing to the checks the cap is not about', async () => {
		const steps = await verification_gate.build_gate_steps(PROJECT_ROOT, CAPPED_PLAN)
		const others = steps.filter((step) => step.label !== gate_plan.UNIT_LABEL)

		for (const step of others) {
			expect(step.command_args).not.toContain(verification_gate.UNIT_WORKER_FLAG)
		}
	})

	it('leaves the unit command bare when the plan caps nothing', async () => {
		const steps = await verification_gate.build_gate_steps(PROJECT_ROOT, UNCAPPED_PLAN)

		expect(unit_step_args(steps)).toEqual([JOSH, gate_plan.UNIT_LABEL])
	})

	// The whole point of the gate is that one failure never hides the other three. Narrowing the
	// plan queues the checks; it must not drop them, which a pool that aborted on the first failure
	// would do.
	it('runs every check even at the narrowest plan, and even after one fails', async () => {
		mock_steps([FAIL, PASS, PASS, PASS])

		const results = await verification_gate.run_marked_gate_steps({}, SERIAL_PLAN)

		expect(results.map((result) => result.label)).toEqual(GATE_STEPS.map((step) => step.label))
	})

	// Anchored at the start of the output rather than merely before the first header: the plan is
	// what the durations under it are read against, so it goes above them, not beside the summary.
	it('prints the plan above the checks it explains', async () => {
		const [, text] = await run_capturing(ALL_PASS)

		expect(text).toMatch(/^plan: \d+ of \d+ checks at once, /u)
	})
})
