import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { stamped_memo } from './stamped-memo'

// joshuafolkken/kit#4263: an answer is computed again only once its key's stamp moves.

const scratch = mkdtempSync(path.join(tmpdir(), 'stamped-memo-test-'))
const KEY = 'key'
const OTHER = 'other'

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('stamped_memo.create', () => {
	it('computes once while the stamp holds, and again once it moves', () => {
		const memo = stamped_memo.create<number>()
		const compute = vi.fn(() => compute.mock.calls.length)

		expect(memo.of(KEY, 'a', compute)).toBe(1)
		expect(memo.of(KEY, 'a', compute)).toBe(1)
		expect(memo.of(KEY, 'b', compute)).toBe(2)
		expect(compute).toHaveBeenCalledTimes(2)
	})

	it('remembers an undefined answer as an answer', () => {
		const memo = stamped_memo.create<string | undefined>()
		const compute = vi.fn((): string | undefined => undefined)

		memo.of(KEY, stamped_memo.NO_STAMP, compute)
		memo.of(KEY, stamped_memo.NO_STAMP, compute)

		expect(compute).toHaveBeenCalledOnce()
	})

	it('forgets every key outside the kept ones', () => {
		const memo = stamped_memo.create<string>()
		const compute = vi.fn(() => 'answer')

		memo.of(KEY, stamped_memo.NO_STAMP, compute)
		memo.of(OTHER, stamped_memo.NO_STAMP, compute)
		memo.keep(new Set([KEY]))
		memo.of(KEY, stamped_memo.NO_STAMP, compute)
		memo.of(OTHER, stamped_memo.NO_STAMP, compute)

		expect(compute).toHaveBeenCalledTimes(3)
	})
})

describe('stamped_memo.file_stamp', () => {
	it('moves when the file is appended to, and is empty for an absent file', () => {
		const file = path.join(scratch, 'ledger.jsonl')

		expect(stamped_memo.file_stamp(file)).toBe(stamped_memo.NO_STAMP)
		writeFileSync(file, 'one\n')
		const written = stamped_memo.file_stamp(file)

		expect(stamped_memo.file_stamp(file)).toBe(written)
		appendFileSync(file, 'two\n')
		expect(stamped_memo.file_stamp(file)).not.toBe(written)
	})
})
