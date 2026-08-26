import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_DOCS, read_repo_file } from './ai-document-fixture'
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

async function run_capturing(exit_codes: ReadonlyArray<number>): Promise<[number, string]> {
	mock_steps(exit_codes)
	const stdout = capture_stdout()

	try {
		const code = await verification_gate.run_verification_gate()

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
	it('runs every check even when the first one fails', async () => {
		await run_capturing([FAIL, PASS, PASS, PASS])

		expect(mocked_execa).toHaveBeenCalledTimes(GATE_STEPS.length)
	})

	// Concurrent processes writing as they go would interleave; the buffered output is what makes
	// the result readable, and printing in declaration order is what makes it scannable twice.
	it('prints each check as one block, in declaration order', async () => {
		const [, output] = await run_capturing(ALL_PASS)

		const positions = GATE_STEPS.map((step) => output.indexOf(step_output(step)))

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
			const code = await verification_gate.run_gate_command(['--workers=1'])

			expect(code).toBe(1)
			expect(stderr.join('')).toContain('josh gate takes no extra arguments')
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
