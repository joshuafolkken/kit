import { readFileSync, writeFileSync } from 'node:fs'
import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { latest_corepack } from './latest-corepack'
import { fake_sync_result } from './latest-corepack-fixture'
import { build_package_manager_manifest } from './package-manager-manifest-fixture'

vi.mock('execa', () => ({ execaSync: vi.fn() }))
vi.mock('node:fs', () => ({ readFileSync: vi.fn(), writeFileSync: vi.fn() }))

const TARGET = 'pnpm@12.6.0'
const VALID_INTEGRITY = `sha512-${Buffer.alloc(64, 1).toString('base64')}`
const EXPECTED_PIN = `12.6.0+sha512.${Buffer.alloc(64, 1).toString('hex')}`

beforeEach(() => {
	vi.resetAllMocks()
})

describe('latest_corepack.query_integrity', () => {
	it('converts the signed registry digest to a Corepack-compatible pin suffix', () => {
		vi.mocked(execaSync).mockReturnValue(fake_sync_result(0, JSON.stringify(VALID_INTEGRITY)))

		expect(latest_corepack.query_integrity(TARGET)).toBe(EXPECTED_PIN.slice('12.6.0+'.length))
		expect(execaSync).toHaveBeenCalledWith(
			'pnpm',
			['view', TARGET, 'dist.integrity', '--json'],
			expect.objectContaining({ reject: false }),
		)
	})

	it('ignores a safe-chain notice outside the registry value', () => {
		vi.mocked(execaSync).mockReturnValue(
			fake_sync_result(0, `${JSON.stringify(VALID_INTEGRITY)}\nSafe-chain notice`),
		)

		expect(latest_corepack.query_integrity(TARGET)).toBe(EXPECTED_PIN.slice('12.6.0+'.length))
	})

	it.each([
		fake_sync_result(1, ''),
		fake_sync_result(0, ''),
		fake_sync_result(0, '{broken'),
		fake_sync_result(0, JSON.stringify('sha512-invalid')),
	])('rejects a missing or malformed registry digest', (result) => {
		vi.mocked(execaSync).mockReturnValue(result)

		expect(latest_corepack.query_integrity(TARGET)).toBeUndefined()
	})
})

describe('latest_corepack.restore_integrity', () => {
	it('restores identical pins after pnpm strips the integrity suffix', () => {
		vi.mocked(readFileSync).mockReturnValue(build_package_manager_manifest(TARGET, '12.6.0'))

		latest_corepack.restore_integrity(TARGET, EXPECTED_PIN.slice('12.6.0+'.length))

		expect(writeFileSync).toHaveBeenCalledWith(
			'package.json',
			build_package_manager_manifest(`pnpm@${EXPECTED_PIN}`, EXPECTED_PIN),
		)
	})

	it('rejects an unexpected version without writing either pin', () => {
		vi.mocked(readFileSync).mockReturnValue(build_package_manager_manifest('pnpm@12.5.0', '12.5.0'))

		expect(() => {
			latest_corepack.restore_integrity(TARGET, 'sha512.abc')
		}).toThrow()
		expect(writeFileSync).not.toHaveBeenCalled()
	})
})
