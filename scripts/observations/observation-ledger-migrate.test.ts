import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
	LEGACY_LEDGER_FILE,
	LEGACY_OBSERVATION_LEDGER_DIRECTORY,
	LEGACY_OBSERVATION_LEDGER_PATHS,
	OBSERVATION_LEDGER_DIRECTORY,
} from './observation-ledger'
import { observation_ledger_migrate } from './observation-ledger-migrate'

const [SINGLE_FILE_LEDGER_PATH = '', LEGACY_OBSERVATION_LEDGER_PATH = ''] =
	LEGACY_OBSERVATION_LEDGER_PATHS
const OBSERVATION_LEDGER_PATH = `${OBSERVATION_LEDGER_DIRECTORY}/${LEGACY_LEDGER_FILE}`

const scratch = mkdtempSync(path.join(tmpdir(), 'observation-ledger-migrate-test-'))
const OLD_LINE = '- k:a | d1 | 2026-09-29 | x | appended at the old path'
const NEW_LINE = '- k:b | d1 | 2026-09-29 | x | appended at the new path'
const STRANDED_LINE = '- k:c | d1 | 2026-09-29 | x | left in a claim by a killed process'
// No process runs under this id, so a claim carrying it belongs to a process that is gone.
const DEAD_PID = 2_147_483_646

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

function fresh_root(): string {
	return mkdtempSync(path.join(scratch, 'root-'))
}

function write(root: string, relative: string, content: string): void {
	mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
	writeFileSync(path.join(root, relative), content)
}

function read(root: string, relative: string): string {
	return readFileSync(path.join(root, relative), 'utf8')
}

function claim_of(pid: number): string {
	return `${LEGACY_OBSERVATION_LEDGER_PATH}.${String(pid)}.migrating`
}

// joshuafolkken/kit#2724: changing the path alone split the appends across two files.
describe('observation_ledger_migrate.migrate — the old ledger', () => {
	it('moves an old ledger to the new path when the new one does not exist yet', () => {
		const root = fresh_root()

		write(root, LEGACY_OBSERVATION_LEDGER_PATH, `${OLD_LINE}\n`)

		expect(observation_ledger_migrate.migrate(root)).toBe(true)
		expect(read(root, OBSERVATION_LEDGER_PATH)).toBe(`${OLD_LINE}\n`)
		expect(existsSync(path.join(root, LEGACY_OBSERVATION_LEDGER_PATH))).toBe(false)
	})

	it('appends the old lines after the new ledger and leaves no claim file behind', () => {
		const root = fresh_root()

		write(root, OBSERVATION_LEDGER_PATH, `${NEW_LINE}\n`)
		write(root, LEGACY_OBSERVATION_LEDGER_PATH, OLD_LINE)

		observation_ledger_migrate.migrate(root)

		expect(read(root, OBSERVATION_LEDGER_PATH)).toBe(`${NEW_LINE}\n${OLD_LINE}\n`)
		const legacy_parent = path.join(root, path.dirname(LEGACY_OBSERVATION_LEDGER_PATH))

		expect(readdirSync(legacy_parent)).toEqual([])
	})

	it('copies the lines once when asked twice, since the first call claimed the file', () => {
		const root = fresh_root()

		write(root, LEGACY_OBSERVATION_LEDGER_PATH, `${OLD_LINE}\n`)

		expect(observation_ledger_migrate.migrate(root)).toBe(true)
		expect(observation_ledger_migrate.migrate(root)).toBe(false)
		expect(read(root, OBSERVATION_LEDGER_PATH)).toBe(`${OLD_LINE}\n`)
	})
})

describe('observation_ledger_migrate.migrate — the single-file ledgers (joshuafolkken/kit#2919)', () => {
	// joshuafolkken/kit#2919: both single-file ledgers move into the directory, neither is left behind.
	it('moves both single-file ledgers into the directory in one call', () => {
		const root = fresh_root()

		write(root, SINGLE_FILE_LEDGER_PATH, `${NEW_LINE}\n`)
		write(root, LEGACY_OBSERVATION_LEDGER_PATH, `${OLD_LINE}\n`)

		expect(observation_ledger_migrate.migrate(root)).toBe(true)
		expect(read(root, OBSERVATION_LEDGER_PATH)).toBe(`${NEW_LINE}\n${OLD_LINE}\n`)
		expect(existsSync(path.join(root, SINGLE_FILE_LEDGER_PATH))).toBe(false)
		expect(existsSync(path.join(root, LEGACY_OBSERVATION_LEDGER_PATH))).toBe(false)
	})

	it('does nothing when there is no old ledger', () => {
		const root = fresh_root()

		expect(observation_ledger_migrate.migrate(root)).toBe(false)
		expect(existsSync(path.join(root, OBSERVATION_LEDGER_PATH))).toBe(false)
	})
})

// `git restore` or a stash without `-u` brings a tracked old ledger back beside the moved new one.
describe('observation_ledger_migrate.migrate — an old ledger restored after the move', () => {
	it('appends only the lines the new ledger does not already hold', () => {
		const root = fresh_root()

		write(root, OBSERVATION_LEDGER_PATH, `${OLD_LINE}\n${NEW_LINE}\n`)
		write(root, LEGACY_OBSERVATION_LEDGER_PATH, `${OLD_LINE}\n${STRANDED_LINE}\n`)

		observation_ledger_migrate.migrate(root)

		expect(read(root, OBSERVATION_LEDGER_PATH)).toBe(`${OLD_LINE}\n${NEW_LINE}\n${STRANDED_LINE}\n`)
	})
})

// joshuafolkken/kit#3341: the directory moved out of `docs/`, and a run on the old code, a stash cut
// before the move and a consumer's existing ledger still write to the old one.
describe('observation_ledger_migrate.migrate — the old ledger directory', () => {
	const OLD_ISSUE_FILE = `${LEGACY_OBSERVATION_LEDGER_DIRECTORY}/2872.md`
	const NEW_ISSUE_FILE = `${OBSERVATION_LEDGER_DIRECTORY}/2872.md`

	it('moves each file to the same name in the new directory and removes the emptied old one', () => {
		const root = fresh_root()

		write(root, OLD_ISSUE_FILE, `${OLD_LINE}\n`)
		write(root, `${LEGACY_OBSERVATION_LEDGER_DIRECTORY}/2026-10-03.md`, `${NEW_LINE}\n`)

		expect(observation_ledger_migrate.migrate(root)).toBe(true)
		expect(read(root, NEW_ISSUE_FILE)).toBe(`${OLD_LINE}\n`)
		expect(read(root, `${OBSERVATION_LEDGER_DIRECTORY}/2026-10-03.md`)).toBe(`${NEW_LINE}\n`)
		expect(existsSync(path.join(root, LEGACY_OBSERVATION_LEDGER_DIRECTORY))).toBe(false)
	})

	it('appends only the lines the new file does not already hold', () => {
		const root = fresh_root()

		write(root, NEW_ISSUE_FILE, `${OLD_LINE}\n`)
		write(root, OLD_ISSUE_FILE, `${OLD_LINE}\n${NEW_LINE}\n`)

		observation_ledger_migrate.migrate(root)

		expect(read(root, NEW_ISSUE_FILE)).toBe(`${OLD_LINE}\n${NEW_LINE}\n`)
	})

	it('absorbs a claim a killed process left in the old directory', () => {
		const root = fresh_root()

		write(root, `${OLD_ISSUE_FILE}.${String(DEAD_PID)}.migrating`, `${STRANDED_LINE}\n`)

		expect(observation_ledger_migrate.migrate(root)).toBe(true)
		expect(read(root, NEW_ISSUE_FILE)).toBe(`${STRANDED_LINE}\n`)
	})

	it('leaves a file in the old directory that is not the ledger, and the directory with it', () => {
		const root = fresh_root()
		const unrelated = `${LEGACY_OBSERVATION_LEDGER_DIRECTORY}/notes.txt`

		write(root, unrelated, 'kept')

		expect(observation_ledger_migrate.migrate(root)).toBe(false)
		expect(read(root, unrelated)).toBe('kept')
	})
})

describe('observation_ledger_migrate.migrate — an interrupted migration', () => {
	it('absorbs a claim whose process is gone, so its lines are not stranded', () => {
		const root = fresh_root()
		const claim = path.join(root, claim_of(DEAD_PID))

		write(root, claim_of(DEAD_PID), `${STRANDED_LINE}\n`)

		expect(observation_ledger_migrate.migrate(root)).toBe(true)
		expect(read(root, OBSERVATION_LEDGER_PATH)).toBe(`${STRANDED_LINE}\n`)
		expect(existsSync(claim)).toBe(false)
	})

	it('leaves a claim alone while its process is still running', () => {
		const root = fresh_root()
		const claim = path.join(root, claim_of(process.pid))

		write(root, claim_of(process.pid), `${STRANDED_LINE}\n`)

		expect(observation_ledger_migrate.migrate(root)).toBe(false)
		expect(existsSync(claim)).toBe(true)
	})
})
