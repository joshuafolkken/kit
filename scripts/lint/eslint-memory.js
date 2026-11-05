import { resourceUsage } from 'node:process'

const KIB_PER_MIB = 1024
const ESLINT_CLI = /[/\\]eslint[/\\]bin[/\\]eslint\.js$/u

// Run inside ESLint: the launcher's own RSS does not include the linter child.
function report_peak_memory() {
	const peak_mib = resourceUsage().maxRSS / KIB_PER_MIB

	process.stderr.write(`ESLint peak RSS: ${peak_mib.toFixed(1)} MiB\n`)
}

if (ESLINT_CLI.test(process.argv[1] ?? '')) process.once('exit', report_peak_memory)

const eslint_memory = { report_peak_memory }

export { eslint_memory }
