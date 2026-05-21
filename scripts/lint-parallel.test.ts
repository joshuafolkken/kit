import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
	spawn: vi.fn(),
}))

type CloseListener = (code: number) => void
type DataListener = (data: Buffer) => void

interface FakeStream {
	on: (event: string, listener: DataListener) => void
}

interface FakeProcess {
	stdout: FakeStream
	stderr: FakeStream
	on: (event: 'close', listener: CloseListener) => void
}

function make_fake_process(exit_code: number): FakeProcess {
	const noop_stream: FakeStream = { on: vi.fn() }

	return {
		stdout: noop_stream,
		stderr: noop_stream,
		on(_event: 'close', listener: CloseListener) {
			setTimeout(() => {
				listener(exit_code)
			}, 0)
		},
	}
}

const { run_lint_parallel_checks } = await import('./lint-parallel')
const child_process_module = await import('node:child_process')
const mocked_spawn = vi.mocked(child_process_module.spawn)

beforeEach(() => {
	vi.clearAllMocks()
})

describe('run_lint_parallel_checks', () => {
	it('returns 0 when both prettier and eslint pass', async () => {
		mocked_spawn
			.mockReturnValueOnce(make_fake_process(0) as ReturnType<typeof child_process_module.spawn>)
			.mockReturnValueOnce(make_fake_process(0) as ReturnType<typeof child_process_module.spawn>)

		const code = await run_lint_parallel_checks()

		expect(code).toBe(0)
	})

	it('returns 1 when prettier fails', async () => {
		mocked_spawn
			.mockReturnValueOnce(make_fake_process(1) as ReturnType<typeof child_process_module.spawn>)
			.mockReturnValueOnce(make_fake_process(0) as ReturnType<typeof child_process_module.spawn>)

		const code = await run_lint_parallel_checks()

		expect(code).toBe(1)
	})

	it('returns 1 when eslint fails', async () => {
		mocked_spawn
			.mockReturnValueOnce(make_fake_process(0) as ReturnType<typeof child_process_module.spawn>)
			.mockReturnValueOnce(make_fake_process(1) as ReturnType<typeof child_process_module.spawn>)

		const code = await run_lint_parallel_checks()

		expect(code).toBe(1)
	})

	it('returns 1 when both fail', async () => {
		mocked_spawn
			.mockReturnValueOnce(make_fake_process(1) as ReturnType<typeof child_process_module.spawn>)
			.mockReturnValueOnce(make_fake_process(1) as ReturnType<typeof child_process_module.spawn>)

		const code = await run_lint_parallel_checks()

		expect(code).toBe(1)
	})
})
