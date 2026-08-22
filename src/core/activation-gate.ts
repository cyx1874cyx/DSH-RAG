export interface ActivationClaim {
  readonly knowledgeBaseIds: readonly string[]
  readonly turn: unknown
}

interface PendingActivation {
  readonly messageId: string
  readonly knowledgeBaseIds: readonly string[]
}

/**
 * Mints an activation for one exact command-created user message and lets one
 * search consume it. Agent identity, message identity, and turn admission all
 * have to match; a durable boolean is intentionally not used.
 */
export class SingleTurnActivationGate<Agent extends object> {
  private readonly pending = new WeakMap<Agent, PendingActivation>()
  private readonly active = new WeakMap<Agent, ActivationClaim>()

  issue(agent: Agent, messageId: string, knowledgeBaseIds: readonly string[]): void {
    if (messageId.length === 0) throw new Error('activation message id must not be empty')
    if (knowledgeBaseIds.length === 0) throw new Error('activation needs at least one knowledge base')
    this.pending.set(agent, {
      messageId,
      knowledgeBaseIds: [...new Set(knowledgeBaseIds)],
    })
    this.active.delete(agent)
  }

  enter(agent: Agent, messageIds: readonly string[], turn: unknown): boolean {
    const pending = this.pending.get(agent)
    this.pending.delete(agent)
    this.active.delete(agent)
    if (pending === undefined || !messageIds.includes(pending.messageId)) return false
    this.active.set(agent, {
      knowledgeBaseIds: pending.knowledgeBaseIds,
      turn,
    })
    return true
  }

  consume(agent: Agent): ActivationClaim | undefined {
    const claim = this.active.get(agent)
    this.active.delete(agent)
    return claim
  }

  clear(agent: Agent): void {
    this.pending.delete(agent)
    this.active.delete(agent)
  }
}
