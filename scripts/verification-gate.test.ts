import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_DOCS, read_repo_file } from './ai-document-fixture'
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

type ExecaResult = Awaited<ReturnType<typeof execa_module.execa>>

const PASS = 0
const FAIL = 1
const ALL_PASS: ReadonlyArray<number> = [PASS, PASS, PASS, PASS]
const FORWARDED_FLAG = '--workers=1'
const REFUSAL_MESSAGE = 'josh gate takes no extra arguments'

// execa's resolved Result is a large interface; the gate only reads `all` and `exitCode`, so a
// minimal stub is bridged through `unknown`.
function fake_result(exit_code: number, output: string): ExecaResult {
	const result = { all: output, exitCode: exit_code }

	return result as unknown as ExecaResult
}

function step_command(step: GateStep): string {
	return step.command_args.at(-1) ?? ''
}

function step_output(step: GateStep): string {
	return `output of ${step_command(step)}`
}

type ExecaImplementation = Parameters<typeof mocked_execa.mockImplementation>[0]

// The step whose command matches the call decides the result, so the mock does not depend on the
// order `Promise.all` happens to start the four processes in. execa's real return type is a
// promise carrying IPC methods the gate never touches, so the implementation is bridged through
// `unknown` the same way `fake_result` is.
function mock_steps(exit_codes: ReadonlyArray<number>): void {
	async function fake_execa(_file: unknown, arguments_: unknown): Promise<ExecaResult> {
		const sub_command = (arguments_ as ReadonlyArray<string>).at(-1) ?? ''
		const index = GATE_STEPS.findIndex((step) => step_command(step) === sub_command)

		return fake_result(exit_codes[index] ?? PASS, `output of ${sub_command}`)
	}

	mocked_execa.mockImplementation(fake_execa as unknown as ExecaImplementation)
}

function capture_stdout(): { text: () => string; restore: () => void } {
	const chunks: Array<string> = []
	const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
		chunks.push(String(chunk))

		return true
	})

	return {
		text: (): string => chunks.join(''),
		restore: (): void => {
			spy.mockRestore()
		},
	}
}

async function run_capturing(
	exit_codes: ReadonlyArray<number>,
	is_verbose = false,
): Promise<[number, string]> {
	mock_steps(exit_codes)
	const stdout = capture_stdout()

	try {
		const code = await verification_gate.run_verification_gate(is_verbose)

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
	it('prints each check as one block, in declaration order', async () => {
		const [, output] = await run_capturing(ALL_PASS)

		const positions = GATE_STEPS.map((step) => output.indexOf(step.label))

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

// joshuafolkken/kit#914: the command only saves a round trip if the documents that define the gate
// actually route to it. A command shipped while every entry point still lists the four serial steps
// is a command nobody runs.
describe('the gate command is what the documents tell an AI to run', () => {
	const GATE_COMMAND = 'pnpm josh gate'

	it.each(AI_DOCS)('names the command in the completion gate of %s', (document_name) => {
		expect(read_repo_file(document_name)).toContain(GATE_COMMAND)
	})

	it.each([
		'.claude/skills/workflow-commands/SKILL.md',
		'.claude/skills/workflow-commands/fullrun.md',
		'.claude/skills/workflow-commands/halfrun.md',
		'.claude/skills/workflow-commands/queue.md',
	])('names the command in the gate description of %s', (skill_path) => {
		expect(read_repo_file(skill_path)).toContain(GATE_COMMAND)
	})
})

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

describe('run_verification_gate — a check that passed without running', () => {
	// A check that passed *without running* still has to say so: `test-unit-guard` exits 0 with a
	// notice when vitest is absent, and suppressing it made a gate that ran zero tests print exactly
	// what a full one prints.
	it('prints the notice of a check that passed without running', async () => {
		mock_steps(ALL_PASS)
		mocked_execa.mockImplementation((async () =>
			fake_result(
				PASS,
				`josh test:unit: vitest is not installed ${test_unit_guard.SKIP_MARKER} vitest unit tests.`,
			)) as unknown as ExecaImplementation)
		const stdout = capture_stdout()

		try {
			await verification_gate.run_verification_gate()

			expect(stdout.text()).toContain(test_unit_guard.SKIP_MARKER)
		} finally {
			stdout.restore()
		}
	})
})

// `lint-parallel` runs eslint without `--max-warnings 0`, so a check can exit 0 with warnings in it.
// Suppressing those would let the gate report "passed" with the warnings invisible.
describe('run_verification_gate — a check that passed with warnings', () => {
	it('prints the body of a passing check whose output carries a warning', async () => {
		const notice = 'src/a.ts:1:1  warning  Unexpected console statement'

		mock_steps(ALL_PASS)
		mocked_execa.mockImplementation((async () =>
			fake_result(PASS, notice)) as unknown as ExecaImplementation)
		const stdout = capture_stdout()

		try {
			await verification_gate.run_verification_gate()

			expect(stdout.text()).toContain(notice)
		} finally {
			stdout.restore()
		}
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
