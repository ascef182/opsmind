import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full min-w-0 rounded-md border border-input bg-input/30 px-3 py-2 text-sm text-foreground shadow-xs outline-none transition-colors placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
