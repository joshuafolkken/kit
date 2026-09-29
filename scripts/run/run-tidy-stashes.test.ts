import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { git_stash } from '#scripts/git/git-stash'
import { stash_sweep_lock } from '#scripts/git/stash-sweep-lock'
import {
	OBSERVATION_LEDGER_PATH as LEDGER_FILE,
	LEGACY_OBSERVATION_LEDGER_PATH as LEGACY_LEDGER_FILE,
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
const LEDGER = path.join(scratch, 'observations.md')
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
	writeFileSync(LEDGER, `${EXISTING_LINE}\n`)
	vi.spyOn(observation_ledger_home, 'ledger_path').mockReturnValue(LEDGER)
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
	it('carries new ledger lines into the ledger before the drop', async () => {
		vi.mocked(git_stash.changed_paths).mockResolvedValue([LEDGER_FILE])
		vi.mocked(git_stash.added_lines).mockResolvedValue([EXISTING_LINE, NEW_LINE])

		const outcomes = await run_tidy_stashes.tidy_stashes(is_merged)

		expect(readFileSync(LEDGER, 'utf8')).toBe(`${EXISTING_LINE}\n${NEW_LINE}\n`)
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

		expect(readFileSync(LEDGER, 'utf8')).toBe(`${EXISTING_LINE}\n${NEW_LINE}\n${OTHER_NEW_LINE}\n`)
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

// joshuafolkken/kit#2724: the duplicate check reads the ledger after the migration, not the empty new
// path before it — otherwise a line both the old ledger and the stash hold is carried twice.
describe('run_tidy_stashes.tidy_stashes — a primary checkout whose ledger is still at the old path', () => {
	it('carries no line the not-yet-migrated old ledger already holds', async () => {
		const root = mkdtempSync(path.join(scratch, 'primary-'))

		mkdirSync(path.join(root, 'docs'), { recursive: true })
		writeFileSync(path.join(root, LEGACY_LEDGER_FILE), `${NEW_LINE}\n`)
		vi.mocked(observation_ledger_home.ledger_path).mockRestore()
		vi.spyOn(repo_discovery, 'main_worktree').mockReturnValue(root)
		vi.mocked(git_stash.changed_paths).mockResolvedValue([LEGACY_LEDGER_FILE])
		vi.mocked(git_stash.added_lines).mockResolvedValue([NEW_LINE])

		await run_tidy_stashes.tidy_stashes(is_merged)

		expect(readFileSync(path.join(root, LEDGER_FILE), 'utf8')).toBe(`${NEW_LINE}\n`)
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
