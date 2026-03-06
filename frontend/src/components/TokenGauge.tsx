interface Props {
  estimated: number;
  limit: number;
}

export default function TokenGauge({ estimated, limit }: Props) {
  const pct = Math.min((estimated / limit) * 100, 100);
  const color = pct < 50 ? 'bg-success' : pct < 80 ? 'bg-warning' : 'bg-error';

  return (
    <div className="flex items-center gap-2 text-xs text-text-secondary">
      <span>Tokens:</span>
      <div className="flex-1 h-2 bg-bg-tertiary rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span>{Math.round(estimated / 1000)}k / {Math.round(limit / 1000)}k</span>
    </div>
  );
}
