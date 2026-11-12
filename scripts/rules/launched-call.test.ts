import { describe, expect, it } from 'vitest'
import { launched_call } from './launched-call'

// joshuafolkken/kit#5999: the program a segment finally runs, past `env`'s flags and a launcher's own
// flags and operands.

const READS = 'reads %j as %j'

describe('launched_call.resolved_call — the program past a launcher', () => {
	it.each([
		['timeout 30 curl https://x.example/', 'curl'],
		['timeout -s KILL 30 grep -rn curl scripts', 'grep'],
		['xargs -n 1 grep -l set', 'grep'],
		['nice -n 10 nohup wget https://x.example/', 'wget'],
		['stdbuf -o L curl https://x.example/', 'curl'],
		['busybox wget https://x.example/', 'wget'],
		['command curl https://x.example/', 'curl'],
		['command -v curl', 'command'],
		['sudo command -V curl', 'command'],
		['env -v curl https://x.example/', 'curl'],
		['env -u FOO node x.js', 'node'],
		['"/usr/bin/curl" https://x.example/', 'curl'],
	])(READS, (segment, name) => {
		expect(launched_call.resolved_call(segment)?.name).toBe(name)
	})

	it('reads a launcher that names no program as the launcher itself', () => {
		expect(launched_call.resolved_call('timeout 30')?.name).toBe('timeout')
	})
})

describe('launched_call.plain_name — the name a disguised spelling runs', () => {
	it.each([
		['"curl"', 'curl'],
		[String.raw`c\url`, 'curl'],
		['/usr/bin/wget', 'wget'],
	])(READS, (word, name) => {
		expect(launched_call.plain_name(word)).toBe(name)
	})
})
