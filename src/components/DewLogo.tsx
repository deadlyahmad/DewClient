import React from 'react';
import dewClientIcon from '../../icon/DewClient.ico';

interface DewLogoProps {
  size?: 'small' | 'hero';
  label?: string;
}

export const DewLogo: React.FC<DewLogoProps> = ({ size = 'small', label = 'DewClient' }) => {
  return (
    <div className={`dew-logo dew-logo-${size}`} role="img" aria-label={label}>
      <img
        className="dew-logo-image"
        src={dewClientIcon}
        alt=""
        aria-hidden="true"
      />
    </div>
  );
};
