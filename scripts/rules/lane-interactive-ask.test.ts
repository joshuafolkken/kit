import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { lane_interactive_ask } from './lane-interactive-ask'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'

// joshuafolkken/kit#2201: a dispatched lane child's interactive ask must be refused and routed to the
// park, so this suite owns the two halves that decide whether the refusal fires — the tool-name match
// (`AskUserQuestion`) and the "is this a dispatched lane child" read. **Both directions matter**: a row
// silent in a lane leaves the measured defect where it was, and one that speaks for a person working in
// a lane refuses every question they ask.

const ASK_TOOL = 'AskUserQuestion'
const BASH = 'Bash'
const RULE_ID = 'lane-interactive-ask'
const ISSUE = '2201'
const ASK_INPUT = { questions: [{ question: 'Which library?', options: [{ label: 'zod' }] }] }
const ASK_CALL = { name: ASK_TOOL, input: ASK_INPUT }
const NOW_MS = 1_700_000_000_000
const A_LATER_CALL_MS = NOW_MS + 60_000
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'lane-interactive-ask-'))
// The directory vitest was launched from, restored before WORK_DIRECTORY is removed. The suite pins its
// working directory to the non-lane WORK_DIRECTORY per test to stay hermetic: the trigger reads the
// live process.cwd() to decide whether a checkout is a lane, so a run started inside a lane worktree
// would otherwise fire the refusal on every silence-expecting case (joshuafolkken/kit#1884).
const ENTRY_DIRECTORY = process.cwd()
const LANE_ROOT = path.join(WORK_DIRECTORY, '.kit-lanes')
const LANE_DIRECTORY = path.join(LANE_ROOT, ISSUE)
const WRITTEN_TRANSCRIPTS = new Set<string>()

// Count of enumeration rows whose trigger fires for an interactive-ask call from a lane child. Only
// this row may, since every other row self-gates on the `Bash` tool name.
function rules_claiming_ask(): number {
	return delivered_rules.DELIVERED_RULES.filter((rule) =>
		rule.is_trigger({ name: ASK_TOOL, input: ASK_INPUT }),
	).length
}

function payload_of(name: string, tool_name = ASK_TOOL): string {
	const transcript = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(transcript, '')
	WRITTEN_TRANSCRIPTS.add(transcript)

	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path: transcript,
		tool_name,
		tool_input: ASK_INPUT,
	})
}

beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = ''
	// Every test starts with no dispatch mark; the lane block sets it in its own beforeEach.
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

describe('cwd isolation', () => {
	// **The suite pins its own working directory** (joshuafolkken/kit#1884): launched from a lane
	// worktree, the silence cases below would otherwise read as a lane and fire the refusal.
	it('runs the silence assertions from the non-lane work directory', () => {
		// realpathSync so the assertion holds on macOS, where process.cwd() resolves the /tmp symlink.
		expect(process.cwd()).toBe(realpathSync(WORK_DIRECTORY))
		expect(lane_child_marker.is_child_of(process.cwd())).toBe(false)
	})
})

describe('is_interactive_ask', () => {
	// The dispatched-child case the refusal exists for.
	it('fires on an interactive ask from a dispatched lane child', () => {
		expect(lane_interactive_ask.is_interactive_ask(ASK_CALL, true)).toBe(true)
	})

	// **A person working in the lane carries no dispatch mark, so the rule stays silent for them.**
	it('says nothing about an interactive ask that is not a lane child', () => {
		expect(lane_interactive_ask.is_interactive_ask(ASK_CALL, false)).toBe(false)
	})

	// A lane child using any other tool is not asking a person.
	it('says nothing about a non-interactive tool even in a lane child', () => {
		expect(lane_interactive_ask.is_interactive_ask({ name: BASH, input: {} }, true)).toBe(false)
	})
})

describe('rule_delivery — inside a lane checkout', () => {
	const ORIGINAL_DIRECTORY = process.cwd()

	beforeEach(() => {
		mkdirSync(LANE_DIRECTORY, { recursive: true })
		process.chdir(LANE_DIRECTORY)
		// A real dispatched child arrives here with the mark set; the trigger reads it from the live
		// environment, so the delivery cases below only fire once it names this lane.
		process.env[lane_child_marker.KEY] = ISSUE
	})

	afterAll(() => {
		process.chdir(ORIGINAL_DIRECTORY)
		Reflect.deleteProperty(process.env, lane_child_marker.KEY)
	})

	it('delivers the rule on an interactive ask that has not parked', () => {
		const reason = rule_delivery(payload_of('lane-ask'), NOW_MS)

		expect(reason).toBe(delivered_rules.LANE_INTERACTIVE_ASK_REASON)
	})

	// **Every occurrence, not once per run.** An interactive ask must never succeed in a child, so a
	// second ask is refused again rather than let through to the harness's fatal denial — unlike the
	// once-per-run `lane-park` stop, whose reissue is the child's own recorded park.
	it('refuses the ask again on a second occurrence', () => {
		const payload = payload_of('lane-ask-again')

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.LANE_INTERACTIVE_ASK_REASON)
		expect(rule_delivery(payload, A_LATER_CALL_MS)).toBe(
			delivered_rules.LANE_INTERACTIVE_ASK_REASON,
		)
	})

	it('is claimed by exactly one rule in the enumeration', () => {
		expect(rules_claiming_ask()).toBe(1)
	})
})

describe('rule_delivery — outside a lane checkout', () => {
	// **The ordinary case is silence.** A person's own session, in the main checkout, may ask a question
	// and must never be refused for it.
	it('says nothing about an interactive ask in a checkout that is not a lane', () => {
		expect(rule_delivery(payload_of('plain-ask'), NOW_MS)).toBeUndefined()
	})
})

describe('LANE_INTERACTIVE_ASK_REASON', () => {
	it.each([
		// The park it asks for, and the command that records it — the only thing that makes it actionable.
		['needs-decision'],
		["labels[]=needs-decision'"],
		// The pointer to the procedure, never a resident document.
		['.claude/skills/workflow-commands/pre-gate-cut.md'],
		['backlogrun-park.md'],
		// It refuses every occurrence rather than standing down after one.
		['every occurrence'],
	])('carries %j', (marker) => {
		expect(delivered_rules.LANE_INTERACTIVE_ASK_REASON).toContain(marker)
	})

	// The pointer, not the resident document: this rule was never in `CLAUDE.md`, because it binds only
	// after a lane child is already running.
	it('names the topic file rather than the resident document', () => {
		expect(delivered_rules.LANE_INTERACTIVE_ASK_REASON).not.toContain('CLAUDE.md')
	})
})
