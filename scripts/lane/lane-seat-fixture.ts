import { vi } from 'vitest'
import { lane_reap_settle } from './lane-reap-settle'
import { lane_residents } from './lane-residents'
import { lane_seat_ownership } from './lane-seat-ownership'
import { lane_seat_start } from './lane-seat-start'

function mock_ownership(): void {
	vi.spyOn(lane_seat_ownership, 'snapshot').mockResolvedValue({
		running: new Set(),
		ports: new Set(),
	})
}

function mock_start(): void {
	vi.spyOn(lane_seat_start, 'start').mockImplementation(
		async (seated, action) => await action(seated),
	)
	vi.spyOn(lane_seat_start, 'environment').mockReturnValue({})
}

function mock_stop(): void {
	vi.spyOn(lane_residents, 'end_residents').mockReturnValue([])
	vi.spyOn(lane_reap_settle, 'settle').mockResolvedValue([])
}

const lane_seat_fixture = { mock_ownership, mock_start, mock_stop }

export { lane_seat_fixture }
