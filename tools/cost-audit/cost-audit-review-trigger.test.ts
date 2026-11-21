import { review_prompt_level } from '#scripts/review/review-prompt-level'
import { describe, expect, it } from 'vitest'
import { cost_audit, type MergeCounts } from './cost-audit'
import { cost_audit_fixture } from './cost-audit-fixture'
import { cost_audit_format } from './cost-audit-format'
import type { AuditSession } from './cost-audit-read'
import { cost_audit_review_trigger } from './cost-audit-review-trigger'

const { ms, day, record, session } = cost_audit_fixture
const { RETRY, UNKNOWN, UNMERGED, TITLE, NO_LEDGER } = cost_audit_review_trigger

// A one-day period ending at day 2: the current period is day 1, the previous one day 0.
const NOW_MS = ms(day(2))
const PREVIOUS = day(0) + 1
const CURRENT = day(1) + 1
const MERGED = 1
const OPEN = 2
const REVIEWER = 'reviewer'
const MAIN_PROMPT =
	'Review this checkout: read the review brief at /tmp/josh-ship-review-brief-a.md'
const INTERACTION_PROMPT =
	'Review this checkout: read the review brief at /tmp/josh-ship-review-brief-interaction-a.md'
const PAIRED_PROMPT =
	'Review this checkout as a paired /code-review, recorded only: read the review brief at /tmp/b.md'

interface Run {
	prompt?: string
	issue?: number | undefined
	agent_type?: string
	minute?: number
}

const ids = { next: 0 }

function run(options: Run): AuditSession {
	ids.next += 1

	return {
		...session('review', [record(`r${String(ids.next)}`, options.minute ?? CURRENT, 1)]),
		prompt: options.prompt ?? MAIN_PROMPT,
		issue: 'issue' in options ? options.issue : MERGED,
		agent_type: options.agent_type ?? REVIEWER,
	}
}

interface Ledger {
	merged_issues?: ReadonlySet<number>
	merges?: MergeCounts
}

const MERGED_LEDGER: Ledger = { merged_issues: new Set([MERGED]) }
// A ledger the audit could not read.
const UNREAD_LEDGER: Ledger = {}

function audit_of(
	sessions: ReadonlyArray<AuditSession>,
	ledger: Ledger,
): ReturnType<typeof cost_audit.audit> {
	const { merged_issues, merges } = ledger

	return cost_audit.audit({ sessions, days: 1, now_ms: NOW_MS, merges, merged_issues })
}

// Each trigger's current-period run count.
function counts_of(sessions: ReadonlyArray<AuditSession>): Map<string, number> {
	const { rows } = audit_of(sessions, MERGED_LEDGER).review_triggers

	return new Map(rows.map((row) => [row.key, row.current.sessions]))
}

function count_of(sessions: ReadonlyArray<AuditSession>, key: string): number | undefined {
	return counts_of(sessions).get(key)
}

describe('cost_audit_review_trigger — a run carrying its trigger', () => {
	it.each(review_prompt_level.TRIGGERS)('places a run whose prompt names %s under it', (word) => {
		const prompt = `medium — trigger: ${word} — ${MAIN_PROMPT}`

		expect(count_of([run({ prompt })], word)).toBe(1)
	})

	it('never calls a written trigger a retry', () => {
		const prompt = `trigger: initial — ${MAIN_PROMPT}`

		expect(count_of([run({ prompt }), run({ prompt })], 'initial')).toBe(2)
	})
})

describe('cost_audit_review_trigger — a run placed by its prompt and order', () => {
	it('places the interaction brief under interaction', () => {
		expect(count_of([run({ prompt: INTERACTION_PROMPT })], 'interaction')).toBe(1)
	})

	it('places the paired wording under paired', () => {
		expect(count_of([run({ prompt: PAIRED_PROMPT })], 'paired')).toBe(1)
	})

	it('places the first verification run under round-2, a consumer prefix dropped', () => {
		expect(count_of([run({ agent_type: 'kit:reviewer-verification' })], 'round-2')).toBe(1)
	})

	it('places a first main-brief run under initial and a second of its pass as a retry', () => {
		const counts = counts_of([run({}), run({}), run({ prompt: INTERACTION_PROMPT })])

		expect([counts.get('initial'), counts.get(RETRY), counts.get('interaction')]).toStrictEqual([
			1, 1, 1,
		])
	})

	it('counts a run outside a lane as unknown rather than dropping it', () => {
		expect(count_of([run({ issue: undefined })], UNKNOWN)).toBe(1)
	})

	it('keeps a written trigger on a run outside a lane', () => {
		const prompt = `trigger: round-2 — ${MAIN_PROMPT}`

		expect(count_of([run({ issue: undefined, prompt })], 'round-2')).toBe(1)
	})

	it('puts every run of an unmerged Issue under unmerged, whatever its trigger', () => {
		const written = run({ issue: OPEN, prompt: `trigger: paired — ${MAIN_PROMPT}` })

		expect(count_of([written, run({ issue: OPEN })], UNMERGED)).toBe(2)
	})

	it('reads only reviewer agents', () => {
		const counts = counts_of([run({ agent_type: 'investigator' })])

		expect(new Set(counts.values())).toStrictEqual(new Set([0]))
	})
})

describe('cost_audit_review_trigger — the rows', () => {
	it('sets each trigger beside the period before, its cost included', () => {
		const sessions = [run({}), run({ minute: PREVIOUS, issue: 3 }), run({ issue: 4 })]
		const { rows } = audit_of(sessions, { merged_issues: new Set([MERGED, 3, 4]) }).review_triggers

		expect(rows.find((row) => row.key === 'initial')).toStrictEqual({
			key: 'initial',
			current: { sessions: 2, usd: 2 },
			previous: { sessions: 1, usd: 1 },
		})
	})

	it('drops the unmerged row when the lane ledger could not be read', () => {
		const triggers = audit_of([run({ issue: OPEN })], UNREAD_LEDGER).review_triggers

		expect([
			triggers.is_merge_known,
			triggers.rows.some((row) => row.key === UNMERGED),
		]).toStrictEqual([false, false])
	})
})

describe('cost_audit_format.report_lines — the reviewer triggers', () => {
	it('prints the title and a row per trigger with its cost per merge', () => {
		const lines = cost_audit_format.report_lines(
			audit_of([run({})], { ...MERGED_LEDGER, merges: { current: 2, previous: 1 } }),
		)
		const initial = lines.find((line) => line.trimStart().startsWith('initial'))

		expect([lines.includes(TITLE), initial?.includes('per merge')]).toStrictEqual([true, true])
	})

	it('prints no cost per merge without merges, and notes an unread ledger', () => {
		const lines = cost_audit_format.report_lines(audit_of([run({})], UNREAD_LEDGER))
		const initial = lines.find((line) => line.trimStart().startsWith('initial'))

		expect([initial?.includes('per merge'), lines.includes(NO_LEDGER)]).toStrictEqual([false, true])
	})
})
