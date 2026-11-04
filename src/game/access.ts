import { currentPlayer, HUMAN_ID } from './engine';
import type { GameState } from './engine';

/** Local capability boundary; replace its provider with verified identity for online play.
 * Browser-local ownership is a convenience, not server-enforced authentication. */
export type PlayAccess = { role: 'owner' | 'spectator'; playerId: string | null };
export const LOCAL_OWNER: PlayAccess = { role: 'owner', playerId: HUMAN_ID };
export function canPlay(state: GameState, access: PlayAccess): boolean {
  return access.role === 'owner' && access.playerId === HUMAN_ID &&
    currentPlayer(state).id === access.playerId && state.phase !== 'finished';
}
