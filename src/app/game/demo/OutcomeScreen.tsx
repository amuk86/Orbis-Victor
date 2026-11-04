'use client';

import Link from 'next/link';
import CRTWarp from '@/components/CRTWarp';
import { getOutcomeQuote } from './outcome-quotes';

type OutcomeScreenProps = {
  won: boolean;
  campaignId: string;
  summary: string;
  onNewCampaign: () => void;
  onSpectate?: () => void;
};

export default function OutcomeScreen({ won, campaignId, summary, onNewCampaign, onSpectate }: OutcomeScreenProps) {
  const quote = getOutcomeQuote(campaignId, won);
  return (
    <section className={`ov-result-screen ${won ? 'ov-result-victory' : 'ov-result-defeat'}`}>
      <div className="ov-result-background" aria-hidden="true">
        <CRTWarp
          color={won ? '#4b5320' : '#8b1e24'}
          backgroundColor={won ? '#120f17' : '#17090d'}
          mask="aperture"
          curvature={0.25}
          persistence={0.4}
          brightness={1.4}
          mouseReact={false}
          changeOnClick={false}
          style={{ position: 'absolute', inset: 0 }}
        />
      </div>
      <div className="ov-result-shade" aria-hidden="true" />
      <div className="ov-result-content">
        <p className="ov-result-wordmark">Orbis Victor</p>
        <p className="ov-result-latin" lang="la">{won ? 'Veni, vidi, vici' : 'Vae victis'}</p>
        <h1 id="ov-outcome-title">{won ? 'Victory' : 'Defeat'}</h1>
        <p className="ov-result-summary">{summary}</p>
        <div className="ov-result-rule" aria-hidden="true" />
        <figure className="ov-result-quote">
          <blockquote lang={quote.translation ? 'la' : 'en'}>“{quote.text}”</blockquote>
          {quote.translation && <p className="ov-result-translation">{quote.translation}</p>}
          <figcaption>— {quote.author}<cite>{quote.work}</cite></figcaption>
        </figure>
        <div className="ov-result-actions">
          <button className="ov-button ov-primary" onClick={onNewCampaign}>Choose a new campaign</button>
          {onSpectate && <button className="ov-button" onClick={onSpectate}>Watch the remaining war</button>}
        </div>
        <div className="ov-result-links"><Link className="ov-result-home" href="/analytics">View player &amp; platform analytics</Link><Link className="ov-result-home" href="/">Return to title screen</Link></div>
      </div>
    </section>
  );
}
