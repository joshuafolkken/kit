import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { session_cite } from '#scripts/issue/session-cite'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { review_record } from './review-record'

const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'review-record-check-'))
const ISSUE = 2343
const NONE_LINE = '- rf:none | none | - | 2026-09-22 | #2343\n'

afterEach(() => {
	vi.restoreAllMocks()
})

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

// A checkout whose ledger holds `content` in the given issue's file.
function root_with(name: string, file_issue: number, content: string): string {
	const root = path.join(TEST_DIR, name)
	const file = path.join(root, observation_ledger.ledger_file(file_issue))

	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, content, 'utf8')

	return root
}

describe('review_record.check', () => {
	it('is `ok` when the ledger holds a finding line for the issue', async () => {
		const root = root_with('recorded', ISSUE, '- rf:tests | medium | a.ts | 2026-09-22 | #2343\n')

		expect(await review_record.check(ISSUE, root)).toEqual({ status: 'ok', issue: ISSUE })
	})

	it('is `ok` when the ledger holds only a zero-finding `none` line for the issue', async () => {
		const root = root_with('none-only', ISSUE, NONE_LINE)

		expect(await review_record.check(ISSUE, root)).toEqual({ status: 'ok', issue: ISSUE })
	})

	// joshuafolkken/kit#2919: every file of the directory is read, not only the issue's own.
	it('is `ok` when the line for the issue sits in another file of the directory', async () => {
		const root = root_with('elsewhere', 1, NONE_LINE)

		expect(await review_record.check(ISSUE, root)).toEqual({ status: 'ok', issue: ISSUE })
	})

	it('is `missing` when the ledger carries no line for the issue', async () => {
		const root = root_with('other-issue', 1, '- rf:tests | low | a.ts | 2026-09-22 | #1\n')

		expect(await review_record.check(ISSUE, root)).toEqual({ status: 'missing', issue: ISSUE })
	})

	it('is `not-required` when the checkout keeps no ledger', async () => {
		const missing = path.join(TEST_DIR, 'does-not-exist')

		expect(await review_record.check(ISSUE, missing)).toEqual({ status: 'not-required' })
	})

	it('reads the work tree the command runs in by default, a lane in a lane', async () => {
		const root = root_with('lane', ISSUE, '- rf:none | none | - | 2026-09-23 | #2343\n')
		const spy = vi.spyOn(observation_ledger_home, 'ledger_root').mockReturnValue(root)

		expect(await review_record.check(ISSUE)).toEqual({ status: 'ok', issue: ISSUE })
		expect(spy).toHaveBeenCalled()
	})
})

describe('review_record.refusal_message', () => {
	it('names the issue and points at the record command', () => {
		const message = review_record.refusal_message(ISSUE)

		expect(message).toContain(`Issue: ${session_cite.issue(ISSUE)}`)
		expect(message).toContain('pnpm josh review:record --issue')
	})
})
