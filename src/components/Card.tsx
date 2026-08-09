import { type HTMLAttributes, type ReactNode } from 'react';

// Card primitive. Used everywhere a content block needs visual grouping —
// role cards on the RolePicker screen, repo rows on CloneRepos, dashboard tiles.
//
// Props:
//   - selected: visual emphasis (titan-blue ring) for current selection
//   - clickable: cursor pointer + hover lift, used for keyboard-pickable role cards
//
// Composition: callers can pass any children; this only owns surface + spacing.

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  clickable?: boolean;
  children: ReactNode;
}

export default function Card({
  selected = false,
  clickable = false,
  children,
  className = '',
  ...rest
}: CardProps): JSX.Element {
  return (
    <div
      className={[
        'rounded-card bg-titan-white p-6',
        'shadow-card transition-all duration-150',
        // Selected state: 3px titan-blue ring + slight lift
        selected ? 'ring-3 ring-titan-blue-main shadow-card-hover' : '',
        // Clickable: visible cursor change + hover elevation
        clickable ? 'cursor-pointer hover:shadow-card-hover hover:-translate-y-0.5' : '',
        className
      ].join(' ')}
      // Keyboard support for clickable cards — accessible alternative to using
      // <button> (which would inherit all button styling).
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                (e.currentTarget as HTMLDivElement).click();
              }
            }
          : undefined
      }
      {...rest}
    >
      {children}
    </div>
  );
}
