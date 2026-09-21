import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { rule_body_guard } from './rule-body-guard'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'

// joshuafolkken/kit#2272: the residency questions have to be delivered at the edit that writes a rule
// into prose, and only there. This suite pins both halves — the append fires, and the three edits that
// are not an append (typo, link swap, deletion) stay silent, the wrong-turn firing `rule-delivery.md`
// calls worse than no hook.

const EDIT = 'Edit'
const WRITE = 'Write'
const BASH = 'Bash'
const RULE_ID = 'rule-body'
const NOW_MS = 1_700_000_000_000
const A_LATER_CALL_MS = NOW_MS + 60_000
const CLAUDE_PATH = '/repo/CLAUDE.md'
const SCRIPT_PATH = '/repo/scripts/foo.ts'
const NEW_PROMPT_PATH = '/repo/prompts/new-rule.md'
const EMPTY = (): string => ''
const RULE_DELIVERY = 'prompts/collaboration-workflow/rule-delivery.md'
const RESIDENCY = 'prompts/collaboration-workflow/residency.md'
const FIRING_SUITE = 'scripts/rules/rule-body-guard.test.ts'
const ORACLE_LIST = 'oracle:list'
const RUN_STEP = 'run:step'
const REASON = rule_body_guard.RULE_BODY_REASON

// A full sentence of rule prose — past the threshold, so adding it is an append.
const RULE_SENTENCE =
	'A run that files a second Issue folds it into the first by default, ' +
	'and states the overage when it does not, so the backlog cannot grow two entries where one would do.'
// A link whose only change is the URL: stripped, the two read identically.
const LINK_OLD = 'See [docs](https://example.com/a) for the rule and its rationale.'
const LINK_NEW = 'See [docs](https://example.com/b) for the rule and its rationale.'
// A one-character typo fix on an existing line — the misspelling is the fixture, so it is ignored.
// cspell:ignore alwyas
const TYPO_OLD = 'The agent must alwyas read the comments before it implements the Issue.'
const TYPO_NEW = TYPO_OLD.replace('alwyas', 'always')

const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'rule-body-guard-'))
const ENTRY_DIRECTORY = process.cwd()
const WRITTEN_TRANSCRIPTS = new Set<string>()

function edit_call(file_path: string, old_string: string, new_string: string): GuardedCall {
	return { name: EDIT, input: { file_path, old_string, new_string } }
}

function edit_payload(name: string, old_string: string, new_string: string): string {
	const transcript = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(transcript, '')
	WRITTEN_TRANSCRIPTS.add(transcript)

	const tool_input = { file_path: CLAUDE_PATH, old_string, new_string }

	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path: transcript,
		tool_name: EDIT,
		tool_input,
	})
}

beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = ''
	Reflect.deleteProperty(process.env, lane_child_marker.KEY)
	process.chdir(WORK_DIRECTORY)
})

afterAll(() => {
	process.chdir(ENTRY_DIRECTORY)

	for (const transcript of WRITTEN_TRANSCRIPTS) {
		rmSync(delivered_rules.delivery_path(RULE_ID, transcript), { force: true })
	}

	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

describe('is_rule_document', () => {
	it.each([
		[CLAUDE_PATH, true],
		['CLAUDE.md', true],
		['/repo/prompts/collaboration-workflow/residency.md', true],
		['/repo/.claude/skills/workflow-commands/SKILL.md', true],
		[SCRIPT_PATH, false],
		['/repo/docs/readme.md', false],
		['/repo/my-prompts/x.md', false],
	])('classifies %j as %s', (file_path, expected) => {
		expect(rule_body_guard.is_rule_document(file_path)).toBe(expected)
	})
})

describe('writes_rule_prose — the append fires, the three non-appends do not', () => {
	it('fires on an edit that appends a rule sentence to a rule document', () => {
		const call = edit_call(CLAUDE_PATH, '', `- **New rule.** ${RULE_SENTENCE}`)

		expect(rule_body_guard.writes_rule_prose(call)).toBe(true)
	})

	// A typo fix leaves the net length unchanged, so it is not an append.
	it('says nothing about a typo fix', () => {
		expect(rule_body_guard.writes_rule_prose(edit_call(CLAUDE_PATH, TYPO_OLD, TYPO_NEW))).toBe(
			false,
		)
	})

	// A link swap changes only the URL, which the prose measure strips from both sides.
	it('says nothing about a link swap', () => {
		const call = edit_call(CLAUDE_PATH, LINK_OLD, LINK_NEW)

		expect(rule_body_guard.writes_rule_prose(call)).toBe(false)
	})

	// A deletion removes prose, so the net addition is negative.
	it('says nothing about a deletion', () => {
		const call = edit_call(CLAUDE_PATH, RULE_SENTENCE, '')

		expect(rule_body_guard.writes_rule_prose(call)).toBe(false)
	})

	// The same append to a file that is not a rule document is out of scope.
	it('says nothing about an append to a non-rule file', () => {
		expect(rule_body_guard.writes_rule_prose(edit_call(SCRIPT_PATH, '', RULE_SENTENCE))).toBe(false)
	})

	// Only Edit and Write carry a file edit; a Bash call is never this rule's trigger.
	it('says nothing about a non-edit tool', () => {
		const call = { name: BASH, input: { command: RULE_SENTENCE } }

		expect(rule_body_guard.writes_rule_prose(call)).toBe(false)
	})
})

describe('writes_rule_prose — Write reads the existing file for its old text', () => {
	// A new file has no existing text, so its whole body is added.
	it('fires on a Write that creates a new rule document', () => {
		const call = { name: WRITE, input: { file_path: NEW_PROMPT_PATH, content: RULE_SENTENCE } }

		expect(rule_body_guard.writes_rule_prose(call, EMPTY)).toBe(true)
	})

	// A rewrite that adds little over the existing text is not an append.
	it('says nothing about a Write that barely grows an existing file', () => {
		const call = {
			name: WRITE,
			input: { file_path: NEW_PROMPT_PATH, content: `${RULE_SENTENCE} X.` },
		}

		expect(rule_body_guard.writes_rule_prose(call, () => RULE_SENTENCE)).toBe(false)
	})
})

describe('rule_delivery — end to end through the enumeration', () => {
	it('delivers the rule on an edit that writes a rule into prose', () => {
		expect(rule_delivery(edit_payload('append', '', RULE_SENTENCE), NOW_MS)).toBe(REASON)
	})

	// Once per run: the second edit of the same run is not refused again.
	it('delivers once per run rather than once per call', () => {
		const payload = edit_payload('append-repeat', '', RULE_SENTENCE)

		expect(rule_delivery(payload, NOW_MS)).toBe(REASON)
		expect(rule_delivery(payload, A_LATER_CALL_MS)).toBeUndefined()
	})

	it('says nothing about a typo fix in a rule document', () => {
		expect(rule_delivery(edit_payload('typo', TYPO_OLD, TYPO_NEW), NOW_MS)).toBeUndefined()
	})

	it('says nothing when the switch is off', () => {
		process.env[SWITCH_ENV_KEY] = 'off'

		expect(rule_delivery(edit_payload('off', '', RULE_SENTENCE), NOW_MS)).toBeUndefined()
	})

	// Exactly one enumeration row claims the edit, so no delivery is silently dropped.
	it('is claimed by exactly one rule in the enumeration', () => {
		const call = edit_call(CLAUDE_PATH, '', RULE_SENTENCE)
		const claiming = delivered_rules.DELIVERED_RULES.filter((rule) => rule.is_trigger(call))

		expect(claiming).toHaveLength(1)
	})
})

describe('RULE_BODY_REASON — what the refusal states', () => {
	it.each([
		// Question 0 and the command that answers it.
		['question 0'],
		[`pnpm josh ${ORACLE_LIST}`],
		// The ordering question and the driver it names.
		['the ordering question'],
		[`pnpm josh ${RUN_STEP}`],
		// The criterion and the delivery enumeration, as pointers rather than restated procedure.
		[RESIDENCY],
		[RULE_DELIVERY],
		// The once-per-run reissue, without which the run cannot land the edit it was refused.
		['once per run'],
		['reissue this'],
	])('carries %j', (marker) => {
		expect(REASON).toContain(marker)
	})
})

describe(`${RULE_DELIVERY} — the enumeration names this rule`, () => {
	const content = read_repo_file(RULE_DELIVERY)

	it.each([FIRING_SUITE, EDIT, ORACLE_LIST])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe(`${RESIDENCY} — the single source of the criterion`, () => {
	const content = read_repo_file(RESIDENCY)

	// The reason points here for both questions; the doc has to carry the commands they name.
	it.each([ORACLE_LIST, RUN_STEP])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})
