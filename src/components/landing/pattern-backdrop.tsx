import { cn } from '@/lib/utils';
import styles from './landing.module.css';

/**
 * Elegant section backdrop (original): "isotherm" contour lines — closed, gently perturbed rings around a few heat
 * cores, like a temperature analysis chart — over a hairline coordinate grid, softly masked at the edges.
 *
 * The contour art is a static asset (/textures/contours.svg, generated once from a deterministic Catmull-Rom ring
 * function) used as a CSS *mask* over a token-coloured layer: it is cached by the browser, adds nothing to the HTML,
 * and follows the theme automatically (the colour comes from `currentColor`). Decorative (aria-hidden).
 */

const CONTOUR_MASK = 'url(/textures/contours.svg)';

export function PatternBackdrop({
  variant = 'contour',
  className,
  intensity = 1,
  animated = true,
  fade = 'radial',
}: {
  variant?: 'contour' | 'grid';
  className?: string;
  /** multiplies line opacity (0.5 = subtler) */
  intensity?: number;
  animated?: boolean;
  fade?: 'radial' | 'top' | 'bottom' | 'none';
}) {
  const mask =
    fade === 'radial'
      ? 'radial-gradient(ellipse 75% 70% at 50% 45%, #000 35%, transparent 100%)'
      : fade === 'top'
        ? 'linear-gradient(to bottom, transparent, #000 30%)'
        : fade === 'bottom'
          ? 'linear-gradient(to top, transparent, #000 30%)'
          : undefined;
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden text-accent', className)}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      {/* hairline coordinate grid */}
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.55 * intensity,
          backgroundImage:
            'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
          backgroundSize: variant === 'grid' ? '48px 48px' : '96px 96px',
        }}
      />
      {variant === 'contour' && (
        <div className={cn('absolute -inset-[4%]', animated && styles.drift)}>
          <div
            className="absolute inset-0"
            style={{
              backgroundColor: 'currentColor',
              opacity: 0.24 * intensity,
              maskImage: CONTOUR_MASK,
              WebkitMaskImage: CONTOUR_MASK,
              maskSize: 'cover',
              WebkitMaskSize: 'cover',
              maskPosition: 'center',
              WebkitMaskPosition: 'center',
              maskRepeat: 'no-repeat',
              WebkitMaskRepeat: 'no-repeat',
            }}
          />
        </div>
      )}
      {variant === 'grid' && (
        <div
          className="absolute inset-0"
          style={{
            opacity: 0.5 * intensity,
            backgroundImage: 'radial-gradient(circle at 1px 1px, var(--border-strong) 1px, transparent 1.5px)',
            backgroundSize: '24px 24px',
          }}
        />
      )}
    </div>
  );
}
