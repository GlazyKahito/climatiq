import Link from 'next/link';
import { Droplets, ExternalLink, HeartPulse, House, Shirt, Sun, Users } from 'lucide-react';
import { Panel } from '@/components/ui/primitives';

const ACTIONS = [
  { icon: Droplets, title: 'Drink water often', text: 'Drink water even if you are not thirsty; carry water when you go out. ORS, lassi, lemon water or buttermilk help.' },
  { icon: Sun, title: 'Avoid the hottest hours', text: 'Stay out of direct sun, especially between noon and 3 pm. Avoid strenuous outdoor work then.' },
  { icon: Shirt, title: 'Dress for the heat', text: 'Wear light, loose, light-coloured cotton clothes; cover your head with a cap, cloth or umbrella.' },
  { icon: House, title: 'Keep homes cool', text: 'Use curtains or shades, open windows at night, and take breaks in cooler places.' },
  { icon: Users, title: 'Check on others', text: 'Look after infants, older people, outdoor workers, pregnant women and anyone who is unwell — and pets.' },
  { icon: HeartPulse, title: 'Know the danger signs', text: 'Dizziness, confusion, very high body temperature, fainting or no sweating can mean heat stroke — call 108/112 and cool the person immediately.' },
];

export function SafetyActions() {
  return (
    <Panel
      className="mt-4"
      title="Stay safe in the heat"
      description="General heat-safety guidance. For official do's and don'ts follow NDMA and your local authorities."
      footer={
        <span>
          Source for official guidance:{' '}
          <a className="inline-flex items-center gap-0.5 font-semibold text-accent hover:underline" href="https://ndma.gov.in/Natural-Hazards/Heat-Wave" target="_blank" rel="noreferrer">
            National Disaster Management Authority — Heat Wave <ExternalLink className="size-3" aria-hidden />
          </a>
        </span>
      }
    >
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ACTIONS.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3 rounded-xl border border-line bg-glass-strong p-3">
            <Icon className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
            <span>
              <span className="block font-semibold">{title}</span>
              <span className="text-sm text-fg-muted">{text}</span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function UnderstandingOutlook() {
  return (
    <Panel className="mt-4" title="Understanding this outlook">
      <div className="grid gap-4 text-sm text-fg-muted md:grid-cols-2">
        <p>
          <strong className="text-fg">What the levels mean.</strong> CLIMATIQ uses four levels — Low, Moderate, High and Extreme. <em>High</em> and <em>Extreme</em> mean the forecast meets the India
          Meteorological Department&apos;s heatwave or severe-heatwave criteria as CLIMATIQ estimates them. They are not official IMD declarations.
        </p>
        <p>
          <strong className="text-fg">How precise is it?</strong> Forecasts are estimates for one point per district (or per state), so conditions in your town can differ. Each forecast has a range and a
          confidence level; confidence is a rough guide, not a probability.
        </p>
        <p>
          <strong className="text-fg">Where the data comes from.</strong> Weather model guidance and past weather (ERA5 reanalysis) from Open-Meteo, combined by CLIMATIQ&apos;s statistical model. No physical
          weather stations are connected yet.
        </p>
        <p>
          <strong className="text-fg">Learn more.</strong> Read the{' '}
          <Link href="/methodology" className="font-semibold text-accent hover:underline">
            methodology and data transparency page
          </Link>{' '}
          for the full method, sources and limitations.
        </p>
      </div>
    </Panel>
  );
}
