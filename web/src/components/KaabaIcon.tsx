export function KaabaIcon({ size = 24, stroke = 'currentColor' }: { size?: number; stroke?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z" />
      <path d="M4 7.5 12 11l8-3.5" />
      <path d="M12 11v9" />
      <path d="M4 10.5 12 14l8-3.5" strokeWidth={1.4} />
    </svg>
  );
}
