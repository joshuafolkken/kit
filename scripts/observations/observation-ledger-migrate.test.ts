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
import { LEGACY_OBSERVATION_LEDGER_PATH, OBSERVATION_LEDGER_PATH } from './observation-ledger'
import { observation_ledger_migrate } from './observation-ledger-migrate'

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
		expect(readdirSync(path.join(root, 'docs'))).toEqual(['maintainers'])
	})

	it('copies the lines once when asked twice, since the first call claimed the file', () => {
		const root = fresh_root()

		write(root, LEGACY_OBSERVATION_LEDGER_PATH, `${OLD_LINE}\n`)

		expect(observation_ledger_migrate.migrate(root)).toBe(true)
		expect(observation_ledger_migrate.migrate(root)).toBe(false)
		expect(read(root, OBSERVATION_LEDGER_PATH)).toBe(`${OLD_LINE}\n`)
	})

	it('does nothing when there is no old ledger', () => {
		const root = fresh_root()

		expect(observation_ledger_migrate.migrate(root)).toBe(false)
		expect(existsSync(path.join(root, OBSERVATION_LEDGER_PATH))).toBe(false)
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
