import type { Metadata } from 'next';
import AnalyticsDashboard from './AnalyticsDashboard';

export const metadata: Metadata = {
  title: 'Orbis Victor — Analytics',
  description: 'Player performance and platform activity across local Orbis Victor campaigns.',
};

export default function AnalyticsPage() {
  return <AnalyticsDashboard />;
}
