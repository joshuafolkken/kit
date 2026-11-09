import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { hook_ledger_read, type LedgerLine } from './hook-ledger-read'

// joshuafolkken/kit#6664: the period's day files are read, lines older than its start are cut, and the
// rest grouped by hook and rule, the most refusals first.

const make_directory = temporary_directory('suite')
const PREFIX = 'hook-ledger-read-test-'
const PRETOOL = 'pretool:guard'
const NOW = new Date('2026-11-09T12:00:00.000Z')
const TODAY = '2026-11-09T10:00:00.000Z'

function entry(at: string, rule: string, hook = PRETOOL): LedgerLine {
	return { at, hook, rule, tool: 'Bash', session: '', command: 'ls' }
}

function line(at: string, rule: string): string {
	return JSON.stringify(entry(at, rule))
}

function ledger(files: Readonly<Record<string, ReadonlyArray<string>>>): string {
	const directory = path.join(make_directory(PREFIX), 'ledger')

	mkdirSync(directory, { recursive: true })

	for (const [day, lines] of Object.entries(files)) {
		writeFileSync(path.join(directory, `${day}.jsonl`), `${lines.join('\n')}\n`)
	}

	return directory
}

describe('hook_ledger_read.read_lines', () => {
	it('reads the lines inside the period and cuts the older ones', async () => {
		const directory = ledger({
			'2026-11-01': [line('2026-11-01T12:00:00.000Z', 'old')],
			'2026-11-02': [
				line('2026-11-02T11:00:00.000Z', 'cut'),
				line('2026-11-02T13:00:00.000Z', 'in'),
			],
			'2026-11-09': [line(TODAY, 'today'), 'not json'],
		})
		const lines = await hook_ledger_read.read_lines(directory, 7, NOW)

		expect(lines.map((read) => read.rule)).toStrictEqual(['in', 'today'])
	})

	it('reads a missing ledger as no lines', async () => {
		const directory = path.join(make_directory(PREFIX), 'none')

		await expect(hook_ledger_read.read_lines(directory, 1, NOW)).resolves.toStrictEqual([])
	})
})

describe('hook_ledger_read.group', () => {
	it('groups by hook and rule, the most refusals first', () => {
		const stop = 'stop:guard'
		const lines = [entry(TODAY, 'a'), entry(TODAY, 'b'), entry(TODAY, 'b'), entry(TODAY, 'b', stop)]
		const groups = hook_ledger_read.group(lines)

		expect(groups.map((group) => [group.hook, group.rule, group.lines.length])).toStrictEqual([
			[PRETOOL, 'b', 2],
			[PRETOOL, 'a', 1],
			[stop, 'b', 1],
		])
	})
})
