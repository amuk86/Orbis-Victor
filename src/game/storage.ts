import { HUMAN_ID, owned } from './engine';
import type { GameState } from './engine';

export type CampaignSummary = {
  id: string; country: string; round: number; territories: number; updatedAt: string; finished: boolean;
};
/** UI-facing persistence boundary. No browser API leaks into the rules. */
export interface CampaignStore {
  list(): CampaignSummary[];
  load(id: string): GameState | null;
  save(state: GameState): void;
  remove(id: string): void;
}
const PREFIX = 'orbis-victor:campaign:v1:';
type Envelope = { updatedAt: string; state: GameState };

export function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false;
  const s = value as GameState;
  if (s.version !== 1 || typeof s.id !== 'string' || !Array.isArray(s.countries) || s.countries.length !== 10 ||
      !Array.isArray(s.players) || s.players.length !== 10 || !Array.isArray(s.order) || s.order.length !== 10 ||
      !Array.isArray(s.events) || !Number.isSafeInteger(s.turnIndex) || s.turnIndex < 0 || s.turnIndex > 9 ||
      !Number.isSafeInteger(s.turn) || s.turn < 1 || !Number.isSafeInteger(s.round) || s.round < 1 ||
      !Number.isSafeInteger(s.reinforcements) || s.reinforcements < 0 || typeof s.attackUsed !== 'boolean' ||
      !['reinforce','action','battle','finished'].includes(s.phase)) return false;
  const ids = new Set(s.players.map(p => p?.id));
  if (ids.size !== 10 || !ids.has(HUMAN_ID) || new Set(s.order).size !== 10 || s.order.some(id => !ids.has(id))) return false;
  if (s.players.some(p => !p || typeof p.name !== 'string' || typeof p.color !== 'string' || typeof p.badge !== 'string' || typeof p.human !== 'boolean')) return false;
  if (new Set(s.countries.map(c => c?.code)).size !== 10 || s.countries.some(c => !c || typeof c.name !== 'string' || !/^[a-z]{2}$/.test(c.code) || !ids.has(c.ownerId) || !Number.isSafeInteger(c.soldiers) || c.soldiers < 1 || !Number.isInteger(c.startingValue) || c.startingValue < 1 || c.startingValue > 9 || !Number.isFinite(c.population))) return false;
  const battleValid = (b: GameState['lastBattle']) => b === null || (typeof b === 'object' && typeof b.source === 'string' && typeof b.target === 'string' && typeof b.attacker === 'string' && typeof b.defender === 'string' && typeof b.commentary === 'string' && Number.isSafeInteger(b.id) && ['both','attacker','defender','tie'].includes(b.outcome) && Array.isArray(b.attackerDice) && Array.isArray(b.defenderDice) && b.attackerDice.length === b.defenderDice.length && [...b.attackerDice,...b.defenderDice].every(n => Number.isInteger(n) && n >= 1 && n <= 6));
  if (!battleValid(s.lastBattle)) return false;
  if (s.events.some((e,i) => !e || e.id !== i+1 || typeof e.text !== 'string' || typeof e.kind !== 'string' || !ids.has(e.actorId) || (e.reason !== undefined && typeof e.reason !== 'string') || (e.battle !== undefined && !battleValid(e.battle)))) return false;
  if (s.phase === 'battle') {
    if (!s.attack || !s.attackUsed) return false;
    const a=s.countries.find(c=>c.code===s.attack!.source), d=s.countries.find(c=>c.code===s.attack!.target);
    if (!a || !d || a.ownerId!==s.order[s.turnIndex] || d.ownerId===a.ownerId || a.soldiers<2) return false;
  } else if (s.attack !== null) return false;
  if ((s.phase === 'reinforce') !== (s.reinforcements > 0)) return false;
  if (s.phase === 'finished') return !!s.winnerId && ids.has(s.winnerId) && s.countries.every(c => c.ownerId === s.winnerId);
  return s.winnerId === null && s.countries.some(c => c.ownerId === s.order[s.turnIndex]);
}

export class BrowserCampaignStore implements CampaignStore {
  list(): CampaignSummary[] {
    const result: CampaignSummary[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        const envelope: Envelope = JSON.parse(localStorage.getItem(key)!);
        if (!isGameState(envelope.state) || typeof envelope.updatedAt !== 'string') continue;
        const s=envelope.state;
        result.push({ id:s.id, country:s.countries[0].name, round:s.round, territories:owned(s,HUMAN_ID).length, updatedAt:envelope.updatedAt, finished:s.phase==='finished'||owned(s,HUMAN_ID).length===0 });
      } catch { /* Ignore an unrelated or damaged save; never break the other campaigns. */ }
    }
    return result.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  }
  load(id: string): GameState | null {
    const raw=localStorage.getItem(PREFIX+id);
    if (!raw) return null;
    const envelope: Envelope=JSON.parse(raw);
    if (!isGameState(envelope.state) || envelope.state.id!==id) throw new Error('Invalid campaign save');
    return envelope.state;
  }
  save(state: GameState): void {
    localStorage.setItem(PREFIX+state.id, JSON.stringify({ updatedAt:new Date().toISOString(), state }));
  }
  remove(id: string): void { localStorage.removeItem(PREFIX+id); }
}
