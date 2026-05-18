import React from 'react';

export const SmmLogo: React.FC = () => {
  return (
    <div className="flex items-center justify-center">
      <svg 
        width="32" 
        height="32" 
        viewBox="0 0 32 32" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
        className="text-primary"
      >
        <path 
          d="M8 8.5C8 7.11929 9.11929 6 10.5 6H21.5C22.8807 6 24 7.11929 24 8.5V23.5C24 24.8807 22.8807 26 21.5 26H10.5C9.11929 26 8 24.8807 8 23.5V8.5Z" 
          stroke="currentColor" 
          strokeWidth="2"
        />
        <path 
          d="M12 14H20" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round"
        />
        <path 
          d="M12 18H20" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round"
        />
        <path 
          d="M12 10H16" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
};
