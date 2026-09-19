import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { SCOUT_COMMAND } from './delivered-rules-fixture'
import { issue_scout } from './issue-scout'

// joshuafolkken/kit#2119: the scout gate's two predicates, judged from the command and the tail. The
// delivery — that a scout-less filing is refused and a scouted one is not — is pinned in
// `delivered-rules-filing.test.ts`; here the predicates are pinned on their own.

const A_FILING = 'gh api repos/joshuafolkken/kit/issues -f title="x"'
const A_NON_SCOUT_COMMAND = 'pnpm josh gate'

function a_call(command: string): { name: string; input: { command: string } } {
	return { name: 'Bash', input: { command } }
}

function tail_with(command: string): string {
	return time_transcript_fixture.josh_call_line(1, time_transcript_fixture.BRANCH, command)
}

describe('runs_the_scout', () => {
	it.each([SCOUT_COMMAND, 'pnpm josh issue:scout "x" --body "y"', 'josh isc "x"'])(
		'reads %j as a scout',
		(command) => {
			expect(issue_scout.runs_the_scout(command)).toBe(true)
		},
	)

	it.each([
		A_NON_SCOUT_COMMAND,
		'pnpm josh issue:read 12',
		// A scout named inside a filing's own body is not the scout that filing skipped.
		'gh api repos/o/r/issues -f title="x" -f body="run pnpm josh issue:scout first"',
	])('leaves %j alone', (command) => {
		expect(issue_scout.runs_the_scout(command)).toBe(false)
	})
})

describe('already_scouted', () => {
	it('is satisfied when the tail carries a scout', () => {
		expect(issue_scout.already_scouted(tail_with(SCOUT_COMMAND), a_call(A_FILING))).toBe(true)
	})

	it.each([
		['an empty tail', ''],
		['a tail with no scout', tail_with(A_NON_SCOUT_COMMAND)],
	])('is not satisfied for %s', (_label, tail) => {
		expect(issue_scout.already_scouted(tail, a_call(A_FILING))).toBe(false)
	})
})
