import { forwardRef } from 'react';
import clsx from 'clsx';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={clsx(
        'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400',
        'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
