import type { Metadata } from 'next';
import GameClient from './GameClient';

export const metadata: Metadata = {
  title: 'Orbis Victor — Campaign',
  description: 'Choose a country and command a local single-player conquest campaign.',
};

export default function Demo() {
  return <GameClient />;
}
