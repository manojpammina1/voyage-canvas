import type { ButtonHTMLAttributes, HTMLAttributes, PropsWithChildren } from 'react';

export function GlassPanel({
  children,
  active = false,
  className = '',
  ...props
}: PropsWithChildren<
  { active?: boolean; className?: string } & HTMLAttributes<HTMLDivElement>
>) {
  return (
    <div
      className={`glass-panel${active ? ' glass-panel--active' : ''} ${className}`.trim()}
      {...props}
    >
      {children}
    </div>
  );
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
}) {
  const v = variant === 'secondary' ? ' vc-button--secondary' : '';
  return <button className={`vc-button${v} ${className}`.trim()} {...props} />;
}

export function EvidenceBadge({ children }: PropsWithChildren) {
  return <span className="evidence-badge">{children}</span>;
}

export function VisuallyHidden({ children }: PropsWithChildren) {
  return <span className="visually-hidden">{children}</span>;
}

export function LiveRegion({ message }: { message: string }) {
  return (
    <div className="vc-live-region" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
