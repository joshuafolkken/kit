import { describe, expect, it, vi } from 'vitest'

// The companion to sync-directory.test.ts, which exercises the guards against the real filesystem
// and can therefore only reach the cases kit's own tree produces: inside kit the package and the
// project are one directory, so a destination that is a file, or a source under a different root,
// cannot be staged without writing into the repository root — and several suites here assert on that
// root's own listing. Mocking what `lstat` answers is what makes the remaining guards testable.
const exists_sync_mock = vi.hoisted(() => vi.fn())
const lstat_sync_mock = vi.hoisted(() => vi.fn())
const cp_sync_mock = vi.hoisted(() => vi.fn())

// The guard reads every path with `lstat`, so a test drives it by saying what `lstat` answers:
// a directory entry, a non-directory entry, or a throw for a path that is not there at all.
function as_directory(): { isDirectory: () => boolean } {
	return { isDirectory: () => true }
}

function as_other(): { isDirectory: () => boolean } {
	return { isDirectory: () => false }
}

// The code is the part that matters: the guard reads only an ENOENT-coded error as "nothing there",
// so an error without one would be classified as a path it could not inspect.
function as_absent(): never {
	throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
}

vi.mock('node:fs', () => ({
	cpSync: cp_sync_mock,
	existsSync: exists_sync_mock,
	lstatSync: lstat_sync_mock,
	mkdirSync: vi.fn(),
	readFileSync: vi.fn().mockReturnValue(''),
	rmSync: vi.fn(),
	writeFileSync: vi.fn(),
}))
vi.mock('#scripts/init/init-paths', () => ({
	PACKAGE_DIR: '/pkg',
	PROJECT_ROOT: '/project',
	package_path: (name: string) => `/pkg/${name}`,
}))

const { sync_directory } = await import('./sync')

const SKILL_DIRECTORY = '.claude/skills/verify-ui'
const SOURCE_PATH = `/pkg/${SKILL_DIRECTORY}`
const DESTINATION_PATH = `/project/${SKILL_DIRECTORY}`

function run_sync(): ReadonlyArray<string> {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

	cp_sync_mock.mockClear()
	sync_directory(SKILL_DIRECTORY)

	const messages = warn.mock.calls.map((call) => String(call[0]))

	warn.mockRestore()
	info.mockRestore()

	return messages
}

describe('sync_directory — destination guards', () => {
	it('copies when the source is a directory and the destination is absent', () => {
		lstat_sync_mock.mockImplementation((candidate: string) =>
			candidate === SOURCE_PATH ? as_directory() : as_absent(),
		)

		expect(run_sync()).toStrictEqual([])
		expect(cp_sync_mock).toHaveBeenCalledWith(SOURCE_PATH, DESTINATION_PATH, { recursive: true })
	})

	it('copies over a destination that is already a directory', () => {
		lstat_sync_mock.mockReturnValue(as_directory())

		expect(run_sync()).toStrictEqual([])
		expect(cp_sync_mock).toHaveBeenCalled()
	})

	// cpSync answers this one with ERR_FS_CP_DIR_TO_NON_DIR, which would end the sync before the
	// config, package.json and repository-settings steps that follow it.
	// One case covers a file, a symlink to a directory and a broken symlink alike: `lstat` reports all
	// three as non-directories, which is exactly why the guard reads them that way. `stat` would call
	// the symlinked directory a directory, and `existsSync` would call the broken link absent — and
	// `cpSync` refuses all three, the broken one by ending the process rather than throwing.
	it('skips a destination that is not a real directory', () => {
		lstat_sync_mock.mockImplementation((candidate: string) =>
			candidate === SOURCE_PATH ? as_directory() : as_other(),
		)

		expect(run_sync().join('\n')).toContain('destination is not a directory')
		expect(cp_sync_mock).not.toHaveBeenCalled()
	})

	it('skips a source the package does not carry', () => {
		lstat_sync_mock.mockImplementation(() => as_absent())

		expect(run_sync().join('\n')).toContain('missing from the installed package')
		expect(cp_sync_mock).not.toHaveBeenCalled()
	})
})
