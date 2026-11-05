import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const KIB_PER_MIB = 1024
const ESLINT_CLI = /[/\\]eslint[/\\]bin[/\\]eslint\.js$/u
const OBSERVED = 'JOSH_ESLINT_MEMORY_CHILD'
const BYTES_PER_MIB = KIB_PER_MIB * KIB_PER_MIB

function peak_mib(report, platform) {
	const line = report.split('\n').find((entry) => entry.includes('maximum resident set size')) ?? ''
	if (platform === 'darwin') return Number(line.trim().split(/\s+/u, 1)[0]) / BYTES_PER_MIB

	return Number(/^JOSH_ESLINT_RSS=(?<rss>\d+)$/mu.exec(report)?.groups?.rss) / KIB_PER_MIB
}

// time owns wait4's peak RSS even when V8 aborts before Node can run exit handlers.
function observe() {
	const directory = mkdtempSync(path.join(tmpdir(), 'eslint-memory-'))
	const report_file = path.join(directory, 'usage')
	const flags = process.platform === 'darwin' ? ['-l'] : ['-f', 'JOSH_ESLINT_RSS=%M']
	const command = [process.execPath, ...process.execArgv, ...process.argv.slice(1)]

	try {
		const result = spawnSync('/usr/bin/time', [...flags, '-o', report_file, ...command], {
			stdio: 'inherit',
			env: { ...process.env, [OBSERVED]: '1' },
		})

		const peak = peak_mib(readFileSync(report_file, 'utf8'), process.platform)

		process.stderr.write(`ESLint peak RSS: ${peak.toFixed(1)} MiB\n`)

		return result.status ?? 1
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}

if (ESLINT_CLI.test(process.argv[1] ?? '') && process.env[OBSERVED] !== '1') process.exit(observe())

const eslint_memory = { peak_mib }

export { eslint_memory }
