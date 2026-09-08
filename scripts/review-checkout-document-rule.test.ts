import { readFileSync } from 'node:fs'
import { read_unwrapped } from '#scripts/ai-document-fixture'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { package_file } from '#scripts/skill-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1522: `/code-review` is forked by the harness into the **session's** working
// directory, so a run implementing in a lane is reviewed against a different tree — one holding the
// previous child's already-merged code, where there is nothing wrong to find. The review returns no
// findings and the run reads that silence as a clean round.
//
// **Two things can rot independently here, and both of them rot silently.** The documents can stop
// telling a run to check the attestation, and the merge gate can stop asking for one; either way the
// next lane run is reviewed against somebody else's diff and reports it as approved. So the rule is
// pinned in the documents a run actually reads on the way to a merge, and the wiring is pinned at the
// one seam that refuses.

const COMMAND = 'pnpm josh review:attest'
const CHECK_COMMAND = `${COMMAND} --check`
const COMMAND_NAME = 'review:attest'
const COMMAND_ALIAS = 'ra'
const SCRIPT_PATH = 'scripts/review/review-attest-cli.ts'
const COMMAND_DOC = 'docs/josh-commands.md'
const REVIEW_PROMPT = 'prompts/review.md'
const FOLLOWUP_SCRIPT = 'scripts-ai/git-followup-workflow.ts'
// The run's tail moved out of the entry point with joshuafolkken/kit#1539, so the clear is asserted
// where it now lives; the gate in front of the merge stayed behind and is still read above.
const FINISH_SCRIPT = 'scripts-ai/git-followup-finish.ts'

// Every document a run reads between a review's verdict and the merge it authorizes. `epicrun.md` is
// on the list because a lane is where the defect fires; `SKILL.md` and `chain-rule.md` because they
// are what a `fullrun` reads at the moment it would act on a clean round.
const WORKFLOW_SKILL = '.claude/skills/workflow-commands/SKILL.md'
const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'
const EPICRUN = '.claude/skills/workflow-commands/epicrun.md'

const FLOW_DOCUMENTS: ReadonlyArray<string> = [
	WORKFLOW_SKILL,
	CHAIN_RULE,
	EPICRUN,
	REVIEW_PROMPT,
	COMMAND_DOC,
]

// The three a run reads at the moment it would act on a clean round, so each has to name the check
// the run itself makes rather than only the one the review makes.
const RUN_SIDE_DOCUMENTS: ReadonlyArray<string> = [WORKFLOW_SKILL, CHAIN_RULE, REVIEW_PROMPT]

describe('a review that cannot show which checkout it read is refused', () => {
	it.each(FLOW_DOCUMENTS)('%s names the attestation command', (document_path) => {
		expect(read_unwrapped(document_path)).toContain(COMMAND)
	})

	// The absent case is the one the defect actually took: it produced no signal at all, so a document
	// that named only the mismatch would leave a run treating silence as success.
	it.each(FLOW_DOCUMENTS)('%s says a missing attestation is a refusal too', (document_path) => {
		expect(read_unwrapped(document_path)).toContain('missing')
	})

	it.each([...FLOW_DOCUMENTS])('%s says the fork starts in the session checkout', (path) => {
		expect(read_unwrapped(path)).toContain("session's")
	})

	// The run asks the other end, and it has to be spelled out somewhere a run reads before it merges.
	it.each(RUN_SIDE_DOCUMENTS)('%s names the check the run itself runs', (document_path) => {
		expect(read_unwrapped(document_path)).toContain(CHECK_COMMAND)
	})

	it('the review prompt gives the verdict a review must report instead of findings', () => {
		expect(read_unwrapped(REVIEW_PROMPT)).toContain('REVIEW TARGET MISMATCH')
	})
})

// A documented command nothing registers is a command an entry point cannot run.
describe('the command the documents name is the one the registry runs', () => {
	it('is registered against its script', () => {
		expect(COMMAND_MAP[COMMAND_NAME]?.script).toBe(SCRIPT_PATH)
	})

	it('resolves from its alias', () => {
		expect(ALIASES[COMMAND_ALIAS]).toBe(COMMAND_NAME)
	})
})

// **The gate is asserted at the seam rather than through an import**: `main` runs at import time in
// `git-followup-workflow.ts`, so a suite reaching it that way would run a real followup. What matters
// is that the refusal sits in front of the merge and not merely somewhere in the file.
describe('the merge gate asks before it merges', () => {
	const source = readFileSync(package_file(FOLLOWUP_SCRIPT), 'utf8')

	const call = 'assert_review_attested(should_merge)'

	it('calls the assertion before the followup run', () => {
		expect(source).toContain(call)
		expect(source.indexOf(call)).toBeLessThan(source.indexOf('await git_pr_followup.run('))
	})

	it('clears the record on a merged run, beside the round-1 snapshot', () => {
		const tail = readFileSync(package_file(FINISH_SCRIPT), 'utf8')

		expect(tail).toContain('clear_review_target(should_merge)')
	})
})
