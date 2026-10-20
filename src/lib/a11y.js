// Shared props for clickable non-button elements so they are keyboard
// accessible (role, focus, Enter/Space activation).
export function clickableProps(onClick) {
  return {
    role: 'button',
    tabIndex: 0,
    onClick,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    },
  };
}
