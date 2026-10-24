import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { project_checks } from '#scripts/gate/project-checks'
import { changed_paths } from '#scripts/git/changed-paths'
import { session_cite } from '#scripts/issue/session-cite'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { review_finding_ledger } from './review-finding-ledger'
import { review_interaction, type InteractionStatus } from './review-interaction'

const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'review-interaction-'))
const ISSUE = 4276
const DATE = '2026-09-22'
const DUE = ['scripts/run/ship/x.ts']
const NOT_DUE = ['scripts/review/x.ts']
const NOT_REQUIRED: InteractionStatus = 'not-required'

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

// A checkout whose ledger holds `content` in the issue's file.
function root_with(name: string, content: string): string {
	const root = path.join(TEST_DIR, name)
	const file = path.join(root, observation_ledger.ledger_file(ISSUE))

	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, content, 'utf8')

	return root
}

describe('review_interaction.due_paths', () => {
	it('keeps the paths under the four run-tooling directories and drops the rest', () => {
		const paths = [
			'scripts/run/a.ts',
			'scripts/lane/b.ts',
			'scripts/backlog/c.ts',
			'scripts/hooks/d.ts',
			'scripts/review/e.ts',
			'docs/scripts/run/notes.md',
		]

		expect(review_interaction.due_paths(paths)).toEqual(paths.slice(0, 4))
	})

	it('keeps none in a consumer checkout, whose own run directories are not kit tooling', () => {
		vi.spyOn(project_checks, 'is_kit_repository').mockReturnValue(false)

		expect(review_interaction.due_paths(DUE, TEST_DIR)).toEqual([])
		expect(project_checks.is_kit_repository).toHaveBeenCalledWith(TEST_DIR)
		vi.restoreAllMocks()
	})
})

describe('review_interaction.status_of', () => {
	it('is `not-required` when the change touches none of the directories', async () => {
		const root = root_with('not-due', '')

		expect(await review_interaction.status_of(ISSUE, NOT_DUE, root)).toBe(NOT_REQUIRED)
	})

	it('is `not-required` when the checkout keeps no ledger', async () => {
		const missing = path.join(TEST_DIR, 'does-not-exist')

		expect(await review_interaction.status_of(ISSUE, DUE, missing)).toBe(NOT_REQUIRED)
	})

	it('is `missing` when only a `/code-review` line is recorded', async () => {
		const root = root_with('code-only', `${review_finding_ledger.zero_round_line(DATE, ISSUE)}\n`)

		expect(await review_interaction.status_of(ISSUE, DUE, root)).toBe('missing')
	})

	it('is `ok` when an interaction line is recorded', async () => {
		const line = review_finding_ledger.zero_round_line(DATE, ISSUE, 'interaction')
		const root = root_with('recorded', `${line}\n`)

		expect(await review_interaction.status_of(ISSUE, DUE, root)).toBe('ok')
	})
})

describe('review_interaction.brief_block', () => {
	it('gives the reviewer its one role and lists the due paths', () => {
		const block = review_interaction.brief_block(DUE)

		expect(block).toContain('## Interaction review')
		expect(block).toContain('find three existing features this change breaks')
		expect(block).toContain(`- ${DUE[0] ?? ''}`)
	})
})

// The merge gate's half, over this checkout's change as `changed_paths` reads it.
describe('review_interaction.refusal', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('refuses a due change whose ledger holds only a `/code-review` line', async () => {
		vi.spyOn(changed_paths, 'read_changed_paths').mockResolvedValue([...DUE])
		const root = root_with(
			'refusal-code-only',
			`${review_finding_ledger.zero_round_line(DATE, ISSUE)}\n`,
		)

		expect(await review_interaction.refusal(ISSUE, root)).toBe(
			review_interaction.refusal_message(ISSUE),
		)
	})

	it('has no refusal once the interaction pass is recorded', async () => {
		vi.spyOn(changed_paths, 'read_changed_paths').mockResolvedValue([...DUE])
		const line = review_finding_ledger.zero_round_line(DATE, ISSUE, 'interaction')
		const root = root_with('refusal-recorded', `${line}\n`)

		expect(await review_interaction.refusal(ISSUE, root)).toBeUndefined()
	})

	it('has no refusal for a change outside the run tooling', async () => {
		vi.spyOn(changed_paths, 'read_changed_paths').mockResolvedValue([...NOT_DUE])
		const root = root_with('refusal-not-due', '')

		expect(await review_interaction.refusal(ISSUE, root)).toBeUndefined()
	})
})

// joshuafolkken/kit#4802: `josh ship` and `josh run:review` open round 1 from the one answer.
describe('review_interaction.round_one_slots', () => {
	it('puts the interaction slot beside code’s when its review is missing', () => {
		expect(review_interaction.round_one_slots('missing')).toStrictEqual(['code', 'interaction'])
	})

	it.each<InteractionStatus | undefined>(['ok', NOT_REQUIRED, undefined])(
		'keeps code’s slot alone when the status is %s',
		(status) => {
			expect(review_interaction.round_one_slots(status)).toStrictEqual(['code'])
		},
	)
})

// A consumer's own `scripts/run/` is not kit's run tooling: neither the brief nor the merge gate asks.
describe('review_interaction in a consumer checkout', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('is `not-required` and has no refusal for a due path with only a `/code-review` line', async () => {
		vi.spyOn(changed_paths, 'read_changed_paths').mockResolvedValue([...DUE])
		vi.spyOn(project_checks, 'is_kit_repository').mockReturnValue(false)
		const root = root_with('consumer', `${review_finding_ledger.zero_round_line(DATE, ISSUE)}\n`)

		expect(await review_interaction.status(ISSUE, root)).toBe(NOT_REQUIRED)
		expect(await review_interaction.refusal(ISSUE, root)).toBeUndefined()
	})
})

describe('review_interaction.refusal_message', () => {
	it('names the issue and points at the brief and record commands', () => {
		const message = review_interaction.refusal_message(ISSUE)

		expect(message).toContain(`Issue: ${session_cite.issue(ISSUE)}`)
		expect(message).toContain('pnpm josh review:brief --interaction')
		expect(message).toContain('pnpm josh review:record --interaction')
	})
})
