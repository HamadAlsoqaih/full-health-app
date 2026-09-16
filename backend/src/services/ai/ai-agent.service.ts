/**
 * STUB — the future conversational AI guide.
 *
 * Deliberately unimplemented in this pass, matching the ai-guide/ stub on the
 * frontend. Left as a named file so the shape of the eventual seam is visible
 * without pretending any of it exists.
 */

export interface AgentTurn {
  role: 'user' | 'assistant';
  content: string;
}

export function createAiAgentService(): never {
  throw new Error('The AI guide is not implemented. See docs/REMAINING-WORK.md.');
}
