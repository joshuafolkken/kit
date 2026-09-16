import { stamp_file } from '#scripts/josh/stamp-file'
import type { LaneInfo } from './lane-registry'

const LOG_PREFIX = 'josh-lane-dispatch-'
const LOG_SUFFIX = '.log'

function default_log_path(lane: LaneInfo): string {
	return stamp_file.stamp_path(`${LOG_PREFIX}${lane.issue}-`, lane.directory, LOG_SUFFIX)
}

const lane_dispatch_log = { default_log_path }

export { lane_dispatch_log }
