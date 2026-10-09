import {
	AI_DOCS,
	read_unwrapped,
	RULE_DELIVERY_RATIONALE,
	WORKFLOW_PROMPT_DIRECTORY,
} from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { rule_list } from './rule-list'

// joshuafolkken/kit#1198: a body handed to a command inside shell double quotes is evaluated before
// the command runs. The Issue recorded both halves of what that costs — a Telegram body that silently
// lost a word to command substitution, and a PR comment whose own words ran as git commands and
// switched a lane's work tree onto `main`, stopping the run.
//
// **The Issue's own premise is why this suite exists.** It says a defect of this shape is not one
// "being careful" avoids: every Issue body, PR comment and review note in this repository wraps file
// and command names in backticks, so firing is the default rather than an edge case. So the rule is
// delivered at the call that binds it rather than only written down, and what pins it is the delivery
// text plus the one resident line a non-Claude-Code session still has to be able to read.
const TOPIC_FILE = 'shell-body.md'
const CANONICAL = `${WORKFLOW_PROMPT_DIRECTORY}/${TOPIC_FILE}`
const DELIVERY = `${WORKFLOW_PROMPT_DIRECTORY}/rule-delivery.md`
// The residency list moved here from `residency.md` in joshuafolkken/kit#3177.
const RESIDENCY = 'docs/maintainers/residency-rationale.md'
const SHELL_BODY_RATIONALE = 'docs/maintainers/shell-body-rationale.md'
const SUITE_PATH = 'scripts/rules/shell-body-rule.test.ts'
// The trigger's own suite, split out of the enumeration's so the reading of a call is read beside the
// cases it has to keep. The marker list has to name it, or the split loses its coverage claim.
const TRIGGER_SUITE = 'scripts/rules/shell-body-trigger.test.ts'
// The one line in that list that had drifted from the suite it credits.
const STDIN_CLAIM = '`-` reads stdin'
// Named once: the enumeration, the residency list and this suite have to agree on the command.
const GUARD_COMMAND = 'pnpm josh rule:guard'
// The single safe spelling the rule steers every caller toward — asserted in the delivered text and
// again at the topic file, so it is named once here rather than duplicated across the two.
const ISSUE_COMMENT_SPELLING = 'pnpm josh issue:comment <N> --body-file <path>'
// The measurement the rule rests on, and the most quotable part of it — so it is the first thing that
// would be pasted back into an always-loaded document.
const MEASUREMENT = '履歴展開は非対話では無効'
// joshuafolkken/kit#3401 moved the measurement table and the blind-spot list into the rationale.
const RATIONALE_MEASUREMENT = 'history expansion is off when non-interactive'
// The resident trigger joshuafolkken/kit#3395 retired, asserted absent so it is not pasted back.
const RESIDENT_TRIGGER = '**Never put a body in shell double quotes**'

// Every sentence here changes what an agent does. Drop the mechanism and the refusal reads as style;
// drop the spellings and there is nothing to reissue with; drop the pointer and the trigger's blind
// spots are invisible.
describe('the delivered text — what the refusal states', () => {
	const delivered = delivered_rules.SHELL_BODY_REASON

	it.each([
		'contains a backtick or a `$`',
		'executed rather than merely mangled',
		'--body-file <path>',
		ISSUE_COMMENT_SPELLING,
		'--notify-message-file',
		'Reissue this call once the body is in a file',
	])('carries %j', (marker) => {
		expect(delivered).toContain(marker)
	})

	// A reference to `CLAUDE.md` names nothing once the body has left it, and the pointer is where the
	// measurement and the trigger's blind spots actually are.
	it('names the topic file rather than the document the body left', () => {
		expect(delivered).toContain(CANONICAL)
		expect(delivered).not.toContain('CLAUDE.md')
	})
})

// **A route stays resident; the trigger and the body do not.** joshuafolkken/kit#3395 took the
// trigger out: an agent that runs no hook applies the delivery enumeration as a self-check list
// (`principles.md`, joshuafolkken/kit#3079), so the resident line names that enumeration, and the
// enumeration's own suite below pins that it names this topic file.
describe.each(AI_DOCS)('%s — keeps the route, not the rule', (document_path) => {
	const content = read_unwrapped(document_path)

	it('routes to the delivery enumeration', () => {
		expect(content).toContain('shell bodies')
		expect(content).toContain(DELIVERY)
	})

	it('no longer carries the trigger', () => {
		expect(content).not.toContain(RESIDENT_TRIGGER)
	})

	it('leaves the measurement at the pointer', () => {
		expect(content).not.toContain(MEASUREMENT)
		expect(read_unwrapped(SHELL_BODY_RATIONALE)).toContain(RATIONALE_MEASUREMENT)
	})
})

describe(`${CANONICAL} — carries the damage, the measurement and the safe spellings`, () => {
	const content = read_unwrapped(CANONICAL)

	it.each([
		'## 本文をシェルの二重引用符に載せない（joshuafolkken/kit#1198）',
		// The half that reads as unbelievable, and therefore the half that gets dropped in a retelling.
		'**テキストが実行されること**',
		// Both call sites, because fixing one and leaving the other is what the Issue was filed over.
		'--notify-message',
		ISSUE_COMMENT_SPELLING,
		// `$'…'` stays correct, so the rule cannot be read as deprecating the form `CLAUDE.md` uses.
		"**`$'…'` も安全である。**",
		// The reader that makes the two call sites one implementation rather than two.
		'scripts/josh/cli-body.ts',
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// The trigger sees a shell string and nothing else, so the procedure says the rule binds beyond it.
	it('states the rule binds where the trigger cannot see', () => {
		expect(content).toContain('引き金が見えない綴り')
	})
})

describe(`${SHELL_BODY_RATIONALE} — records what the trigger cannot see`, () => {
	const content = read_unwrapped(SHELL_BODY_RATIONALE)

	it.each(['### What the trigger cannot see', 'gh api --input <file>', '`-b`'])(
		'records the blind spot %j',
		(marker) => {
			expect(content).toContain(marker)
		},
	)
})

// **The marker list is a claim about other suites, and nothing was checking it.** The list said
// `cli-body.test.ts` pinned the stdin `-` form while no case in it passed `-` at all — a
// documentation line that read as coverage and was not. So each suite the list credits is asserted
// here by name, and the one claim that had drifted is asserted as text: the suites themselves carry
// the cases, and this is what fails when the list and the suites part company again. The list is
// writer-facing, so it lives in the rationale rather than the procedure (joshuafolkken/kit#3179).
describe(`${SHELL_BODY_RATIONALE} — carries the marker list`, () => {
	const content = read_unwrapped(SHELL_BODY_RATIONALE)

	it.each([TRIGGER_SUITE, 'scripts/josh/cli-body.test.ts', SUITE_PATH, STDIN_CLAIM])(
		'credits %j in the marker list',
		(marker) => {
			expect(content).toContain(marker)
		},
	)

	it('leaves the marker list out of the procedure', () => {
		expect(read_unwrapped(CANONICAL)).not.toContain('### マーカーテスト')
	})
})

// The residency list is the second half of the rule: a rule the criterion moved and that is not
// listed as moved has not been checked against it (`residency-rationale.md`).
describe.each([RESIDENCY])('%s — lists the rule as delivered', (list_path) => {
	const content = read_unwrapped(list_path)

	it.each([TOPIC_FILE, GUARD_COMMAND])('names %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe(`pnpm josh rule:list — the enumeration names this rule and its silent turn`, () => {
	const content = rule_list.render()

	it.each([TOPIC_FILE, GUARD_COMMAND])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it('leaves the pinning suite to the rationale', () => {
		expect(read_unwrapped(RULE_DELIVERY_RATIONALE)).toContain(SUITE_PATH)
	})

	// The condition the whole enumeration turns on: a turn where nothing fires has to be a turn where
	// the rule is already kept, or the hook is firing on the wrong turns.
	it('says what a turn with no trigger means', () => {
		expect(content).toContain('the shell does not evaluate the body')
	})
})
