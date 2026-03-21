import * as React from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';

export type ComboboxOption = {
  value: string;
  label: string;
  keywords?: string[];
};

type ComboboxProps = {
  value: string;
  options: ComboboxOption[];
  placeholder: string;
  emptyLabel: string;
  disabled?: boolean;
  heading?: string;
  searchPlaceholder?: string;
  className?: string;
  contentClassName?: string;
  onChange: (value: string) => void;
};

export function Combobox({
  value,
  options,
  placeholder,
  emptyLabel,
  disabled = false,
  heading,
  searchPlaceholder,
  className,
  contentClassName,
  onChange,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selectedOption = React.useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-10 w-full min-w-0 items-center justify-between overflow-hidden rounded-[8px] border border-[hsl(var(--ds-border-1))] bg-[hsl(var(--ds-background-1))] px-3.5 py-2 text-left text-[14px] text-foreground transition-[background-color,border-color,box-shadow] duration-150 hover:border-[hsl(var(--ds-border-2))] hover:bg-[hsl(var(--ds-surface-1))] focus-visible:outline-none focus-visible:border-[hsl(var(--ds-accent-7)/0.44)] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ds-accent-7)/0.16)] disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            {selectedOption?.label ?? (value.trim() ? value : placeholder)}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-[hsl(var(--ds-text-2))]" />
        </button>
      </PopoverTrigger>
      <PopoverContent className={cn('w-[320px] p-0', contentClassName)} align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder ?? placeholder} />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            {heading ? (
              <CommandGroup heading={heading}>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={option.keywords ?? [option.label]}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.value === value && <Check className="size-4 shrink-0 text-[hsl(var(--ds-text-2))]" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              <div className="p-1">
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={option.keywords ?? [option.label]}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.value === value && <Check className="size-4 shrink-0 text-[hsl(var(--ds-text-2))]" />}
                  </CommandItem>
                ))}
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
