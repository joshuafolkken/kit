import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { unused_members_cache, type UnusedMembersScan } from './unused-members-cache'

const create_directory = temporary_directory()
const LOCKFILE = 'pnpm-lock.yaml'
const SOURCE = 'source.ts'
const INPUTS = { roots: [SOURCE] }

interface Checkout {
	root: string
	source: string
	scan: () => UnusedMembersScan
	calls: () => number
}

function checkout(): Checkout {
	const root = create_directory('unused-members-cache-')
	const source = path.join(root, SOURCE)
	const member = { namespace: 'space', member: 'unused', file: source, line: 1 }
	const scan = vi.fn(() => ({ members: [{ ...member, declaration: {} }], files: [source] }))

	writeFileSync(source, 'export const value = 1\n')
	writeFileSync(path.join(root, LOCKFILE), 'lockfileVersion: 9\n')
	vi.spyOn(git_common_directory, 'own').mockReturnValue(create_directory('unused-members-git-'))

	return { root, source, scan, calls: () => scan.mock.calls.length }
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('unused_members_cache.reuse', () => {
	it('reuses the last scan while its inputs and loaded files are unchanged', () => {
		const { root, source, scan, calls } = checkout()
		const first = unused_members_cache.reuse(root, INPUTS, scan)
		const second = unused_members_cache.reuse(root, INPUTS, scan)

		expect(calls()).toBe(1)
		expect(second).toStrictEqual([{ namespace: 'space', member: 'unused', file: source, line: 1 }])
		expect(first).toHaveLength(1)
	})

	it('scans again when a loaded file changes', () => {
		const { root, source, scan, calls } = checkout()

		unused_members_cache.reuse(root, INPUTS, scan)
		writeFileSync(source, 'export const value = 2\n')
		unused_members_cache.reuse(root, INPUTS, scan)

		expect(calls()).toBe(2)
	})

	it('scans again when the inputs change', () => {
		const { root, scan, calls } = checkout()

		unused_members_cache.reuse(root, INPUTS, scan)
		unused_members_cache.reuse(root, { roots: [] }, scan)

		expect(calls()).toBe(2)
	})
})

describe('unused_members_cache.reuse beyond the scan inputs', () => {
	it('scans again when the lockfile changes', () => {
		const { root, scan, calls } = checkout()

		unused_members_cache.reuse(root, INPUTS, scan)
		writeFileSync(path.join(root, LOCKFILE), 'lockfileVersion: 10\n')
		unused_members_cache.reuse(root, INPUTS, scan)

		expect(calls()).toBe(2)
	})

	it('always scans outside a git checkout', () => {
		const { root, scan, calls } = checkout()

		vi.mocked(git_common_directory.own).mockReturnValue(undefined)
		unused_members_cache.reuse(root, INPUTS, scan)
		unused_members_cache.reuse(root, INPUTS, scan)

		expect(calls()).toBe(2)
	})
})
