import { describe, expect, it, vi } from 'vitest'

const spawn_mock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ spawnSync: spawn_mock }))
vi.mock('node:fs', () => ({ readFileSync: vi.fn().mockReturnValue('{"pnpm":{"overrides":{}}}') }))
vi.mock('./overrides/overrides-logic', () => ({
	overrides_check: {
		read_overrides_from_package: vi.fn().mockReturnValue({}),
		extract_capped_package_names: vi.fn().mockReturnValue([]),
		build_update_command: vi.fn().mockReturnValue(['pnpm', 'update', '--latest']),
	},
}))

const { latest_update } = await import('./latest-update')

const PNPM = 'pnpm'
const UPDATE_ARGS = ['update', '--latest']

describe('latest_update.run — spawnSync dispatch', () => {
	it('calls spawnSync with the first argument as the command', () => {
		latest_update.run([PNPM, ...UPDATE_ARGS])

		expect(spawn_mock).toHaveBeenCalledWith(
			PNPM,
			UPDATE_ARGS,
			expect.objectContaining({ shell: false }),
		)
	})

	it('does nothing when arguments array is empty', () => {
		spawn_mock.mockClear()
		latest_update.run([])

		expect(spawn_mock).not.toHaveBeenCalled()
	})

	it('passes stdio inherit option to spawnSync', () => {
		latest_update.run([PNPM, ...UPDATE_ARGS])

		expect(spawn_mock).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(Array),
			expect.objectContaining({ stdio: 'inherit' }),
		)
	})
})
