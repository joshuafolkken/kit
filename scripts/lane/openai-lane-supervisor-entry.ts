#!/usr/bin/env tsx
import { openai_lane_supervisor_cli } from './openai-lane-supervisor-cli'

const ARGV_OFFSET = 2

process.exitCode = await openai_lane_supervisor_cli.run(process.argv.slice(ARGV_OFFSET))
