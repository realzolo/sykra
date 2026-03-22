'use client';

import { useMemo, useState } from 'react';
import { User } from 'lucide-react';

import { cn } from '@/lib/utils';

type UserAvatarProps = {
  src?: string | null;
  name?: string | null;
  email?: string | null;
  size?: number;
  className?: string;
};

function getInitials(label?: string | null) {
  if (!label) return '';
  const words = label
    .split(/[\s._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (words.length === 0) return '';
  if (words.length === 1) {
    return words[0]?.slice(0, 2).toUpperCase() ?? '';
  }

  return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
}

export default function UserAvatar({
  src,
  name,
  email,
  size = 32,
  className,
}: UserAvatarProps) {
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);
  const initials = useMemo(() => getInitials(name ?? email), [email, name]);
  const dimension = `${size}px`;

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[hsl(var(--ds-surface-3))]',
        className,
      )}
      style={{ width: dimension, height: dimension }}
    >
      {src && erroredSrc !== src ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          onError={() => setErroredSrc(src)}
        />
      ) : initials ? (
        <span className="text-[10px] font-semibold tracking-[0.02em] text-[hsl(var(--ds-text-2))]">
          {initials}
        </span>
      ) : (
        <User className="size-1/2 text-[hsl(var(--ds-text-2))]" />
      )}
    </span>
  );
}
