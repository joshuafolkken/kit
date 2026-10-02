import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_spawn } from '#scripts/git/git-spawn'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { observation_ledger, OBSERVATION_LEDGER_DIRECTORY } from './observation-ledger'
import { observation_ledger_home } from './observation-ledger-home'

vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: vi.fn() } }))

const scratch = mkdtempSync(path.join(tmpdir(), 'observation-ledger-home-test-'))
const PRIMARY = path.join(scratch, 'kit')
const LANE = path.join(scratch, '.kit-lanes', '2919')
const NOW = new Date('2026-10-02T12:00:00Z')
const LINE_A = '- k:a | d1 | 2026-10-02 | x | from one lane'
const LINE_B = '- k:b | d1 | 2026-10-02 | x | from another lane'

const mocked_read = vi.mocked(git_spawn.read)

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

beforeEach(() => {
	vi.clearAllMocks()
})

describe('observation_ledger_home — where a writer appends', () => {
	// joshuafolkken/kit#2919 regression: a lane's ledger resolved to the primary checkout, where another
	// run's stash took the lines before any flush saw them.
	it('places a lane writer in the lane, not the primary checkout', async () => {
		mocked_read.mockResolvedValue('2919-lane')

		const target = await observation_ledger_home.writer_path(NOW, LANE)

		expect(target).toBe(path.join(LANE, observation_ledger.ledger_file(2919)))
		expect(target.startsWith(PRIMARY)).toBe(false)
	})

	it('names the file after the issue an issue branch leads with', async () => {
		mocked_read.mockResolvedValue('2919-store-the-ledger')

		expect(await observation_ledger_home.writer_path(NOW, PRIMARY)).toBe(
			path.join(PRIMARY, observation_ledger.ledger_file(2919)),
		)
	})

	it('names the file after the date on a branch that leads with no issue', async () => {
		mocked_read.mockResolvedValue('main')

		expect(await observation_ledger_home.writer_path(NOW, PRIMARY)).toBe(
			path.join(PRIMARY, observation_ledger.ledger_file('2026-10-02')),
		)
	})

	it('places an explicit issue in its own file', () => {
		expect(observation_ledger_home.issue_path(7, PRIMARY)).toBe(
			path.join(PRIMARY, observation_ledger.ledger_file(7)),
		)
	})
})

describe('observation_ledger_home.read', () => {
	// joshuafolkken/kit#2919: two lanes write two files, and a reader counts both.
	it('reads every file in the directory as one ledger', async () => {
		const root = mkdtempSync(path.join(scratch, 'read-'))
		const directory = path.join(root, OBSERVATION_LEDGER_DIRECTORY)

		mkdirSync(directory, { recursive: true })
		writeFileSync(path.join(directory, '2.md'), LINE_B)
		writeFileSync(path.join(directory, '1.md'), `${LINE_A}\n`)
		writeFileSync(path.join(directory, 'notes.txt'), 'not a ledger file\n')

		expect(await observation_ledger_home.read(root)).toBe(`${LINE_A}\n${LINE_B}\n`)
	})

	it('answers undefined for a checkout that keeps no ledger', async () => {
		const root = mkdtempSync(path.join(scratch, 'none-'))

		expect(await observation_ledger_home.read(root)).toBeUndefined()
	})
})
