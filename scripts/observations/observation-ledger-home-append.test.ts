import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { LEGACY_OBSERVATION_LEDGER_PATHS, OBSERVATION_LEDGER_DIRECTORY } from './observation-ledger'
import { observation_ledger_home } from './observation-ledger-home'

const make_directory = temporary_directory('suite')
const scratch = make_directory('observation-ledger-append-test-')
const LEDGER_FILE = 'observations.md'
const LINE = '- k:a | d1 | 2026-09-29 | x | y'
const OTHER_LINE = '- k:b | d1 | 2026-09-29 | x | z'
const ISSUE = 2919

// joshuafolkken/kit#2701: every ledger writer shares one append rather than spelling its own.
describe('observation_ledger_home.append', () => {
	it('creates a missing docs directory and appends one line per entry', async () => {
		const target = path.join(scratch, 'fresh', 'docs', LEDGER_FILE)

		await observation_ledger_home.append(target, [LINE, OTHER_LINE])

		expect(readFileSync(target, 'utf8')).toBe(`${LINE}\n${OTHER_LINE}\n`)
	})

	// joshuafolkken/kit#9049: the single-file migration is gone, so resolving, appending and reading
	// use the directory alone and leave an old ledger where it is.
	it('reads and writes only the directory, leaving an old ledger untouched', async () => {
		const root = path.join(scratch, 'consumer')
		const legacy_paths = LEGACY_OBSERVATION_LEDGER_PATHS.map((legacy) => path.join(root, legacy))

		for (const legacy of legacy_paths) {
			mkdirSync(path.dirname(legacy), { recursive: true })
			writeFileSync(legacy, `${LINE}\n`)
		}

		const target = observation_ledger_home.issue_path(ISSUE, root)

		expect(target).toBe(path.join(root, OBSERVATION_LEDGER_DIRECTORY, `${String(ISSUE)}.md`))
		await observation_ledger_home.append(target, [OTHER_LINE])

		expect(await observation_ledger_home.read(root)).toBe(`${OTHER_LINE}\n`)
		for (const legacy of legacy_paths) expect(readFileSync(legacy, 'utf8')).toBe(`${LINE}\n`)
	})

	it('writes nothing, not even the file, for no lines', async () => {
		const target = path.join(scratch, 'empty', LEDGER_FILE)

		await observation_ledger_home.append(target, [])

		expect(existsSync(target)).toBe(false)
	})
})
