'use client';

import { useEffect, useState } from 'react';

interface ResilientImageProps {
  src: string;
  alt: string;
  className?: string;
  fallbackTitle?: string;
}

export function ResilientImage({
  src,
  alt,
  className = '',
  fallbackTitle = 'Deshi Gee',
}: ResilientImageProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex flex-col items-center justify-center gap-3 bg-[#F2ECE1] text-[#635647] p-6 text-center ${className}`}
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 40 40"
          fill="none"
          aria-hidden="true"
          className="text-[#B47B2B]"
        >
          <rect
            x="11"
            y="6"
            width="18"
            height="4.5"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.75"
          />
          <path
            d="M12 10.5H28L30 14.5V31.5C30 33.1569 28.6569 34.5 27 34.5H13C11.3431 34.5 10 33.1569 10 31.5V14.5L12 10.5Z"
            stroke="currentColor"
            strokeWidth="1.75"
          />
          <path
            d="M10.5 21H29.5"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeOpacity="0.45"
          />
        </svg>
        <span className="font-serif text-sm font-medium text-[#1E1710]">
          {fallbackTitle}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
