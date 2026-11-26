import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi } from 'vitest'
import {
	LEGACY_OBSERVATION_LEDGER_PATHS,
	observation_ledger,
	OBSERVATION_LEDGER_DIRECTORY,
} from './observation-ledger'
import { observation_ledger_prepare } from './observation-ledger-prepare'

const make_directory = temporary_directory('suite')
const GOOD_LINE = '- k:a | d1 | 2026-09-30 | scripts/x.ts | A well-formed sighting'
const OBSERVATION_LEDGER_PATH = observation_ledger.ledger_file(1)
const OTHER_ISSUE_PATH = observation_ledger.ledger_file(2)
const LEGACY_OBSERVATION_LEDGER_PATH = LEGACY_OBSERVATION_LEDGER_PATHS[0] ?? ''
const BROKEN_LINE = '- k:b | d1 | a line missing its fields'

function root_with(relative: string, content: string): string {
	const root = make_directory('observation-ledger-prepare-test-')

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

	// joshuafolkken/kit#2919: the grammar is held across every issue's file, not only one.
	it('names a broken line in another issue file of the directory', async () => {
		const root = root_with(OBSERVATION_LEDGER_PATH, `${GOOD_LINE}\n`)

		writeFileSync(path.join(root, OTHER_ISSUE_PATH), `${BROKEN_LINE}\n`)

		const broken = await observation_ledger_prepare.prepare(root)

		expect(broken.map((entry) => entry.line)).toEqual([BROKEN_LINE])
	})

	it('answers no broken line when there is no ledger at all', async () => {
		const root = make_directory('observation-ledger-prepare-empty-')

		expect(await observation_ledger_prepare.prepare(root)).toEqual([])
	})

	it('warns once about a ledger on an old path and leaves it where it is', async () => {
		const root = root_with(LEGACY_OBSERVATION_LEDGER_PATH, `${BROKEN_LINE}\n`)
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		expect(await observation_ledger_prepare.prepare(root)).toEqual([])
		expect(warn).toHaveBeenCalledOnce()
		expect(readFileSync(path.join(root, LEGACY_OBSERVATION_LEDGER_PATH), 'utf8')).toBe(
			`${BROKEN_LINE}\n`,
		)
		expect(existsSync(path.join(root, OBSERVATION_LEDGER_DIRECTORY))).toBe(false)
		warn.mockRestore()
	})
})
