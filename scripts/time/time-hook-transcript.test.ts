import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { time_hook_transcript } from './time-hook-transcript'

const { fork_path, transcript_of } = time_hook_transcript

const PROJECT_DIRECTORY = path.join('/home', '.claude', 'projects', '-home-someone-kit')
const SESSION_ID = 'df8c44ca-f66c-431a-b196-1d71d44a9321'
const AGENT_ID = 'a313eea340918b8a1'
const SESSION_PATH = path.join(PROJECT_DIRECTORY, `${SESSION_ID}.jsonl`)
// The layout is spelled out once, here, so a rename on Claude Code's side has one place to fail rather
// than a suite that agrees with itself.
const FORK_PATH = path.join(PROJECT_DIRECTORY, SESSION_ID, 'subagents', `agent-${AGENT_ID}.jsonl`)

// Nothing here touches the filesystem: whether the fork has written anything yet is deliberately not
// part of the answer, so there is no file for a case to create.
describe('time_hook_transcript.fork_path', () => {
	it("names the fork under the session's own subagents directory", () => {
		expect(fork_path(SESSION_PATH, AGENT_ID)).toBe(FORK_PATH)
	})
})

describe('time_hook_transcript.transcript_of', () => {
	// The whole point of the module (joshuafolkken/kit#1424): inside a fork the payload names the
	// parent, and the fork's own file is one level down.
	it("answers the fork's own transcript when the payload names an agent", () => {
		expect(transcript_of(SESSION_PATH, AGENT_ID)).toBe(FORK_PATH)
	})

	// **Answered before the fork has written a line, and that is the point.** "No history" is the honest
	// verdict for a fork's first call, and both callers reach it by finding nothing to read. Falling back
	// to the parent would judge the fork on a timeline it never ran and spend the parent's own budget.
	it('answers the fork path whether or not that file exists yet', () => {
		expect(transcript_of(SESSION_PATH, AGENT_ID)).not.toBe(SESSION_PATH)
	})

	// The main line: no agent, so the path the payload carried is the run's own. The `null` spelling of
	// the same thing is covered where it actually arrives — as JSON text, in the two hook suites, since
	// what has to tolerate it is each hook's schema.
	it('answers the payload path when no agent is named', () => {
		expect(transcript_of(SESSION_PATH, undefined)).toBe(SESSION_PATH)
	})

	// A hook payload is input, not something this package produced, so an id that would resolve outside
	// the session's directory is refused rather than joined into a path.
	it.each([
		['a path separator', `..${path.sep}${AGENT_ID}`],
		['a parent segment', '..'],
		['nothing at all', ''],
		['a dot in place of an id', '.'],
	])('refuses an agent id that is %s', (_description, agent_id) => {
		expect(transcript_of(SESSION_PATH, agent_id)).toBe(SESSION_PATH)
	})

	// Nothing can be derived from a path that is not a transcript, and guessing would name a file in
	// some other layout entirely.
	it('answers the payload path when it does not end in the transcript extension', () => {
		const other = path.join(PROJECT_DIRECTORY, SESSION_ID)

		expect(transcript_of(other, AGENT_ID)).toBe(other)
	})
})
