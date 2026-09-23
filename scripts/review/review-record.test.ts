import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { review_record } from './review-record'

const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'review-record-check-'))
const ISSUE = 2343

afterEach(() => {
	vi.restoreAllMocks()
})

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

function ledger_with(name: string, content: string): string {
	const file = path.join(TEST_DIR, name)

	writeFileSync(file, content, 'utf8')

	return file
}

describe('review_record.check', () => {
	it('is `ok` when the ledger holds a finding line for the issue', async () => {
		const file = ledger_with('recorded.md', '- rf:tests | medium | a.ts | 2026-09-22 | #2343\n')

		expect(await review_record.check(ISSUE, file)).toEqual({ status: 'ok', issue: ISSUE })
	})

	it('is `ok` when the ledger holds only a zero-finding `none` line for the issue', async () => {
		const file = ledger_with('none-only.md', '- rf:none | none | - | 2026-09-22 | #2343\n')

		expect(await review_record.check(ISSUE, file)).toEqual({ status: 'ok', issue: ISSUE })
	})

	it('is `missing` when the ledger carries no line for the issue', async () => {
		const file = ledger_with('other-issue.md', '- rf:tests | low | a.ts | 2026-09-22 | #1\n')

		expect(await review_record.check(ISSUE, file)).toEqual({ status: 'missing', issue: ISSUE })
	})

	it('is `not-required` when the ledger file cannot be read', async () => {
		const missing = path.join(TEST_DIR, 'does-not-exist.md')

		expect(await review_record.check(ISSUE, missing)).toEqual({ status: 'not-required' })
	})

	it('reads the primary checkout ledger by default, the one a lane records into', async () => {
		const file = ledger_with('primary.md', '- rf:none | none | - | 2026-09-23 | #2343\n')
		const spy = vi.spyOn(observation_ledger_home, 'ledger_path').mockReturnValue(file)

		expect(await review_record.check(ISSUE)).toEqual({ status: 'ok', issue: ISSUE })
		expect(spy).toHaveBeenCalled()
	})
})

describe('review_record.refusal_message', () => {
	it('names the issue and points at the record command', () => {
		const message = review_record.refusal_message(ISSUE)

		expect(message).toContain('Issue: #2343')
		expect(message).toContain('pnpm josh review:record --issue')
	})
})
