import { describe, expect, it } from 'vitest'
import { behavior_assertion } from './behavior-assertion'
import { behavior_rules } from './behavior-rules'
import { behavior_test_fixture } from './behavior-test-fixture'

const {
	bash_block,
	bash_line,
	bash_result_line,
	DENIED_BASH,
	GIT_STATUS,
	GIT_COMMIT,
	GIT_ADD_DRY,
	JOSH_GIT,
	TOOL_ID,
} = behavior_test_fixture
const OTHER_TOOL_ID = 'tool-2'
const EXECUTION_ERROR = 'fatal: unable to write index'

describe('behavior_rules.is_index_mutation', () => {
	it('flags direct staging and commit commands', () => {
		const mutations = [
			GIT_COMMIT,
			'git add .',
			'git add -A',
			'git rm --cached foo',
			'git restore --staged foo',
			'cd sub && git commit -m "y"',
			'git commit -n -m "x"',
		]

		expect(mutations.every((command) => behavior_rules.is_index_mutation(command))).toBe(true)
	})

	it('does not flag dry runs, josh git, working-tree rm, or a mere mention', () => {
		const clean = [
			GIT_ADD_DRY,
			'git add --dry-run .',
			'git rm --cached -n foo',
			JOSH_GIT,
			GIT_STATUS,
			'git rm foo',
			"grep 'git commit' file.ts",
			'echo "git add ."',
		]

		expect(clean.some((command) => behavior_rules.is_index_mutation(command))).toBe(false)
	})
})

describe('behavior_rules.command_of', () => {
	it('reads a Bash command and ignores every other block', () => {
		expect(behavior_rules.command_of(bash_block(GIT_STATUS))).toBe(GIT_STATUS)
	})

	it('returns undefined for a non-Bash block', () => {
		expect(behavior_rules.command_of({ ...bash_block('x'), name: 'Write' })).toBeUndefined()
	})

	it('returns undefined when the input is not a record', () => {
		expect(behavior_rules.command_of({ ...bash_block('x'), input: 'raw' })).toBeUndefined()
	})
})

describe('behavior_rules.index_mutation_assertion', () => {
	it.each([GIT_COMMIT, 'git add .'])('ignores a denied Bash call: %s', (command) => {
		const text = [bash_line(command), bash_result_line(TOOL_ID, true, DENIED_BASH)].join('\n')

		const findings = behavior_rules.index_mutation_assertion.scan(
			behavior_assertion.parse_transcript(text),
		)

		expect(findings).toEqual([])
	})

	it('still flags a call that failed after execution', () => {
		const text = [bash_line(GIT_COMMIT), bash_result_line(TOOL_ID, true, EXECUTION_ERROR)].join(
			'\n',
		)

		const findings = behavior_rules.index_mutation_assertion.scan(
			behavior_assertion.parse_transcript(text),
		)

		expect(findings).toHaveLength(1)
	})

	it('only excludes the call paired with the denial', () => {
		const text = [
			bash_line(GIT_COMMIT, TOOL_ID),
			bash_line('git add .', OTHER_TOOL_ID),
			bash_result_line(OTHER_TOOL_ID, true, DENIED_BASH),
		].join('\n')

		const findings = behavior_rules.index_mutation_assertion.scan(
			behavior_assertion.parse_transcript(text),
		)

		expect(findings.map((finding) => finding.detail)).toEqual([GIT_COMMIT])
	})
})

describe('behavior_rules.index_mutation_assertion existing coverage', () => {
	it('finds a direct commit and names the assertion and command', () => {
		const lines = behavior_assertion.parse_transcript(bash_line(GIT_COMMIT))

		const findings = behavior_rules.index_mutation_assertion.scan(lines)

		expect(findings).toEqual([
			{
				assertion: behavior_rules.INDEX_ASSERTION_NAME,
				position: 1,
				detail: GIT_COMMIT,
			},
		])
	})

	it('stays green on a transcript that only mentions git in an argument', () => {
		const text = [bash_line("grep 'git commit' x"), bash_line(GIT_ADD_DRY)].join('\n')

		const findings = behavior_rules.index_mutation_assertion.scan(
			behavior_assertion.parse_transcript(text),
		)

		expect(findings).toEqual([])
	})
})
