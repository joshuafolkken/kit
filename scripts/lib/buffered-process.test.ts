import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pnpm_reach } from './pnpm-reach'
import { SUITE_TIMEOUT_MS } from './timeouts'

vi.mock('execa', () => ({
	execa: vi.fn(),
}))

const { buffered_process } = await import('./buffered-process')
const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)

type ExecaResult = Awaited<ReturnType<typeof execa_module.execa>>
type ExecaImplementation = Parameters<typeof mocked_execa.mockImplementation>[0]

const SIGNAL_EXIT_CODE = undefined
const FAILING_EXIT_CODE = 1
const LANE_DIRECTORY = '/lanes/1554'
const SHORTER_TIMEOUT_MS = 600_000
const LINT_OUTPUT = 'lint errors'
const MISSING_DIRECTORY = '/lanes/3712/removed'
const SPAWN_FAILED = 'Command failed with ENOENT: pnpm josh lint\nspawn pnpm ENOENT'
const TIMED_OUT = 'Command timed out after 1800000 milliseconds: pnpm josh test:unit'

// Only the options the callers depend on; execa's own Options type carries dozens more.
interface ObservedExecaOptions {
	all?: boolean
	reject?: boolean
	timeout?: number
	cwd?: string
	env?: NodeJS.ProcessEnv
	extendEnv?: boolean
}

const spawn_options: Array<ObservedExecaOptions> = []

// execa is declared with overloaded signatures, so `mock.calls` types the options out of the
// position they are actually passed in. The stub records them as it receives them instead, and is
// bridged through `unknown` because the real return type carries IPC methods nothing here touches.
async function fake_execa(
	_file: unknown,
	_arguments: unknown,
	options: ObservedExecaOptions,
): Promise<ExecaResult> {
	spawn_options.push(options)

	return { all: 'output', exitCode: 0 } as unknown as ExecaResult
}

function mock_execa(): void {
	mocked_execa.mockImplementation(fake_execa as unknown as ExecaImplementation)
}

// What execa resolves with when the child produced no exit code, as observed against the real
// library: `code` only when the spawn itself failed, `all` holding whatever was written first.
interface UnfinishedOutcome {
	all: string
	code?: string
	shortMessage: string
}

function mock_unfinished(outcome: UnfinishedOutcome): void {
	const result = { ...outcome, exitCode: undefined } as unknown as ExecaResult

	mocked_execa.mockImplementation((async () => result) as unknown as ExecaImplementation)
}

beforeEach(() => {
	vi.clearAllMocks()
	spawn_options.length = 0
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_buffered_process', () => {
	// These three options are the whole contract: buffered so concurrent writers cannot interleave,
	// non-rejecting so a failing check is reported instead of aborting its siblings, and bounded so
	// a check that never exits cannot hold an unattended run open with nothing printed.
	it('buffers the output, reports failures instead of throwing, and bounds the run', async () => {
		mock_execa()

		await buffered_process.run_buffered_process(['josh', 'lint'])

		expect(spawn_options[0]?.all).toBe(true)
		expect(spawn_options[0]?.reject).toBe(false)
		expect(spawn_options[0]?.timeout).toBe(SUITE_TIMEOUT_MS)
	})

	// joshuafolkken/kit#1554: `lane:open` runs its install in the work tree it just created, so a
	// `cwd` silently dropped here would install the repository `josh` was typed in and leave every
	// lane exactly as empty as before — the failure that command exists to remove, reported as done.
	it('runs the child in a caller-supplied directory, under a caller-supplied bound', async () => {
		mock_execa()

		await buffered_process.run_buffered_process(['install'], {
			cwd: LANE_DIRECTORY,
			timeout_ms: SHORTER_TIMEOUT_MS,
		})

		expect(spawn_options[0]?.cwd).toBe(LANE_DIRECTORY)
		expect(spawn_options[0]?.timeout).toBe(SHORTER_TIMEOUT_MS)
	})

	// The fan-out callers pass no options at all, and execa's overload resolution is sensitive to an
	// explicitly-`undefined` `cwd` — it widens `all` back to `string | undefined`, so the key has to
	// be absent rather than present and empty.
	it('omits the directory key entirely when no caller asked for one', async () => {
		mock_execa()

		await buffered_process.run_buffered_process(['josh', 'lint'])

		expect(spawn_options[0]).not.toHaveProperty('cwd')
	})

	it('returns the captured output and exit code', async () => {
		mock_execa()

		const result = await buffered_process.run_buffered_process(['josh', 'lint'])

		expect(result.output).toBe('output')
		expect(result.exit_code).toBe(0)
	})

	// The duration is measured here rather than by each caller, so it has to arrive with every
	// result. Asserted as a finite non-negative number rather than against a threshold: the stub
	// resolves immediately, and a monotonic clock is the whole reason a lower bound of zero holds
	// (joshuafolkken/kit#1248).
	it('reports how long the child ran', async () => {
		mock_execa()

		const result = await buffered_process.run_buffered_process(['josh', 'lint'])

		expect(Number.isFinite(result.elapsed_ms)).toBe(true)
		expect(result.elapsed_ms).toBeGreaterThanOrEqual(0)
	})
})

// joshuafolkken/kit#3712: a child with no exit code never said why, so `josh gate` printed a bare ✗
// and an empty log for every check when `pnpm` was missing from the PATH the gate ran with.
describe('run_buffered_process — a child that produced no exit code', () => {
	it('says pnpm is not on PATH when the child could not be started', async () => {
		mock_unfinished({ all: '', code: 'ENOENT', shortMessage: SPAWN_FAILED })

		const result = await buffered_process.run_buffered_process(['josh', 'lint'])

		expect(result.exit_code).toBeUndefined()
		expect(result.output).toBe(`${SPAWN_FAILED}\n${pnpm_reach.NOT_ON_PATH_NOTICE}`)
	})

	// A removed working directory fails the spawn with the same code; blaming pnpm for it would send
	// the reader to reinstall a tool that is working.
	it('does not blame pnpm when the working directory is what is missing', async () => {
		mock_unfinished({ all: '', code: 'ENOENT', shortMessage: SPAWN_FAILED })

		const result = await buffered_process.run_buffered_process(['install'], {
			cwd: MISSING_DIRECTORY,
		})

		expect(result.output).toBe(SPAWN_FAILED)
	})

	it('keeps what the child wrote and adds why it stopped when it ran past its bound', async () => {
		mock_unfinished({ all: 'partial', shortMessage: TIMED_OUT })

		const result = await buffered_process.run_buffered_process(['josh', 'test:unit'])

		expect(result.output).toBe(`partial\n${TIMED_OUT}`)
	})

	it('adds nothing to a child that exited by itself', async () => {
		const failed = {
			all: LINT_OUTPUT,
			exitCode: FAILING_EXIT_CODE,
			shortMessage: 'Command failed',
		}

		mocked_execa.mockImplementation((async () => failed) as unknown as ExecaImplementation)
		const result = await buffered_process.run_buffered_process(['josh', 'lint'])

		expect(result.output).toBe(LINT_OUTPUT)
		expect(result.exit_code).toBe(FAILING_EXIT_CODE)
	})
})

describe('color environment', () => {
	it('forces color when the parent does not disable it', async () => {
		vi.stubEnv('NO_COLOR', undefined)
		mock_execa()

		await buffered_process.run_buffered_process(['josh', 'lint'])

		expect(spawn_options[0]?.env?.['FORCE_COLOR']).toBe('1')
		expect(spawn_options[0]?.env).not.toHaveProperty('NO_COLOR')
	})

	it('respects disabled color without forwarding a conflicting override', async () => {
		vi.stubEnv('NO_COLOR', '1')
		vi.stubEnv('FORCE_COLOR', '3')
		mock_execa()

		await buffered_process.run_buffered_process(['josh', 'lint'])

		expect(spawn_options[0]?.env?.['NO_COLOR']).toBe('1')
		expect(spawn_options[0]?.env).not.toHaveProperty('FORCE_COLOR')
		expect(spawn_options[0]?.extendEnv).toBe(false)
	})
})

// The parameter is narrowed to the one field the function reads, so these carry the exit code and
// nothing else — a caller asking "did this fail" has no output or duration to hand over.
describe('is_process_failed', () => {
	it('treats a zero exit code as success', () => {
		expect(buffered_process.is_process_failed({ exit_code: 0 })).toBe(false)
	})

	it('treats a non-zero exit code as failure', () => {
		expect(buffered_process.is_process_failed({ exit_code: FAILING_EXIT_CODE })).toBe(true)
	})

	// execa reports `undefined` when the process was killed by a signal — including the timeout
	// above, which is exactly the case that must not read as a pass.
	it('treats a signal-terminated process as failure', () => {
		expect(buffered_process.is_process_failed({ exit_code: SIGNAL_EXIT_CODE })).toBe(true)
	})
})
