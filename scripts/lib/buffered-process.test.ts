import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('execa', () => ({
	execa: vi.fn(),
}))

const { buffered_process, PROCESS_TIMEOUT_MS } = await import('./buffered-process')
const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)

type ExecaResult = Awaited<ReturnType<typeof execa_module.execa>>
type ExecaImplementation = Parameters<typeof mocked_execa.mockImplementation>[0]

const SIGNAL_EXIT_CODE = undefined
const FAILING_EXIT_CODE = 1
const LANE_DIRECTORY = '/lanes/1554'
const SHORTER_TIMEOUT_MS = 600_000

// Only the options the callers depend on; execa's own Options type carries dozens more.
interface ObservedExecaOptions {
	all?: boolean
	reject?: boolean
	timeout?: number
	cwd?: string
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

beforeEach(() => {
	vi.clearAllMocks()
	spawn_options.length = 0
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
		expect(spawn_options[0]?.timeout).toBe(PROCESS_TIMEOUT_MS)
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
