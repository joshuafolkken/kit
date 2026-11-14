import { lane_early_push_count } from '#scripts/lane/lane-early-push-count'
import { afterEach, expect, it } from 'vitest'
import { issue_not_before } from './issue-not-before'
import { issue_observation_fixture as fixture } from './issue-observation-fixture'
import { issue_observation_gate } from './issue-observation-gate'
import { issue_sample_gate } from './issue-sample-gate'

afterEach(() => {
	issue_observation_gate.reset()
	issue_sample_gate.reset()
})

it('waits again after restart until the persisted evidence comment is read', () => {
	issue_observation_gate.record(fixture.URL, fixture.comment(fixture.KEYS))
	expect(issue_not_before.is_due(fixture.BODY)).toBe(true)
	issue_observation_gate.reset()
	expect(issue_not_before.is_due(fixture.BODY)).toBe(false)
	expect(issue_not_before.waiting_reason(fixture.BODY)).toContain('unread')
})

it('requires multi-slot dispositions, same-head execution, comparison and acquired costs independently', () => {
	issue_observation_gate.record(fixture.URL, fixture.comment(['same-head']))
	expect(issue_not_before.waiting_reason(fixture.BODY)).toBe(
		'observation evidence required: multi-slot, comparison, cost',
	)
	expect(issue_not_before.is_due(fixture.BODY)).toBe(false)
	issue_observation_gate.record(fixture.URL, fixture.comment(fixture.KEYS))
	expect(issue_not_before.is_due(fixture.BODY)).toBe(true)
})

it.each([
	['unknown version', fixture.BODY.replace(':v1 ', ':v2 ')],
	['unknown required key', fixture.BODY.replace('cost -->', 'unknown -->')],
	['malformed source', fixture.BODY.replace('https://github.com', 'https://example.com')],
])('withholds an %s instead of treating it as fulfilled', (_name, body) => {
	issue_observation_gate.record(fixture.URL, fixture.comment(fixture.KEYS))
	expect(issue_not_before.is_due(body)).toBe(false)
})

it.each([
	['missing tasks', '## Observation evidence\n'],
	['missing evidence', fixture.comment(fixture.KEYS).replaceAll(/ \[evidence\]\([^\n]+\)/gu, '')],
	[
		'duplicated task',
		`${fixture.comment(fixture.KEYS)}\n- [x] cost: duplicate [evidence](${fixture.EVIDENCE})`,
	],
	['fenced example', `\`\`\`\n${fixture.comment(fixture.KEYS)}\n\`\`\``],
])('keeps waiting on %s', (_name, comment) => {
	issue_observation_gate.record(fixture.URL, comment)
	expect(issue_not_before.is_due(fixture.BODY)).toBe(false)
})

const METRIC = lane_early_push_count.MULTI_SLOT_EARLY_PUSH
const UNKNOWN_METRIC = 'unknown-metric'
const LEDGER_BODY = fixture.ledger_body(METRIC)

it('releases a ledger-conditioned wait once the ledger holds the declared samples', () => {
	issue_observation_gate.record(fixture.URL, fixture.comment([]))
	issue_observation_gate.record_sample(METRIC, 0)
	expect(issue_not_before.is_due(LEDGER_BODY)).toBe(false)
	expect(issue_not_before.waiting_reason(LEDGER_BODY)).toContain('multi-slot, same-head')
	issue_observation_gate.record_sample(METRIC, 1)
	expect(issue_not_before.is_due(LEDGER_BODY)).toBe(true)
})

it('still releases a ledger-conditioned wait on checked evidence', () => {
	issue_observation_gate.record(fixture.URL, fixture.comment(fixture.KEYS))
	expect(issue_not_before.is_due(LEDGER_BODY)).toBe(true)
})

it('withholds an unknown ledger metric instead of treating it as fulfilled', () => {
	const body = fixture.ledger_body(UNKNOWN_METRIC)

	issue_observation_gate.record_sample(UNKNOWN_METRIC, 1)
	issue_observation_gate.record(fixture.URL, fixture.comment(fixture.KEYS))
	expect(issue_not_before.is_due(body)).toBe(false)
	expect(issue_not_before.waiting_reason(body)).toContain('unknown observation condition')
})

it('does not reinterpret a free-text stop or an ordinary failure as an observation wait', () => {
	expect(
		issue_not_before.waiting_reason('Waiting for multi-slot evidence and costs'),
	).toBeUndefined()
	expect(issue_not_before.waiting_reason('review failed')).toBeUndefined()
})

it('keeps observation requirements after the initial merge sample condition is satisfied', () => {
	const body = `${fixture.BODY}\n- 実施可能条件: #7399 のマージ後 1 マージ`

	issue_sample_gate.record(
		{ cited: 7399, via: 'pull', count: 1 },
		{ merged_at: '2026-11-01', closes: 7398 },
	)
	issue_sample_gate.use_merges(() => [{ issue: 7401, at: '2026-11-02' }])
	issue_observation_gate.record(fixture.URL, fixture.comment(['same-head']))
	expect(issue_not_before.waiting_reason(body)).toContain('multi-slot, comparison, cost')
})
