import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { json_value } from '#scripts/lib/json-value'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { lane_ledger } from './lane-ledger'
import { lane_ledger_write } from './lane-ledger-write'

// joshuafolkken/kit#3355: the lane-limit measurement ledger is append-only JSONL that survives a
// malformed line.

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-ledger-test-'))
const AT = '2026-10-06T00:00:00.000Z'

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

function ledger(name: string): string {
	return path.join(scratch, `${name}.jsonl`)
}

describe('lane_ledger.read_entries', () => {
	it('reads back every appended entry, oldest first', () => {
		const target = ledger('round-trip')

		lane_ledger_write.append(target, { kind: 'merge', at: AT, issue: 1 })
		lane_ledger_write.append(target, { kind: 'load', at: AT, load: 2.5, available_mb: 512 })

		expect(lane_ledger.read_entries(target)).toStrictEqual([
			{ kind: 'merge', at: AT, issue: 1 },
			{ kind: 'load', at: AT, load: 2.5, available_mb: 512 },
		])
	})

	it('skips a malformed line instead of dropping the whole ledger', () => {
		const target = ledger('malformed')

		lane_ledger_write.append(target, { kind: 'merge', at: AT, issue: 2 })
		appendFileSync(target, '{"kind":"merge","at\n')
		lane_ledger_write.append(target, { kind: 'merge', at: AT, issue: 3 })

		expect(lane_ledger.read_entries(target)).toHaveLength(2)
	})

	it('reads an absent file as an empty ledger', () => {
		expect(lane_ledger.read_entries(ledger('absent'))).toStrictEqual([])
	})
})

// joshuafolkken/kit#5202: a reader looks entries up by the writer's own names.
describe('lane_ledger names', () => {
	it('re-exposes the writer leaf’s kinds, stage names and ledger path', () => {
		expect(lane_ledger.KIND).toBe(lane_ledger_write.KIND)
		expect(lane_ledger.PRE_DETACH_STAGE).toBe(lane_ledger_write.PRE_DETACH_STAGE)
		expect(lane_ledger.ROUND_ONE_REUSED).toBe(lane_ledger_write.ROUND_ONE_REUSED)
		expect(lane_ledger.target_of).toBe(lane_ledger_write.target_of)
		expect(lane_ledger.target).toBe(lane_ledger_write.target)
	})
})

describe('lane_ledger_write.record_size', () => {
	it('appends declared and actual sizes that the ledger can read back', async () => {
		const target = ledger('size-round-trip')
		const size = {
			issue: 5384,
			declared: { files: 7, lines: 160 },
			actual: { files: 20, lines: 286 },
		}

		await lane_ledger_write.record_size(size, target)

		const entries = lane_ledger.read_entries(target)

		expect(entries).toMatchObject([{ kind: 'size', ...size }])
		expect(typeof entries[0]?.at).toBe('string')
	})
})

// joshuafolkken/kit#4263: `run:board` reads the ledger on every local read; an unchanged file is not
// parsed again.
describe('lane_ledger.read_entries over an unchanged ledger', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('parses the ledger once while it is unchanged, and again once it is appended to', () => {
		const target = ledger('unchanged')

		lane_ledger_write.append(target, { kind: 'merge', at: AT, issue: 1 })
		const parse = vi.spyOn(json_value, 'parse_or_undefined')

		lane_ledger.read_entries(target)
		const parsed = parse.mock.calls.length

		lane_ledger.read_entries(target)
		expect(parsed).toBeGreaterThan(0)
		expect(parse).toHaveBeenCalledTimes(parsed)

		lane_ledger_write.append(target, { kind: 'merge', at: AT, issue: 2 })
		expect(lane_ledger.read_entries(target)).toHaveLength(2)
	})
})

describe('lane_ledger.read_entries on a load sample memory', () => {
	// joshuafolkken/kit#3593: the memory is `machine_capacity`'s reading, which can go unread.
	it('keeps a load sample whose memory could not be read', () => {
		const target = ledger('unread-memory')

		lane_ledger_write.append(target, { kind: 'load', at: AT, load: 2.5, lanes: 1 })
		lane_ledger_write.append(target, {
			kind: 'load',
			at: AT,
			load: 1,
			available_mb: 512,
			swapped_mb: 3,
		})

		expect(lane_ledger.read_entries(target)).toStrictEqual([
			{ kind: 'load', at: AT, load: 2.5, lanes: 1 },
			{ kind: 'load', at: AT, load: 1, available_mb: 512, swapped_mb: 3 },
		])
	})

	// joshuafolkken/kit#3874: the process breakdown reads back with the sample it was taken in.
	it('keeps the process kinds a load sample carries', () => {
		const target = ledger('process-kinds')
		const processes = [{ kind: 'eslint', cpu_percent: 180, rss_mb: 2048, count: 3 }]

		lane_ledger_write.append(target, { kind: 'load', at: AT, load: 9, processes })

		expect(lane_ledger.read_entries(target)).toStrictEqual([
			{ kind: 'load', at: AT, load: 9, processes },
		])
	})

	// joshuafolkken/kit#3593: a row measured before the rename keeps its load and loses its memory.
	it('reads a pre-rename load sample without its memory fields', () => {
		const target = ledger('pre-rename')
		const old_row = { kind: 'load', at: AT, load: 2.5, free_mb: 40, swap_mb: 900, lanes: 1 }

		appendFileSync(target, `${JSON.stringify(old_row)}\n`)

		expect(lane_ledger.read_entries(target)).toStrictEqual([
			{ kind: 'load', at: AT, load: 2.5, lanes: 1 },
		])
	})
})
