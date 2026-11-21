import { run_startup } from '#scripts/run/startup/run-startup'
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

	it('keeps defaults when optional values are explicitly undefined', async () => {
		stub(OK, ' output ')

		const result = await josh_command.josh_run([BUDGET], {
			should_forward_stderr: undefined,
			timeout_ms: undefined,
			environment: undefined,
		})

		expect(mocked_execa).toHaveBeenCalledWith(PNPM, [JOSH, BUDGET], PIPED)
		expect(result).toStrictEqual({ code: OK, out: 'output', err: '' })
	})
})

describe('josh_command.josh_run — explicit options', () => {
	it('keeps stderr piped when forwarding is explicitly disabled', async () => {
		stub(FALLBACK_EXIT, ' output ', ' reason ')

		const result = await josh_command.josh_run([BUDGET], { should_forward_stderr: false })

		expect(mocked_execa).toHaveBeenCalledWith(PNPM, [JOSH, BUDGET], PIPED)
		expect(result).toStrictEqual({ code: FALLBACK_EXIT, out: 'output', err: 'reason' })
	})

	it('applies forwarding, timeout and additional environment together', async () => {
		const timeout_ms = 30_000
		const environment = { EXTRA: 'kept' }

		stub(OK, ' output ', ' warning ')

		const result = await josh_command.josh_run([BUDGET], {
			should_forward_stderr: true,
			timeout_ms,
			environment,
		})

		expect(mocked_execa).toHaveBeenCalledWith(PNPM, [JOSH, BUDGET], {
			...FORWARDED,
			timeout: timeout_ms,
			env: environment,
		})
		expect(result).toStrictEqual({ code: OK, out: 'output', err: 'warning' })
	})
})

describe('josh_command.josh_run — failures and forwarding', () => {
	it('reads a missing exit code as a failure rather than a success', async () => {
		stub(undefined, '')

		const result = await josh_command.josh_run(['cost', '--over', '5'])

		expect(result.code).toBe(FALLBACK_EXIT)
	})

	it('forwards the child stderr and captures it too when told to forward it', async () => {
		const reason = 'refused: behind origin/main'

		stub(FALLBACK_EXIT, '', ` ${reason} \n`)

		const result = await josh_command.josh_run([BUDGET], { should_forward_stderr: true })

		expect(mocked_execa).toHaveBeenCalledWith(PNPM, [JOSH, BUDGET], FORWARDED)
		expect(result.err).toBe(reason)
	})

	it('bounds the subprocess when given a timeout, and reads the kill as a failure', async () => {
		const timeout_ms = 30_000

		stub(undefined, '')

		const result = await josh_command.josh_run([BUDGET], { timeout_ms })

		expect(mocked_execa).toHaveBeenCalledWith(PNPM, [JOSH, BUDGET], {
			...PIPED,
			timeout: timeout_ms,
		})
		expect(result.code).toBe(FALLBACK_EXIT)
	})
})

// joshuafolkken/kit#4985: `josh ship` switches the local commit's lint hooks off this way.
describe('josh_command.josh_run — the environment', () => {
	it('forwards the active startup span through both subprocess entries', async () => {
		const place = { run: 'run', attempt: 'attempt', issue: '7422', span: 'span' }

		stub(OK, '')

		await run_startup.within(place, async () => {
			await josh_command.josh_run([BUDGET], { environment: { EXTRA: 'kept' } })
			await josh_command.josh_run_at([BUDGET], '/lane')
		})

		expect(mocked_execa).toHaveBeenNthCalledWith(1, PNPM, [JOSH, BUDGET], {
			...PIPED,
			env: { JOSH_STARTUP_SCOPE: JSON.stringify(place), EXTRA: 'kept' },
		})
		expect(mocked_execa).toHaveBeenNthCalledWith(2, PNPM, [JOSH, BUDGET], {
			...PIPED,
			cwd: '/lane',
			env: { JOSH_STARTUP_SCOPE: JSON.stringify(place) },
		})
	})
	it('adds the given variables to the environment the subprocess inherits', async () => {
		const environment = { JOSH_PRE_COMMIT_LINT: 'off' }

		stub(OK, '')

		await josh_command.josh_run([BUDGET], { environment })

		expect(mocked_execa).toHaveBeenCalledWith(PNPM, [JOSH, BUDGET], {
			...PIPED,
			env: environment,
		})
	})
})

describe('josh_command.josh_run_at', () => {
	it('runs a command in the requested checkout and captures a failure there', async () => {
		const cwd = '/primary/checkout'

		stub(FALLBACK_EXIT, ' output ', ' reason ')

		await expect(josh_command.josh_run_at([BUDGET], cwd)).resolves.toStrictEqual({
			code: FALLBACK_EXIT,
			out: 'output',
			err: 'reason',
		})
		expect(mocked_execa).toHaveBeenCalledWith(PNPM, [JOSH, BUDGET], { ...PIPED, cwd })
	})
})
