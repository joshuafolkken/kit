import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi } from 'vitest'
import { cost_audit_read } from './cost-audit-read'
import { cost_audit_read_pool } from './cost-audit-read-pool'

// joshuafolkken/kit#8757: the transcripts are read across worker threads and handed back in file order,
// each session equal to the one read on this thread.

const { shares, interleaved, worker_count, sessions_of } = cost_audit_read_pool
const CORES = 8
const FILES_PER_WORKER = 64

describe('cost_audit_read_pool.shares / interleaved — every item once, back in order', () => {
	it('deals every count-th item to a share and interleaves them back', () => {
		const items = Array.from({ length: 11 }, (_, index) => index)
		const dealt = shares(items, 3)

		expect(dealt).toStrictEqual([
			[0, 3, 6, 9],
			[1, 4, 7, 10],
			[2, 5, 8],
		])
		expect(interleaved(dealt)).toStrictEqual(items)
	})
})

describe('cost_audit_read_pool.worker_count — one worker per share of files, at most the cores', () => {
	it('answers under two for a small set and the cores for a large one', () => {
		expect(worker_count(FILES_PER_WORKER * 2 - 1, CORES)).toBe(1)
		expect(worker_count(FILES_PER_WORKER * 3, CORES)).toBe(3)
		expect(worker_count(FILES_PER_WORKER * 100, CORES)).toBe(CORES)
	})
})

const make_directory = temporary_directory('suite')
const STORE = make_directory('cost-audit-pool-')
const FILE_COUNT = FILES_PER_WORKER * 2

function prompt_line(index: number): string {
	const message = { role: 'user', content: `prompt ${String(index)}` }

	return JSON.stringify({ type: 'user', timestamp: '2026-11-01T00:00:00.000Z', message })
}

function store_files(): Array<SessionFile> {
	return Array.from({ length: FILE_COUNT }, (_, index) => {
		const file_path = path.join(STORE, `s${String(index)}.jsonl`)

		writeFileSync(file_path, `${prompt_line(index)}\n`)

		return {
			session_id: `s${String(index)}`,
			path: file_path,
			modified_ms: index,
			is_delegated: false,
			depth: 0,
		}
	})
}

describe('cost_audit_read_pool.sessions_of — the sessions in file order', () => {
	it('reads a small set on this thread', async () => {
		const read_files = vi.fn(() => [])

		await sessions_of([], new Set(), read_files)

		expect(read_files).toHaveBeenCalledOnce()
	})

	it('reads a large set in workers, equal to the reading on this thread', async () => {
		const files = store_files()
		const lanes = new Set<string>()
		const pooled = await sessions_of(files, lanes, () => [])

		expect(pooled).toStrictEqual(cost_audit_read.read_files(files, lanes))
		expect(pooled.map((one) => one.prompt)).toContain(`prompt ${String(FILE_COUNT - 1)}`)
	})
})
