import { vi } from 'vitest'
import type { lane_registry as LaneRegistryModule } from './lane-registry'

vi.mock('./lane-registry', async (import_original) => {
	type LaneRegistry = typeof LaneRegistryModule
	const { lane_registry: actual } = await import_original<{ lane_registry: LaneRegistry }>()

	return {
		lane_registry: {
			find_lane: actual.find_lane,
			list_lanes: vi.fn(),
			main_repository_root: vi.fn(),
			unreadable_lanes: actual.unreadable_lanes,
			used_seats: actual.used_seats,
			write_environment: actual.write_environment,
			OWNER_ONLY_MODE: actual.OWNER_ONLY_MODE,
		},
	}
})

const { lane_registry } = await import('./lane-registry')

export { lane_registry }
