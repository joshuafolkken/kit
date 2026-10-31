import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { lane_registry } from '#scripts/lane/lane-registry'
import { error_text } from '#scripts/lib/error-message'

const SUCCESS_EXIT_CODE = 0
const FAILURE_PREFIX = 'observations:flush skipped: '
const FLUSH_COMMAND = 'observations:flush'

function require_success(result: JoshResult, command: string): void {
	if (result.code === SUCCESS_EXIT_CODE) return

	const reason = [result.err, result.out].find((text) => text?.trim())

	throw new Error(reason ?? `${command} exited ${String(result.code)}`)
}

async function flush(): Promise<void> {
	try {
		const root = await lane_registry.main_repository_root()

		require_success(await josh_command.josh_run_at(['main:sync'], root), 'main:sync')
		require_success(await josh_command.josh_run_at([FLUSH_COMMAND], root), FLUSH_COMMAND)
	} catch (error) {
		console.error(`${FAILURE_PREFIX}${error_text.message_of(error).replaceAll(/\s+/gu, ' ')}`)
	}
}

export const backlog_drain_flush = { flush }
