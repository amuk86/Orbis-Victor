import { battleCommentary } from './engine';
import type { Battle } from './engine';

// Async boundary for a future commentary service. Local play uses no network.
export async function getCommentary(context: Battle): Promise<string> {
  return battleCommentary(context, context.id);
}
