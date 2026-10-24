#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { lane_session_reread } from './lane-session-reread'

// The fresh process a lane broker starts for a request its own code refused (`lane-session-reread.ts`):
// `<issue> <request JSON>` in, the answer's JSON out, exit 1 where it read nothing.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2
	const [issue = '', text = ''] = process.argv.slice(ARGV_OFFSET)
	const answer = await lane_session_reread.answer_text(issue, text)

	if (answer === undefined) process.exitCode = 1
	else process.stdout.write(`${JSON.stringify(answer)}\n`)
}
