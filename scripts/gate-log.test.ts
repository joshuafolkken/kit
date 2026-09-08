import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_log } from './gate-log'
import { gate_plan } from './gate-plan'
import { gate_test_fixture, type ExecaResult } from './gate-test-fixture'

// joshuafolkken/kit#1227: the verification gate's full output must exist somewhere the console's
// size limit cannot reach. A red gate can never read as green — the verdict is the last line — but
// the *middle* of the output is what an elision takes, and the middle is where a failure says what
// it was.
//
// The assertions below are what stands between that and a mechanism that quietly writes nothing: the
// file exists, it holds every check's whole output, and the console says where it is. The last one
// matters as much as the first two — a log nobody is told about is a log nobody reads.
//
// A separate file rather than more of `verification-gate.test.ts`, which is at its 300-line limit —
// the precedent `gate-no-unit.test.ts` set.

vi.mock('execa', () => ({
	execa: vi.fn(),
}))

// The real resolver probes the project; which command the type check turns into is not this suite's
// subject.
vi.mock('./type-check-step', () => ({
	type_check_step: {
		resolve_type_check_args: async (): Promise<ReadonlyArray<string>> => ['josh', 'check'],
	},
}))

const { verification_gate } = await import('./verification-gate')
const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)

const PASS = 0
const FAIL = 1
const LINT_TARGET = 'lint'
// The two checks whose sub-command name is also the last argument they are spawned with, so the
// stub's body can be matched by name. The unit check is not one of them — the gate appends
// `--maxWorkers=<n>` to it — and its section is asserted by header instead.
const SUPPRESSED_TARGETS: ReadonlyArray<string> = ['check', 'cspell:dot']
const FIRST_HEADER = '✗ lint (pnpm josh lint) 1.0s'
const FIRST_BODY = 'first body'
const SECOND_HEADER = '✔ cspell (pnpm josh cspell:dot) 2.0s'
const SECOND_BODY = 'second body'
const { as_execa_implementation, capture_stdout, fake_result } = gate_test_fixture
const RECORDS = gate_test_fixture.suite_records('gate-log')
// Both derived from this suite's own record rather than named in the temp directory outright: a
// fixed temp path is one another suite running beside this can name too (joshuafolkken/kit#1517),
// and `suite_records` already keys its paths on the suite and the pid.
const EXPLICIT_TARGET = RECORDS.log_path
const UNWRITABLE = path.join(`${RECORDS.log_path}-absent-directory`, 'gate.log')

function output_of(sub_command: string): string {
	return `output of ${sub_command}`
}

// One check fails and the rest pass, which is the shape the log exists for: the failing body is on
// the console, the three passing ones are suppressed there and exist only in the file.
function lint_fails(): void {
	mocked_execa.mockImplementation(
		as_execa_implementation(async (_file: unknown, arguments_: unknown): Promise<ExecaResult> => {
			const sub_command = (arguments_ as ReadonlyArray<string>).at(-1) ?? ''
			const is_failing = sub_command === LINT_TARGET

			return fake_result(is_failing ? FAIL : PASS, output_of(sub_command))
		}),
	)
}

function every_step_passes(): void {
	mocked_execa.mockImplementation(
		as_execa_implementation(async (_file: unknown, arguments_: unknown): Promise<ExecaResult> => {
			const sub_command = (arguments_ as ReadonlyArray<string>).at(-1) ?? ''

			return fake_result(PASS, output_of(sub_command))
		}),
	)
}

interface GateRun {
	exit_code: number
	text: string
}

async function run_gate(log_path: string = RECORDS.log_path): Promise<GateRun> {
	const stdout = capture_stdout()

	try {
		const exit_code = await verification_gate.run_gate_command([], { ...RECORDS, log_path })

		return { exit_code, text: stdout.text() }
	} finally {
		stdout.restore()
	}
}

function last_line(text: string): string {
	return text.trimEnd().split('\n').at(-1) ?? ''
}

beforeEach(() => {
	RECORDS.clear()
	vi.clearAllMocks()
	lint_fails()
})

describe('gate_log.gate_log_path', () => {
	it('keeps the log in the temp directory, named as a log rather than as JSON', () => {
		const resolved = gate_log.gate_log_path()

		expect(path.dirname(resolved)).toBe(tmpdir())
		expect(path.basename(resolved).startsWith(gate_log.GATE_LOG_PREFIX)).toBe(true)
		expect(resolved.endsWith(gate_log.GATE_LOG_SUFFIX)).toBe(true)
	})

	it('is the same path on every run, so one checkout keeps one log', () => {
		expect(gate_log.gate_log_path()).toBe(gate_log.gate_log_path())
	})

	it('uses an explicit destination when one is given', () => {
		expect(gate_log.gate_log_path(EXPLICIT_TARGET)).toBe(EXPLICIT_TARGET)
	})
})

describe('gate_log.format_gate_log', () => {
	it('names every section with the header the console printed, and keeps the body whole', () => {
		const formatted = gate_log.format_gate_log([
			{ header: FIRST_HEADER, output: FIRST_BODY },
			{ header: SECOND_HEADER, output: SECOND_BODY },
		])

		expect(formatted).toContain(`=== ${FIRST_HEADER} ===`)
		expect(formatted).toContain(FIRST_BODY)
		expect(formatted).toContain(`=== ${SECOND_HEADER} ===`)
		expect(formatted).toContain(SECOND_BODY)
	})
})

describe('a failed gate leaves its whole output in a file', () => {
	it('writes the file', async () => {
		await run_gate()

		expect(existsSync(RECORDS.log_path)).toBe(true)
	})

	// The point of the file rather than of the console: these bodies are suppressed on stdout because
	// a passing check has nothing to say there, so the file is the only place they exist.
	it('keeps the bodies a green console suppressed', async () => {
		await run_gate()

		const written = readFileSync(RECORDS.log_path, 'utf8')

		for (const target of SUPPRESSED_TARGETS) expect(written).toContain(output_of(target))

		expect(written).toContain(output_of(LINT_TARGET))
	})

	it('gives every check the gate ran a section of its own', async () => {
		await run_gate()

		const written = readFileSync(RECORDS.log_path, 'utf8')

		for (const check of gate_plan.GATE_CHECKS) expect(written).toContain(`${check.label} (pnpm `)
	})

	it('prints where the file is, in the failure summary', async () => {
		const run = await run_gate()

		expect(run.text).toContain(`${gate_log.LOG_NOTICE_PREFIX}${RECORDS.log_path}`)
		expect(run.exit_code).not.toBe(PASS)
	})

	// `josh-verdict.ts` builds two readers on the verdict being the gate's last line — the rework
	// detector's scan, and the `2>&1 | tail -40` the output-bounds prompt prescribes. The path goes
	// above it so both keep working, and this is what pins that.
	it('leaves the verdict as the last line', async () => {
		const run = await run_gate()

		expect(last_line(run.text)).toContain('verification gate failed')
	})
})

describe('a passing gate writes it too', () => {
	beforeEach(() => {
		every_step_passes()
	})

	it('writes the file and prints its path on a green run', async () => {
		const run = await run_gate()

		expect(run.exit_code).toBe(PASS)
		expect(existsSync(RECORDS.log_path)).toBe(true)
		expect(run.text).toContain(`${gate_log.LOG_NOTICE_PREFIX}${RECORDS.log_path}`)
	})

	it('records what a green console suppressed', async () => {
		await run_gate()

		const written = readFileSync(RECORDS.log_path, 'utf8')

		for (const target of SUPPRESSED_TARGETS) expect(written).toContain(output_of(target))
	})
})

// A temp-directory problem must never turn a green gate red — the rule the green-gate record and the
// in-flight marker already follow.
describe('a log that cannot be written', () => {
	it('does not change a failed gate into anything else', async () => {
		const run = await run_gate(UNWRITABLE)

		expect(run.exit_code).not.toBe(PASS)
		expect(run.text).toContain(gate_log.LOG_FAILED_NOTICE)
	})

	it('does not turn a green gate red', async () => {
		every_step_passes()

		const run = await run_gate(UNWRITABLE)

		expect(run.exit_code).toBe(PASS)
		expect(run.text).toContain(gate_log.LOG_FAILED_NOTICE)
	})
})
