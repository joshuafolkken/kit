import { execa } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { josh_command } from './josh-run'

vi.mock('execa', () => ({ execa: vi.fn() }))

const mocked_execa = vi.mocked(execa)

type ExecaResult = Awaited<ReturnType<typeof execa>>

const OK = 0
const FALLBACK_EXIT = 1
const PNPM = 'pnpm'
const JOSH = 'josh'
const DISPATCH = 'lane:dispatch'
const BUDGET = 'backlog:budget'
const PIPED = { reject: false, stderr: 'pipe' }
const FORWARDED = { reject: false, stderr: ['pipe', 'inherit'] }

function fake_result(exit_code: number | undefined, stdout: string, stderr = ''): ExecaResult {
	return { exitCode: exit_code, stdout, stderr } as unknown as ExecaResult
}

function stub(exit_code: number | undefined, stdout: string, stderr = ''): void {
	mocked_execa.mockResolvedValue(fake_result(exit_code, stdout, stderr))
}

beforeEach(() => {
	vi.resetAllMocks()
})

describe('josh_command.josh_run — the captured pnpm josh subprocess', () => {
	it('runs `pnpm josh <args>` and returns the exit code with trimmed stdout', async () => {
		stub(OK, '  17\n')

		const result = await josh_command.josh_run([DISPATCH, '17'])

		expect(result).toStrictEqual({ code: OK, out: '17', err: '' })
		expect(mocked_execa).toHaveBeenCalledWith(PNPM, [JOSH, DISPATCH, '17'], PIPED)
	})

	it('reads a missing exit code as a failure rather than a success', async () => {
		stub(undefined, '')

		const result = await josh_command.josh_run(['cost', '--over', '5'])

		expect(result.code).toBe(FALLBACK_EXIT)
	})

	it('forwards the child stderr and captures it too when told to forward it', async () => {
		const reason = 'refused: behind origin/main'

		stub(FALLBACK_EXIT, '', ` ${reason} \n`)

		const result = await josh_command.josh_run([BUDGET], true)

		expect(mocked_execa).toHaveBeenCalledWith(PNPM, [JOSH, BUDGET], FORWARDED)
		expect(result.err).toBe(reason)
	})

	it('bounds the subprocess when given a timeout, and reads the kill as a failure', async () => {
		const timeout_ms = 30_000

		stub(undefined, '')

		const result = await josh_command.josh_run([BUDGET], false, timeout_ms)

		expect(mocked_execa).toHaveBeenCalledWith(PNPM, [JOSH, BUDGET], {
			...PIPED,
			timeout: timeout_ms,
		})
		expect(result.code).toBe(FALLBACK_EXIT)
	})
})
