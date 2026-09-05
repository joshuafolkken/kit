import { describe, expect, it } from 'vitest'
import { time_bundle_call } from './time-bundle-call'

const READ_PATH = 'scripts/time/time-spans.ts'
const OTHER_PATH = 'scripts/time/time-report.ts'

describe('time_bundle_call.tool_facts', () => {
	it('reads a path-naming tool as bundleable and keeps its target', () => {
		expect(time_bundle_call.tool_facts('Read', { file_path: READ_PATH })).toEqual({
			is_bundleable: true,
			targets: [READ_PATH],
		})
	})

	it('reads an edit as bundleable, since the harness applies a turn edits in order', () => {
		expect(time_bundle_call.tool_facts('Edit', { file_path: READ_PATH }).is_bundleable).toBe(true)
	})

	// The allow-list is what keeps an unclassified tool out. A delegation is the case it exists for:
	// the call after one routinely needs what the unit answered.
	it('refuses a tool nobody put on the allow-list', () => {
		expect(time_bundle_call.tool_facts('Task', { file_path: READ_PATH })).toEqual({
			is_bundleable: false,
			targets: [],
		})
	})

	// `old_string` and `new_string` carry file bodies. Reading them as targets would pull every path
	// the file happens to mention into the call's set, where it would make unrelated calls look ordered.
	it('takes no target from a field holding a file body', () => {
		const facts = time_bundle_call.tool_facts('Edit', { old_string: OTHER_PATH })

		expect(facts.targets).toEqual([])
	})
})

describe('time_bundle_call.bash_facts — which commands count', () => {
	it('reads an inspection command as bundleable', () => {
		expect(time_bundle_call.bash_facts(`cat ${READ_PATH}`)).toEqual({
			is_bundleable: true,
			targets: [READ_PATH],
		})
	})

	// `git status` and `git switch` are one word apart, and the label carries only the leading word.
	it('refuses git, which no reading of the leading word can classify', () => {
		expect(time_bundle_call.bash_facts('git status').is_bundleable).toBe(false)
	})

	// A chain is labelled by its first segment, so the leading word says nothing about the rest.
	it('refuses a chain whose later segment mutates', () => {
		expect(time_bundle_call.bash_facts(`cat ${READ_PATH} && rm ${OTHER_PATH}`)).toEqual({
			is_bundleable: false,
			targets: [],
		})
	})

	it('reads a gh query as bundleable', () => {
		const facts = time_bundle_call.bash_facts('gh api repos/joshuafolkken/kit/issues/1344')

		expect(facts.is_bundleable).toBe(true)
		expect(facts.targets).toEqual(['repos/joshuafolkken/kit/issues/1344'])
	})

	it('refuses a gh call carrying a write flag', () => {
		const command = 'gh api repos/joshuafolkken/kit/issues -f title=x'

		expect(time_bundle_call.bash_facts(command).is_bundleable).toBe(false)
	})
})

describe('time_bundle_call.bash_facts — what a command names', () => {
	it('normalizes a leading ./ so the same file reads as one target', () => {
		expect(time_bundle_call.bash_facts(`cat ./${READ_PATH}`).targets).toEqual([READ_PATH])
	})

	it('keeps a flag and a bare word out of the targets', () => {
		expect(time_bundle_call.bash_facts(`grep -rn foo ${READ_PATH}`).targets).toEqual([READ_PATH])
	})

	// A line naming twenty paths says nothing more about what it depends on than its first few do, and
	// the set is carried on every span of the run.
	it('caps how many targets one call contributes', () => {
		const paths = Array.from({ length: 20 }, (_value, index) => `scripts/a${String(index)}.ts`)
		const facts = time_bundle_call.bash_facts(`cat ${paths.join(' ')}`)

		expect(facts.targets).toHaveLength(time_bundle_call.MAX_TARGETS)
	})
})
