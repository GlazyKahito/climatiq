import type { Permission } from './rbac';

export type NavItem = { href: string; label: string; icon: string; permission?: Permission; description: string };

/** Primary navigation (icons are lucide-react names resolved in the sidebar). */
export const NAV: NavItem[] = [
  { href: '/command', label: 'Command center', icon: 'Radar', permission: 'dashboard:view', description: 'Nationwide heat map and situational overview' },
  { href: '/forecasts', label: 'Heatwave prediction', icon: 'ThermometerSun', permission: 'dashboard:view', description: 'Regional forecasts, risk and uncertainty' },
  { href: '/stations', label: 'Weather stations', icon: 'RadioTower', permission: 'station:view', description: 'Station network, observations and health' },
  { href: '/advisories', label: 'Advisories & alerts', icon: 'Megaphone', permission: 'advisory:view_internal', description: 'AI-assisted advisories and automated alerts' },
  { href: '/response', label: 'Response CRM', icon: 'Siren', permission: 'incident:view', description: 'Incidents, tasks and team coordination' },
  { href: '/analytics', label: 'Climate analytics', icon: 'ChartSpline', permission: 'analytics:view', description: 'History, comparisons and forecast accuracy' },
  { href: '/admin', label: 'Administration', icon: 'ShieldCheck', permission: 'admin:view', description: 'Users, ingestion, audit and demo controls' },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: '/portal', label: 'Public portal', icon: 'Globe2', description: 'Public climate information' },
  { href: '/methodology', label: 'Methodology', icon: 'BookOpenText', description: 'Data sources, models and limitations' },
  { href: '/settings', label: 'Profile & settings', icon: 'Settings2', description: 'Your profile and preferences' },
];
