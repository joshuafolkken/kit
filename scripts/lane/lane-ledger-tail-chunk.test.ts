import { appendFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_ledger_tail } from './lane-ledger-tail'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#8243: a ledger larger than a chunk is parsed a chunk at a time — no read buffer
// the size of the whole file — and reads the same entries a whole read did.

const scratch = make_directory('lane-ledger-tail-chunk-test-')
const AT = '2026-10-06T00:00:00.000Z'
const { GROW_CHUNK_BYTES } = lane_ledger_tail
const CHUNKS = 3

function ledger(name: string): string {
	return path.join(scratch, `${name}.jsonl`)
}

function merge(issue: number): object {
	return { kind: 'merge', at: AT, issue }
}

function line_of(entry: object): string {
	return `${JSON.stringify(entry)}\n`
}

// Merge lines through past `bytes`, issues numbered from 1.
function write_merges(target: string, bytes: number): Array<object> {
	const line_bytes = line_of(merge(1)).length
	const entries = Array.from({ length: Math.ceil(bytes / line_bytes) }, (_, index) =>
		merge(index + 1),
	)

	writeFileSync(target, entries.map((entry) => line_of(entry)).join(''))

	return entries
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('lane_ledger_tail.tail_store on a ledger larger than a chunk', () => {
	it('reads every entry, a line cut by a chunk boundary included', () => {
		const target = ledger('chunked')
		const entries = write_merges(target, CHUNKS * GROW_CHUNK_BYTES)

		expect(lane_ledger_tail.tail_store().read(target)).toStrictEqual(entries)
	})

	it('allocates no read buffer larger than a chunk', () => {
		const target = ledger('bounded')

		write_merges(target, CHUNKS * GROW_CHUNK_BYTES)
		const alloc = vi.spyOn(Buffer, 'alloc')

		lane_ledger_tail.tail_store().read(target)
		const sizes = alloc.mock.calls.map(([size]) => size)

		expect(Math.max(...sizes)).toBeLessThanOrEqual(GROW_CHUNK_BYTES)
	})

	it('keeps the fragment after the last complete line uncounted until it completes', () => {
		const target = ledger('fragment')
		const entries = write_merges(target, GROW_CHUNK_BYTES)
		const store = lane_ledger_tail.tail_store()
		const last = merge(entries.length + 1)

		appendFileSync(target, JSON.stringify(last).slice(0, -1))

		expect(store.read(target)).toStrictEqual(entries)

		appendFileSync(target, '}\n')

		expect(store.read(target)).toStrictEqual([...entries, last])
	})
})
