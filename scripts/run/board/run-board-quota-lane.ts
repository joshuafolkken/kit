import { lane_paths } from '#scripts/lane/lane-paths'
import { process_directories } from '#scripts/lane/process-directories'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

const CODEX_META = z.looseObject({
	type: z.literal('session_meta'),
	payload: z.looseObject({ cwd: z.string() }),
})

function codex_lane(
	head: string,
	root: string = process.env[lane_paths.LANE_ROOT_KEY] ?? '',
): string | undefined {
	const meta = head.split('\n').map((line) => json_value.parse_with(line, CODEX_META))
	const cwd = meta.find((event) => event !== undefined)?.payload.cwd

	return cwd === undefined ? undefined : process_directories.lane_of(cwd, root)
}

const run_board_quota_lane = { codex_lane }

export { run_board_quota_lane }
