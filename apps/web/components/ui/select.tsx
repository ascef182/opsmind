import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-9 w-full rounded-md border border-input bg-input/30 px-3 py-1 text-sm text-foreground outline-none transition-colors',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
