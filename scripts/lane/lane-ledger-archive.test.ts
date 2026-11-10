import { appendFileSync, closeSync, openSync, readFileSync, statSync, writeSync } from 'node:fs'
import path from 'node:path'
import { repository_lock } from '#scripts/git/repository-lock'
import { atomic_write } from '#scripts/lib/atomic-write'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import { lane_ledger_archive } from './lane-ledger-archive'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_stats } from './lane-stats'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#7038: records past the retention, merges apart, move to the archive, and `lane:stats` reads
// the archive with the ledger, so a period past the retention counts as before.

const scratch = make_directory('lane-ledger-archive-test-')
const NOW = Date.parse('2026-11-10T12:00:00.000Z')
const MS_PER_DAY = 86_400_000
const OLD_DAYS = 20
const RECENT_DAYS = 1
const STATS_DAYS = 30
const LOAD = 2.5
const REPLACE_FILE = 'replace_file'

function ledger(name: string): string {
	return path.join(scratch, `${name}.jsonl`)
}

function days_ago(days: number): string {
	return new Date(NOW - days * MS_PER_DAY).toISOString()
}

function load(days: number): LedgerEntry {
	return { kind: 'load', at: days_ago(days), load: LOAD }
}

function merge(days: number): LedgerEntry {
	return { kind: 'merge', at: days_ago(days), issue: days }
}

function dispatch(days: number): LedgerEntry {
	return { kind: 'dispatch', at: days_ago(days), issue: days }
}

function write(target: string, entries: ReadonlyArray<LedgerEntry>): void {
	for (const entry of entries) lane_ledger_write.append(target, entry)
}

describe('lane_ledger_archive.rotate', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('moves records past the retention and keeps merges and recent records', () => {
		const target = ledger('rotate')

		write(target, [load(OLD_DAYS), dispatch(OLD_DAYS), merge(OLD_DAYS), load(RECENT_DAYS)])

		expect(lane_ledger_archive.rotate(target, NOW)).toBe(2)
		expect(lane_ledger.read_entries(target)).toStrictEqual([merge(OLD_DAYS), load(RECENT_DAYS)])
		expect(lane_ledger.read_entries(lane_ledger_archive.archive_of(target))).toStrictEqual([
			load(OLD_DAYS),
			dispatch(OLD_DAYS),
		])
	})

	it('carries a line still landing past the last complete one into the replacement', () => {
		const target = ledger('fragment')
		const fragment = '{"kind":"merge"'

		write(target, [load(OLD_DAYS)])
		appendFileSync(target, fragment)
		lane_ledger_archive.rotate(target, NOW)

		expect(readFileSync(target, 'utf8')).toBe(fragment)
	})
})

describe('lane_ledger_archive.rotate around the ledger replace', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('carries an append that opened the old ledger before the rename into the replacement', () => {
		const target = ledger('late')
		const { replace_file } = atomic_write

		write(target, [load(OLD_DAYS)])
		vi.spyOn(atomic_write, REPLACE_FILE).mockImplementation((file, content, options) => {
			const writer = openSync(file, 'a')

			replace_file(file, content, options)
			writeSync(writer, `${JSON.stringify(load(RECENT_DAYS))}\n`)
			closeSync(writer)
		})

		lane_ledger_archive.rotate(target, NOW)

		expect(lane_ledger.read_entries(target)).toStrictEqual([load(RECENT_DAYS)])
	})

	it('truncates the archive back when the ledger replace throws, so no record is in both', () => {
		const target = ledger('replace-fails')
		const archive = lane_ledger_archive.archive_of(target)

		write(archive, [dispatch(OLD_DAYS)])
		write(target, [load(OLD_DAYS)])
		const before = readFileSync(archive, 'utf8')

		const failure = 'replace failed'

		vi.spyOn(atomic_write, REPLACE_FILE).mockImplementation(() => {
			throw new Error(failure)
		})

		expect(() => lane_ledger_archive.rotate(target, NOW)).toThrow(failure)
		expect(readFileSync(archive, 'utf8')).toBe(before)
		expect(lane_ledger.read_entries(target)).toStrictEqual([load(OLD_DAYS)])
	})
})

describe('lane_ledger_archive.rotate with nothing to move', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('leaves the ledger file in place when nothing is past the retention', () => {
		const target = ledger('recent')

		write(target, [load(RECENT_DAYS), merge(OLD_DAYS)])
		const before = statSync(target).ino

		expect(lane_ledger_archive.rotate(target, NOW)).toBe(0)
		expect(statSync(target).ino).toBe(before)
	})

	it('does nothing while another rotation holds the lock', () => {
		const target = ledger('locked')

		write(target, [load(OLD_DAYS)])
		vi.spyOn(repository_lock, 'with_lock_sync').mockReturnValue(undefined)

		expect(lane_ledger_archive.rotate(target, NOW)).toBe(0)
		expect(lane_ledger.read_entries(target)).toStrictEqual([load(OLD_DAYS)])
	})

	it('answers 0 for an absent ledger', () => {
		expect(lane_ledger_archive.rotate(ledger('absent'), NOW)).toBe(0)
	})
})

describe('lane_ledger_archive.read_history', () => {
	it('gives lane:stats the same row past the retention after a rotation', async () => {
		const target = ledger('history')
		const window = lane_stats.window_of(STATS_DAYS, NOW)
		const label = { limit: '4' }

		write(target, [load(OLD_DAYS), merge(OLD_DAYS), load(RECENT_DAYS)])
		const before = lane_stats.row(lane_ledger.read_entries(target), window, label)

		lane_ledger_archive.rotate(target, NOW)
		const after = await lane_ledger_archive.read_history({ ledger_path: target })

		expect(lane_stats.row(after, window, label)).toBe(before)
		expect(after).toHaveLength(3)
	})

	it('reads no ledger outside a repository', async () => {
		await expect(lane_ledger_archive.read_history({})).resolves.toStrictEqual([])
	})
})
