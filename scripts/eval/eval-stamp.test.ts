import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { eval_stamp } from './eval-stamp'
import {
	STAMP_DOCUMENT,
	STAMP_HASH,
	stamp_of,
	STAMP_OTHER_HASH,
	STAMP_STARTED_AT,
} from './eval-stamp-fixture'
import { eval_trigger } from './eval-trigger'

// joshuafolkken/kit#1152: `josh eval` now starts alongside `/code-review`, so its result describes
// the tree as it stood when the run began. This is the record that says whether the review moved it.

const SKILL_ENTRY = '.claude/skills'
const REVIEWED_FILE = 'prompts/review.md'
const ORIGINAL_CONTENT = 'someone else owns this'

const scratch = mkdtempSync(path.join(tmpdir(), 'josh-eval-stamp-test-'))

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

describe('eval_stamp.files_under', () => {
	it('expands a file entry to itself', () => {
		expect(eval_stamp.files_under(STAMP_DOCUMENT)).toStrictEqual([STAMP_DOCUMENT])
	})

	it('expands a directory entry to the files beneath it', () => {
		const files = eval_stamp.files_under(SKILL_ENTRY)

		expect(files).toContain('.claude/skills/workflow-commands/eval-gate.md')
		expect(files.every((file) => file.startsWith(`${SKILL_ENTRY}/`))).toBe(true)
	})

	// An installed kit need not carry every path this repository does, and a record that refused to
	// be taken would answer `required` forever — which is the serial behavior this issue removes.
	it('contributes nothing for an entry that is not there', () => {
		expect(eval_stamp.files_under('prompts-archive')).toStrictEqual([])
	})
})

describe('eval_stamp.read_tree', () => {
	it('hashes every measured path the repository carries', () => {
		const tree = eval_stamp.read_tree()

		expect(tree[STAMP_DOCUMENT]).toBeDefined()
		expect(tree[REVIEWED_FILE]).toBeDefined()
	})

	// The record is compared against a later reading of the same tree, so two readings of an
	// unchanged tree have to agree exactly — otherwise every check would report a review that
	// touched nothing as having touched everything.
	it('reads an unchanged tree the same way twice', () => {
		expect(eval_stamp.read_tree()).toStrictEqual(eval_stamp.read_tree())
	})

	it('names nothing outside the trigger set', () => {
		const outside = Object.keys(eval_stamp.read_tree()).filter(
			(file) => !eval_trigger.is_measured(file),
		)

		expect(outside).toStrictEqual([])
	})
})

describe('eval_stamp.changed_since', () => {
	it('reports nothing when the tree has not moved', () => {
		const files = { [STAMP_DOCUMENT]: STAMP_HASH }

		expect(eval_stamp.changed_since(stamp_of(files), { ...files })).toStrictEqual([])
	})

	it('reports a file whose contents changed', () => {
		const changed = eval_stamp.changed_since(stamp_of({ [STAMP_DOCUMENT]: STAMP_HASH }), {
			[STAMP_DOCUMENT]: STAMP_OTHER_HASH,
		})

		expect(changed).toStrictEqual([STAMP_DOCUMENT])
	})

	// A review that files a new skill page changes what the scenarios read just as an edit does, and
	// so does one that deletes a rule outright.
	it('reports an added file and a removed one', () => {
		const before = stamp_of({ [STAMP_DOCUMENT]: STAMP_HASH })
		const after = { [REVIEWED_FILE]: STAMP_HASH }

		expect(eval_stamp.changed_since(before, after)).toStrictEqual([STAMP_DOCUMENT, REVIEWED_FILE])
	})
})

describe('eval_stamp.try_read_tree', () => {
	it('reads the same tree the direct call does', () => {
		expect(eval_stamp.try_read_tree()).toStrictEqual(eval_stamp.read_tree())
	})

	// A review applying its own fixes can delete or rename a measured file between the walk and the
	// read. The throw must not escape: it would kill the process before the command printed anything,
	// and a caller capturing the answer would read an empty string instead of `required`.
	it('answers with nothing rather than throwing when a measured path will not read', () => {
		expect(
			eval_stamp.try_read_tree(() => {
				throw new Error('ENOENT')
			}),
		).toBeUndefined()
	})
})

describe('eval_stamp.stamp_path', () => {
	// One checkout's record must not answer another's question, and both commands have to arrive at
	// the same file without being told where it is.
	it('is a json file in the temp directory keyed to this checkout', () => {
		const target = eval_stamp.stamp_path()

		expect(path.dirname(target)).toBe(tmpdir())
		expect(path.basename(target)).toMatch(/^josh-eval-stamp-[\da-f]+\.json$/u)
	})

	it('answers with the same path every time', () => {
		expect(eval_stamp.stamp_path()).toBe(eval_stamp.stamp_path())
	})
})

describe('eval_stamp.write_stamp and read_stamp', () => {
	it('reads back what it wrote', () => {
		const target = path.join(scratch, 'round-trip.json')

		eval_stamp.write_stamp(target)

		expect(eval_stamp.read_stamp(target)?.files[STAMP_DOCUMENT]).toBeDefined()
	})

	// "There is no record" and "the record says nothing changed" are the two answers this module
	// exists to keep apart: only the first is a reason to spend five real Claude sessions again.
	it('answers with no record when the file is not there', () => {
		expect(eval_stamp.read_stamp(path.join(scratch, 'absent.json'))).toBeUndefined()
	})

	it('answers with no record when the file cannot be parsed', () => {
		const target = path.join(scratch, 'corrupt.json')

		writeFileSync(target, '{ not json')

		expect(eval_stamp.read_stamp(target)).toBeUndefined()
	})

	it('answers with no record when the file is json of the wrong shape', () => {
		const target = path.join(scratch, 'wrong-shape.json')

		writeFileSync(target, JSON.stringify({ taken_at: STAMP_STARTED_AT }))

		expect(eval_stamp.read_stamp(target)).toBeUndefined()
	})

	it('replaces a record it wrote before', () => {
		const target = path.join(scratch, 'rewritten.json')

		eval_stamp.write_stamp(target)
		const second = eval_stamp.read_stamp(eval_stamp.write_stamp(target))

		expect(second?.files[STAMP_DOCUMENT]).toBeDefined()
	})
})

// The path is deterministic and sits in a directory every account on the host may write to, so a
// record somebody else chose is a record that answers `skip` — suppressing exactly the re-measure
// this check exists to force.
describe('eval_stamp refuses a record it did not write', () => {
	it('answers with no record when the path is a symlink', () => {
		const real = path.join(scratch, 'planted.json')
		const target = path.join(scratch, 'link.json')

		eval_stamp.write_stamp(real)
		symlinkSync(real, target)

		expect(eval_stamp.read_stamp(real)).toBeDefined()
		expect(eval_stamp.read_stamp(target)).toBeUndefined()
	})

	// Someone re-creating the path between the unlink and the create can make the write fail; it must
	// never make it land somewhere else, and a failure leaves no record, which answers `required`.
	it('refuses to write through a symlink rather than following it', () => {
		const outside = path.join(scratch, 'not-the-record.txt')
		const target = path.join(scratch, 'write-link.json')

		writeFileSync(outside, ORIGINAL_CONTENT)
		symlinkSync(outside, target)

		eval_stamp.write_stamp(target)

		expect(readFileSync(outside, 'utf8')).toBe(ORIGINAL_CONTENT)
	})
})
