interface Props {
  totalRounds: number;
  currentRound: number;
  completedRounds: number;
  selectedRound: number;
  onSelect: (round: number) => void;
}

export default function RoundTabs({ totalRounds, currentRound, completedRounds, selectedRound, onSelect }: Props) {
  const tabs = [];
  const maxRound = Math.max(totalRounds, completedRounds);

  for (let i = 1; i <= maxRound; i++) {
    const isActive = i === selectedRound;
    const isCurrent = i === currentRound;
    const isCompleted = i <= completedRounds;

    tabs.push(
      <button
        key={i}
        onClick={() => isCompleted && onSelect(i)}
        className={`px-3 py-1 text-xs rounded-t font-medium transition-colors ${
          isActive
            ? 'bg-bg-secondary text-accent border-b-2 border-accent'
            : isCompleted
              ? 'bg-bg-tertiary text-text-secondary hover:text-text-primary cursor-pointer'
              : 'bg-bg-primary text-text-muted cursor-default'
        }`}
        disabled={!isCompleted}
      >
        {isCurrent && !isCompleted ? '\u25CF ' : ''}Round {i}
      </button>
    );
  }

  return (
    <div className="flex gap-1 border-b border-border">
      {tabs}
    </div>
  );
}
