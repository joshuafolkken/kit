import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import ts from 'typescript'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { review_code_tree } from './review-code-tree'
import { review_stamps } from './review-stamps'

// joshuafolkken/kit#3826: the comment-free digests round 1 records, and the comparison round 2 reads
// them through. Real files in a temp root; TypeScript is passed in, because the temp root has none to
// resolve — which is itself the case of a consumer without it.

const ROOT = mkdtempSync(path.join(tmpdir(), 'josh-review-code-tree-'))
const RECORD_PATH = path.join(ROOT, 'round1-code.json')
const SOURCE = 'src/thing.ts'
const OTHER_SOURCE = 'src/other.ts'
const COMPONENT = 'src/view.svelte'
const DOCUMENT = 'docs/guide.md'
const HOOK = '.claude/hooks/guard.js'
const DELETED = 'src/gone.ts'
const BASE = '0123456789abcdef0123456789abcdef01234567'
const CODE = 'const value = 1\n'
const CHANGED_CODE = 'const value = 2\n'

function write(relative: string, text: string): void {
	mkdirSync(path.dirname(path.join(ROOT, relative)), { recursive: true })
	writeFileSync(path.join(ROOT, relative), text)
}

function stamp_of(files: Record<string, string>): {
	taken_at: string
	files: Record<string, string>
	base: string
} {
	return { taken_at: '', files, base: BASE }
}

// `git show <base>:<path>` answering from `files` with the final newline stripped, as `git_spawn.read`
// returns it, and failing for a path the base does not hold.
function base_holds(files: Record<string, string>): void {
	vi.spyOn(git_command, 'show_file').mockImplementation(async (spec) => {
		const text = files[spec.slice(BASE.length + 1)]
		if (text === undefined) throw new Error(`fatal: path not in ${spec}`)

		return text.replace(/\n$/u, '')
	})
}

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(RECORD_PATH, { force: true })
})

afterAll(() => {
	rmSync(ROOT, { recursive: true, force: true })
})

describe('review_code_tree.tree_of — which paths get a code digest', () => {
	it('digests source files and leaves out documentation, `.claude/` and deleted paths', () => {
		write(SOURCE, CODE)
		write(COMPONENT, '<p>hi</p>\n')
		write(DOCUMENT, '# Guide\n')
		write(HOOK, CODE)

		const tree = review_code_tree.tree_of(ROOT, [SOURCE, COMPONENT, DOCUMENT, HOOK, DELETED], ts)

		expect(Object.keys(tree)).toStrictEqual([SOURCE, COMPONENT])
	})

	it('records nothing where TypeScript cannot be resolved from the project', () => {
		write(SOURCE, CODE)

		expect(review_code_tree.tree_of(ROOT, [SOURCE])).toStrictEqual({})
	})
})

describe('review_code_tree.comment_only — the paths whose code the fixes left alone', () => {
	it('names a file whose fix changed only a comment, and not one whose code changed', () => {
		write(SOURCE, CODE)
		write(OTHER_SOURCE, CODE)
		const before = review_code_tree.tree_of(ROOT, [SOURCE, OTHER_SOURCE], ts)

		write(SOURCE, `// Explained.\n${CODE}`)
		write(OTHER_SOURCE, CHANGED_CODE)
		const after = review_code_tree.tree_of(ROOT, [SOURCE, OTHER_SOURCE], ts)

		expect(review_code_tree.comment_only(stamp_of(before), after, BASE)).toStrictEqual([SOURCE])
	})

	it('names, on a moved base, only the file the move left alone (joshuafolkken/kit#4165)', () => {
		const files = { [SOURCE]: 'digest', [OTHER_SOURCE]: 'digest' }

		expect(review_code_tree.comment_only(stamp_of(files), files, 'other', [SOURCE])).toStrictEqual([
			SOURCE,
		])
	})

	it('names nothing against a record taken on another base, or with none', () => {
		const files = { [SOURCE]: 'digest' }

		expect(review_code_tree.comment_only(stamp_of(files), files, 'other')).toStrictEqual([])
		expect(review_code_tree.comment_only(stamp_of(files), files, undefined)).toStrictEqual([])
		expect(review_code_tree.comment_only(undefined, files, BASE)).toStrictEqual([])
	})

	it('names nothing for a file the fix deleted', () => {
		expect(review_code_tree.comment_only(stamp_of({ [SOURCE]: 'digest' }), {}, BASE)).toStrictEqual(
			[],
		)
	})
})

// joshuafolkken/kit#5656: before round 1 has recorded anything, the base's blobs stand in for the
// snapshot.
describe('review_code_tree.comment_only_since — the paths whose code the base already had', () => {
	it('names a file whose change is only a comment, and not one whose code changed', async () => {
		base_holds({ [SOURCE]: CODE, [OTHER_SOURCE]: CODE })
		write(SOURCE, `// Explained.\n${CODE}`)
		write(OTHER_SOURCE, CHANGED_CODE)

		expect(
			await review_code_tree.comment_only_since(BASE, [SOURCE, OTHER_SOURCE], ROOT, ts),
		).toStrictEqual([SOURCE])
	})

	it('names neither a file new since the base nor a documentation path', async () => {
		base_holds({ [DOCUMENT]: '# Guide\n' })
		write(SOURCE, CODE)
		write(DOCUMENT, '# Guide\n')

		expect(
			await review_code_tree.comment_only_since(BASE, [SOURCE, DOCUMENT], ROOT, ts),
		).toStrictEqual([])
	})

	it('names nothing where TypeScript cannot be resolved from the project', async () => {
		base_holds({ [SOURCE]: CODE })
		write(SOURCE, CODE)

		expect(await review_code_tree.comment_only_since(BASE, [SOURCE], ROOT)).toStrictEqual([])
	})
})

describe('review_code_tree.record — written beside the round-1 snapshot', () => {
	it('writes the code record with the base it was taken against', async () => {
		await review_code_tree.record([SOURCE], BASE, RECORD_PATH, ROOT)

		expect(review_stamps.round_one_code_stamp.read(RECORD_PATH)?.base).toBe(BASE)
	})

	it('removes an earlier record when the write fails, rather than keep one from another moment', async () => {
		review_stamps.round_one_code_stamp.write({ [SOURCE]: 'old' }, RECORD_PATH, BASE)
		vi.spyOn(review_stamps.round_one_code_stamp, 'write').mockImplementation(() => {
			throw new Error('the temp directory is not writable')
		})

		await review_code_tree.record([SOURCE], BASE, RECORD_PATH, ROOT)

		expect(review_stamps.round_one_code_stamp.read(RECORD_PATH)).toBeUndefined()
	})
})
