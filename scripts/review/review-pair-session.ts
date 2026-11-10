import { agent_argv } from '#scripts/agent/agent-argv'
import { parse_json } from '#scripts/git/parse-json-array'
import { stamp_file } from '#scripts/josh/stamp-file'
import { error_text } from '#scripts/lib/error-message'
import { detached_launch } from '#scripts/run/detached-launch'
import { z } from 'zod'
import { review_pair } from './review-pair'

// The paired reviewer beside a round 1 the ship runs (joshuafolkken/kit#7020): the ship pairs its code
// brief with `review_pair.offer`, and whoever starts the code reviewer — the ship itself or the lane's
// broker — starts this one beside it. **It never gates**: a failed start or run is only noted, and
// `josh review:pair` compares the two headless sessions by the ids their stream-json logs open with.

type LaunchEnvironment = Readonly<Record<string, string | undefined>>

const PAIR_COMMAND = 'review:pair'
const OBJECT_OPENING = '{'
const record_schema = z.looseObject({})
const init_schema = z.object({
	type: z.literal('system'),
	subtype: z.literal('init'),
	session_id: z.string().min(1),
})

function note(text: string): void {
	process.stderr.write(`paired reviewer: ${text}\n`)
}

function session_in(line: string): string | undefined {
	if (!line.startsWith(OBJECT_OPENING)) return undefined
	const record = parse_json.parse_json_object_or_undefined(line, record_schema)

	return init_schema.safeParse(record).data?.session_id
}

// A log is appended to across launches, so its last session is the latest one.
function session_of(log_path: string): string | undefined {
	const lines = stamp_file.read_stamp_text(log_path)?.split('\n') ?? []

	return lines.map((line) => session_in(line.trim())).findLast((id) => id !== undefined)
}

async function run(directory: string, environment: LaunchEnvironment): Promise<void> {
	const { brief, log } = review_pair.paths(directory)
	const opening = review_pair.opening(brief)
	const built = agent_argv.with_profile_in(opening, review_pair.PAIRED_PROFILE, directory)

	if (built.kind === 'rejected') {
		note(`not started — ${built.note}`)

		return
	}

	stamp_file.remove_stamp(log)
	const request = {
		argv: built.argv,
		cwd: directory,
		log_path: log,
		profile: built.profile,
		env: environment,
	}
	const result = await detached_launch.launch_attached(request, note)

	if (result.kind === 'failed') note(`not started — ${result.note}`)
}

// Started only while the round is paired, and settled even when it throws, so the code reviewer's
// round never waits on or fails with it.
async function launch(directory: string, environment: LaunchEnvironment): Promise<void> {
	if (!review_pair.is_offered(directory)) return

	try {
		await run(directory, environment)
	} catch (error) {
		note(`failed — ${error_text.message_of(error)}`)
	}
}

// The `josh review:pair` argv for a paired round that ran, or `undefined` when it was unpaired or a
// session left no id to compare.
function pair_argv(
	issue: string,
	code_log: string,
	directory: string,
): ReadonlyArray<string> | undefined {
	if (!review_pair.is_offered(directory)) return undefined
	const opus = session_of(code_log)
	const sonnet = session_of(review_pair.paths(directory).log)

	if (opus === undefined || sonnet === undefined) return undefined

	return [PAIR_COMMAND, '--issue', issue, '--opus-agent', opus, '--sonnet-agent', sonnet]
}

const review_pair_session = { launch, pair_argv, session_of }

export type { LaunchEnvironment }
export { review_pair_session }
