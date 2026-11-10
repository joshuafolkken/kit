import type { HookContext } from '#scripts/hooks/hook-context'
import { hook_decision, type GuardRun, type TranscriptGuardSpec } from '#scripts/josh/hook-decision'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { hook_context_fixture } from '#tools/hooks/hook-context-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeliveredRule } from './delivered-rules'
import { delivered_rules_guard } from './delivered-rules-guard'

// joshuafolkken/kit#6973: a row reads the context of the call it judges, never the process's.

const RULE_ID = 'example-rule'
const LANE: HookContext = hook_context_fixture.of('/lanes/6973', { MARK: 'lane' })
const PERSON: HookContext = hook_context_fixture.of('/person', {})
const CALL: GuardedCall = { name: 'Bash', input: { command: 'ls' } }
const RUN = { transcript: '/session.jsonl', now_ms: 0, context: LANE }

function rule_of(overrides: Partial<DeliveredRule> = {}): DeliveredRule {
	return {
		id: RULE_ID,
		is_trigger: (_call, context) => context.env['MARK'] === 'lane',
		reason: 'reason',
		about: { title: 'Example', topic: '`example.md`', fires: 'fires', quiet: 'quiet' },
		...overrides,
	}
}

function spec_of(rule: DeliveredRule): TranscriptGuardSpec {
	const create = vi.spyOn(hook_decision, 'create_transcript_guard')

	delivered_rules_guard.guard_of(rule)

	const [spec] = create.mock.lastCall ?? []

	if (spec === undefined) throw new Error('guard_of built no guard')

	return spec
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('delivered_rules_guard.prefix_of', () => {
	it('keys the stamp on the rule id', () => {
		expect(delivered_rules_guard.prefix_of(RULE_ID)).toBe(`josh-rule-guard-${RULE_ID}-`)
	})
})

describe('delivered_rules_guard.call_only', () => {
	it('asks the row with the call alone, leaving its own seam at the default', () => {
		const is_trigger = vi.fn((_call: GuardedCall, seam?: unknown) => seam === undefined)
		const row = delivered_rules_guard.call_only({ id: RULE_ID, is_trigger })

		expect(row.is_trigger(CALL)).toBe(true)
		expect(is_trigger).toHaveBeenCalledWith(CALL)
		expect(row.id).toBe(RULE_ID)
	})
})

describe('delivered_rules_guard.guard_of — the per-call context', () => {
	it('builds a candidate that reads the call context, not the process', () => {
		const spec = spec_of(rule_of())

		expect(spec.is_candidate(CALL, LANE)).toBe(true)
		expect(spec.is_candidate(CALL, PERSON)).toBe(false)
	})

	it('hands the run context to the row decision', () => {
		const decide = vi.fn((_call: GuardedCall, run: GuardRun) => run.context === LANE)
		const spec = spec_of(rule_of({ decide }))

		expect(spec.should_block('', CALL, hook_decision.NEVER_MS, RUN)).toBe(true)
	})

	it('stamps under the rule prefix with the rule switch', () => {
		const spec = spec_of(rule_of())

		expect(spec.prefix).toBe(delivered_rules_guard.prefix_of(RULE_ID))
		expect(spec.switch_key).toBe(delivered_rules_guard.SWITCH_ENV_KEY)
	})
})
