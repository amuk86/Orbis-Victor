import { currentPlayer, owned } from './engine';
import type { Action, GameState } from './engine';

/** One decision per call: the UI schedules each action and renders every result. */
export function nextNpcAction(s: GameState): Action | null {
  if (s.phase === 'finished') return null;
  const p = currentPlayer(s);
  if (p.human) return null;
  const mine = owned(s, p.id).sort((a, b) => b.soldiers - a.soldiers);
  const base = mine[0];
  const actorId = p.id;
  if (s.phase === 'reinforce') return { type: 'reinforce', actorId, country: base.code, amount: s.reinforcements, reason: `${base.name} is my strongest base. Concentrating ${s.reinforcements} reinforcements creates the best attack.` };
  if (s.phase === 'battle' && s.attack) {
    const a = s.countries.find(c => c.code === s.attack!.source)!;
    const d = s.countries.find(c => c.code === s.attack!.target)!;
    if (s.lastBattle && (a.soldiers <= 2 || a.soldiers < d.soldiers)) return { type: 'stop', actorId, reason: `${a.name} has ${a.soldiers} against ${d.soldiers}. Preserve the remaining force.` };
    return { type: 'roll', actorId, reason: `${a.soldiers - 1} available attackers against ${d.soldiers} defenders. The odds still support the assault.` };
  }
  if (s.attackUsed) return { type: 'end', actorId, reason: 'My one attack is complete. Hold the gains until the next turn.' };
  const donor = mine.find(c => c.code !== base.code && c.soldiers > 1);
  if (donor) return { type: 'transfer', actorId, source: donor.code, target: base.code, amount: donor.soldiers - 1, reason: `Consolidate spare troops in ${base.name}; leave one guarding ${donor.name}.` };
  const targets = s.countries.filter(c => c.ownerId !== p.id).map(c => {
    const count = owned(s, c.ownerId).length;
    const score = base.soldiers - 1 - c.soldiers + (count === 1 ? 3 : 0) - (count >= 4 ? 2 : 0);
    return { c, count, score };
  }).sort((a, b) => b.score - a.score);
  const best = targets[0];
  if (base.soldiers < 3 || !best || best.score < 0) return { type: 'end', actorId, reason: base.soldiers < 3 ? `${base.name} has fewer than three soldiers. Build strength before attacking.` : `Best target score is ${best.score}; no favourable attack is available.` };
  return { type: 'attack', actorId, source: base.code, target: best.c.code, reason: `Target score ${best.score}: ${base.soldiers - 1} available − ${best.c.soldiers} defenders${best.count === 1 ? ' +3 for eliminating a commander' : ''}${best.count >= 4 ? ' −2 against a large commander' : ''}.` };
}
