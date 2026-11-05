'use client';

import {useState} from 'react';
import briefings from '../../data/country-briefings.json';
import {startingSoldiers} from '@/game/engine';
import type {Country} from '@/game/engine';

type Briefing={region:string;capital:string;overview:string;wars:string;notable:string};

export default function CountryBriefing({country}:{country:Country}){
  const [flagFailed,setFlagFailed]=useState(false);
  const note=(briefings as Record<string,Briefing>)[country.code];
  const soldiers=startingSoldiers(country.population);
  const population=new Intl.NumberFormat('en',{maximumFractionDigits:0}).format(country.population*1_000_000);
  return <section className="country-briefing" aria-label="Selected country briefing">
    <div aria-live="polite" aria-atomic="true">
      <div className="country-briefing-heading">
        <div className="country-briefing-flag" aria-hidden="true">{flagFailed?<span>{country.code.toUpperCase()}</span>:<img src={`https://flagcdn.com/w160/${country.code}.png`} alt="" width={80} height={52} onError={()=>setFlagFailed(true)}/>}</div>
        <div><p className="country-briefing-eyebrow">Your starting nation</p><h2>{country.name}</h2>{note&&<p className="country-briefing-location">{note.region}<span aria-hidden="true"> / </span><span>Capital: {note.capital}</span></p>}</div>
      </div>
      {note&&<p className="country-briefing-overview">{note.overview}</p>}
    </div>
    <dl className="country-briefing-stats">
      <div><dt>Population · game snapshot</dt><dd>{population}</dd></div>
      <div><dt>Starting force</dt><dd>{soldiers} {soldiers===1?'soldier':'soldiers'}</dd></div>
    </dl>
    {note&&<details className="country-briefing-history"><summary>Historical notes</summary><p><strong>Conflicts</strong>{note.wars}</p><p><strong>Did you know?</strong>{note.notable}</p><small>Historical reference notes</small></details>}
  </section>;
}
