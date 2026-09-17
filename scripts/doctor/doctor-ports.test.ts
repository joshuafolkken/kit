import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { doctor_ports, type RepositoryPorts as RepoPorts } from './doctor-ports'

// joshuafolkken/kit#1494: `doctor` reads each discovered repository's `PORT_SEED`, resolves its
// seat-0 ports through the one formula, and names any seed held by more than one — the clash the
// `seed × 10 + lane` offset does not prevent when two projects pick the same seed.

const OWNER_A = 'owner/a'
const OWNER_B = 'owner/b'
const OWNER_C = 'owner/c'
const SEED_2_ENV = 'PORT_SEED=2\n'
const KIT_NAME = 'owner/kit'
const BARE_NAME = 'owner/bare'
const BROKEN_NAME = 'owner/broken'

const scratch = mkdtempSync(path.join(tmpdir(), 'doctor-ports-test-'))

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

function repo_with_environment(name: string, content: string | undefined): string {
	const directory = path.join(scratch, name)

	mkdirSync(directory, { recursive: true })

	if (content !== undefined) {
		writeFileSync(path.join(directory, '.env'), content)
	}

	return directory
}

function entry(name: string, seed: number | undefined): RepoPorts {
	if (seed === undefined) {
		return { name, seed: undefined, development: undefined, preview: undefined }
	}

	const offset = seed * 10

	return { name, seed, development: 5173 + offset, preview: 4173 + offset }
}

describe('reading a repository’s port seed and ports', () => {
	it('reads the seed and resolves the seat-0 ports the main work tree runs on', () => {
		const directory = repo_with_environment('kit', 'PORT_SEED=1\n')

		expect(doctor_ports.read_repository_ports(KIT_NAME, directory)).toStrictEqual({
			name: KIT_NAME,
			seed: 1,
			development: 5183,
			preview: 4183,
		})
	})

	it('reads a repository with no .env as seed 0, the historical ports', () => {
		const directory = repo_with_environment('bare', undefined)

		expect(doctor_ports.read_repository_ports(BARE_NAME, directory)).toStrictEqual({
			name: BARE_NAME,
			seed: 0,
			development: 5173,
			preview: 4173,
		})
	})
})

describe('reading a repository at its main work tree', () => {
	it('reports a malformed seed as unreadable rather than guessing at ports', () => {
		const directory = repo_with_environment('broken', 'PORT_SEED=abc\n')

		expect(doctor_ports.read_repository_ports(BROKEN_NAME, directory)).toStrictEqual({
			name: BROKEN_NAME,
			seed: undefined,
			development: undefined,
			preview: undefined,
		})
	})

	// The ports are the main tree's (seat 0), read from the seed alone: a stray JOSH_LANE_SEAT that a
	// root .env should never carry must not move the ports or hide a valid seed behind a bad seat.
	it('reports seat-0 ports from a valid seed, ignoring a stray lane seat', () => {
		const name = 'owner/stray'
		const directory = repo_with_environment('stray', 'PORT_SEED=1\nJOSH_LANE_SEAT=99\n')

		expect(doctor_ports.read_repository_ports(name, directory)).toStrictEqual({
			name,
			seed: 1,
			development: 5183,
			preview: 4183,
		})
	})
})

describe('naming repositories that share a seed', () => {
	it('names only the seeds more than one repository holds, lowest first', () => {
		const shared = doctor_ports.shared_seeds([
			entry(OWNER_A, 0),
			entry(OWNER_C, 1),
			entry(OWNER_B, 0),
		])

		expect(shared).toStrictEqual([{ seed: 0, names: [OWNER_A, OWNER_B] }])
	})

	it('ignores an unreadable seed rather than grouping repositories under it', () => {
		const shared = doctor_ports.shared_seeds([entry(OWNER_A, undefined), entry(OWNER_B, undefined)])

		expect(shared).toStrictEqual([])
	})
})

describe('the port-seed report', () => {
	it('lists each repository’s seed and ports, and names a shared seed', () => {
		const report = doctor_ports.format_port_report([
			entry(OWNER_A, 0),
			entry(OWNER_B, 1),
			entry(OWNER_C, 0),
		])

		expect(report).toContain('owner/a  seed 0  dev 5173  preview 4173')
		expect(report).toContain('owner/b  seed 1  dev 5183  preview 4183')
		expect(report).toContain('⚠ seed 0 is shared by: owner/a, owner/c')
	})

	it('marks a repository whose seed could not be read', () => {
		const report = doctor_ports.format_port_report([entry('owner/x', undefined)])

		expect(report).toContain('owner/x  PORT_SEED could not be read')
	})

	it('reads a whole map, sorted by name, and names the shared seed', () => {
		const map = new Map([
			[OWNER_B, repo_with_environment('rb', SEED_2_ENV)],
			[OWNER_A, repo_with_environment('ra', SEED_2_ENV)],
		])

		const report = doctor_ports.report_port_seeds(map)

		expect(report).toContain('owner/a  seed 2  dev 5193  preview 4193')
		expect(report).toContain('⚠ seed 2 is shared by: owner/a, owner/b')
	})
})
