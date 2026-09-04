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
