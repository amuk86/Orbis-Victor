/** Pure, serializable rules. Randomness is supplied by the caller, never read globally. */
export type RNG = () => number;
export type Country = { name: string; code: string; population: number };
export type Territory = Country & { ownerId: string; soldiers: number; startingValue: number; takenOnTurn?: number };
export type Player = { id: string; name: string; color: string; badge: string; human: boolean };
export type Battle = {
  id: number; source: string; target: string; attacker: string; defender: string;
  attackerDice: number[]; defenderDice: number[]; attackerLosses: number; defenderLosses: number;
  outcome: 'both' | 'attacker' | 'defender' | 'tie'; commentary: string;
  conquered: boolean; eliminated: boolean;
};
export type GameEvent = {
  id: number; turn: number; round: number; actorId: string; kind: string;
  text: string; reason?: string; battle?: Battle;
};
export type GameState = {
  version: 1; id: string; countries: Territory[]; players: Player[]; order: string[];
  turnIndex: number; turn: number; round: number; phase: 'reinforce' | 'action' | 'battle' | 'finished';
  reinforcements: number; attackUsed: boolean; attack: { source: string; target: string } | null;
  lastBattle: Battle | null; winnerId: string | null; events: GameEvent[];
};
export type Command =
  | { type: 'reinforce'; country: string; amount?: number }
  | { type: 'transfer'; source: string; target: string; amount?: number }
  | { type: 'attack'; source: string; target: string }
  | { type: 'roll' } | { type: 'stop' } | { type: 'end' };
export type Action = Command & { actorId: string; reason?: string };
export type Transition = { state: GameState; events: GameEvent[]; error?: string };
export const OWNER_COLORS = ['#e0b030', '#c0392b', '#4a90c0', '#d0702a', '#b070c0', '#40b0a0', '#c8c8c8', '#e06090', '#a08060', '#7fb04a'];
export const HUMAN_ID = 'human';
const LIMITS = [5, 10, 25, 50, 75, 100, 125, 150];
export function startingSoldiers(population: number): number {
  if (!Number.isFinite(population) || population < 0) throw new Error('Invalid population');
  const bracket = LIMITS.findIndex(limit => population <= limit);
  return bracket < 0 ? 9 : bracket + 1;
}
/** Ambiguous case-study reward: use ORIGINAL population value, as the NEW garrison.
 * This does not deduct from the source; extra troops can be transferred afterward. */
export const conquestGarrison = (startingValue: number) => Math.max(2, Math.floor(startingValue / 2));
export const diceCount = (attacker: number, defender: number) => Math.max(0, Math.min(attacker - 1, defender));
export const currentPlayer = (s: GameState) => s.players.find(p => p.id === s.order[s.turnIndex])!;
export const owned = (s: GameState, id: string) => s.countries.filter(c => c.ownerId === id);
const randomIndex = (rng: RNG, size: number) => Math.min(size - 1, Math.max(0, Math.floor(rng() * size)));
export function shuffle<T>(items: T[], rng: RNG): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomIndex(rng, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function battleCommentary(b: Pick<Battle, 'source' | 'target' | 'outcome'>, variant = 0): string {
  const lines = {
    both: [`${b.source} breaks the line at ${b.target}, but pays in soldiers.`, `Both armies yield ground. Neither yields the field.`, `A costly exchange leaves both ranks thinner.`],
    attacker: [`${b.source} pushes forward; ${b.target}'s line buckles.`, `The assault finds its mark. The defenders fall back.`, `The attackers seize the initiative.`],
    defender: [`${b.target} holds firm. The assault loses momentum.`, `The defenders make every advance costly.`, `${b.source}'s charge meets a resolute defence.`],
    tie: [`The lines hold. No soldiers fall.`, `An even exchange; both armies stand their ground.`, `Neither side gains an opening.`],
  };
  return lines[b.outcome][Math.abs(variant) % 3];
}
export function createGame(pool: Country[], chosenCode: string, rng: RNG, id: string): GameState {
  const chosen = pool.find(c => c.code === chosenCode);
  if (!chosen || new Set(pool.map(c => c.code)).size !== pool.length || pool.length < 10) throw new Error('Choose from at least ten unique countries.');
  const selected = [chosen, ...shuffle(pool.filter(c => c.code !== chosenCode), rng).slice(0, 9)];
  return initialiseGame(selected, rng, id);
}

/** Shared canonical initializer, also used to replay explicit legacy imports. */
export function initialiseGame(selected: Country[], rng: RNG, id: string): GameState {
  if (selected.length !== 10 || new Set(selected.map(c => c.code)).size !== 10) throw new Error('Ten distinct countries required.');
  const badges = new Set(['Y']);
  const players = selected.map((c, i) => {
    const letters = c.name.normalize('NFD').toUpperCase().replace(/[^A-Z]/g, '') + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const badge = i === 0 ? 'Y' : [...letters].find(letter => !badges.has(letter))!;
    badges.add(badge);
    return { id: i === 0 ? HUMAN_ID : `npc-${i}`, name: i === 0 ? 'You' : c.name, color: OWNER_COLORS[i], badge, human: i === 0 };
  });
  const order = shuffle(players.map(p => p.id), rng);
  const s: GameState = {
    version: 1, id, players, order, turnIndex: 0, turn: 1, round: 1, phase: 'action', reinforcements: 0,
    attackUsed: false, attack: null, lastBattle: null, winnerId: null, events: [],
    countries: selected.map((c, i) => ({ ...c, ownerId: players[i].id, startingValue: startingSoldiers(c.population), soldiers: startingSoldiers(c.population) })),
  };
  s.events.push({ id: 1, turn: 1, round: 1, actorId: currentPlayer(s).id, kind: 'start', text: `${currentPlayer(s).name} takes the first turn.`, reason: 'First commander and fixed turn order drawn randomly. No reinforcements in round 1.' });
  return s;
}
export function transition(state: GameState, action: Action, rng: RNG, eventOffset = 0): Transition {
  const reject = (error: string): Transition => ({ state, events: [], error });
  if (state.phase === 'finished') return reject('The campaign is over.');
  if (currentPlayer(state).id !== action.actorId) return reject('Only the current commander can act.');
  const source = 'source' in action ? state.countries.find(c => c.code === action.source) : undefined;
  const target = 'target' in action ? state.countries.find(c => c.code === action.target) : undefined;
  const amount = 'amount' in action ? action.amount ?? 1 : 1;
  if (!Number.isSafeInteger(amount) || amount < 1) return reject('Choose a positive whole number of soldiers.');
  const s: GameState = { ...state, countries: state.countries.map(c => ({ ...c })), events: [...state.events], attack: state.attack ? { ...state.attack } : null };
  const emitted: GameEvent[] = [];
  const log = (kind: string, text: string, reason?: string, battle?: Battle) => {
    const event: GameEvent = { id: eventOffset + s.events.length + 1, turn: s.turn, round: s.round, actorId: kind === 'turn' ? currentPlayer(s).id : action.actorId, kind, text, ...(reason !== undefined ? { reason } : {}), ...(battle ? { battle } : {}) };
    s.events.push(event); emitted.push(event);
  };
  const nextTurn = () => {
    log('turn-end', `${currentPlayer(s).name} ends the turn.`);
    do {
      s.turnIndex++;
      if (s.turnIndex === s.order.length) { s.turnIndex = 0; s.round++; }
    } while (owned(s, s.order[s.turnIndex]).length === 0);
    s.turn++; s.attack = null; s.attackUsed = false;
    s.reinforcements = s.round >= 2 ? owned(s, currentPlayer(s).id).length * 2 : 0;
    s.phase = s.reinforcements ? 'reinforce' : 'action';
    log('turn', `${currentPlayer(s).name}'s turn · round ${s.round}.`, s.reinforcements ? `${s.reinforcements} soldiers to place: two per country.` : 'Round 1: no reinforcements.');
  };
  const decision = () => { if (action.reason) log('decision', `${currentPlayer(s).name}: ${action.type}.`, action.reason); };
  if (action.type === 'reinforce') {
    const country = s.countries.find(c => c.code === action.country);
    if (s.phase !== 'reinforce' || !country || country.ownerId !== action.actorId || amount > s.reinforcements) return reject('Place available reinforcements in your own country.');
    decision(); country.soldiers += amount; s.reinforcements -= amount;
    log('reinforce', `${currentPlayer(s).name} reinforces ${country.name} (+${amount}).`);
    if (s.reinforcements === 0) s.phase = 'action';
  } else if (action.type === 'transfer') {
    if (s.phase !== 'action' || !source || !target || source === target || source.ownerId !== action.actorId || target.ownerId !== action.actorId || source.soldiers - amount < 1) return reject('Transfer between your countries, leaving at least one soldier behind.');
    decision(); s.countries.find(c => c.code === source.code)!.soldiers -= amount;
    s.countries.find(c => c.code === target.code)!.soldiers += amount;
    log('transfer', `${source.name} → ${target.name}: ${amount} soldiers.`);
  } else if (action.type === 'attack') {
    if (s.phase !== 'action' || s.attackUsed || !source || !target || source.ownerId !== action.actorId || target.ownerId === action.actorId || source.soldiers < 2) return reject('Choose your base with at least two soldiers and one enemy target. One attack per turn.');
    decision(); s.lastBattle = null; s.attack = { source: source.code, target: target.code }; s.phase = 'battle'; s.attackUsed = true;
    log('attack', `${source.name} attacks ${target.name}.`, 'Alea iacta est. One soldier stays behind.');
  } else if (action.type === 'roll') {
    if (s.phase !== 'battle' || !s.attack) return reject('Choose an attacker and enemy target first.');
    const a = s.countries.find(c => c.code === s.attack!.source)!;
    const d = s.countries.find(c => c.code === s.attack!.target)!;
    const count = diceCount(a.soldiers, d.soldiers);
    if (count < 1) return reject('No soldiers available to fight.');
    decision();
    const attackerDice: number[] = [], defenderDice: number[] = [];
    let attackerLosses = 0, defenderLosses = 0;
    for (let i = 0; i < count; i++) {
      const x = randomIndex(rng, 6) + 1, y = randomIndex(rng, 6) + 1;
      attackerDice.push(x); defenderDice.push(y);
      if (x > y) defenderLosses++; else if (x < y) attackerLosses++;
    }
    a.soldiers -= attackerLosses; d.soldiers -= defenderLosses;
    const outcome = attackerLosses && defenderLosses ? 'both' : defenderLosses ? 'attacker' : attackerLosses ? 'defender' : 'tie';
    const b: Battle = {
      id: eventOffset + s.events.length + 1, source: a.name, target: d.name,
      attacker: currentPlayer(s).name, defender: s.players.find(p => p.id === d.ownerId)!.name,
      attackerDice, defenderDice, attackerLosses, defenderLosses, outcome,
      conquered: d.soldiers === 0, eliminated: false, commentary: '',
    };
    b.commentary = battleCommentary(b, b.id);
    log('dice', `${a.name} [${attackerDice.join(', ')}] vs ${d.name} [${defenderDice.join(', ')}].`, 'Dice paired in order; tied dice cause no loss.');
    log('losses', `${a.name} loses ${attackerLosses}; ${d.name} loses ${defenderLosses}.`);
    log('commentary', b.commentary);
    if (b.conquered) {
      const previousOwner = d.ownerId;
      d.ownerId = a.ownerId; d.soldiers = conquestGarrison(d.startingValue); d.takenOnTurn = s.turn;
      s.phase = 'action'; s.attack = null;
      log('conquest', `Veni, vidi, vici. ${d.name} belongs to ${currentPlayer(s).name}.`, `New garrison: ${d.soldiers}, based on its original soldier value.`);
      if (owned(s, previousOwner).length === 0) {
        b.eliminated = true;
        log('elimination', `Vae victis. ${s.players.find(p => p.id === previousOwner)!.name} is eliminated.`);
      }
      if (owned(s, a.ownerId).length === 10) {
        s.winnerId = a.ownerId; s.phase = 'finished';
        log('victory', `${currentPlayer(s).name} conquers the world.`, 'All ten countries under one command.');
      }
    } else if (a.soldiers === 1) {
      s.phase = 'action'; s.attack = null;
      log('repelled', `${a.name}'s attack ends. ${d.name} holds.`, 'The attacker must keep its last soldier.');
    }
    s.lastBattle = b;
    log('battle', `${a.name} vs ${d.name}`, undefined, b);
  } else if (action.type === 'stop') {
    if (s.phase !== 'battle') return reject('There is no attack in progress.');
    decision(); log('stop', `${currentPlayer(s).name} stops the attack.`); nextTurn();
  } else if (action.type === 'end') {
    if (s.phase !== 'action') return reject(s.phase === 'reinforce' ? 'Place all reinforcements before ending the turn.' : 'Stop the active attack to end your turn.');
    decision(); nextTurn();
  } else return reject('Unknown action.');
  return { state: s, events: emitted };
}
