import { beforeEach, expect, it, vi } from 'vitest'
import { lane_listening_ports } from './lane-listening-ports'

const probe = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execa: probe }))

const NO_MATCH = 1
const PORT = 5174

beforeEach(() => {
	probe.mockReset()
})

it('reads a clean lsof no-match exit as an empty port set', async () => {
	probe.mockResolvedValue({ exitCode: NO_MATCH, stdout: '', stderr: '' })
	await expect(lane_listening_ports.read_ports('darwin')).resolves.toEqual(new Set())
})

it('treats an incomplete lsof listing as unknown even when its exit also means no matches', async () => {
	probe.mockResolvedValue({ exitCode: NO_MATCH, stdout: '', stderr: 'permission denied' })
	await expect(lane_listening_ports.read_ports('darwin')).resolves.toBeUndefined()
})

it('reads lsof listener ports without depending on a process working directory', async () => {
	probe.mockResolvedValue({ exitCode: 0, stdout: `p123\nn127.0.0.1:${String(PORT)}\n`, stderr: '' })
	await expect(lane_listening_ports.read_ports('darwin')).resolves.toEqual(new Set([PORT]))
})
