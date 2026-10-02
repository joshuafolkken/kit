import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
	LEGACY_LEDGER_FILE,
	LEGACY_OBSERVATION_LEDGER_PATHS,
	OBSERVATION_LEDGER_DIRECTORY,
} from './observation-ledger'
import { observation_ledger_home } from './observation-ledger-home'

const scratch = mkdtempSync(path.join(tmpdir(), 'observation-ledger-append-test-'))
const LEDGER_FILE = 'observations.md'
const LINE = '- k:a | d1 | 2026-09-29 | x | y'
const OTHER_LINE = '- k:b | d1 | 2026-09-29 | x | z'
const ISSUE = 2919

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

	// joshuafolkken/kit#2724, joshuafolkken/kit#2919: a consumer's single-file ledger moves into the
	// directory on its first append, because the append's target is resolved through the directory.
	it('moves the old ledger into the directory before an append lands beside it', async () => {
		const root = path.join(scratch, 'consumer')
		const legacy = path.join(root, LEGACY_OBSERVATION_LEDGER_PATHS[0] ?? '')

		mkdirSync(path.dirname(legacy), { recursive: true })
		writeFileSync(legacy, `${LINE}\n`)

		const target = observation_ledger_home.issue_path(ISSUE, root)

		await observation_ledger_home.append(target, [OTHER_LINE])

		expect(readFileSync(target, 'utf8')).toBe(`${OTHER_LINE}\n`)
		expect(
			readFileSync(path.join(root, OBSERVATION_LEDGER_DIRECTORY, LEGACY_LEDGER_FILE), 'utf8'),
		).toBe(`${LINE}\n`)
		expect(existsSync(legacy)).toBe(false)
	})

	it('writes nothing, not even the file, for no lines', async () => {
		const target = path.join(scratch, 'empty', LEDGER_FILE)

		await observation_ledger_home.append(target, [])

		expect(existsSync(target)).toBe(false)
	})
})
