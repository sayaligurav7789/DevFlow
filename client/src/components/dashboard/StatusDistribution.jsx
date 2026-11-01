import { STATUSES, STATUS_COLORS } from '../../lib/constants.js';

// Stacked bar + legend. The legend repeats every number as text, so the chart never relies on color alone.
export function StatusDistribution({ byStatus, total }) {
  const summary = STATUSES.map((s) => `${s.label} ${byStatus[s.value]}`).join(', ');
  return (
    <div>
      <div
        role="img"
        aria-label={`Task distribution by status, ${total} tasks: ${summary}`}
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-hover"
      >
        {STATUSES.map((s) => (byStatus[s.value] > 0 ? (
          <div key={s.value} style={{ width: `${(byStatus[s.value] / total) * 100}%`, background: STATUS_COLORS[s.value] }} />
        ) : null))}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
        {STATUSES.map((s) => {
          const count = byStatus[s.value];
          return (
            <li key={s.value} className="min-w-0">
              <p className="flex items-center gap-2 text-[12.5px] text-muted">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: STATUS_COLORS[s.value] }} />
                <span className="truncate">{s.label}</span>
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-fg">
                {count}
                <span className="sr-only">, </span>
                <span className="ml-1.5 text-[12px] font-normal text-faint">{Math.round((count / total) * 100)}%</span>
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
