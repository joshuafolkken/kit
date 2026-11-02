import { josh_command } from '#scripts/josh/josh-run'
import { lane_registry } from '#scripts/lane/lane-registry'
import { error_text } from '#scripts/lib/error-message'

const FAILURE_PREFIX = 'observations:flush skipped: '
const FLUSH_COMMAND = 'observations:flush'

async function flush(): Promise<void> {
	try {
		const root = await lane_registry.main_repository_root()

		josh_command.require_success(await josh_command.josh_run_at(['main:sync'], root), 'main:sync')
		josh_command.require_success(
			await josh_command.josh_run_at([FLUSH_COMMAND], root),
			FLUSH_COMMAND,
		)
	} catch (error) {
		console.error(`${FAILURE_PREFIX}${error_text.message_of(error).replaceAll(/\s+/gu, ' ')}`)
	}
}

export const backlog_drain_flush = { flush }
