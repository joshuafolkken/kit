import { describe, expect, it } from 'vitest'
import { egress_guard } from './egress-guard'

describe('shell permissions — stops interpreter options at the script', () => {
	it.each([
		'node scripts/check.ts',
		'node scripts/check.ts -e fixture',
		'node -- scripts/check.ts --eval fixture',
		'node -r "-e" scripts/check.ts -e fixture',
		'node --require fixture scripts/check.ts -p fixture',
		'node --require=fixture scripts/check.ts -e fixture',
		'node -rfixture scripts/check.ts -e fixture',
		'python3 scripts/check.py',
		'python3 scripts/check.py -c config.json',
		'python3 -W "-c" scripts/check.py -c config.json',
		'python3 -Wonce scripts/check.py -c config.json',
		'python3 -- scripts/check.py -c config.json',
		'bash scripts/check.sh -c fixture',
		'bash -- scripts/check.sh -c fixture',
		'bash -o errexit scripts/check.sh -c fixture',
		'bash scripts/check.sh -c "gh gist create output.txt"',
		'bash scripts/check.sh -c "true; gh gist create output.txt"',
		'bash -- scripts/check.sh -c "gh gist create output.txt"',
		'bash -o errexit scripts/check.sh -c "gh gist create output.txt"',
		'bash --rcfile "-c" scripts/check.sh "gh gist create output.txt"',
		'perl -I lib scripts/check.pl -e fixture',
		'perl -Iexample scripts/check.pl -e fixture',
		'ruby -r json scripts/check.rb -e fixture',
		'ruby -rrexml scripts/check.rb -e fixture',
		'bun --preload fixture scripts/check.ts -e fixture',
		'deno run scripts/check.ts --eval fixture',
		'deno --config config.json run scripts/check.ts --eval fixture',
	])('allows %j', (command) => {
		expect(egress_guard.ROW.is_trigger({ name: 'Bash', input: { command } })).toBe(false)
	})
})
