import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { changed_file_scope, type ScopeInputs, type ScopeVocabulary } from './changed-file-scope'
import { changed_paths } from './git/changed-paths'
import { git_command } from './git/git-command'

vi.mock('./git/git-command', () => ({ git_command: { repository_root: vi.fn() } }))
vi.mock('./git/changed-paths', () => ({ changed_paths: { read_changed_paths: vi.fn() } }))

const mocked_root = vi.mocked(git_command.repository_root)
const mocked_changed = vi.mocked(changed_paths.read_changed_paths)

// joshuafolkken/kit#1298: `josh test:related` and `josh lint:related` narrow by the same reading,
// and the one way it may not fail is quietly — a set narrowed to nothing checks nothing and reports
// success. Every branch that could produce that is asserted here, once, for both commands.

const ROOT = path.resolve('/repo')
const REPOSITORY_ROOT = process.cwd()
const CHANGED_SOURCE = path.join('scripts', 'changed-file-scope.ts')
const ABSOLUTE_SOURCE = path.join(REPOSITORY_ROOT, CHANGED_SOURCE)
const GIT_FAILURE = 'not a git repository'
const NOTHING_REASON = 'no changed file is one this check reads'
const LABEL = 'josh check:related'

// How many files the listing has to leave unnamed for the "and N more" line to be exercised.
const UNLISTED_FILE_COUNT = 2

function at(...segments: ReadonlyArray<string>): string {
	return path.join(ROOT, ...segments)
}

function written(): string {
	return vi
		.mocked(process.stdout.write)
		.mock.calls.map((call) => String(call[0]))
		.join('')
}

const SOURCE_FILE = at('scripts', 'thing.ts')
const OTHER_SOURCE_FILE = at('scripts', 'other.ts')
const DOCUMENT_FILE = at('docs', 'thing.md')

const VOCABULARY: ScopeVocabulary = {
	label: LABEL,
	fallback_suffix: 'checking everything instead',
	narrowed_suffix: 'checking only them',
}

function inputs(overrides: Partial<ScopeInputs> = {}): ScopeInputs {
	return {
		is_present: () => true,
		is_selectable: (file_path) => path.extname(file_path) === '.ts',
		nothing_reason: NOTHING_REASON,
		...overrides,
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	mocked_root.mockResolvedValue(REPOSITORY_ROOT)
	mocked_changed.mockResolvedValue([CHANGED_SOURCE])
})

describe('changed_file_scope.select_files', () => {
	it('keeps the selectable files the tree still holds', () => {
		const selected = changed_file_scope.select_files(
			[SOURCE_FILE, DOCUMENT_FILE, OTHER_SOURCE_FILE],
			inputs(),
		)

		expect(selected).toEqual([SOURCE_FILE, OTHER_SOURCE_FILE])
	})

	it('drops a path the tree no longer holds', () => {
		expect(
			changed_file_scope.select_files([SOURCE_FILE], inputs({ is_present: () => false })),
		).toEqual([])
	})
})

describe('changed_file_scope.resolve_scope', () => {
	it('narrows to the changed files this check reads', () => {
		const scope = changed_file_scope.resolve_scope([SOURCE_FILE, DOCUMENT_FILE], inputs())

		expect(scope.mode).toBe('related')
		expect(scope.files).toEqual([SOURCE_FILE])
	})

	it('falls back to everything when the changed files could not be read', () => {
		const scope = changed_file_scope.resolve_scope(undefined, inputs())

		expect(scope.mode).toBe('all')
		expect(scope.reason).toBe(changed_file_scope.UNREADABLE_REASON)
	})

	it.each([
		['nothing changed', []],
		['no changed file is one it reads', [DOCUMENT_FILE]],
	])('falls back to everything when %s', (_label, paths) => {
		const scope = changed_file_scope.resolve_scope(paths, inputs())

		expect(scope.mode).toBe('all')
		expect(scope.reason).toBe(NOTHING_REASON)
	})

	it('separates an unreadable change list from one that narrowed to nothing', () => {
		expect(changed_file_scope.resolve_scope(undefined, inputs()).reason).not.toBe(
			changed_file_scope.resolve_scope([], inputs()).reason,
		)
	})
})

describe('changed_file_scope.describe_scope', () => {
	it('names each file the run was narrowed by, relative to the root', () => {
		const scope = changed_file_scope.resolve_scope([SOURCE_FILE, OTHER_SOURCE_FILE], inputs())
		const description = changed_file_scope.describe_scope(scope, ROOT, VOCABULARY)

		expect(description).toContain('2 changed file(s)')
		expect(description).toContain(path.join('scripts', 'thing.ts'))
		expect(description).toContain(path.join('scripts', 'other.ts'))
	})

	it('caps the listing and says how many it did not name', () => {
		const files = Array.from(
			{ length: changed_file_scope.LISTED_FILE_LIMIT + UNLISTED_FILE_COUNT },
			(_unused, index) => at('scripts', `file-${String(index)}.ts`),
		)
		const scope = changed_file_scope.resolve_scope(files, inputs())

		expect(changed_file_scope.describe_scope(scope, ROOT, VOCABULARY)).toContain(
			`… and ${String(UNLISTED_FILE_COUNT)} more`,
		)
	})

	it('says which fallback was taken instead of reporting a narrowed run', () => {
		const scope = changed_file_scope.resolve_scope(undefined, inputs())
		const description = changed_file_scope.describe_scope(scope, ROOT, VOCABULARY)

		expect(description).toContain(VOCABULARY.fallback_suffix)
		expect(description).toContain(changed_file_scope.UNREADABLE_REASON)
	})
})

describe('changed_file_scope.read_changed_files', () => {
	it('resolves the changed paths against the repository root', async () => {
		await expect(changed_file_scope.read_changed_files(REPOSITORY_ROOT)).resolves.toEqual([
			ABSOLUTE_SOURCE,
		])
	})

	it('answers undefined — not an empty list — when git cannot be read', async () => {
		mocked_changed.mockRejectedValue(new Error(GIT_FAILURE))

		await expect(changed_file_scope.read_changed_files(REPOSITORY_ROOT)).resolves.toBeUndefined()
	})
})

describe('changed_file_scope.repository_root_or_cwd', () => {
	it('falls back to the working directory when git cannot answer', async () => {
		mocked_root.mockRejectedValue(new Error('no repository'))

		await expect(changed_file_scope.repository_root_or_cwd()).resolves.toBe(process.cwd())
	})
})

describe('changed_file_scope.resolve_command_scope', () => {
	it('prefers explicit file arguments over the git reading', async () => {
		const scope = await changed_file_scope.resolve_command_scope({
			command_arguments: [CHANGED_SOURCE],
			root: REPOSITORY_ROOT,
			inputs: inputs(),
		})

		expect(mocked_changed).not.toHaveBeenCalled()
		expect(scope.files).toEqual([ABSOLUTE_SOURCE])
	})

	it('reads the change when only flags were given', async () => {
		const scope = await changed_file_scope.resolve_command_scope({
			command_arguments: ['--silent'],
			root: REPOSITORY_ROOT,
			inputs: inputs(),
		})

		expect(scope.files).toEqual([ABSOLUTE_SOURCE])
	})
})

describe('changed_file_scope.report_unusable_arguments', () => {
	const MISSING_FILE = 'no-such-file.ts'

	beforeEach(() => {
		vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	})

	it('names a file argument the narrowing could not use', () => {
		const scope = changed_file_scope.resolve_scope([], inputs())

		changed_file_scope.report_unusable_arguments([MISSING_FILE], scope, LABEL)

		expect(written()).toContain(MISSING_FILE)
		expect(written()).toContain(LABEL)
	})

	it('says nothing when every named file was used', () => {
		const scope = changed_file_scope.resolve_scope([path.resolve(CHANGED_SOURCE)], inputs())

		changed_file_scope.report_unusable_arguments([CHANGED_SOURCE], scope, LABEL)

		expect(written()).toBe('')
	})
})

describe('changed_file_scope.is_flag', () => {
	it.each(['--silent', '-s'])('reads %j as a flag', (argument) => {
		expect(changed_file_scope.is_flag(argument)).toBe(true)
	})

	it('reads a path as a file', () => {
		expect(changed_file_scope.is_flag(CHANGED_SOURCE)).toBe(false)
	})
})
