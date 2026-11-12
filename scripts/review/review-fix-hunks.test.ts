import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { review_brief } from './review-brief'
import type { RecordedRound } from './review-fix-round'
import { review_round_one_blobs } from './review-round-one-blobs'
import { review_tree } from './review-tree'

const FILE = 'a.ts'
const OTHER = 'b.ts'
const BEFORE = 'broken\nuntouched\nopen\n'
const FIXED = 'fixed\nuntouched\nopen\n'
const SETTLED = 'settled\n'
const CLOSED_REASON = 'Broken boundary.'
const BASE = 'base'
const WHOLE = 'Target: the whole change'
const TIMEOUT_MS = 30_000
const fixture: FixtureWorkspace & { root: string } = {
	previous_cwd: '',
	restore_environment: undefined,
	root: '',
	workspace: '',
}
const recorded: { round?: RecordedRound } = {}

function write(file: string, content: string): void {
	writeFileSync(path.join(fixture.root, file), content)
}

function previous(): RecordedRound {
	if (recorded.round === undefined) throw new Error('fixture not opened')

	return recorded.round
}

function compose(round: RecordedRound = previous(), base: string = BASE): string {
	return review_brief.compose({
		level: 'medium',
		round: 1,
		base,
		tree: review_tree.tree_of(fixture.root, [FILE, OTHER]),
		stamps: { gate: undefined, in_flight: undefined, round_one: undefined },
		checkout: { root: fixture.root, branch: 'feature', head: 'head' },
		nonce: 'nonce',
		rubric_path: '/rubric.md',
		fix_round: round,
	})
}

function record_fixture(): void {
	write(FILE, BEFORE)
	write(OTHER, SETTLED)
	const snapshot: FileMapStamp = {
		taken_at: '2026-11-04T00:00:00Z',
		base: BASE,
		files: review_tree.tree_of(fixture.root, [FILE, OTHER]),
		blobs: review_round_one_blobs.capture([FILE, OTHER]) ?? {},
	}

	recorded.round = {
		id: 'first',
		issue: 6286,
		snapshot: JSON.stringify(snapshot),
		findings: [
			{
				category: 'tests',
				severity: 'medium',
				file: `${FILE}:1`,
				description: CLOSED_REASON,
				disposition: 'fixed',
			},
			{
				category: 'security',
				severity: 'medium',
				file: `${FILE}:3`,
				description: 'Open validation finding.',
			},
		],
	}
}

beforeAll(async () => {
	Object.assign(fixture, git_fixture_workspace.open_workspace('review-fix-round-'))
	fixture.root = path.join(fixture.workspace, 'primary')
	await git_fixture_workspace.git(fixture.workspace, [
		'init',
		git_fixture_workspace.MAIN_BRANCH,
		'primary',
	])
	process.chdir(fixture.root)
	record_fixture()
}, TIMEOUT_MS)

afterEach(() => {
	write(FILE, BEFORE)
	write(OTHER, SETTLED)
})
afterAll(async () => {
	await git_fixture_workspace.close_workspace(fixture)
}, TIMEOUT_MS)

describe('round-1 fix rerun against real blobs', () => {
	it('prints only fix hunks and unresolved finding locations and bodies (ac-e34742ae)', () => {
		write(FILE, FIXED)
		const brief = compose()

		expect(brief).toContain('Round 1 rerun')
		expect(brief).toContain('-broken\n+fixed')
		expect(brief).toContain(`${FILE}:3 — Open validation finding.`)
		expect(brief).not.toContain(CLOSED_REASON)
		expect(brief).not.toContain('settled')
		expect(brief).not.toContain(WHOLE)
	})
	it('widens when the base moved (ac-a7908b53)', () => {
		write(FILE, FIXED)

		expect(compose(previous(), 'moved')).toContain(WHOLE)
	})
})

describe('round-1 fix rerun fallback', () => {
	it('widens without a usable snapshot or blobs', () => {
		write(FILE, FIXED)

		expect(compose({ ...previous(), snapshot: '{}' })).toContain(WHOLE)
		expect(
			compose({ ...previous(), snapshot: JSON.stringify({ taken_at: '', base: BASE, files: {} }) }),
		).toContain(WHOLE)
	})
	it('widens for an unrelated hunk in the same file', () => {
		write(FILE, 'fixed\nunrelated\nopen\n')

		expect(compose()).toContain(WHOLE)
	})
	it('widens for an unrelated file or an empty delta', () => {
		expect(compose()).toContain(WHOLE)
		write(FILE, FIXED)
		write(OTHER, 'unrelated\n')

		expect(compose()).toContain(WHOLE)
	})
	it('widens when a recorded finding has no body', () => {
		write(FILE, FIXED)
		const round = {
			...previous(),
			findings: previous().findings.map((finding) => ({ ...finding, description: '' })),
		}

		expect(compose(round)).toContain(WHOLE)
	})
})
