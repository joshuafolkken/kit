import { delivered_rules } from '#scripts/rules/delivered-rules'
import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_unwrapped, WORKFLOW_PROMPT_DIRECTORY } from './ai-document-fixture'
import { SKILL_ENTRY_FILE, SKILL_ROOT } from './skill-fixture'

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
const RESIDENCY = `${WORKFLOW_PROMPT_DIRECTORY}/residency.md`
const WORKFLOW_SKILL_ENTRY = `${SKILL_ROOT}/workflow-commands/${SKILL_ENTRY_FILE}`
const SUITE_PATH = 'scripts/shell-body-rule.test.ts'
// The trigger's own suite, split out of the enumeration's so the reading of a call is read beside the
// cases it has to keep. The marker list has to name it, or the split loses its coverage claim.
const TRIGGER_SUITE = 'scripts/rules/shell-body-trigger.test.ts'
// The one line in that list that had drifted from the suite it credits.
const STDIN_CLAIM = '`-` が標準入力を読むこと'
// Named once: the enumeration, both residency lists and this suite have to agree on the command.
const GUARD_COMMAND = 'pnpm josh rule:guard'
// The measurement the rule rests on, and the most quotable part of it — so it is the first thing that
// would be pasted back into an always-loaded document.
const MEASUREMENT = '履歴展開は非対話では無効'
// The resident trigger, asserted twice — once as present, once for where it sits relative to the rule
// it is the counterpart of.
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
		'--field body=@<path>',
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

// **The trigger stays resident; the body does not.** A hook reaches this harness alone — `AGENTS.md`,
// `GEMINI.md` and `.cursorrules` are pointers to `CLAUDE.md`, and a session under any of them runs no
// hook — so a document with the line removed would leave those sessions with no statement of the rule
// anywhere. It also has to keep working on the spellings the regex does not know.
describe.each(AI_DOCS)('%s — keeps the trigger, not the body', (document_path) => {
	const content = read_unwrapped(document_path)

	it.each([RESIDENT_TRIGGER, 'is _executed_', 'pass the body by path'])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it('routes to the topic file that carries the procedure', () => {
		expect(content).toContain(CANONICAL)
	})

	// It sits beside the rule it is the counterpart of: that one forbids carrying a file's new text in
	// a command, this one forbids carrying a body. The Issue asked for exactly that placement.
	it('sits beside the file-editing prohibition it is the counterpart of', () => {
		const editing = content.indexOf("**Never carry a file's new text inside a shell command.**")
		const body = content.indexOf(RESIDENT_TRIGGER)

		expect(editing).toBeGreaterThan(-1)
		expect(body).toBeGreaterThan(editing)
	})

	it('leaves the measurement at the pointer', () => {
		expect(content).not.toContain(MEASUREMENT)
		expect(read_unwrapped(CANONICAL)).toContain(MEASUREMENT)
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
		'gh api repos/{owner}/{repo}/issues/<N>/comments --field body=@<path>',
		// `$'…'` stays correct, so the rule cannot be read as deprecating the form `CLAUDE.md` uses.
		"**`$'…'` も安全である。**",
		// The reader that makes the two call sites one implementation rather than two.
		'scripts/josh/cli-body.ts',
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// The trigger sees a shell string and nothing else, so what it cannot see is part of the rule
	// rather than a footnote — it is the reason the resident line was not deleted.
	it.each(['### 引き金が見えないもの', 'gh api --input <file>', '`-b`'])(
		'records the blind spot %j',
		(marker) => {
			expect(content).toContain(marker)
		},
	)

	// **The marker list is a claim about other suites, and nothing was checking it.** The list said
	// `cli-body.test.ts` pinned the stdin `-` form while no case in it passed `-` at all — a
	// documentation line that read as coverage and was not. So each suite the list credits is asserted
	// here by name, and the one claim that had drifted is asserted as text: the suites themselves carry
	// the cases, and this is what fails when the list and the suites part company again.
	it.each([TRIGGER_SUITE, 'scripts/josh/cli-body.test.ts', SUITE_PATH, STDIN_CLAIM])(
		'credits %j in the marker list',
		(marker) => {
			expect(content).toContain(marker)
		},
	)
})

// The residency lists are the second half of the rule: a rule the criterion moved and that is not
// listed as moved has not been checked against it (`residency.md`).
describe.each([RESIDENCY, WORKFLOW_SKILL_ENTRY])(
	'%s — lists the rule as delivered',
	(list_path) => {
		const content = read_unwrapped(list_path)

		it.each([TOPIC_FILE, GUARD_COMMAND])('names %j', (marker) => {
			expect(content).toContain(marker)
		})
	},
)

describe(`${DELIVERY} — the enumeration names this rule and its silent turn`, () => {
	const content = read_unwrapped(DELIVERY)

	it.each([TOPIC_FILE, GUARD_COMMAND, SUITE_PATH])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// The condition the whole enumeration turns on: a turn where nothing fires has to be a turn where
	// the rule is already kept, or the hook is firing on the wrong turns.
	it('says what a turn with no trigger means', () => {
		expect(content).toContain('本文がシェルに評価されない ＝ 規則は既に守られている')
	})
})
