import { describe, expect, it } from 'vitest'
import { time_bundle_call } from './time-bundle-call'
import { time_writes } from './time-writes'

const READ_PATH = 'scripts/time/time-spans.ts'
const OTHER_PATH = 'scripts/time/time-report.ts'
// The one operand of a `gh` line that sits outside its quotes (joshuafolkken/kit#1611).
const ENDPOINT = '/issues/1'
// The shape the measured genuine loss takes: an absolute path quoted for its length, not for a space.
const ABSOLUTE_PATH = '/Users/example/.claude/projects/kit/tool-results/b5qsy8wac.txt'

describe('time_bundle_call.tool_facts', () => {
	it('reads a path-naming tool as bundleable and keeps its target', () => {
		expect(time_bundle_call.tool_facts('Read', { file_path: READ_PATH })).toEqual({
			is_bundleable: true,
			targets: [READ_PATH],
			is_writing: false,
			may_write: false,
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
			is_writing: false,
			may_write: false,
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
			is_writing: false,
			may_write: false,
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
			is_writing: false,
			may_write: false,
		})
	})

	it('reads a gh query as bundleable', () => {
		const facts = time_bundle_call.bash_facts('gh api repos/joshuafolkken/kit/issues/1344')

		expect(facts.is_bundleable).toBe(true)
		expect(facts.targets).toEqual(['repos/joshuafolkken/kit/issues/1344'])
	})

	// An in-place edit is what `Edit` does, and `Edit` is bundleable — rejecting the shell spelling of
	// the same thing would exclude a call the tool form counts.
	it('reads an in-place edit as bundleable, as it does the tool that edits', () => {
		expect(time_bundle_call.bash_facts(`sed -i '' 's/a/b/' ${READ_PATH}`).is_bundleable).toBe(true)
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

	// joshuafolkken/kit#1611. A quote is a separator to `words_of` and `/` is not a separator at all,
	// so the substitution script came out as the path-shaped word `s/old/new` — a file no edit can ever
	// name, left pending in `investigation-reads.ts` for the rest of the run.
	it('takes no target from a quoted substitution script', () => {
		const facts = time_bundle_call.bash_facts(`sed -i '' 's/old/new/' ${READ_PATH}`)

		expect(facts.targets).toEqual([READ_PATH])
	})

	// The daily case in this repository: a path named inside a body being written to an Issue is prose
	// about a file, not a call on one, and counting it made unrelated calls look ordered.
	it('takes no target from a path quoted inside an argument', () => {
		const facts = time_bundle_call.bash_facts(`gh api ${ENDPOINT} --jq "${OTHER_PATH}"`)

		expect(facts.targets).toEqual([ENDPOINT])
	})

	// **The cost of stripping quotes rather than parsing them, asserted so it stays deliberate.** A
	// path quoted for any reason is lost, and the second case below is a genuine loss rather than a
	// tidy-up: `cat "<a long absolute path>"` really was reading that file, and with no target left the
	// dependency veto in `time-batch-guard.ts` no longer covers the search-then-read pair that produced
	// it.
	//
	// **Measured before it was accepted** (joshuafolkken/kit#1611), over 1,195 local transcripts and
	// 10,257 bundleable `Bash` calls: 2,094 calls change target set, and of the calls left naming
	// nothing at all, 579 lost words are phantoms — `*.ts` 76 times, `/##` 65, `.author.login` 46 —
	// against roughly 16 that were a quoted absolute path being read, every one of them under a
	// `tool-results` or `tasks` directory outside the repository. The phantoms are worse than noise:
	// two unrelated calls both quoting `*.ts` shared a target and looked *ordered*, which suppressed
	// the refusal this guard exists to make.
	//
	// **Parsing the quotes instead does not separate the two cases.** `'s/old/new/'` and `"*.ts"` are
	// whole-word quoted operands exactly as `"scripts/x.ts"` is, so unquoting a whole word rather than
	// dropping it keeps every phantom above. The shell line does not carry which is which — which is
	// why the alternative that would have was a second `targets` field on `Span`, rejected in the
	// Issue for leaving every reader to choose between them.
	it.each([
		['quoted because it holds a space', `cat 'scripts/a b.ts'`],
		['quoted because it is long', `cat "${ABSOLUTE_PATH}"`],
	])('loses a path %s', (_label, command) => {
		expect(time_bundle_call.bash_facts(command).targets).toEqual([])
	})

	// A line naming twenty paths says nothing more about what it depends on than its first few do, and
	// the set is carried on every span of the run.
	it('caps how many targets one call contributes', () => {
		const paths = Array.from({ length: 20 }, (_value, index) => `scripts/a${String(index)}.ts`)
		const facts = time_bundle_call.bash_facts(`cat ${paths.join(' ')}`)

		expect(facts.targets).toHaveLength(time_bundle_call.MAX_TARGETS)
	})
})

// **Whether a call writes is two questions, not one** (joshuafolkken/kit#1509). `may_write` feeds the
// refusal test and has to over-call, because refusing a write leaves a turn half applied. `is_writing`
// feeds the dependency test and must not, because a read wrongly called a write has its dependency
// *removed*. Same bias, opposite consequences.
describe('time_bundle_call — which calls write', () => {
	it.each([
		['Edit', true],
		['Write', true],
		['NotebookEdit', true],
		['Read', false],
		['Grep', false],
	])('reads the tool %s as writing: %s', (name, is_expected) => {
		const facts = time_bundle_call.tool_facts(name, { file_path: READ_PATH })

		expect(facts.is_writing).toBe(is_expected)
		expect(facts.may_write).toBe(is_expected)
	})

	// **The case the two fields exist for.** `sed` is on the read list because `sed -n` prints, so the
	// flag is the whole of the difference — and a `sed -n` counted as a certain write would have two
	// reads of one file read as independent, which is exactly the dependency the shared-target proxy
	// is kept for.
	it.each([
		[`sed -i '' s/a/b/ ${READ_PATH}`, true],
		[`sed -i.bak s/a/b/ ${READ_PATH}`, true],
		[`sed --in-place=.bak s/a/b/ ${READ_PATH}`, true],
		[`sed -n '1,200p' ${READ_PATH}`, false],
		[`cat ${READ_PATH}`, false],
		[`grep -rn 'a->b' ${READ_PATH}`, false],
		[`awk '$1 > 5' ${READ_PATH}`, false],
		// A bundled short flag is the spelling this repository's own instructions produce, and a
		// prefix test on `-i` alone missed it — leaving one span carrying a written path in `writes`
		// beside `is_writing: false`.
		[`sed -ni 's/a/b/p' ${READ_PATH}`, true],
		// Only the segment that runs the command answers. Scanned whole, any single-dash `i`
		// downstream — `grep -i`, `find -iname`, `diff -i` — made a pure read into a certain write,
		// and a read wrongly called a write has its dependency removed.
		[`sed -n '1,200p' ${READ_PATH} | grep -i handler`, false],
		[`sed -n 's/x -input/y/p' ${READ_PATH}`, false],
	])('reads the shell line %s as certainly writing: %s', (command, is_expected) => {
		expect(time_bundle_call.bash_facts(command).is_writing).toBe(is_expected)
	})

	// The conservative half stays wide: everything it over-calls is a call allowed that could have been
	// refused, which is the safe direction for the refusal test and for nothing else.
	it.each([
		[`sed -n '1,200p' ${READ_PATH}`, true],
		[`cat a.ts > ${READ_PATH}`, true],
		[`cat ${READ_PATH}`, false],
	])('reads the shell line %s as possibly writing: %s', (command, is_expected) => {
		expect(time_bundle_call.bash_facts(command).may_write).toBe(is_expected)
	})
})

// **The two halves of one `sed` line may never disagree** (joshuafolkken/kit#1509). `time-writes.ts`
// names *which* files an in-place `sed` wrote and this module answers *whether* it wrote at all; a
// span carrying a path in `writes` beside `is_writing: false` is a contradiction on one row, and it is
// exactly what two separate implementations of the test produced — one read the whole line and called
// a piped `grep -i` a write, the other missed a bundled `sed -ni`. They share one predicate now, and
// this suite is what would notice a second copy appearing again.
describe('time_bundle_call — the write question is answered once', () => {
	it.each([
		`sed -i '' s/a/b/ ${READ_PATH}`,
		`sed -ni 's/a/b/p' ${READ_PATH}`,
		`sed -n '1,200p' ${READ_PATH} | grep -i handler`,
		`sed -n '1,200p' ${READ_PATH}`,
	])('agrees with time_writes about whether %s wrote', (command) => {
		const has_writes = time_writes.bash_writes(command).length > 0

		expect(time_bundle_call.bash_facts(command).is_writing).toBe(has_writes)
	})
})

// The entry a caller holding a raw tool invocation uses — a `PreToolUse` payload, which has not had
// the shell command read out of its input the way `time-spans.ts` has by the time it asks
// (joshuafolkken/kit#1390).
describe('time_bundle_call.call_facts', () => {
	it('unwraps a Bash input before classifying it', () => {
		const facts = time_bundle_call.call_facts('Bash', { command: `cat ${READ_PATH}` })

		expect(facts).toEqual({
			is_bundleable: true,
			targets: [READ_PATH],
			is_writing: false,
			may_write: false,
		})
	})

	it('refuses a Bash input that writes', () => {
		const facts = time_bundle_call.call_facts('Bash', { command: 'pnpm josh followup --merge' })

		expect(facts.is_bundleable).toBe(false)
	})

	it('reads every other tool from its input fields', () => {
		expect(time_bundle_call.call_facts('Read', { file_path: OTHER_PATH })).toEqual({
			is_bundleable: true,
			targets: [OTHER_PATH],
			is_writing: false,
			may_write: false,
		})
	})

	it('refuses a tool nobody classified', () => {
		expect(time_bundle_call.call_facts('Task', { path: OTHER_PATH }).is_bundleable).toBe(false)
	})
})
