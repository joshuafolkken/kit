import { describe, expect, it } from 'vitest'
import { time_markers } from './time-markers'

const ISSUE_PATH = 'repos/{owner}/{repo}/issues/1269'
const REVIEW_SKILL = 'code-review'

describe('time_markers.tool_marker', () => {
	it('marks an edit as the boundary implementation opens at', () => {
		expect(time_markers.tool_marker('Edit', {})).toBe(time_markers.EDIT_MARKER)
	})

	it('marks writing a new file the same way, because a new file is an edit', () => {
		expect(time_markers.tool_marker('Write', {})).toBe(time_markers.EDIT_MARKER)
	})

	it('marks the code-review skill as the review boundary', () => {
		expect(time_markers.tool_marker('Skill', { skill: REVIEW_SKILL })).toBe(
			time_markers.REVIEW_MARKER,
		)
	})

	it('leaves another skill unmarked, so loading one is not read as a review', () => {
		expect(time_markers.tool_marker('Skill', { skill: 'verify-ui' })).toBe(time_markers.NO_MARKER)
	})

	// The first act of every entry point, and the earliest instant a transcript can be read for "the
	// run starts here". Without it the conversation that preceded the keyword is measured as the run's.
	it('marks the workflow-commands skill as the instant the run opened', () => {
		expect(time_markers.tool_marker('Skill', { skill: 'workflow-commands' })).toBe(
			time_markers.WORKFLOW_MARKER,
		)
	})

	it('leaves a skill call whose input is not a record unmarked', () => {
		expect(time_markers.tool_marker('Skill', REVIEW_SKILL)).toBe(time_markers.NO_MARKER)
	})

	it('leaves a read unmarked', () => {
		expect(time_markers.tool_marker('Read', {})).toBe(time_markers.NO_MARKER)
	})
})

// Since joshuafolkken/kit#1855 the review runs in a forked subagent launched with the `Agent` tool, so
// the marker moved off the main-line `Skill` call and onto that launch (joshuafolkken/kit#1846).
describe('time_markers.tool_marker — the forked review launch', () => {
	it('marks a forked code-review Agent launch as the review boundary', () => {
		const prompt = 'Invoke the /code-review skill using this brief: run pnpm josh review:attest abc'

		expect(time_markers.tool_marker('Agent', { prompt })).toBe(time_markers.REVIEW_MARKER)
	})

	// An investigation subagent about the review tooling quotes the invocation but is handed no brief,
	// so it carries no attestation line — the token that tells a genuine launch from a discussion. This
	// is the exact shape of run #1855's "Map code-review invocation" investigation agent.
	it('leaves an Agent that mentions the review but carries no attest line unmarked', () => {
		const prompt = 'Map where the /code-review invocation is spawned and how review:brief is passed'

		expect(time_markers.tool_marker('Agent', { prompt })).toBe(time_markers.NO_MARKER)
	})

	it('leaves an Agent launch whose input is not a record unmarked', () => {
		expect(time_markers.tool_marker('Agent', 'run the review')).toBe(time_markers.NO_MARKER)
	})
})

describe('time_markers.bash_marker', () => {
	it('marks posting a plan comment as the end of planning', () => {
		const command = `gh api ${ISSUE_PATH}/comments -f body="the plan"`

		expect(time_markers.bash_marker(command)).toBe(time_markers.PLAN_MARKER)
	})

	it('marks filling a blank issue body the same way', () => {
		const command = `gh api -X PATCH ${ISSUE_PATH} -f body="the plan"`

		expect(time_markers.bash_marker(command)).toBe(time_markers.PLAN_MARKER)
	})

	it('marks the gh issue comment spelling of the same post', () => {
		expect(time_markers.bash_marker('gh issue comment 1269 --body "the plan"')).toBe(
			time_markers.PLAN_MARKER,
		)
	})

	it('marks a body passed as a file, which carries no body= at all', () => {
		expect(time_markers.bash_marker('gh issue comment 1269 --body-file plan.md')).toBe(
			time_markers.PLAN_MARKER,
		)
	})
})

describe('time_markers.bash_marker — what is not a plan comment', () => {
	it('leaves the title normalization unmarked, because it writes no body', () => {
		const command = `gh api -X PATCH ${ISSUE_PATH} -f title="A clearer title"`

		expect(time_markers.bash_marker(command)).toBe(time_markers.NO_MARKER)
	})

	it('reads the in-progress label call as the workflow boundary rather than as a plan', () => {
		const command = `gh api ${ISSUE_PATH}/labels -f 'labels[]=in-progress'`

		expect(time_markers.bash_marker(command)).toBe(time_markers.WORKFLOW_MARKER)
	})

	it('leaves a notification unmarked even though it names an issue and a body', () => {
		const url = 'https://github.com/joshuafolkken/kit/issues/1269'
		const command = `pnpm josh notify --task-type confirmation --issue-url "${url}" --body="stopped"`

		expect(time_markers.bash_marker(command)).toBe(time_markers.NO_MARKER)
	})

	it('leaves reading the comments unmarked, because it writes no body', () => {
		expect(time_markers.bash_marker(`gh api ${ISSUE_PATH}/comments --jq '.[].body'`)).toBe(
			time_markers.NO_MARKER,
		)
	})

	it('leaves filing a new issue unmarked, because the plan is written after it', () => {
		const command = 'gh api repos/{owner}/{repo}/issues -f title="A title" -f body="A body"'

		expect(time_markers.bash_marker(command)).toBe(time_markers.NO_MARKER)
	})
})

// The prerequisite branch removes this label to stop `epic:next` classifying a paused issue as
// waiting on time. Matched loosely, that call would move the run's start to somewhere near its end.
describe('time_markers.bash_marker — what is not the workflow boundary', () => {
	it('leaves removing the in-progress label unmarked', () => {
		const command = `gh api -X DELETE ${ISSUE_PATH}/labels/in-progress`

		expect(time_markers.bash_marker(command)).toBe(time_markers.NO_MARKER)
	})

	it('leaves a command that merely quotes the field unmarked', () => {
		const command = String.raw`gh api ${ISSUE_PATH}/comments --jq '.[].body' | grep "labels\[\]=in-progress"`

		expect(time_markers.bash_marker(command)).toBe(time_markers.NO_MARKER)
	})

	it('leaves labelling with something else unmarked', () => {
		const command = `gh api ${ISSUE_PATH}/labels -f 'labels[]=needs-decision'`

		expect(time_markers.bash_marker(command)).toBe(time_markers.NO_MARKER)
	})
})

// The one line of a lane run's transcript that names the issue it is running: the branch cannot,
// because the session writing the transcript never leaves the default one (joshuafolkken/kit#1617).
describe('time_markers.bash_issue', () => {
	it('reads the issue number the in-progress label call names', () => {
		const command = `gh api ${ISSUE_PATH}/labels -f 'labels[]=in-progress'`

		expect(time_markers.bash_issue(command)).toBe(1269)
	})

	it('reads no issue from removing the label, which ends a run rather than opening one', () => {
		const command = `gh api -X DELETE ${ISSUE_PATH}/labels/in-progress`

		expect(time_markers.bash_issue(command)).toBe(time_markers.NO_ISSUE)
	})

	// Under lanes this declaration is the only evidence there is, so taking the leftmost issue path in
	// the command would hand the whole run to the issue it was handing back rather than taking up.
	it('reads the issue being labelled, not one whose label the same call removed first', () => {
		const removal = 'gh api -X DELETE repos/{owner}/{repo}/issues/1600/labels/in-progress'
		const command = `${removal} || true; gh api ${ISSUE_PATH}/labels -f 'labels[]=in-progress'`

		expect(time_markers.bash_issue(command)).toBe(1269)
	})

	// Parking one child and starting another can chain both label calls into one command, and the
	// first of them is an add too — so the removal lookahead alone does not decide this one.
	it('reads the issue labelled in-progress, not one the same call labelled something else', () => {
		const parked = `gh api ${ISSUE_PATH}/labels -f 'labels[]=needs-decision'`
		const started = "gh api repos/{owner}/{repo}/issues/1300/labels -f 'labels[]=in-progress'"

		expect(time_markers.bash_issue(`${parked} && ${started}`)).toBe(1300)
	})

	// Every other call against an issue names one the session is not running — an epic insertion, a
	// plan comment, a completion comment.
	it('reads no issue from a call against the issue that is not the label add', () => {
		const command = `gh api ${ISSUE_PATH}/comments --jq '.[].body'`

		expect(time_markers.bash_issue(command)).toBe(time_markers.NO_ISSUE)
	})
})
