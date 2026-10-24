import { durable_state } from '#scripts/josh/durable-state'
import type { LaneInfo } from './lane-registry'

const LOG_PREFIX = durable_state.PREFIX.LANE_DISPATCH
const LOG_SUFFIX = '.log'

function default_log_path(lane: LaneInfo): string {
	return durable_state.path(`${LOG_PREFIX}${lane.issue}-`, lane.directory, LOG_SUFFIX)
}

const lane_dispatch_log = { default_log_path }

export { lane_dispatch_log }
