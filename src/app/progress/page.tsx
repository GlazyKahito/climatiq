import type { Metadata } from 'next';
import { ProgressBoard } from './progress-board';

export const metadata: Metadata = { title: 'Build progress · CLIMATIQ' };

export default function ProgressPage() {
  return <ProgressBoard />;
}
