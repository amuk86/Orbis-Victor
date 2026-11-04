'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import CRTWarp from '@/components/CRTWarp';
import { aggregateCampaigns } from '@/game/analytics';
import type { AnalyticsOverview, CampaignAnalytics } from '@/game/analytics';
import { BrowserCampaignStore } from '@/game/storage';
import './analytics.css';

const count = (n: number) => n.toLocaleString();
const rate = (n: number | null) => n === null ? '—' : `${n.toFixed(1)}%`;
const resultLabel = (result: CampaignAnalytics['result']) => result === 'win' ? 'Victory' : result === 'loss' ? 'Defeat' : 'In progress';

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <article className="oa-metric"><p>{label}</p><strong>{typeof value === 'number' ? count(value) : value}</strong>{note && <small>{note}</small>}</article>;
}

function DiceChart({ faces }: { faces: number[] }) {
  const max = Math.max(1, ...faces);
  return <section className="oa-panel"><h2>Your dice distribution</h2><p className="oa-description">Every die you rolled, attacking or defending.</p><ol className="oa-bars" aria-label="Number of rolls for each die face">{faces.map((n,i)=><li key={i}><span className="oa-face">{i+1}</span><span className="oa-bar-track" aria-hidden="true"><span style={{ width:`${n/max*100}%` }} /></span><span className="oa-number">{count(n)}</span></li>)}</ol></section>;
}

function ResultChart({ data }: { data: AnalyticsOverview }) {
  const { wins, losses, active } = data.player;
  const total = data.platform.campaigns;
  return <section className="oa-panel"><h2>Campaign results</h2><p className="oa-description">Your outcome in each saved campaign, including wars still in progress.</p><div className="oa-result-chart" aria-hidden="true">{total > 0 && <><span className="oa-result-win" style={{ width:`${wins/total*100}%` }} /><span className="oa-result-loss" style={{ width:`${losses/total*100}%` }} /><span className="oa-result-active" style={{ width:`${active/total*100}%` }} /></>}</div><ul className="oa-result-legend"><li><i className="oa-result-win" />Victories <strong>{wins}</strong></li><li><i className="oa-result-loss" />Defeats <strong>{losses}</strong></li><li><i className="oa-result-active" />In progress <strong>{active}</strong></li></ul></section>;
}

export default function AnalyticsDashboard() {
  const store = useMemo(()=>new BrowserCampaignStore(),[]);
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState('');
  const [tab, setTab] = useState<'player' | 'platform' | 'campaign'>('player');
  const [campaignId, setCampaignId] = useState('');
  const refresh = useCallback(()=>{
    try {
      setData(aggregateCampaigns(store.all()));
      setUpdated(new Date().toLocaleTimeString(undefined,{ hour:'2-digit', minute:'2-digit' }));
      setError('');
    } catch { setError('Browser storage could not be read. Enable site storage, then refresh to load your statistics.'); }
  },[store]);
  useEffect(()=>{
    refresh();
    const onStorage = (event: StorageEvent) => { if (event.key===null || event.key.startsWith('orbis-victor:campaign:')) refresh(); };
    window.addEventListener('storage',onStorage);
    return ()=>window.removeEventListener('storage',onStorage);
  },[refresh]);
  const campaign = data?.campaigns.find(c=>c.id===campaignId) ?? data?.campaigns[0];

  return <main className="oa-dashboard">
    <div className="oa-background" aria-hidden="true"><CRTWarp color="#4b5320" backgroundColor="#120f17" mask="aperture" curvature={0.25} persistence={0.4} brightness={0.6} mouseReact={false} changeOnClick={false} style={{ position:'absolute', inset:0 }} /></div>
    <section className="oa-shell">
      <header className="oa-header"><div><Link href="/" className="oa-wordmark">Orbis Victor</Link><p className="oa-eyebrow">The record of your wars</p><h1>Campaign analytics</h1></div><div className="oa-header-actions"><button onClick={refresh} className="oa-button">Refresh statistics</button><Link href="/game/demo" className="oa-button oa-primary">Back to campaigns</Link></div></header>
      <p className="oa-scope"><strong>Local platform · this browser</strong><span>Statistics cover valid campaigns saved here. Deleted saves no longer contribute. Cross-device and online totals will come with online integration.</span></p>
      {error && <p className="oa-error" role="alert">{error}</p>}
      {!data && !error && <p className="oa-empty" role="status">Reading your campaigns…</p>}
      {data && <>
        <div className="oa-tabs" role="group" aria-label="Analytics view">{(['player','platform','campaign'] as const).map(t=><button key={t} onClick={()=>setTab(t)} aria-pressed={tab===t} className={tab===t ? 'is-active' : ''}>{t==='player' ? 'Your performance' : t==='platform' ? 'Platform overview' : 'Campaign details'}</button>)}<span className="oa-updated">Updated {updated}</span></div>
        {data.platform.campaigns===0 ? <section className="oa-empty oa-panel"><p className="oa-eyebrow">A blank page in history</p><h2>No saved campaigns yet</h2><p>Start a campaign and play a turn. Your results and battle statistics will appear here automatically.</p><Link className="oa-button oa-primary" href="/game/demo">Begin a campaign →</Link></section> : <>
          {tab==='player' && <section aria-label="Your performance">
            <div className="oa-metrics"><Metric label="Campaigns played" value={data.platform.campaigns} note="All your saved campaigns" /><Metric label="Victories" value={data.player.wins} /><Metric label="Defeats" value={data.player.losses} note="Counts when your last country falls" /><Metric label="Win rate" value={rate(data.player.winRate)} note="Victories ÷ decided player outcomes" /></div>
            <div className="oa-metrics oa-secondary"><Metric label="Attacks launched" value={data.player.attacks} /><Metric label="Countries captured" value={data.player.conquests} note="Includes recaptures" /><Metric label="Commanders eliminated" value={data.player.eliminations} /><Metric label="Enemy soldiers defeated" value={data.player.enemyLosses} /><Metric label="Your soldiers lost" value={data.player.soldiersLost} /><Metric label="Dice rolled" value={data.player.diceRolled} /></div>
            <div className="oa-two-columns"><DiceChart faces={data.player.diceFaces} /><section className="oa-panel"><h2>On the battlefield</h2><p className="oa-description">Individual dice comparisons, from both sides of your battles.</p><dl className="oa-comparisons"><div><dt>Dice won</dt><dd>{count(data.player.diceWins)}</dd></div><div><dt>Dice lost</dt><dd>{count(data.player.diceLosses)}</dd></div><div><dt>Tied dice</dt><dd>{count(data.player.diceTies)}</dd></div><div><dt>Campaigns in progress</dt><dd>{count(data.player.active)}</dd></div></dl><p className="oa-footnote">Tied dice cause no casualties. A campaign still in progress does not lower your win rate.</p></section></div>
            <section className="oa-panel"><h2>Performance by starting country</h2><p className="oa-description">Which nations have you led, and how have those campaigns ended?</p><div className="oa-table-scroll" role="region" aria-label="Starting country performance" tabIndex={0}><table><thead><tr><th>Starting country</th><th>Campaigns</th><th>Victories</th><th>Defeats</th><th>In progress</th><th>Win rate</th></tr></thead><tbody>{data.countries.map(c=><tr key={c.code}><th scope="row">{c.name}</th><td>{c.campaigns}</td><td>{c.wins}</td><td>{c.losses}</td><td>{c.active}</td><td>{rate(c.wins+c.losses ? c.wins/(c.wins+c.losses)*100 : null)}</td></tr>)}</tbody></table></div></section>
          </section>}
          {tab==='platform' && <section aria-label="Platform overview">
            <div className="oa-metrics"><Metric label="Saved campaigns" value={data.platform.campaigns} /><Metric label="World conquests" value={data.platform.worldFinished} note="Any commander owns all ten countries" /><Metric label="Ongoing wars" value={data.platform.ongoingWars} note="May continue after your defeat" /><Metric label="NPC decisions" value={data.platform.npcDecisions} note="Includes fast-forward actions" /></div>
            <div className="oa-metrics oa-secondary"><Metric label="All attacks" value={data.platform.attacks} /><Metric label="All conquests" value={data.platform.conquests} /><Metric label="Battle rounds" value={data.platform.battleRounds} note="One paired roll, counted once" /><Metric label="All dice rolled" value={data.platform.diceRolled} note="Attacker and defender combined" /><Metric label="Total casualties" value={data.platform.soldiersLost} note="All human and NPC soldiers lost" /></div>
            <ResultChart data={data} />
            <p className="oa-footnote">Activity includes every human and NPC commander in the saved wars. These are local totals, not live visitors or an online user count.</p>
          </section>}
          {tab==='campaign' && campaign && <section aria-label="Campaign details">
            <div className="oa-campaign-heading"><div><label htmlFor="analytics-campaign">Inspect a saved campaign</label><select id="analytics-campaign" value={campaign.id} onChange={e=>setCampaignId(e.target.value)}>{data.campaigns.map((c,i)=><option key={c.id} value={c.id}>{c.country} · Round {c.round} · {resultLabel(c.result)} · Save {i+1}</option>)}</select></div><span className={`oa-outcome oa-${campaign.result}`}>{resultLabel(campaign.result)}</span></div>
            <div className="oa-metrics"><Metric label="Current round" value={campaign.round} /><Metric label="Your countries" value={`${campaign.human.territories} / 10`} /><Metric label="Your standing army" value={campaign.human.soldiers} /><Metric label="Battle rounds" value={campaign.battleRounds} /></div>
            <section className="oa-panel"><h2>Commander performance</h2><p className="oa-description">Current holdings and recorded combat activity in this campaign.</p><div className="oa-table-scroll" role="region" aria-label="Commander statistics" tabIndex={0}><table><thead><tr><th>Commander</th><th>Countries</th><th>Soldiers</th><th>Attacks</th><th>Captures</th><th>Eliminations</th><th>Lost</th><th>Enemies defeated</th></tr></thead><tbody>{campaign.commanders.map(p=><tr key={p.id} className={p.human ? 'oa-human' : ''}><th scope="row"><i className="oa-owner-dot" style={{ background:p.color }} />{p.name}{p.territories===0 && <small> · eliminated</small>}</th><td>{p.territories}</td><td>{count(p.soldiers)}</td><td>{p.attacks}</td><td>{p.conquests}</td><td>{p.eliminations}</td><td>{count(p.soldiersLost)}</td><td>{count(p.enemyLosses)}</td></tr>)}</tbody></table></div></section>
          </section>}
          <section className="oa-panel oa-archive"><h2>Campaign archive</h2><p className="oa-description">Open a campaign’s figures without changing its saved progress.</p><div className="oa-table-scroll" role="region" aria-label="Campaign history" tabIndex={0}><table><thead><tr><th>Starting country</th><th>Round</th><th>Player result</th><th>Countries held</th><th>Your captures</th><th>Details</th></tr></thead><tbody>{data.campaigns.map(c=><tr key={c.id}><th scope="row">{c.country}</th><td>{c.round}</td><td><span className={`oa-outcome oa-${c.result}`}>{resultLabel(c.result)}</span></td><td>{c.human.territories} / 10</td><td>{c.human.conquests}</td><td><button className="oa-text-button" aria-label={`View ${c.country} campaign statistics`} onClick={()=>{setCampaignId(c.id);setTab('campaign');document.querySelector('.oa-tabs')?.scrollIntoView({block:'start'});}}>View statistics</button></td></tr>)}</tbody></table></div></section>
        </>}
      </>}
      <footer className="oa-footer">Derived from saved game events · No tracking service or network connection required</footer>
    </section>
  </main>;
}
