import path from 'node:path'
import { PACKAGE_DIR } from '#scripts/init/init-paths'
import { describe, expect, it } from 'vitest'
import { eval_scenario, type Scenario } from './eval-scenario'
import { FIXTURE_FILE_NAME, MINIMAL_SCENARIO } from './eval-scenario-fixture'

const SCENARIO_DIRECTORY = path.join(PACKAGE_DIR, 'evals/scenarios')
const QUOTING_LOW = 'tests:low:src/a.ts:1 — the name "x" is unclear.\n'
const LATER_MEDIUM = 'bug-risks:medium:src/a.ts:2 — it breaks.\n'

// kit#855's acceptance bar: at least four scenarios, each judged on observable behavior rather than
// on wording. Both halves are asserted against the shipped suite, because a scenario file that
// declares no expectation passes every run and reads as coverage.
const MINIMUM_SCENARIOS = 4

function parse(body: Record<string, unknown>): ReturnType<typeof eval_scenario.parse_scenario> {
	return eval_scenario.parse_scenario(FIXTURE_FILE_NAME, JSON.stringify(body))
}

const VALID = MINIMAL_SCENARIO

describe('eval_scenario.parse_scenario', () => {
	it('fills the optional halves so a minimal scenario is still complete', () => {
		const scenario = parse(VALID)

		expect(scenario.should_call).toStrictEqual([])
		expect(scenario.max_turns).toBeGreaterThan(0)
	})

	it.each([
		['a missing name', { rule: 'r', prompt: 'p' }],
		['a missing rule', { name: 'n', prompt: 'p' }],
		['a missing prompt', { name: 'n', rule: 'r' }],
		['an empty prompt', { ...VALID, prompt: '' }],
		['a zero turn limit', { ...VALID, max_turns: 0 }],
		['an expectation with no tool', { ...VALID, should_call: [{ because: 'b' }] }],
		// Without it a red run says "Edit was called" and nothing about which rule that broke, which
		// is the whole difference between a suite you can act on and a number.
		['an expectation with no reason', { ...VALID, should_call: [{ tool: 'Edit' }] }],
	])('rejects %s', (_label, body) => {
		expect(() => parse(body)).toThrow()
	})

	it('names the file in the error, since scenarios are read as a batch', () => {
		expect(() => parse({ rule: 'r', prompt: 'p' })).toThrow(new RegExp(FIXTURE_FILE_NAME, 'u'))
	})
})

describe('the shipped scenario suite', () => {
	const scenarios = eval_scenario.load_scenarios(SCENARIO_DIRECTORY)

	it('carries at least the four the issue asks for', () => {
		expect(scenarios.length).toBeGreaterThanOrEqual(MINIMUM_SCENARIOS)
	})

	it('gives every scenario a distinct name, since a name selects one to run', () => {
		expect(new Set(scenarios.map((scenario) => scenario.name)).size).toBe(scenarios.length)
	})

	it.each(scenarios.map((scenario) => [scenario.name, scenario]))(
		'%s judges on observable behavior',
		(_name, scenario) => {
			const expectations =
				scenario.should_call.length +
				scenario.should_not_call.length +
				scenario.should_call_in_order.length

			expect(expectations).toBeGreaterThan(0)
		},
	)

	it.each(scenarios.map((scenario) => [scenario.name, scenario]))(
		'%s names the rule it measures',
		(_name, scenario) => {
			expect(scenario.rule.length).toBeGreaterThan(0)
		},
	)
})

// The Write input arrives JSON-encoded, so a finding that quotes text puts `\"` before any later
// line; the blocking pattern has to read past it to the High or Medium written after. A pass
// scenario forbids that Write and a block scenario requires it, so the pattern sits in either list.
function blocks(scenario: Scenario, content: string): boolean {
	const input = JSON.stringify({ file_path: 'findings.txt', content })
	const patterns = [...scenario.should_call, ...scenario.should_not_call]
		.map((expectation) => expectation.input_matches ?? '')
		.filter((pattern) => pattern.includes(':(?:high|medium):'))

	return patterns.some((pattern) => new RegExp(pattern, 'u').test(input))
}

describe('the verification-fix scenarios — the High/Medium blocking pattern', () => {
	const scenarios = eval_scenario
		.load_scenarios(SCENARIO_DIRECTORY)
		.filter((scenario) => scenario.name.startsWith('verification-fix-'))

	it.each(scenarios.map((scenario) => [scenario.name, scenario]))(
		'%s blocks a Medium written after a line that quotes text',
		(_name, scenario) => {
			expect(blocks(scenario, `${QUOTING_LOW}${LATER_MEDIUM}`)).toBe(true)
		},
	)

	it.each(scenarios.map((scenario) => [scenario.name, scenario]))(
		'%s lets a Low-only findings file through',
		(_name, scenario) => {
			expect(blocks(scenario, QUOTING_LOW)).toBe(false)
		},
	)
})

// The three Bash-shape scenarios judge one forbidden command each. The sandbox drops the hooks that
// refuse these shapes, so the pattern is the whole measurement: it has to catch the shape the rule
// forbids and pass the compliant form beside it, or a run reads as held whatever the agent did.
function forbids(name: string, command: string, description = 'Run the command'): boolean {
	const scenario = eval_scenario
		.load_scenarios(SCENARIO_DIRECTORY)
		.find((candidate) => candidate.name === name)
	const input = JSON.stringify({ command, description })

	return (scenario?.should_not_call ?? [])
		.filter((expectation) => expectation.tool === 'Bash')
		.some((expectation) => new RegExp(expectation.input_matches ?? '', 'u').test(input))
}

const PIPED_VERIFICATION = 'piped-verification'
const FILE_BODY = 'file-body'
const ISSUE_COMMENTS = 'issue-comments'
const PIPED_GATE = 'pnpm josh gate 2>&1 | tail -20'
const BODY_ONLY_VIEW = 'gh issue view 42'

describe('the Bash-shape scenarios — the forbidden command pattern', () => {
	it.each([
		[PIPED_VERIFICATION, PIPED_GATE],
		[PIPED_VERIFICATION, 'pnpm josh test:unit | head -40'],
		[PIPED_VERIFICATION, 'cd /tmp/sandbox && npx josh check 2>&1 | tail -5'],
		[FILE_BODY, "cat > src/messages.ts <<'EOF'\nexport const GREETING = 'Hi'\nEOF"],
		[FILE_BODY, 'cat <<EOF > "src/messages.ts"\nexport const GREETING = \'Hi\'\nEOF'],
		[FILE_BODY, "printf 'x' | tee -a ./src/messages.ts"],
		[FILE_BODY, "echo 'export const THANKS = 1' >> src/messages.ts"],
		[FILE_BODY, "cat > /private/var/eval-abc/src/messages.ts <<'EOF'\nx\nEOF"],
		[FILE_BODY, 'cat > "$PWD/src/messages.ts" <<\'EOF\'\nx\nEOF'],
		[FILE_BODY, "tee -i src/messages.ts <<'EOF'\nx\nEOF"],
		[ISSUE_COMMENTS, BODY_ONLY_VIEW],
		[ISSUE_COMMENTS, 'gh issue view 42 --json title,body'],
		[ISSUE_COMMENTS, 'gh api repos/owner/repo/issues/42 --jq .body'],
	])('%s forbids `%s`', (name, command) => {
		expect(forbids(name, command)).toBe(true)
	})

	it.each([
		[PIPED_VERIFICATION, 'pnpm josh gate'],
		[PIPED_VERIFICATION, 'set -o pipefail; pnpm josh gate 2>&1 | tail -20'],
		[PIPED_VERIFICATION, 'pnpm josh gate || echo failed'],
		[FILE_BODY, 'cat src/messages.ts'],
		[FILE_BODY, "cat > notes/new.md <<'EOF'\nfresh\nEOF"],
		[ISSUE_COMMENTS, 'gh issue view 42 --comments'],
		[ISSUE_COMMENTS, 'gh issue view 42 --json body,comments'],
		[ISSUE_COMMENTS, 'gh issue view 42 -c'],
		[ISSUE_COMMENTS, 'gh api repos/owner/repo/issues/42/comments'],
		[FILE_BODY, 'cat src/messages.ts 2>/dev/null'],
	])('%s lets `%s` through', (name, command) => {
		expect(forbids(name, command)).toBe(false)
	})
})

// The pattern reads the JSON-encoded input, which carries the description beside the command; an
// agent describing the call as compliant must not hide the call itself.
describe('the Bash-shape scenarios — the description beside the command', () => {
	it.each([
		[PIPED_VERIFICATION, PIPED_GATE, 'pipefail is not needed here'],
		[ISSUE_COMMENTS, BODY_ONLY_VIEW, 'View issue 42 title, body and comments'],
	])('%s forbids `%s` whatever its description says', (name, command, description) => {
		expect(forbids(name, command, description)).toBe(true)
	})
})
