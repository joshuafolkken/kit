import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { eval_sandbox } from './eval-sandbox'
import { eval_trigger } from './eval-trigger'
import { eval_trigger_cli } from './eval-trigger-cli'

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

describe('eval_trigger.scope_for', () => {
	it('requires a run when a distributed document changed', () => {
		expect(eval_trigger.scope_for([RULES_DOCUMENT])).toBe(eval_trigger.REQUIRED_SCOPE)
	})

	it('skips a change that touches nothing the scenarios read', () => {
		expect(eval_trigger.scope_for([CODE, MANIFEST])).toBe(eval_trigger.SKIPPED_SCOPE)
	})

	// One measured path decides the whole change: the suite measures the distribution, not the file.
	it('requires a run when one measured path is mixed in', () => {
		expect(eval_trigger.scope_for([CODE, SKILL_FILE])).toBe(eval_trigger.REQUIRED_SCOPE)
	})

	// Answering `skip` here would hand a caller that failed to read the diff a skip as though it had
	// measured — the same side of the same ambiguity `josh review:level` takes.
	it('requires a run for an empty path list rather than assuming there was nothing', () => {
		expect(eval_trigger.scope_for([])).toBe(eval_trigger.REQUIRED_SCOPE)
	})

	it('ignores blank lines a diff listing may end with', () => {
		expect(eval_trigger.scope_for([CODE, '', '  '])).toBe(eval_trigger.SKIPPED_SCOPE)
	})
})

// joshuafolkken/kit#1152: the concurrent placement asks the same question of a list that already
// holds only measured paths — what a review changed while `josh eval` was running.
describe('eval_trigger.scope_for_measured_changes', () => {
	it('requires another run when the review touched a measured path', () => {
		expect(eval_trigger.scope_for_measured_changes([SKILL_FILE])).toBe(eval_trigger.REQUIRED_SCOPE)
	})

	// The deliberate opposite of `scope_for`'s empty case. There the empty list is a caller that
	// failed to read the diff; here it is the positive fact that a walk of the trigger's own path set
	// found nothing moved, and measuring again would re-read a tree that has not changed.
	it('skips an empty list where scope_for would require a run', () => {
		expect(eval_trigger.scope_for_measured_changes([])).toBe(eval_trigger.SKIPPED_SCOPE)
		expect(eval_trigger.scope_for([])).toBe(eval_trigger.REQUIRED_SCOPE)
	})
})

describe('eval_trigger.deciding_paths', () => {
	it('names the paths that forced the run', () => {
		expect(eval_trigger.deciding_paths([CODE, SKILL_FILE])).toStrictEqual([SKILL_FILE])
	})

	it('names nothing when no path is measured', () => {
		expect(eval_trigger.deciding_paths([CODE])).toStrictEqual([])
	})
})

describe('eval_trigger_cli.format_reason', () => {
	it('names the path that forced the run', () => {
		expect(eval_trigger_cli.format_reason([SKILL_FILE], eval_trigger.REQUIRED_SCOPE)).toContain(
			SKILL_FILE,
		)
	})

	it('says why a change was skipped', () => {
		expect(eval_trigger_cli.format_reason([CODE], eval_trigger.SKIPPED_SCOPE)).toContain(
			'nothing to measure',
		)
	})

	// The empty case answers `required`, so its reason has to explain a run nobody can see a cause
	// for rather than naming no path at all.
	it('explains a run forced by an unread diff', () => {
		expect(eval_trigger_cli.format_reason([], eval_trigger.REQUIRED_SCOPE)).toContain(
			'no changed paths were read',
		)
	})
})

describe('josh eval:scope registration', () => {
	it('is registered as a josh command', () => {
		expect(COMMAND_MAP['eval:scope']?.script).toBe('scripts/eval/eval-trigger-cli.ts')
	})

	it('has a short alias', () => {
		const { es } = ALIASES

		expect(es).toBe('eval:scope')
	})
})

describe('eval_trigger.documented_form', () => {
	// The prose form the marker suite compares each document against.
	it.each([
		['prompts', 'prompts/**'],
		['.claude/skills', '.claude/skills/**'],
		['CLAUDE.md', 'CLAUDE.md'],
		[HOOK_SETTINGS, HOOK_SETTINGS],
	])('writes %s as %s', (entry, expected) => {
		expect(eval_trigger.documented_form(entry)).toBe(expected)
	})

	// A dotfile's leading dot is part of the name, not an extension. Reading it as one would document
	// a directory as a bare path, and the marker suite would then force every distributed document to
	// state a set that describes the command's own answer wrongly.
	it('reads a dot-directory as a directory', () => {
		expect(eval_trigger.documented_form('.claude')).toBe('.claude/**')
	})

	it('reads an uppercase extension as an extension', () => {
		const shouting = 'docs/README.MD'

		expect(eval_trigger.documented_form(shouting)).toBe(shouting)
	})
})
