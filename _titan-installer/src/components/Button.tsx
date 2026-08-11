import { type ButtonHTMLAttributes, type ReactNode } from 'react';

// Three button variants matching the plan's design system:
//   - primary: filled titan blue, used for the single primary action per screen
//   - secondary: outlined titan gray, used for "Back" / "Skip"
//   - ghost: text-only, used for tertiary links like "How do I create a PAT?"
//
// All variants share a pill shape (matches lemonade.com aesthetic) and a
// minimum 44×44 hit target for accessibility (WCAG 2.5.5).

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-titan-blue-main text-titan-white hover:bg-titan-blue-deep active:bg-titan-blue-deep ' +
    'disabled:bg-titan-gray-light disabled:text-titan-gray-mid disabled:cursor-not-allowed ' +
    'shadow-card hover:shadow-card-hover',
  secondary:
    'bg-titan-white text-titan-gray-main border-2 border-titan-gray-main ' +
    'hover:bg-titan-gray-light disabled:opacity-50 disabled:cursor-not-allowed',
  ghost:
    'bg-transparent text-titan-blue-main hover:bg-titan-blue-soft ' +
    'disabled:opacity-50 disabled:cursor-not-allowed'
};

// min-h ensures the 44×44 hit-target rule even when the text content is short.
const sizeClasses: Record<Size, string> = {
  sm: 'text-sm px-4 py-2  min-h-[36px]',
  md: 'text-base px-6 py-3  min-h-[44px]',
  lg: 'text-lg font-medium px-8 py-4  min-h-[52px]'
};

export default function Button({
  variant = 'primary',
  size = 'md',
  children,
  className = '',
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      className={[
        'rounded-pill font-medium transition-all duration-150',
        'inline-flex items-center justify-center gap-2',
        variantClasses[variant],
        sizeClasses[size],
        className
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}
