import { describe, expect, it } from 'vitest'
import { behavior_assertion } from './behavior-assertion'
import { behavior_rules } from './behavior-rules'
import { behavior_test_fixture } from './behavior-test-fixture'

const { bash_block, bash_line, GIT_STATUS, GIT_COMMIT, GIT_ADD_DRY, JOSH_GIT } =
	behavior_test_fixture

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
