import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_stash } from '#scripts/git/git-stash'
import { stash_sweep_lock } from '#scripts/git/stash-sweep-lock'
import {
	LEGACY_OBSERVATION_LEDGER_PATHS,
	LEGACY_LEDGER_FILE as MIGRATED_FILE_NAME,
	observation_ledger,
	OBSERVATION_LEDGER_DIRECTORY,
} from '#scripts/observations/observation-ledger'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_tidy_stashes } from './run-tidy-stashes'

vi.mock('#scripts/git/git-stash', () => ({
	git_stash: {
		added_lines: vi.fn(),
		changed_paths: vi.fn(),
		drop_by_hash: vi.fn(),
		list_by_hash: vi.fn(),
	},
}))

vi.mock('#scripts/git/stash-sweep-lock', () => ({
	stash_sweep_lock: {
		with_lock: vi.fn(async (work: () => Promise<unknown>) => await work()),
	},
}))

const scratch = mkdtempSync(path.join(tmpdir(), 'run-tidy-stashes-test-'))
// joshuafolkken/kit#2919: the carry lands in the running tree's own issue file, and the duplicate check
// reads every file of the directory.
const LEDGER_FILE = observation_ledger.ledger_file(2701)
const LEGACY_LEDGER_FILE = LEGACY_OBSERVATION_LEDGER_PATHS[0] ?? ''
const LEDGER = path.join(scratch, LEDGER_FILE)
const OTHER_ISSUE_LEDGER = path.join(scratch, observation_ledger.ledger_file(1))
const EXISTING_LINE = '- k:old | d1 | 2026-09-01 | x | already recorded'
const NEW_LINE = '- k:lane-seat | d1 | 2026-09-29 | lane | a merged lane held a seat'
const OTHER_NEW_LINE = '- k:other | d1 | 2026-09-29 | lane | appended at the new path'
const MERGED_ENTRY = { selector: 'a'.repeat(40), subject: 'On main: backlogrun: parked #2583' }
const MIXED_ENTRY = {
	selector: 'b'.repeat(40),
	subject: 'On main: paused #2584 for prerequisite #2701',
}
const OPEN_ENTRY = { selector: 'c'.repeat(40), subject: 'On main: backlogrun: parked #2701' }
const NUMBERLESS_ENTRY = { selector: 'd'.repeat(40), subject: 'On main: scratch' }
const MERGED_ISSUES = new Set(['2583', '2584'])
const MIXED_KEPT = {
	target: `stash "${MIXED_ENTRY.subject}"`,
	verdict: { kind: 'keep', reason: '#2701 not merged' },
}

async function is_merged(issue: string): Promise<boolean> {
	return MERGED_ISSUES.has(issue)
}

beforeEach(() => {
	vi.clearAllMocks()
	rmSync(path.join(scratch, OBSERVATION_LEDGER_DIRECTORY), { force: true, recursive: true })
	mkdirSync(path.dirname(LEDGER), { recursive: true })
	writeFileSync(OTHER_ISSUE_LEDGER, `${EXISTING_LINE}\n`)
	vi.spyOn(process, 'cwd').mockReturnValue(scratch)
	vi.spyOn(observation_ledger_home, 'writer_path').mockResolvedValue(LEDGER)
	vi.mocked(git_stash.list_by_hash).mockResolvedValue([
		MERGED_ENTRY,
		MIXED_ENTRY,
		OPEN_ENTRY,
		NUMBERLESS_ENTRY,
	])
	vi.mocked(git_stash.changed_paths).mockResolvedValue(['scripts/a.ts'])
	vi.mocked(git_stash.drop_by_hash).mockResolvedValue(true)
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

// joshuafolkken/kit#2701: stashes of merged issues piled up until a person dropped them.
describe('run_tidy_stashes.tidy_stashes — which entries go', () => {
	it('drops only the entry whose issues are all merged', async () => {
		await run_tidy_stashes.tidy_stashes(is_merged)

		expect(git_stash.drop_by_hash).toHaveBeenCalledExactlyOnceWith(MERGED_ENTRY.selector)
	})

	it('reports the dropped entry and the kept one that names a merged issue', async () => {
		const outcomes = await run_tidy_stashes.tidy_stashes(is_merged)

		expect(outcomes).toStrictEqual([
			{ target: `stash "${MERGED_ENTRY.subject}"`, verdict: { kind: 'clean' } },
			MIXED_KEPT,
		])
	})
})

describe('run_tidy_stashes.tidy_stashes — the ledger carry and failures', () => {
	it("carries new ledger lines into this tree's file, skipping one another file holds", async () => {
		vi.mocked(git_stash.changed_paths).mockResolvedValue([LEDGER_FILE])
		vi.mocked(git_stash.added_lines).mockResolvedValue([EXISTING_LINE, NEW_LINE])

		const outcomes = await run_tidy_stashes.tidy_stashes(is_merged)

		expect(readFileSync(LEDGER, 'utf8')).toBe(`${NEW_LINE}\n`)
		expect(outcomes[0]?.target).toContain('1 observation line(s) carried to the ledger')
		expect(git_stash.added_lines).toHaveBeenCalledWith(MERGED_ENTRY.selector, LEDGER_FILE)
	})

	// joshuafolkken/kit#2724: an entry cut before the move holds its lines at the old path.
	it('carries the lines of both ledger paths an entry touches', async () => {
		vi.mocked(git_stash.changed_paths).mockResolvedValue([LEGACY_LEDGER_FILE, LEDGER_FILE])
		vi.mocked(git_stash.added_lines).mockImplementation(async (_hash, file_path) => [
			file_path === LEGACY_LEDGER_FILE ? NEW_LINE : OTHER_NEW_LINE,
		])

		await run_tidy_stashes.tidy_stashes(is_merged)

		expect(readFileSync(LEDGER, 'utf8')).toBe(`${NEW_LINE}\n${OTHER_NEW_LINE}\n`)
	})

	it('keeps the entry and drops nothing when the carry fails', async () => {
		vi.mocked(git_stash.changed_paths).mockRejectedValue(new Error('bad object'))

		const outcomes = await run_tidy_stashes.tidy_stashes(is_merged)

		expect(outcomes[0]?.verdict.kind).toBe('keep')
		expect(git_stash.drop_by_hash).not.toHaveBeenCalled()
	})

	it('reports an entry another run already dropped as kept', async () => {
		vi.mocked(git_stash.drop_by_hash).mockResolvedValue(false)

		const outcomes = await run_tidy_stashes.tidy_stashes(is_merged)

		expect(outcomes[0]?.verdict).toStrictEqual({
			kind: 'keep',
			reason: 'already dropped by another run',
		})
	})
})

function primary_with_old_ledger(): string {
	const root = mkdtempSync(path.join(scratch, 'primary-'))

	mkdirSync(path.join(root, path.dirname(LEGACY_LEDGER_FILE)), { recursive: true })
	writeFileSync(path.join(root, LEGACY_LEDGER_FILE), `${NEW_LINE}\n`)

	return root
}

// joshuafolkken/kit#2724: the duplicate check reads the ledger after the migration, not the empty new
// path before it — otherwise a line both the old ledger and the stash hold is carried twice.
describe('run_tidy_stashes.tidy_stashes — a primary checkout whose ledger is still at the old path', () => {
	it('carries no line the not-yet-migrated old ledger already holds', async () => {
		const root = primary_with_old_ledger()

		vi.mocked(process.cwd).mockReturnValue(root)
		vi.mocked(observation_ledger_home.writer_path).mockResolvedValue(path.join(root, LEDGER_FILE))
		vi.mocked(git_stash.changed_paths).mockResolvedValue([LEGACY_LEDGER_FILE])
		vi.mocked(git_stash.added_lines).mockResolvedValue([NEW_LINE])

		await run_tidy_stashes.tidy_stashes(is_merged)

		const migrated = path.join(root, OBSERVATION_LEDGER_DIRECTORY, MIGRATED_FILE_NAME)

		expect(readFileSync(migrated, 'utf8')).toBe(`${NEW_LINE}\n`)
		expect(existsSync(path.join(root, LEDGER_FILE))).toBe(false)
	})
})

describe('run_tidy_stashes.tidy_stashes — the sweep lock', () => {
	it('keeps every entry and drops nothing while another sweep holds the lock', async () => {
		vi.mocked(stash_sweep_lock.with_lock).mockResolvedValueOnce(undefined)

		const outcomes = await run_tidy_stashes.tidy_stashes(is_merged)

		expect(git_stash.drop_by_hash).not.toHaveBeenCalled()
		expect(outcomes).toStrictEqual([
			{
				target: `stash "${MERGED_ENTRY.subject}"`,
				verdict: { kind: 'keep', reason: 'another run held the stash sweep lock' },
			},
			MIXED_KEPT,
		])
	})
})
