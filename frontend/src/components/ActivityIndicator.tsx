import { useActivityTimer, formatTime } from '../hooks/useActivityTimer';

interface Props {
  isActive: boolean;
}

export default function ActivityIndicator({ isActive }: Props) {
  const { elapsed, total } = useActivityTimer(isActive);

  return (
    <div className="flex items-center gap-1.5 text-xs font-mono">
      <div
        className={`w-2.5 h-2.5 rounded-sm ${
          isActive ? 'bg-success animate-pulse' : 'bg-text-muted/40'
        }`}
      />
      {isActive ? (
        <span className="text-success">{formatTime(elapsed)}</span>
      ) : (
        <span className="text-text-muted">--:--</span>
      )}
      {total > 0 && (
        <span className="text-text-muted">(total {formatTime(total + (isActive ? elapsed : 0))})</span>
      )}
    </div>
  );
}
