import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { observation_ledger_home } from './observation-ledger-home'

const scratch = mkdtempSync(path.join(tmpdir(), 'observation-ledger-append-test-'))
const LEDGER_FILE = 'observations.md'
const LINE = '- k:a | d1 | 2026-09-29 | x | y'
const OTHER_LINE = '- k:b | d1 | 2026-09-29 | x | z'

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

// joshuafolkken/kit#2701: every ledger writer shares one append rather than spelling its own.
describe('observation_ledger_home.append', () => {
	it('creates a missing docs directory and appends one line per entry', async () => {
		const target = path.join(scratch, 'fresh', 'docs', LEDGER_FILE)

		await observation_ledger_home.append(target, [LINE, OTHER_LINE])

		expect(readFileSync(target, 'utf8')).toBe(`${LINE}\n${OTHER_LINE}\n`)
	})

	it('writes nothing, not even the file, for no lines', async () => {
		const target = path.join(scratch, 'empty', LEDGER_FILE)

		await observation_ledger_home.append(target, [])

		expect(existsSync(target)).toBe(false)
	})
})
