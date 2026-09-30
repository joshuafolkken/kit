import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LEGACY_OBSERVATION_LEDGER_PATH, OBSERVATION_LEDGER_PATH } from './observation-ledger'
import { observation_ledger_prepare } from './observation-ledger-prepare'

const scratch = mkdtempSync(path.join(tmpdir(), 'observation-ledger-prepare-test-'))
const GOOD_LINE = '- k:a | d1 | 2026-09-30 | scripts/x.ts | A well-formed sighting'
const BROKEN_LINE = '- k:b | d1 | a line missing its fields'

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

function root_with(relative: string, content: string): string {
	const root = mkdtempSync(path.join(scratch, 'root-'))

	mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
	writeFileSync(path.join(root, relative), content)

	return root
}

describe('observation_ledger_prepare.prepare', () => {
	it('answers no broken line for a ledger that keeps the grammar', async () => {
		const root = root_with(OBSERVATION_LEDGER_PATH, `${GOOD_LINE}\n`)

		expect(await observation_ledger_prepare.prepare(root)).toEqual([])
	})

	it('names each line that breaks the grammar', async () => {
		const root = root_with(OBSERVATION_LEDGER_PATH, `${GOOD_LINE}\n${BROKEN_LINE}\n`)
		const broken = await observation_ledger_prepare.prepare(root)

		expect(broken.map((entry) => entry.line)).toEqual([BROKEN_LINE])
	})

	it('answers no broken line when there is no ledger at all', async () => {
		const root = mkdtempSync(path.join(scratch, 'empty-'))

		expect(await observation_ledger_prepare.prepare(root)).toEqual([])
	})

	it('moves lines on the old path to the new one before reading', async () => {
		const root = root_with(LEGACY_OBSERVATION_LEDGER_PATH, `${GOOD_LINE}\n`)

		expect(await observation_ledger_prepare.prepare(root)).toEqual([])
		expect(existsSync(path.join(root, LEGACY_OBSERVATION_LEDGER_PATH))).toBe(false)
		expect(readFileSync(path.join(root, OBSERVATION_LEDGER_PATH), 'utf8')).toContain(GOOD_LINE)
	})
})
