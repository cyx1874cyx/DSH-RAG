import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { retrievalConversationDefinition } from '../src/client/index.tsx'

test('Evidence cards follow the command identity even when Harness remints the user message ID', () => {
  const event = { type: 'command/run' as const, seq: SessionSeq(1), time: Date.now(), data: { commandId: CommandId('cmd-1'), name: 'rag', args: 'CLOT OUT', source: { kind: 'user' as const } } }
  assert.deepEqual(retrievalConversationDefinition.match(event), { id: 'cmd-1', role: 'start' })
  assert.equal(retrievalConversationDefinition.match({ ...event, data: { ...event.data, args: '' } }), null)
})
