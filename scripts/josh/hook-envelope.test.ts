import { describe, expect, it } from 'vitest'
import { hook_envelope } from './hook-envelope'

const INPUT = { command: 'ls' }

describe('hook_envelope — the PreToolUse answer shapes', () => {
	it('denies with the reason as the permission decision reason', () => {
		expect(JSON.parse(hook_envelope.deny_envelope('no'))).toEqual({
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				permissionDecision: 'deny',
				permissionDecisionReason: 'no',
			},
		})
	})

	it('allows a rewrite past the permission prompt', () => {
		expect(JSON.parse(hook_envelope.rewrite_envelope(INPUT, 'why'))).toEqual({
			systemMessage: 'why',
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				permissionDecision: 'allow',
				updatedInput: INPUT,
				additionalContext: 'why',
			},
		})
	})

	it('leaves the permission of a flow rewrite to the harness', () => {
		const envelope = JSON.parse(hook_envelope.flow_rewrite_envelope(INPUT, 'why')) as {
			hookSpecificOutput: Record<string, unknown>
		}

		expect(envelope.hookSpecificOutput).not.toHaveProperty('permissionDecision')
		expect(envelope.hookSpecificOutput['updatedInput']).toEqual(INPUT)
	})

	it('carries a notice to both the model and the person, with no decision', () => {
		expect(JSON.parse(hook_envelope.notice_envelope('heads up'))).toEqual({
			systemMessage: 'heads up',
			hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'heads up' },
		})
	})
})
