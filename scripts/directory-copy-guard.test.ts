import { describe, expect, it, vi } from 'vitest'

const lstat_sync_mock = vi.hoisted(() => vi.fn())
const cp_sync_mock = vi.hoisted(() => vi.fn())

vi.mock('node:fs', () => ({
	cpSync: cp_sync_mock,
	lstatSync: lstat_sync_mock,
}))

const { classify_path, copy_directory_failure, directory_copy_blocker } =
	await import('./directory-copy-guard')

const SOURCE = '/pkg/.claude/skills/verify-ui'
const DESTINATION = '/project/.claude/skills/verify-ui'

function throwing(code: string): () => never {
	return () => {
		throw Object.assign(new Error(code), { code })
	}
}

function as_directory(): { isDirectory: () => boolean } {
	return { isDirectory: () => true }
}

describe('classify_path', () => {
	it('reads a directory as a directory', () => {
		lstat_sync_mock.mockReturnValue(as_directory())

		expect(classify_path(DESTINATION)).toBe('directory')
	})

	it('reads a file, a symlink or a broken link as something other than a directory', () => {
		lstat_sync_mock.mockReturnValue({ isDirectory: () => false })

		expect(classify_path(DESTINATION)).toBe('other')
	})

	it('reads a missing path as absent', () => {
		lstat_sync_mock.mockImplementation(throwing('ENOENT'))

		expect(classify_path(DESTINATION)).toBe('absent')
	})

	// Absent is the only answer that lets the copy proceed, so every error that means "something is
	// here and I could not read it" has to land on the other side. ENOTDIR is the trap: a component
	// of the path is a file, which is the opposite of nothing being there.
	it.each(['EACCES', 'EPERM', 'ENOTDIR', 'ELOOP'])('does not read %s as absent', (code) => {
		lstat_sync_mock.mockImplementation(throwing(code))

		expect(classify_path(DESTINATION)).toBe('other')
	})
})

describe('directory_copy_blocker', () => {
	it('allows a real directory copied to an absent destination', () => {
		lstat_sync_mock.mockImplementation((candidate: string) =>
			candidate === SOURCE ? as_directory() : throwing('ENOENT')(),
		)

		expect(directory_copy_blocker(SOURCE, DESTINATION)).toBeUndefined()
	})

	it('blocks a source the package does not carry', () => {
		lstat_sync_mock.mockImplementation(throwing('ENOENT'))

		expect(directory_copy_blocker(SOURCE, DESTINATION)).toContain('missing from the installed')
	})

	it('blocks a copy onto the package itself', () => {
		lstat_sync_mock.mockReturnValue(as_directory())

		expect(directory_copy_blocker(SOURCE, SOURCE)).toContain("package's own copy")
	})
})

// The guards above answer what is knowable before the walk; this one is about the walk itself, where
// a type conflict nested inside the tree surfaces only once `cpSync` reaches it.
describe('copy_directory_failure', () => {
	it('returns nothing when the copy succeeds', () => {
		cp_sync_mock.mockImplementation(() => undefined)

		expect(copy_directory_failure(SOURCE, DESTINATION)).toBeUndefined()
	})

	it('returns the message instead of letting the throw end the command', () => {
		cp_sync_mock.mockImplementation(throwing('ENOTSUP'))

		expect(copy_directory_failure(SOURCE, DESTINATION)).toContain('ENOTSUP')
	})
})
