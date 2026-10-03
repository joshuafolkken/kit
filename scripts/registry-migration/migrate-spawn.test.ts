import { COMMAND_TIMEOUT_MS, INSTALL_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execa } from 'execa'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registry_migration } from './migrate'

vi.mock('execa', () => ({ execa: vi.fn() }))

const mocked_execa = vi.mocked(execa)
const CWD = '/project'
const REGISTRY = 'https://registry.npmjs.org/'

function stub_stdout(stdout: string): void {
	mocked_execa.mockResolvedValue({ stdout } as unknown as Awaited<ReturnType<typeof execa>>)
}

afterEach(() => {
	mocked_execa.mockReset()
})

// joshuafolkken/kit#2981: a stalled `pnpm` must not hold the migration forever.
describe('registry_migration — spawned pnpm commands carry a time limit', () => {
	it('bounds the lockfile install with the shared install time limit', async () => {
		stub_stdout('')
		await registry_migration.install(CWD)

		expect(mocked_execa).toHaveBeenCalledWith('pnpm', expect.any(Array), {
			cwd: CWD,
			timeout: INSTALL_TIMEOUT_MS,
		})
	})

	it('bounds the registry query with the shared command time limit', async () => {
		stub_stdout(` ${REGISTRY} \n`)

		expect(await registry_migration.effective_registry(CWD)).toBe(REGISTRY)
		expect(mocked_execa).toHaveBeenCalledWith('pnpm', expect.any(Array), {
			cwd: CWD,
			timeout: COMMAND_TIMEOUT_MS,
		})
	})
})
