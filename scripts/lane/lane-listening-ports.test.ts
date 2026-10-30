import { expect, it } from 'vitest'
import { lane_listening_ports } from './lane-listening-ports'

const PORT = 5174
const ROW = '0: 0100007F:1436 00000000:0000 0A 00000000:00000000'

async function table_text(): Promise<string> {
	return `${ROW}\n0: 00000000:1437 00000000:0000 01`
}

async function ipv4_only(file: string): Promise<string> {
	if (file.endsWith('tcp6')) throw Object.assign(new Error('IPv6 disabled'), { code: 'ENOENT' })

	return ROW
}

it('reads Linux TCP and IPv6 listeners without requiring lsof', async () => {
	await expect(lane_listening_ports.read_ports('linux', table_text)).resolves.toEqual(
		new Set([PORT]),
	)
})

it('distinguishes an empty Linux table from a failed read', async () => {
	await expect(lane_listening_ports.read_ports('linux', async () => '')).resolves.toEqual(new Set())
	await expect(
		lane_listening_ports.read_ports('linux', async () => {
			throw new Error('permission denied')
		}),
	).resolves.toBeUndefined()
})

it('accepts a Linux kernel without an IPv6 table while preserving IPv4 listeners', async () => {
	await expect(lane_listening_ports.read_ports('linux', ipv4_only)).resolves.toEqual(
		new Set([PORT]),
	)
})
