import { describe, expect, it } from 'vitest'
import {
	LEDGER_EXCLUSION_PATHSPEC,
	LEGACY_OBSERVATION_LEDGER_PATHS,
	observation_ledger,
	OBSERVATION_LEDGER_DIRECTORY,
} from './observation-ledger'
import { LEGACY_OBSERVATION_LEDGER_DIRECTORY } from './observation-ledger-legacy'

const ISSUE = 2919
const LEDGER_FILE = observation_ledger.ledger_file(ISSUE)
const [SINGLE_FILE_LEDGER = '', LEGACY_LEDGER = ''] = LEGACY_OBSERVATION_LEDGER_PATHS

// joshuafolkken/kit#1810: this is the one place that answers "does the working tree hold a pending
// observation append?", asked by both `observations-flush.ts` and `pnpm josh followup`.
const MODIFIED_LEDGER = ` M ${LEDGER_FILE}`
const UNTRACKED_LEDGER = `?? ${LEDGER_FILE}`
const UNTRACKED_DIRECTORY = `?? ${OBSERVATION_LEDGER_DIRECTORY}/`
const OTHER_CHANGE = ' M scripts/git/git-command.ts'
const LOOKALIKE_PATH = ` M ${OBSERVATION_LEDGER_DIRECTORY}-archive/1.md`
const UNTRACKED_LEGACY_LEDGER = `?? ${LEGACY_LEDGER}`
const DELETED_SINGLE_FILE_LEDGER = ` D ${SINGLE_FILE_LEDGER}`

describe('observation_ledger.ledger_file', () => {
	// joshuafolkken/kit#2919: one file per issue, so parallel lanes never append to the same file.
	it('names one file per issue inside the ledger directory', () => {
		expect(LEDGER_FILE).toBe(`${OBSERVATION_LEDGER_DIRECTORY}/2919.md`)
		expect(observation_ledger.ledger_file(ISSUE + 1)).not.toBe(LEDGER_FILE)
	})
})

describe('observation_ledger.has_pending_append', () => {
	it('is true when an issue file was modified', () => {
		expect(observation_ledger.has_pending_append(MODIFIED_LEDGER)).toBe(true)
	})

	it('is true when an issue file is untracked', () => {
		expect(observation_ledger.has_pending_append(UNTRACKED_LEDGER)).toBe(true)
	})

	// Porcelain status collapses a wholly untracked directory to its name.
	it('is true when the whole directory is untracked', () => {
		expect(observation_ledger.has_pending_append(UNTRACKED_DIRECTORY)).toBe(true)
	})

	it('finds the ledger among other changed paths', () => {
		const status = [OTHER_CHANGE, MODIFIED_LEDGER].join('\n')

		expect(observation_ledger.has_pending_append(status)).toBe(true)
	})

	it('is false on a clean tree', () => {
		expect(observation_ledger.has_pending_append('')).toBe(false)
	})

	it('is false when only other files changed', () => {
		expect(observation_ledger.has_pending_append(OTHER_CHANGE)).toBe(false)
	})

	it('does not mistake a look-alike directory for the ledger', () => {
		expect(observation_ledger.has_pending_append(LOOKALIKE_PATH)).toBe(false)
	})

	// joshuafolkken/kit#2724: a run on the old code still appends at an old path.
	it('is true when only an old single-file ledger changed', () => {
		expect(observation_ledger.has_pending_append(UNTRACKED_LEGACY_LEDGER)).toBe(true)
	})
})

describe('observation_ledger.ledger_paths', () => {
	it('names every ledger path and nothing else', () => {
		const status = [OTHER_CHANGE, DELETED_SINGLE_FILE_LEDGER, UNTRACKED_LEDGER].join('\n')

		expect(observation_ledger.ledger_paths(status)).toEqual([SINGLE_FILE_LEDGER, LEDGER_FILE])
	})
})

// joshuafolkken/kit#3341: the ledger left `docs/`.
describe('observation_ledger — the ledger outside docs/', () => {
	it('keeps the ledger directory outside docs/', () => {
		expect(OBSERVATION_LEDGER_DIRECTORY.startsWith('docs/')).toBe(false)
	})
})

// joshuafolkken/kit#9049: with the migration gone, only the two old single files stay recognized —
// kept out of an ordinary commit — while a migration claim and the old directory are ordinary paths.
describe('observation_ledger.is_ledger_path — after the migration was removed', () => {
	it('still recognizes both old single-file ledgers', () => {
		for (const legacy of LEGACY_OBSERVATION_LEDGER_PATHS) {
			expect(observation_ledger.is_ledger_path(legacy)).toBe(true)
		}
	})

	it('no longer recognizes a migration claim on an old path', () => {
		expect(observation_ledger.is_ledger_path(`${SINGLE_FILE_LEDGER}.123.migrating`)).toBe(false)
	})

	it('no longer recognizes a file in the old directory', () => {
		expect(
			observation_ledger.is_ledger_path(`${LEGACY_OBSERVATION_LEDGER_DIRECTORY}/2919.md`),
		).toBe(false)
	})
})

describe('LEDGER_EXCLUSION_PATHSPEC', () => {
	it('excludes the directory and both old single files, and nothing else', () => {
		expect(LEDGER_EXCLUSION_PATHSPEC).toEqual([
			':/',
			`:(top,exclude)${OBSERVATION_LEDGER_DIRECTORY}`,
			...LEGACY_OBSERVATION_LEDGER_PATHS.map((legacy) => `:(top,exclude)${legacy}`),
		])
	})
})
