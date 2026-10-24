import { fileURLToPath } from 'node:url'
import { json_value } from '#scripts/lib/json-value'
import { execa } from 'execa'
import { z } from 'zod'
import { lane_registry } from './lane-registry'
import { lane_session_action, type BrokerAnswer } from './lane-session-action'

// **A request the supervisor's loaded code refuses is read again by the code on disk**
// (joshuafolkken/kit#4732): the `run:wake` supervisor reloads only at a pass boundary, so a schema main
// widened after it started refused the request a stopped ship sent, and the lane it should have
// relaunched was parked instead. A fresh process of this file's sibling entry reads the request with
// the schema main has now and performs the action; it prints the answer only when it read the request,
// so a disk as old as the supervisor leaves the refusal to the broker.

const ENTRY = fileURLToPath(new URL('lane-session-reread-main.ts', import.meta.url))
const answer_schema = z.discriminatedUnion('is_success', [
	z.object({ is_success: z.literal(true) }).strict(),
	z.object({ is_success: z.literal(false), reason: z.string() }).strict(),
])

// The fresh process's side: the answer to a request read with the schema on disk, or `undefined` where
// the request is unreadable or no open lane carries the issue.
async function answer_text(issue: string, text: string): Promise<BrokerAnswer | undefined> {
	const request = json_value.parse_with(text, lane_session_action.request_schema)
	if (request === undefined) return undefined

	const lane = await lane_registry.find_open_lane(issue)
	if (lane === undefined) return undefined

	return await lane_session_action.answer(lane, request.action)
}

function last_line(text: string): string {
	return text.trimEnd().split('\n').at(-1) ?? ''
}

// The supervisor's side: the fresh process's answer, or `undefined` where it read nothing.
async function reread(issue: string, received: unknown): Promise<BrokerAnswer | undefined> {
	const result = await execa(
		process.execPath,
		[...process.execArgv, ENTRY, issue, JSON.stringify(received)],
		{ reject: false, stderr: 'inherit' },
	)
	if (result.exitCode !== 0) return undefined

	return json_value.parse_with(last_line(result.stdout), answer_schema)
}

const lane_session_reread = { answer_text, reread }

export { lane_session_reread }
