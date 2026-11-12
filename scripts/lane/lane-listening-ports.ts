import { readFile } from 'node:fs/promises'
import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execa } from 'execa'

type ReadText = (file: string) => Promise<string>
const PORT_FIELD = /^n.*:(?<port>\d+)$/gmu
const NO_MATCH = 1
const HEX_RADIX = 16
const LISTEN_STATE = '0A'
const TCP_TABLE = '/proc/net/tcp'
const TCP6_TABLE = '/proc/net/tcp6'
const TABLE_FIELDS = 4
const ADDRESS_FIELDS = 2

async function read_text(file: string): Promise<string> {
	return await readFile(file, 'utf8')
}

function linux_port(line: string): Array<number> {
	const [, local, , state] = line.trim().split(/\s+/u, TABLE_FIELDS)
	if (state !== LISTEN_STATE || local === undefined) return []
	const port = Number.parseInt(local.split(':', ADDRESS_FIELDS)[1] ?? '', HEX_RADIX)

	return Number.isSafeInteger(port) ? [port] : []
}

async function ipv6_text(read: ReadText): Promise<string> {
	try {
		return await read(TCP6_TABLE)
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
		throw error
	}
}

async function linux_ports(read: ReadText): Promise<ReadonlySet<number>> {
	const tables = await Promise.all([read(TCP_TABLE), ipv6_text(read)])

	return new Set(tables.flatMap((table) => table.split('\n').flatMap((line) => linux_port(line))))
}

async function darwin_ports(): Promise<ReadonlySet<number> | undefined> {
	const result = await execa('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fn'], {
		reject: false,
		timeout: PROBE_TIMEOUT_MS,
	})
	if (result.exitCode !== 0 && result.exitCode !== NO_MATCH) return undefined
	if (result.stderr.trim() !== '') return undefined

	return new Set(
		[...result.stdout.matchAll(PORT_FIELD)].map((match) => Number(match.groups?.['port'])),
	)
}

async function read_for(
	platform: NodeJS.Platform,
	read: ReadText,
): Promise<ReadonlySet<number> | undefined> {
	if (platform === 'linux') return await linux_ports(read)

	return platform === 'darwin' ? await darwin_ports() : undefined
}

async function read_ports(
	platform: NodeJS.Platform = process.platform,
	read: ReadText = read_text,
): Promise<ReadonlySet<number> | undefined> {
	try {
		return await read_for(platform, read)
	} catch {
		return undefined
	}
}

const lane_listening_ports = { read_ports }

export { lane_listening_ports }
