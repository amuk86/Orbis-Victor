'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import CRTWarp from '@/components/CRTWarp';
import countries from '../../../../data/countries.json';
import { createGame, currentPlayer, diceCount, HUMAN_ID, owned, startingSoldiers, transition } from '@/game/engine';
import type { Action, Command, Country, GameState, Territory } from '@/game/engine';
import { nextNpcAction } from '@/game/npc';
import { getCommentary } from '@/game/commentary';
import { BrowserCampaignStore } from '@/game/storage';
import type { CampaignSummary } from '@/game/storage';
import { canPlay, LOCAL_OWNER } from '@/game/access';
import OutcomeScreen from './OutcomeScreen';
import type { RemoteGame } from '@/cloud/game';
import './game.css';

function Modal({ children, onClose, className = '', labelledBy }: { children: React.ReactNode; onClose?: () => void; className?: string; labelledBy?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); };
  }, []);
  return <dialog ref={dialog} className={`ov-native-dialog ${className}`} aria-labelledby={labelledBy} onCancel={event => { event.preventDefault(); onClose?.(); }}>{children}</dialog>;
}

function Flag({ country }: { country: Country }) {
  const [failed, setFailed] = useState(false);
  return <span className="ov-flag" aria-hidden="true">{failed ? <span className="ov-flag-fallback"><i /><i /><i /></span> : <img src={`https://flagcdn.com/w80/${country.code}.png`} alt="" width={80} height={48} onError={() => setFailed(true)} loading="lazy" />}</span>;
}

export default function GameClient({ remote }: { remote?: RemoteGame } = {}) {
  const [localGame, setGame] = useState<GameState | null>(null);
  const game = remote?.state ?? localGame;
  const stateRef = useRef<GameState | null>(null);
  useEffect(() => { if (remote) stateRef.current = remote.state; }, [remote]);
  const store = useMemo(() => new BrowserCampaignStore(), []);
  const [saves, setSaves] = useState<CampaignSummary[]>([]);
  const [country, setCountry] = useState('za');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'mine' | 'enemies'>('all');
  const [fast, setFast] = useState(false);
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const [spectator, setSpectator] = useState(false);
  const [watchDefeat, setWatchDefeat] = useState(false);
  const [visible, setVisible] = useState(true);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [historyLimit, setHistoryLimit] = useState(300);
  const [commentary, setCommentary] = useState<{ id: number; text: string } | null>(null);
  const dispatchEnd = useRef<HTMLDivElement>(null);
  const previousTurn = useRef<number | null>(null);
  const turnBanner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { if (!remote) setSaves(store.list()); } catch { setSaveError('Browser storage is unavailable. You can play, but progress cannot be saved.'); }
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [store, !!remote]);

  const commit = useCallback((next: GameState) => {
    stateRef.current = next; setGame(next);
    try { store.save(next); setSaves(store.list()); setSaveError(''); }
    catch { setSaveError('Progress could not be saved. Browser storage may be full or disabled. Keep this tab open.'); }
  }, [store]);

  const send = useCallback((action: Action) => {
    if (remote) {
      if (remote.pending || !remote.canControl) return;
      const { actorId, reason, ...command } = action; void actorId; void reason;
      void remote.send(command);
      return;
    }
    const s = stateRef.current;
    if (!s) return;
    const result = transition(s, action, Math.random);
    if (result.error) { setMessage(result.error); return; }
    setMessage(''); commit(result.state);
  }, [commit, remote]);

  const humanCount = game ? owned(game, HUMAN_ID).length : 0;
  const defeated = !!game && humanCount === 0;
  const player = game ? currentPlayer(game) : null;
  const controls = !!game && !spectator && canPlay(game, LOCAL_OWNER) && !menu && (!remote || (remote.canControl && !remote.pending));

  useEffect(() => {
    remote?.setPlaybackPaused?.(menu || !visible || (defeated && !watchDefeat));
  }, [menu, visible, defeated, watchDefeat, remote?.setPlaybackPaused]);

  useEffect(() => {
    if (remote && (!remote.canControl || remote.pending)) return;
    if (!game || game.phase === 'finished' || currentPlayer(game).human || menu || !visible || (defeated && !watchDefeat)) return;
    const timer = window.setTimeout(() => {
      if (remote) { void (fast ? remote.npcBatch() : remote.npcStep()); return; }
      const action = nextNpcAction(game);
      if (action) send(action);
    }, fast ? 170 : 1020);
    return () => window.clearTimeout(timer);
  }, [game, fast, menu, visible, defeated, watchDefeat, send, remote]);

  useEffect(() => {
    if (!game) return;
    if (previousTurn.current !== game.turn) {
      setSelected(null); setTarget(null); setMessage(''); previousTurn.current = game.turn;
      if (currentPlayer(game).human) turnBanner.current?.focus({ preventScroll: true });
    }
    dispatchEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [game]);

  useEffect(() => {
    let active = true;
    if (game?.lastBattle) getCommentary(game.lastBattle).then(line => { if (active) setCommentary({ id: game.lastBattle!.id, text: line }); });
    return () => { active = false; };
  }, [game?.lastBattle]);

  function start() {
    const next = createGame(countries, country, Math.random, crypto.randomUUID());
    setSelected(null); setTarget(null); setMenu(false); setWatchDefeat(false); setSpectator(false); setMessage(''); setFilter('all'); previousTurn.current = null;
    commit(next);
  }
  function resume(id: string) {
    try {
      const saved = store.load(id);
      if (!saved) throw new Error('Missing campaign');
      setSelected(null); setTarget(null); setMenu(false); setWatchDefeat(false); setSpectator(false); setMessage(''); previousTurn.current = null;
      commit(saved);
    } catch { setMessage('This saved campaign could not be opened. Start a new campaign or choose another save.'); }
  }
  function leave() {
    if (remote) { remote.leave(); return; }
    stateRef.current = null; setGame(null); setMenu(false); setHelp(false); setMessage('');
    try { setSaves(store.list()); } catch { /* The storage warning remains visible. */ }
  }
  function human(action: Command) {
    const s = stateRef.current;
    if (!s || spectator || !canPlay(s, LOCAL_OWNER)) return;
    send({ ...action, actorId: HUMAN_ID });
  }
  function selectCard(c: Territory) {
    if (!game || !controls || game.phase === 'battle' || game.phase === 'finished') return;
    if (game.phase === 'reinforce') {
      if (c.ownerId === HUMAN_ID) human({ type: 'reinforce', country: c.code });
      else setMessage('Place your remaining soldiers in a country you own.');
      return;
    }
    if (c.ownerId === HUMAN_ID) {
      if (selected === c.code) { setSelected(null); setTarget(null); return; }
      if (selected) {
        human({ type: 'transfer', source: selected, target: c.code });
        setTarget(null); return;
      }
      setSelected(c.code); setTarget(null); setMessage('');
    } else if (selected && !game.attackUsed) {
      const base = game.countries.find(t => t.code === selected)!;
      if (base.soldiers < 2) { setMessage('This base needs at least two soldiers to attack.'); return; }
      setTarget(c.code); setMessage('');
    } else setMessage(game.attackUsed ? 'Your one attack is complete. Transfer troops or end your turn.' : 'Select one of your countries first.');
  }
  function roll() {
    if (!game || !controls) return;
    if (game.phase === 'battle') { human({ type: 'roll' }); return; }
    if (selected && target) {
      if (remote) { void remote.launch(selected, target); return; }
      human({ type: 'attack', source: selected, target });
      // Declare and roll as two logged engine transitions, displayed in the same battle step.
      const s = stateRef.current;
      if (s?.phase === 'battle') send({ type: 'roll', actorId: HUMAN_ID });
    }
  }

  const selectedCountry = game?.countries.find(c => c.code === (game.attack?.source ?? selected));
  const targetCountry = game?.countries.find(c => c.code === (game.attack?.target ?? (!game.attackUsed ? target : null)));
  const canRoll = controls && !!game && (game.phase === 'battle' || (game.phase === 'action' && !game.attackUsed && !!selectedCountry && selectedCountry.soldiers >= 2 && !!targetCountry));
  const battle = game?.lastBattle;
  const status = !game ? '' : game.phase === 'finished' ? `${game.winnerId === HUMAN_ID ? 'VICTORY' : 'CAMPAIGN OVER'}` : `${player?.human ? 'YOUR TURN' : `${player?.name.toUpperCase()}'S TURN`} · ${game.phase === 'reinforce' ? `place ${game.reinforcements} soldiers` : game.phase === 'battle' ? 'attack in progress' : game.attackUsed ? 'attack complete' : 'choose your move'}`;
  const hint = message || remote?.notice || (remote && !remote.canControl ? 'Public spectator view. Only the signed-in owner can control this campaign.' : spectator ? 'Spectator mode: resume command from the menu to play.' : !game ? '' : game.phase === 'finished' ? 'The world is under one command.' : !player?.human ? `${fast ? 'Fast-forward' : 'Following NPC moves'} · every decision and roll remains visible.` : game.phase === 'reinforce' ? `Click your countries to place ${game.reinforcements} remaining soldiers.` : game.phase === 'battle' ? 'Roll to continue the attack, or stop to end your turn.' : game.attackUsed ? 'Transfer soldiers if needed, then end your turn.' : target ? 'Roll dice to launch your one attack this turn.' : selected ? 'Choose an enemy to attack, or your other country to transfer one soldier. Click the selected base to deselect.' : 'Select your base, then an enemy. You can also end your turn.');

  return <main className="ov-game">
    <div className="ov-background" aria-hidden="true"><CRTWarp color="#4b5320" backgroundColor="#120f17" mask="aperture" curvature={0.25} persistence={0.4} brightness={0.65} mouseReact={false} changeOnClick={false} style={{ position: 'absolute', inset: 0 }} /><div /></div>
    {!game ? <section className="ov-setup ov-frame">
      <div className="ov-setup-navigation"><Link href="/" className="ov-back">← Title screen</Link><Link href="/analytics" className="ov-button">View analytics</Link></div>
      <p className="ov-eyebrow">A campaign of ten nations</p>
      <h1>Choose your country</h1>
      <p className="ov-intro">One commander. Nine rivals. The world is yours to conquer.</p>
      <div className="ov-setup-columns">
        <div className="ov-setup-choice ov-panel">
          <label htmlFor="country-search">Find your nation</label>
          <input id="country-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search 195 countries…" />
          <div className="ov-country-list" role="group" aria-label="Choose your starting country">
            {countries.filter(c => c.name.toLowerCase().includes(search.toLowerCase())).map(c => <button key={c.code} className={`ov-country-option ${country === c.code ? 'is-chosen' : ''}`} aria-pressed={country === c.code} onClick={() => setCountry(c.code)}><span>{c.name}</span><span className="ov-numeric">{startingSoldiers(c.population)} <small>soldiers</small></span></button>)}
            {!countries.some(c => c.name.toLowerCase().includes(search.toLowerCase())) && <p>No countries match that search.</p>}
          </div>
        </div>
        <aside className="ov-setup-summary ov-panel">
          <p className="ov-eyebrow">Your command</p>
          <Flag key={country} country={countries.find(c => c.code === country)!} />
          <h2>{countries.find(c => c.code === country)!.name}</h2>
          <p className="ov-starting"><strong>{startingSoldiers(countries.find(c => c.code === country)!.population)}</strong> starting soldiers</p>
          <p className="ov-muted">{countries.find(c => c.code === country)!.population.toLocaleString(undefined, { maximumFractionDigits: 2 })} million people · 2026 population snapshot</p>
          <div className="ov-rule-note">Nine rival nations are drawn randomly. First commander is chosen by lot. Reinforcements begin in round two.</div>
          <button className="ov-button ov-primary" onClick={start}>Begin campaign →</button>
          <button className="ov-text-button" onClick={() => setHelp(true)}>Read the field manual</button>
        </aside>
      </div>
      {saves.length > 0 && <section className="ov-saved"><h2>Continue a campaign</h2><div className="ov-save-list">{saves.map(s => <article key={s.id} className="ov-save ov-panel"><div><strong>{s.country}</strong><p className="ov-muted">Round {s.round} · {s.territories}/10 countries · {s.finished ? 'Completed' : 'In progress'}</p><small>Saved {new Date(s.updatedAt).toLocaleString()}</small></div><div><button className="ov-button" onClick={() => resume(s.id)}>Continue</button><button className="ov-text-button" aria-label={`Delete saved ${s.country} campaign`} onClick={() => { if (window.confirm(`Delete the saved ${s.country} campaign?`)) { try { store.remove(s.id); setSaves(store.list()); } catch { setMessage('This save could not be deleted.'); } } }}>Delete</button></div></article>)}</div></section>}
      <p className="ov-storage-note">Local campaigns stay in this browser. No account or online service required.</p>
      {message && <p role="alert" className="ov-notice">{message}</p>}
    </section> : <section className="ov-frame ov-console" aria-label="Orbis Victor campaign">
      <header className="ov-topbar"><Link href="/" className="ov-wordmark">Orbis Victor</Link><div ref={turnBanner} tabIndex={-1} className="ov-turn-status" aria-live="polite"><span>Round {game.round}</span><span>·</span><span>{status}</span></div><button className="ov-button" onClick={() => setMenu(true)}>Menu</button></header>
      <div className="ov-columns">
        <details open className="ov-commanders ov-panel"><summary>Commanders <span className="ov-drawer-hint">↕</span></summary><div className="ov-commander-list">{game.players.map(p => {
          const holdings = owned(game, p.id); const active = p.id === player?.id;
          return <div key={p.id} className={`ov-commander ${active ? 'is-current' : ''} ${holdings.length === 0 ? 'is-eliminated' : ''}`} style={{ '--owner': p.color } as React.CSSProperties}>
            <div className="ov-commander-heading"><span>{p.name}</span><span className="ov-numeric">{holdings.length ? `${holdings.length} / ${holdings.reduce((n,c) => n+c.soldiers,0)}` : 'out'}</span></div>
            {p.human && holdings.map(c => <button key={c.code} onClick={() => selectCard(c)} disabled={!controls || game.phase === 'battle' || game.phase === 'finished'} className="ov-holding"><span>{c.name}</span><span className="ov-numeric">{c.soldiers}</span></button>)}
          </div>;
        })}</div><p className="ov-panel-foot">Countries / soldiers<br />Badges identify each owner</p></details>
        <div className="ov-board-zone"><div className="ov-board-toolbar"><div className="ov-filters" role="group" aria-label="Filter countries">{(['all','mine','enemies'] as const).map(f => <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={`ov-button ${filter === f ? 'is-active' : ''}`}>{f}</button>)}</div><div className="ov-progress"><progress max={10} value={humanCount} aria-label="Your countries conquered" /><span className="ov-numeric">{humanCount} / 10</span></div></div>
          <div className="ov-board" aria-label="World territories">{game.countries.map(c => {
            const owner = game.players.find(p => p.id === c.ownerId)!;
            const attacker = c.code === (game.attack?.source ?? selected);
            const targeted = c.code === (game.attack?.target ?? (!game.attackUsed ? target : null));
            const validTarget = controls && game.phase === 'action' && !game.attackUsed && !!selectedCountry && selectedCountry.soldiers >= 2 && c.ownerId !== HUMAN_ID;
            const taken = c.takenOnTurn === game.turn;
            const dim = filter === 'mine' ? c.ownerId !== HUMAN_ID : filter === 'enemies' ? c.ownerId === HUMAN_ID : false;
            return <button key={c.code} className={`ov-territory ${attacker ? 'is-attacker' : ''} ${targeted ? 'is-target' : ''} ${validTarget ? 'is-valid-target' : ''} ${dim ? 'is-dimmed' : ''}`} style={{ '--owner': owner.color } as React.CSSProperties} onClick={() => selectCard(c)} aria-label={`${c.name}, ${c.soldiers} soldiers, owned by ${owner.name}${attacker ? ', selected attacker' : ''}${targeted ? ', selected target' : ''}`} aria-pressed={attacker || targeted} disabled={!controls || game.phase === 'battle' || game.phase === 'finished'}>
              <span className="ov-owner-badge" title={owner.name}>{owner.badge}</span><Flag country={c} /><strong className="ov-troops ov-numeric">{c.soldiers}</strong><span className="ov-country-name">{c.name}</span><span className={`ov-card-tag ${targeted ? 'ov-target-tag' : taken ? 'ov-gold' : ''}`}>{attacker ? 'attacker' : targeted ? 'target' : taken ? 'just taken' : '\u00a0'}</span>
            </button>;
          })}</div>
          <section className="ov-battle ov-panel" aria-label="Battle results"><div className="ov-battle-heading"><h2>{game.phase === 'battle' && selectedCountry && targetCountry ? `${selectedCountry.name} vs ${targetCountry.name}` : battle ? `${battle.source} vs ${battle.target}` : 'Awaiting your orders'}</h2><span className="ov-latin">{battle?.conquered && !game.attack ? battle.eliminated ? 'Vae victis · Veni, vidi, vici' : 'Veni, vidi, vici' : game.attack || battle ? 'Alea iacta est' : 'Alea iacta est'}</span></div>
            {battle ? <><div className="ov-dice-rows">{(['attacker','defender'] as const).map(side => <div className="ov-dice-row" key={side}><span className="ov-dice-label">{side === 'attacker' ? battle.attacker : battle.defender}</span><div className="ov-dice">{(side === 'attacker' ? battle.attackerDice : battle.defenderDice).map((die,i) => { const other = side === 'attacker' ? battle.defenderDice[i] : battle.attackerDice[i]; return <span key={`${battle.id}-${side}-${i}`} className={`ov-die ${die > other ? 'is-win' : die < other ? 'is-loss' : 'is-tie'}`} aria-label={`${die}, ${die > other ? 'wins' : die < other ? 'loses' : 'tie'}`}>{die}</span>; })}</div></div>)}</div><p className="ov-commentary">{commentary?.id === battle.id ? commentary.text : battle.commentary}</p><p className="ov-losses ov-numeric">Losses: {battle.source} −{battle.attackerLosses} · {battle.target} −{battle.defenderLosses}</p></> : <><div className="ov-dice-placeholder" aria-hidden="true">⚀ <span>vs</span> ⚀</div><p className="ov-commentary">Every conquest begins with a decision.</p></>}
            {game.phase === 'battle' && selectedCountry && targetCountry && <p className="ov-muted">Next roll: {diceCount(selectedCountry.soldiers, targetCountry.soldiers)} dice per side · paired in order</p>}
          </section>
        </div>
        <details open className="ov-dispatches ov-panel"><summary>Dispatches <span className="ov-drawer-hint">↕</span></summary><div className="ov-dispatch-list" role="log" aria-label="Campaign dispatches" aria-live="off">{game.events.length > historyLimit && <button className="ov-text-button" onClick={() => setHistoryLimit(n => n+300)}>Show earlier dispatches</button>}{game.events.filter(e => e.kind !== 'battle').slice(-historyLimit).map(e => <article key={e.id} className={`ov-dispatch ov-event-${e.kind}`}><small className="ov-dispatch-time">R{e.round} · {game.players.find(p => p.id === e.actorId)?.name}</small><p>{e.text}</p>{e.reason && <p className="ov-dispatch-reason">{e.reason}</p>}</article>)}<div ref={dispatchEnd} /></div></details>
      </div>
      <footer className="ov-bottom"><div className="ov-actions"><button className="ov-button ov-primary" disabled={!canRoll} onClick={roll} title={canRoll ? 'Roll paired dice' : hint}>Roll dice</button><button className="ov-button" disabled={!controls || game.phase !== 'battle'} onClick={() => human({ type:'stop' })} title="Stop an active attack and end your turn">Stop attack</button><button className="ov-button" disabled={!controls || game.phase !== 'action'} onClick={() => human({ type:'end' })} title={game.phase === 'reinforce' ? 'Place all reinforcements first' : game.phase === 'battle' ? 'Stop the active attack to end your turn' : 'Pass to the next commander'}>End turn</button><button className={`ov-button ${fast ? 'is-active' : ''}`} onClick={() => setFast(v => !v)} aria-pressed={fast}>Fast-forward <span className="ov-speed">{fast ? (remote ? 'ON' : '6×') : ''}</span></button></div><p className="ov-hint" role="status">{hint}</p></footer>
      {(game.phase === 'finished' || (defeated && !watchDefeat)) && (
        <Modal className="ov-outcome-dialog" labelledBy="ov-outcome-title">
          <OutcomeScreen
            won={game.winnerId === HUMAN_ID}
            campaignId={game.id}
            summary={game.winnerId === HUMAN_ID
              ? `All ten nations united in round ${game.round}.`
              : game.winnerId
                ? `${game.players.find(p => p.id === game.winnerId)?.name} has conquered the world.`
                : 'Your last banner has fallen. Your command is at an end.'}
            onNewCampaign={leave}
            onSpectate={!game.winnerId ? () => setWatchDefeat(true) : undefined}
          />
        </Modal>
      )}
      {menu && <Modal onClose={() => setMenu(false)}><section className="ov-modal ov-panel" role="dialog" aria-modal="true" aria-labelledby="menu-title"><p className="ov-eyebrow">Campaign paused</p><h2 id="menu-title">Field headquarters</h2><button autoFocus className="ov-button ov-primary" onClick={() => setMenu(false)}>Resume campaign</button><Link href="/analytics" className="ov-button">Player &amp; platform analytics</Link><button className="ov-button" onClick={() => setHelp(true)}>Field manual</button><button className="ov-button" onClick={() => { setSpectator(v => !v); setMenu(false); }}>{spectator ? 'Resume command' : 'Watch as spectator'}</button><button className="ov-button" onClick={leave}>{remote ? 'My cloud campaigns / New game' : 'Saved campaigns / New game'}</button><Link href="/" className="ov-text-button">Return to title screen</Link><p className="ov-muted">{remote ? 'Every confirmed move is saved in Firestore.' : 'Progress saves after every move in this browser.'}</p></section></Modal>}
    </section>}
    {help && <Modal onClose={() => setHelp(false)}><section className="ov-modal ov-manual ov-panel" role="dialog" aria-modal="true" aria-labelledby="manual-title"><h2 id="manual-title">The field manual</h2><p>Conquer all ten countries. Distance does not matter.</p><ol><li>Round one has no reinforcements. From round two, place two soldiers per country you own before acting.</li><li>Select your base, then an enemy. Roll to start your one attack this turn. Keep rolling or stop to end the turn.</li><li>Both sides roll the smaller of available attackers (troops minus one) and defenders. Dice fight in order. Ties cause no losses.</li><li>A conquest changes the owner and installs a garrison of at least two, or half the original soldier value, rounded down.</li><li>Outside combat, select your country and click another of yours to transfer one soldier. Click the base again to deselect. Always leave one behind.</li><li>End turn to pass. Fast-forward speeds NPC steps sixfold while showing every action and its reason.</li></ol><p className="ov-muted">Gold Y identifies your command. Unique letter badges identify rivals. Each commander’s row shows countries / total soldiers.</p><button autoFocus className="ov-button ov-primary" onClick={() => setHelp(false)}>Understood</button></section></Modal>}
    {saveError && <p className="ov-save-error" role="alert">{saveError}</p>}
  </main>;
}
