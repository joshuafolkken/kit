import { describe, expect, it } from 'vitest'
import { file_rewrite } from './file-rewrite'

// joshuafolkken/kit#5284: a `Write` over an existing file keeping most of its lines is refused. The
// file read is injected so the suite controls the old body without touching the real filesystem.

const OLD_BODY = 'one\ntwo\nthree\nfour\n'

function read_old(): string {
	return OLD_BODY
}

function read_absent(): undefined {
	return undefined
}

function write_call(file_path: string, content: string): { name: string; input: unknown } {
	return { name: 'Write', input: { file_path, content } }
}

describe('file_rewrite.shared_ratio', () => {
	it('counts the new lines found in the old body, each old line once', () => {
		expect(file_rewrite.shared_ratio('a\nb\n', 'a\na\nb\nc\n')).toBe(0.5)
	})

	it('ignores blank lines and reads an empty new body as 0', () => {
		expect([
			file_rewrite.shared_ratio('a\n\n', '\na\n\n'),
			file_rewrite.shared_ratio('a', ''),
		]).toStrictEqual([1, 0])
	})
})

describe('file_rewrite.rewrites_kept_body — the threshold boundary', () => {
	it('refuses a Write keeping more than half the lines', () => {
		const call = write_call('src/a.ts', 'one\ntwo\nthree\nnew\n')

		expect(file_rewrite.rewrites_kept_body(call, read_old)).toBe(true)
	})

	it('lets a Write keeping exactly half the lines through', () => {
		const call = write_call('src/a.ts', 'one\ntwo\nnew\nnewer\n')

		expect(file_rewrite.rewrites_kept_body(call, read_old)).toBe(false)
	})

	it('pins the threshold at a strict majority', () => {
		expect(file_rewrite.MAX_SHARED_RATIO).toBe(0.5)
	})
})

describe('file_rewrite.rewrites_kept_body — stays silent', () => {
	it('lets a new file through', () => {
		const call = write_call('src/new.ts', OLD_BODY)

		expect(file_rewrite.rewrites_kept_body(call, read_absent)).toBe(false)
	})

	it("lets the run's handoff through", () => {
		const call = write_call('/repo/.josh/tmp/handoff-5284.json', OLD_BODY)

		expect(file_rewrite.rewrites_kept_body(call, read_old)).toBe(false)
	})

	it('lets an Edit through', () => {
		const call = {
			name: 'Edit',
			input: { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' },
		}

		expect(file_rewrite.rewrites_kept_body(call, read_old)).toBe(false)
	})
})

describe('file_rewrite.ROW — measurement', () => {
	it('reaches every Edit and Write, and is kept by an Edit', () => {
		const edit = { name: 'Edit', input: {} }
		const write = write_call('src/a.ts', OLD_BODY)

		expect([
			file_rewrite.ROW.reaches(edit),
			file_rewrite.ROW.reaches(write),
			file_rewrite.ROW.keeps(edit),
			file_rewrite.ROW.keeps(write),
		]).toStrictEqual([true, true, true, false])
	})

	it('names the share and the Edit tool in its reason', () => {
		expect(file_rewrite.FILE_REWRITE_REASON).toMatch(/more than 50%.*Edit tool/su)
	})
})
