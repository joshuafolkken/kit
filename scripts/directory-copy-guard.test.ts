import { beforeEach, describe, expect, it, vi } from 'vitest'

const lstat_sync_mock = vi.hoisted(() => vi.fn())
const cp_sync_mock = vi.hoisted(() => vi.fn())
// The copy is followed by a transform pass over the copied markdown, so the mocked filesystem has to
// answer the walk too — an empty listing is the neutral answer for the suites that only test guards.
const readdir_sync_mock = vi.hoisted(() => vi.fn<() => Array<string>>(() => []))
const read_file_sync_mock = vi.hoisted(() => vi.fn<() => string>(() => ''))
const write_file_sync_mock = vi.hoisted(() => vi.fn())

vi.mock('node:fs', () => ({
	cpSync: cp_sync_mock,
	lstatSync: lstat_sync_mock,
	readdirSync: readdir_sync_mock,
	readFileSync: read_file_sync_mock,
	writeFileSync: write_file_sync_mock,
}))

const { classify_path, copy_directory_failure, directory_copy_blocker, transform_copied_tree } =
	await import('./directory-copy-guard')

const SOURCE = '/pkg/.claude/skills/verify-ui'
const DESTINATION = '/project/.claude/skills/verify-ui'

// The config sets no `clearMocks`, so without this the listing and file contents one suite installs
// are still installed for the next — and a test can then pass on a sibling suite's state rather than its
// own. Resetting to the neutral answers means every suite says what it needs.
beforeEach(() => {
	cp_sync_mock.mockReset()
	lstat_sync_mock.mockReset()
	readdir_sync_mock.mockReset().mockReturnValue([])
	read_file_sync_mock.mockReset().mockReturnValue('')
	write_file_sync_mock.mockReset()
})

function throwing(code: string): () => never {
	return () => {
		throw Object.assign(new Error(code), { code })
	}
}

function as_directory(): { isDirectory: () => boolean; isFile: () => boolean } {
	return { isDirectory: () => true, isFile: () => false }
}

function as_file(): { isDirectory: () => boolean; isFile: () => boolean } {
	return { isDirectory: () => false, isFile: () => true }
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

	// The copy and the rewrite are one operation: a tree copied but not rewritten still cites the
	// package's own `prompts/…` paths, which resolve to nothing in a consumer.
	it('rewrites the copied markdown as part of the copy', () => {
		cp_sync_mock.mockImplementation(() => undefined)
		lstat_sync_mock.mockReturnValue(as_file())
		readdir_sync_mock.mockReturnValue(['SKILL.md'])
		read_file_sync_mock.mockReturnValue('see `prompts/refactoring.md`')

		expect(copy_directory_failure(SOURCE, DESTINATION)).toBeUndefined()
		expect(write_file_sync_mock).toHaveBeenCalledWith(
			`${DESTINATION}/SKILL.md`,
			'see `node_modules/@joshuafolkken/kit/prompts/refactoring.md`',
		)
	})

	// The two failures leave the destination in opposite states, and the callers print the message as
	// the reason a directory was skipped. Saying "copy failed" for a rewrite that threw would tell the
	// user nothing was written when `cpSync` had already replaced the whole tree.
	it('distinguishes a failed rewrite from a failed copy', () => {
		cp_sync_mock.mockImplementation(() => undefined)
		lstat_sync_mock.mockReturnValue(as_file())
		readdir_sync_mock.mockReturnValue(['SKILL.md'])
		read_file_sync_mock.mockImplementation(throwing('EACCES'))

		const failure = copy_directory_failure(SOURCE, DESTINATION) ?? ''

		expect(failure).toContain('EACCES')
		expect(failure).toContain('copied but left partly un-rewritten')
		expect(failure).not.toContain('copy failed')
	})

	it('returns the message instead of letting the throw end the command', () => {
		cp_sync_mock.mockImplementation(throwing('ENOTSUP'))

		expect(copy_directory_failure(SOURCE, DESTINATION)).toContain('ENOTSUP')
	})
})

// Only markdown is rewritten. A skill that grows a binary supporting file — an image in a reference
// page, say — would be corrupted by a utf8 round-trip, and the paths it does not contain need none.
describe('transform_copied_tree', () => {
	it('leaves every non-markdown file untouched', () => {
		lstat_sync_mock.mockReturnValue(as_file())
		readdir_sync_mock.mockReturnValue(['diagram.png', 'reference.json'])

		transform_copied_tree(SOURCE, DESTINATION)

		expect(write_file_sync_mock).not.toHaveBeenCalled()
	})

	it('reaches markdown nested below the directory root', () => {
		lstat_sync_mock.mockReturnValue(as_file())
		readdir_sync_mock.mockReturnValue(['reference/deep.md'])
		read_file_sync_mock.mockReturnValue('`prompts/review.md`')

		transform_copied_tree(SOURCE, DESTINATION)

		expect(write_file_sync_mock).toHaveBeenCalledWith(
			`${DESTINATION}/reference/deep.md`,
			'`node_modules/@joshuafolkken/kit/prompts/review.md`',
		)
	})

	// The copy merges and never prunes, so a consumer's own notes sit beside the distributed files.
	// Listing the destination instead of the source would rewrite those too — editing text this
	// package never wrote, which is why the walk reads the source.
	it('lists the source, so a consumer file beside the copy is never rewritten', () => {
		lstat_sync_mock.mockReturnValue(as_file())
		readdir_sync_mock.mockReturnValue(['SKILL.md'])
		read_file_sync_mock.mockReturnValue('')

		transform_copied_tree(SOURCE, DESTINATION)

		expect(readdir_sync_mock).toHaveBeenCalledWith(SOURCE, expect.anything())
		expect(readdir_sync_mock).not.toHaveBeenCalledWith(DESTINATION, expect.anything())
	})
})

// The entries the walk classifies out before reading them.
describe('transform_copied_tree — what it leaves alone', () => {
	// A `.md` name is not a file to rewrite on its own: `readFileSync` answers a directory with
	// EISDIR and follows a symlink out of the tree, so both are classified out before the read
	// rather than taking the whole skill copy down with them.
	it.each([
		['a directory carrying the suffix', as_directory],
		['a path that cannot be inspected', () => throwing('EACCES')()],
	])('skips %s', (_label, answer) => {
		lstat_sync_mock.mockImplementation(answer)
		readdir_sync_mock.mockReturnValue(['nested.md'])

		transform_copied_tree(SOURCE, DESTINATION)

		expect(write_file_sync_mock).not.toHaveBeenCalled()
	})
})
