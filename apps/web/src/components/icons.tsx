/** Inline 24px stroke icons — no icon package, no network request, currentColor only. */
export type IconName =
  | 'market'
  | 'search'
  | 'plus'
  | 'orders'
  | 'profile'
  | 'bell'
  | 'chat'
  | 'timer'
  | 'check'
  | 'close'
  | 'chevron';

const PATHS: Record<IconName, string> = {
  market: 'M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14m5.5 12.5L21 21',
  plus: 'M12 5v14M5 12h14',
  orders: 'M5 4h14v16l-3-2-2 2-2-2-2 2-3-2zM9 9h6M9 13h6',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8m-8 8c0-3.3 3.6-6 8-6s8 2.7 8 6',
  bell: 'M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9M10 19a2 2 0 0 0 4 0',
  chat: 'M4 5h16v11H9l-4 4V5z',
  timer: 'M12 8v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
  check: 'm5 13 4 4L19 7',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'm9 6 6 6-6 6',
};

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 24, className }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
