import { forwardRef } from 'react';
import clsx from 'clsx';

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={clsx(
        'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900',
        'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
