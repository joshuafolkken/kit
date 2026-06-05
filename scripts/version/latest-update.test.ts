import { beforeEach, describe, expect, it, vi } from 'vitest'

const execa_sync_mock = vi.hoisted(() => vi.fn().mockReturnValue({ exitCode: 0 }))
const sync_mock = vi.hoisted(() => vi.fn())
const write_mock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execaSync: execa_sync_mock }))
vi.mock('node:fs', () => ({
	readFileSync: vi.fn().mockReturnValue('{"pnpm":{"overrides":{}},"packageManager":"pnpm@11.0.9"}'),
	writeFileSync: write_mock,
}))
vi.mock('./preinstall-version-update', () => ({
	preinstall_version_update: { sync: sync_mock },
}))
vi.mock('#scripts/overrides/overrides-logic', () => ({
	overrides_check: {
		read_overrides_from_package: vi.fn().mockReturnValue({}),
		extract_capped_package_names: vi.fn().mockReturnValue([]),
		build_update_command: vi.fn().mockReturnValue(['pnpm', 'update', '--latest']),
	},
}))

const { latest_update } = await import('./latest-update')

const PNPM = 'pnpm'
const UPDATE_ARGS = ['update', '--latest']

describe('latest_update.run — execaSync dispatch', () => {
	it('calls execaSync with the first argument as the command', () => {
		latest_update.run([PNPM, ...UPDATE_ARGS])

		expect(execa_sync_mock).toHaveBeenCalledWith(
			PNPM,
			UPDATE_ARGS,
			expect.objectContaining({ reject: false }),
		)
	})

	it('does nothing when arguments array is empty', () => {
		execa_sync_mock.mockClear()
		latest_update.run([])

		expect(execa_sync_mock).not.toHaveBeenCalled()
	})

	it('passes stdio inherit option to execaSync', () => {
		latest_update.run([PNPM, ...UPDATE_ARGS])

		expect(execa_sync_mock).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(Array),
			expect.objectContaining({ stdio: 'inherit' }),
		)
	})

	it('returns the exit code from execaSync', () => {
		execa_sync_mock.mockReturnValueOnce({ exitCode: 42 })

		expect(latest_update.run([PNPM, ...UPDATE_ARGS])).toBe(42)
	})

	it('returns 1 when execaSync exitCode is absent', () => {
		execa_sync_mock.mockReturnValueOnce({})

		expect(latest_update.run([PNPM, ...UPDATE_ARGS])).toBe(1)
	})
})

describe('latest_update.main — preinstall sync guard', () => {
	beforeEach(() => {
		sync_mock.mockReset()
		execa_sync_mock.mockReturnValue({ exitCode: 0 })
	})

	it('calls preinstall sync when update succeeds', () => {
		latest_update.main()

		expect(sync_mock).toHaveBeenCalled()
	})

	it('skips preinstall sync when update fails', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 1 })
		latest_update.main()

		expect(sync_mock).not.toHaveBeenCalled()
	})
})

describe('latest_update.main — packageManager preservation', () => {
	beforeEach(() => {
		write_mock.mockReset()
		execa_sync_mock.mockReturnValue({ exitCode: 0 })
	})

	it('does not write package.json to strip packageManager field', () => {
		latest_update.main()

		const stripping_call = write_mock.mock.calls.find(([, content]) => {
			if (typeof content !== 'string') return false

			return !content.includes('packageManager')
		})

		expect(stripping_call).toBeUndefined()
	})
})
