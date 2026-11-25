const icon = (path: string) =>
  function Icon() {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d={path} />
      </svg>
    );
  };

export const Cart = icon('M3 3h2l3 12h11l2-8H6');
export const User = icon('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0');
export const Settings = icon('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z');
