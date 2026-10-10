import React from 'react';

interface MicrosoftLogoProps {
  size?: number;
  className?: string;
}

/**
 * Official Microsoft 4-Color Brand Vector Asset
 */
export const MicrosoftLogo: React.FC<MicrosoftLogoProps> = ({ size = 18, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 21 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
};
