import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PLATFORM_TEMP_ROOT } from '#scripts/josh/platform-temporary'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { temporary_directory } from './temporary-directory'

const hooks = vi.hoisted(() => ({
	test: new Array<() => void>(),
	suite: new Array<() => void>(),
}))

vi.mock('vitest', async (import_original) => ({
	...(await import_original<Record<string, unknown>>()),
	afterEach: (cleanup: () => void): void => {
		hooks.test.push(cleanup)
	},
	afterAll: (cleanup: () => void): void => {
		hooks.suite.push(cleanup)
	},
}))

beforeEach(() => {
	for (const cleanup of [...hooks.test.splice(0), ...hooks.suite.splice(0)]) cleanup()
})

const PREFIX = 'temporary-directory-'

describe('temporary_directory', () => {
	it('creates unique directories below the platform temporary root', () => {
		const create = temporary_directory()
		const first = create(PREFIX)
		const second = create(PREFIX)

		expect(first).not.toBe(second)
		expect(path.dirname(first)).toBe(PLATFORM_TEMP_ROOT)
		expect(existsSync(first)).toBe(true)
		expect(existsSync(second)).toBe(true)
		hooks.test[0]?.()
	})

	it('removes every directory and nested file after each test', () => {
		const create = temporary_directory()
		const first = create(PREFIX)
		const second = create(PREFIX)

		mkdirSync(path.join(first, 'nested'))
		writeFileSync(path.join(first, 'nested', 'file'), 'content')

		hooks.test[0]?.()

		expect(existsSync(first)).toBe(false)
		expect(existsSync(second)).toBe(false)
	})
})

describe('temporary_directory lifecycle', () => {
	it('tracks new roots after an earlier test has been cleaned', () => {
		const create = temporary_directory()
		const first = create(PREFIX)

		hooks.test[0]?.()

		const second = create(PREFIX)

		expect(existsSync(first)).toBe(false)
		expect(existsSync(second)).toBe(true)
		hooks.test[0]?.()
		expect(existsSync(second)).toBe(false)
	})

	it('retains a suite root until the suite cleanup hook', () => {
		const create = temporary_directory('suite')
		const directory = create(PREFIX)

		expect(hooks.test).toHaveLength(0)
		expect(existsSync(directory)).toBe(true)
		hooks.suite[0]?.()
		expect(existsSync(directory)).toBe(false)
	})
})

describe('temporary_directory nested ownership', () => {
	it('keeps a suite parent when a test child is removed', () => {
		const create_parent = temporary_directory('suite')
		const create_child = temporary_directory()
		const parent = create_parent(PREFIX)
		const child = create_child(path.join(parent, 'child-'))

		hooks.test[0]?.()

		expect(existsSync(parent)).toBe(true)
		expect(existsSync(child)).toBe(false)
		hooks.suite[0]?.()
	})
})

describe('temporary_directory teardown', () => {
	it('tolerates explicit teardown and repeated cleanup', () => {
		const create = temporary_directory()
		const directory = create(PREFIX)

		rmSync(directory, { recursive: true })

		expect(() => hooks.test[0]?.()).not.toThrow()
		expect(() => hooks.test[0]?.()).not.toThrow()
	})

	it('does not register a failed creation for cleanup', () => {
		const create = temporary_directory()
		const parent = create(PREFIX)

		expect(() => create(path.join(parent, 'missing', 'child-'))).toThrow()
		expect(() => hooks.test[0]?.()).not.toThrow()
		expect(existsSync(parent)).toBe(false)
	})
})
