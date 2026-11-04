import { HUMAN_ID, owned } from './engine';
import type { GameState } from './engine';

export type CommanderStats = {
  id: string;
  name: string;
  color: string;
  human: boolean;
  territories: number;
  soldiers: number;
  attacks: number;
  conquests: number;
  eliminations: number;
  battleRounds: number;
  diceRolled: number;
  diceWins: number;
  diceLosses: number;
  diceTies: number;
  soldiersLost: number;
  enemyLosses: number;
  diceFaces: number[];
};
export type CampaignAnalytics = {
  id: string;
  country: string;
  countryCode: string;
  round: number;
  result: 'win' | 'loss' | 'in-progress';
  worldFinished: boolean;
  commanders: CommanderStats[];
  human: CommanderStats;
  attacks: number;
  conquests: number;
  battleRounds: number;
  diceRolled: number;
  soldiersLost: number;
  npcDecisions: number;
};
export type CountryPerformance = {
  code: string; name: string; campaigns: number; wins: number; losses: number; active: number;
};
export type AnalyticsOverview = {
  campaigns: CampaignAnalytics[];
  player: {
    wins: number; losses: number; active: number; winRate: number | null;
    attacks: number; conquests: number; eliminations: number;
    soldiersLost: number; enemyLosses: number; diceRolled: number;
    diceWins: number; diceLosses: number; diceTies: number; diceFaces: number[];
  };
  platform: {
    campaigns: number; worldFinished: number; ongoingWars: number;
    attacks: number; conquests: number; battleRounds: number;
    diceRolled: number; soldiersLost: number; npcDecisions: number;
  };
  countries: CountryPerformance[];
};

export function analyseCampaign(state: GameState): CampaignAnalytics {
  const commanders = state.players.map(p => {
    const holdings = owned(state, p.id);
    return {
      id: p.id, name: p.name, color: p.color, human: p.id === HUMAN_ID,
      territories: holdings.length, soldiers: holdings.reduce((n,c) => n+c.soldiers,0),
      attacks: 0, conquests: 0, eliminations: 0, battleRounds: 0,
      diceRolled: 0, diceWins: 0, diceLosses: 0, diceTies: 0,
      soldiersLost: 0, enemyLosses: 0, diceFaces: [0,0,0,0,0,0],
    } satisfies CommanderStats;
  });
  const byId = new Map(commanders.map(p => [p.id,p]));
  // Older saves identify defenders by their unique commander name. No prose is parsed.
  const byName = new Map(commanders.map(p => [p.name,p]));
  const seenEvents = new Set<number>();
  const seenBattles = new Set<number>();
  let battleRounds = 0, npcDecisions = 0;
  for (const event of state.events) {
    if (seenEvents.has(event.id)) continue;
    seenEvents.add(event.id);
    const actor = byId.get(event.actorId);
    if (!actor) continue;
    if (event.kind === 'attack') actor.attacks++;
    if (event.kind === 'conquest') actor.conquests++;
    if (event.kind === 'elimination') actor.eliminations++;
    if (event.kind === 'decision' && !actor.human) npcDecisions++;
    const battle = event.kind === 'battle' ? event.battle : undefined;
    if (!battle || seenBattles.has(battle.id)) continue;
    seenBattles.add(battle.id);
    const defender = byName.get(battle.defender);
    if (!defender || defender.id === actor.id) continue;
    battleRounds++;
    actor.battleRounds++; defender.battleRounds++;
    for (let i = 0; i < battle.attackerDice.length; i++) {
      const a = battle.attackerDice[i], d = battle.defenderDice[i];
      actor.diceRolled++; defender.diceRolled++;
      actor.diceFaces[a-1]++; defender.diceFaces[d-1]++;
      if (a > d) {
        actor.diceWins++; actor.enemyLosses++;
        defender.diceLosses++; defender.soldiersLost++;
      } else if (a < d) {
        defender.diceWins++; defender.enemyLosses++;
        actor.diceLosses++; actor.soldiersLost++;
      } else { actor.diceTies++; defender.diceTies++; }
    }
  }
  const human = byId.get(HUMAN_ID)!;
  return {
    id: state.id, country: state.countries[0].name, countryCode: state.countries[0].code,
    round: state.round, result: state.winnerId === HUMAN_ID ? 'win' : human.territories === 0 ? 'loss' : 'in-progress',
    worldFinished: state.phase === 'finished', commanders, human, battleRounds, npcDecisions,
    attacks: commanders.reduce((n,p)=>n+p.attacks,0),
    conquests: commanders.reduce((n,p)=>n+p.conquests,0),
    diceRolled: commanders.reduce((n,p)=>n+p.diceRolled,0),
    soldiersLost: commanders.reduce((n,p)=>n+p.soldiersLost,0),
  };
}

export function aggregateCampaigns(states: GameState[]): AnalyticsOverview {
  // A resumed campaign is one campaign, regardless of how often it was saved.
  const campaigns = [...new Map(states.map(s=>[s.id,s])).values()].map(analyseCampaign);
  const wins = campaigns.filter(c=>c.result==='win').length;
  const losses = campaigns.filter(c=>c.result==='loss').length;
  const sum = (field: 'attacks' | 'conquests' | 'eliminations' | 'soldiersLost' | 'enemyLosses' | 'diceRolled' | 'diceWins' | 'diceLosses' | 'diceTies') => campaigns.reduce((n,c)=>n+c.human[field],0);
  const countries = new Map<string,CountryPerformance>();
  for (const campaign of campaigns) {
    const country = countries.get(campaign.countryCode) ?? { code:campaign.countryCode, name:campaign.country, campaigns:0, wins:0, losses:0, active:0 };
    country.campaigns++;
    if (campaign.result==='win') country.wins++;
    else if (campaign.result==='loss') country.losses++;
    else country.active++;
    countries.set(country.code,country);
  }
  const worldFinished = campaigns.filter(c=>c.worldFinished).length;
  return {
    campaigns,
    player: {
      wins, losses, active:campaigns.length-wins-losses, winRate:wins+losses ? wins/(wins+losses)*100 : null,
      attacks:sum('attacks'), conquests:sum('conquests'), eliminations:sum('eliminations'),
      soldiersLost:sum('soldiersLost'), enemyLosses:sum('enemyLosses'), diceRolled:sum('diceRolled'),
      diceWins:sum('diceWins'), diceLosses:sum('diceLosses'), diceTies:sum('diceTies'),
      diceFaces:[0,1,2,3,4,5].map(i=>campaigns.reduce((n,c)=>n+c.human.diceFaces[i],0)),
    },
    platform: {
      campaigns:campaigns.length, worldFinished, ongoingWars:campaigns.length-worldFinished,
      attacks:campaigns.reduce((n,c)=>n+c.attacks,0), conquests:campaigns.reduce((n,c)=>n+c.conquests,0),
      battleRounds:campaigns.reduce((n,c)=>n+c.battleRounds,0), diceRolled:campaigns.reduce((n,c)=>n+c.diceRolled,0),
      soldiersLost:campaigns.reduce((n,c)=>n+c.soldiersLost,0), npcDecisions:campaigns.reduce((n,c)=>n+c.npcDecisions,0),
    },
    countries:[...countries.values()].sort((a,b)=>b.campaigns-a.campaigns||a.name.localeCompare(b.name)),
  };
}
