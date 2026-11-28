#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { createWorkflowScriptArchive } from '../workflow-script.mjs'

const { values: options } = parseArgs({
  options: {
    'source-root': { type: 'string' },
    'original-root': { type: 'string' },
    entry: { type: 'string' },
    output: { type: 'string' },
    include: { type: 'string', multiple: true },
    help: { type: 'boolean' }
  }
})
const usage =
  'dsh-workflow-script-archive --source-root DIR --original-root ORIGINAL_DIR --entry RELATIVE_ENTRY --output NEW_FILE [--include RELATIVE_MODULE ...]'
if (options.help) console.log(usage)
else {
  if (!options['source-root'] || !options.entry || !options.output) throw Error(usage)
  const { bytes, ...receipt } = await createWorkflowScriptArchive({
    sourceRoot: options['source-root'],
    originalRoot: options['original-root'],
    entry: options.entry,
    include: options.include
  })
  await writeFile(options.output, bytes, { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ archive: path.resolve(options.output), ...receipt }, null, 2))
}
