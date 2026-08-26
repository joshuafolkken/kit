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

// Only the three options the callers depend on; execa's own Options type carries dozens more.
interface ObservedExecaOptions {
	all?: boolean
	reject?: boolean
	timeout?: number
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

	it('returns the captured output and exit code', async () => {
		mock_execa()

		const result = await buffered_process.run_buffered_process(['josh', 'lint'])

		expect(result).toEqual({ output: 'output', exit_code: 0 })
	})
})

describe('is_process_failed', () => {
	it('treats a zero exit code as success', () => {
		expect(buffered_process.is_process_failed({ output: '', exit_code: 0 })).toBe(false)
	})

	it('treats a non-zero exit code as failure', () => {
		expect(buffered_process.is_process_failed({ output: '', exit_code: FAILING_EXIT_CODE })).toBe(
			true,
		)
	})

	// execa reports `undefined` when the process was killed by a signal — including the timeout
	// above, which is exactly the case that must not read as a pass.
	it('treats a signal-terminated process as failure', () => {
		expect(buffered_process.is_process_failed({ output: '', exit_code: SIGNAL_EXIT_CODE })).toBe(
			true,
		)
	})
})
