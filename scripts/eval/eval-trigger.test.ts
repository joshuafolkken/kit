import { describe, expect, it } from 'vitest'
import { eval_sandbox } from './eval-sandbox'
import { eval_trigger } from './eval-trigger'

const RULES_DOCUMENT = 'CLAUDE.md'
const POINTER_DOCUMENT = 'AGENTS.md'
const SKILL_FILE = '.claude/skills/workflow-commands/fullrun.md'
const PROMPT_FILE = 'prompts/review.md'
const HOOK_SETTINGS = '.claude/settings.json'
const CODE = 'scripts/eval/eval-trigger.ts'
const MANIFEST = 'package.json'

describe('eval_trigger.is_measured', () => {
	it.each([RULES_DOCUMENT, POINTER_DOCUMENT, 'GEMINI.md', SKILL_FILE, PROMPT_FILE, HOOK_SETTINGS])(
		'treats %s as something the scenarios can see',
		(path) => {
			expect(eval_trigger.is_measured(path)).toBe(true)
		},
	)

	it.each([CODE, 'docs/eval.md', MANIFEST, 'evals/scenarios/consult-not-execute.json'])(
		'does not treat %s as measured',
		(path) => {
			expect(eval_trigger.is_measured(path)).toBe(false)
		},
	)

	// A bare prefix test would match a sibling directory whose name merely starts the same way.
	it('does not match a sibling directory sharing a prefix', () => {
		expect(eval_trigger.is_measured('prompts-archive/rule.md')).toBe(false)
	})
})

// The trigger set is the sandbox's own list. Restating it here would let the two drift, and a
// trigger that names a path no scenario reads asks for real Claude sessions that measure nothing.
describe('the trigger set is the set the sandbox copies', () => {
	it('is exactly the distributed paths plus the settings file', () => {
		expect([...eval_trigger.MEASURED_PATHS]).toStrictEqual([
			...eval_sandbox.DISTRIBUTED_PATHS,
			eval_sandbox.SETTINGS_PATH,
		])
	})
})
