import { useMemo } from 'preact/hooks';
import type { ContribDay, Level } from '@/api/contracts';
import { trimPaddedDays } from '@/utils/trimPaddedDays';
import styles from './ContribGrid.module.css';

const WEEKS = 53;
const DAYS = 7;
const TOTAL_CELLS = WEEKS * DAYS;

type Cell = { key: number; level: Level };

const emptyCells = (): Cell[] =>
  Array.from({ length: TOTAL_CELLS }, (_, key) => ({ key, level: 0 as Level }));

// Map GitHub's flat day list onto the 53 × 7 grid. GitHub's contribution
// calendar returns whole Sun–Sat weeks, padding the final week with zero-count
// future days; `trimPaddedDays` drops those so the anchor is always today (not
// this week's upcoming Saturday). After trimming, today sits at the rightmost
// column at its day-of-week row, and earlier days walk backwards day-by-day.
//
// Internal math uses column-major indexing (week-then-day) so calendar-adjacent
// days are at adjacent indices; the final output is row-major to match the
// CSS grid's `grid-template-columns: repeat(53, 1fr)` flow.
export const gridCellsFromDays = (
  days: ReadonlyArray<ContribDay>,
  now: Date = new Date(),
): Cell[] => {
  const real = trimPaddedDays(days, now);
  if (real.length === 0) return emptyCells();

  const anchor = real[real.length - 1];
  if (!anchor) return emptyCells();

  const anchorMs = Date.parse(`${anchor.date}T00:00:00Z`);
  if (Number.isNaN(anchorMs)) return emptyCells();
  const anchorDow = new Date(anchorMs).getUTCDay();
  const anchorColMajor = (WEEKS - 1) * DAYS + anchorDow;

  const levels: Level[] = new Array<Level>(TOTAL_CELLS).fill(0);
  for (const day of real) {
    const dayMs = Date.parse(`${day.date}T00:00:00Z`);
    if (Number.isNaN(dayMs)) continue;
    const daysAgo = Math.round((anchorMs - dayMs) / 86_400_000);
    const colMajor = anchorColMajor - daysAgo;
    if (colMajor < 0 || colMajor >= TOTAL_CELLS) continue;
    const d = colMajor % DAYS;
    const w = Math.floor(colMajor / DAYS);
    const domIdx = d * WEEKS + w;
    levels[domIdx] = day.level;
  }

  return levels.map((level, key) => ({ key, level }));
};

// Discriminated union over the three render modes. Forces the caller to pass
// all live data together or none of it — illegal states like "sample grid with
// a live total" are unrepresentable.
export type ContribGridProps =
  | { state: 'loading' }
  | { state: 'error'; message?: string | undefined }
  | {
      state: 'live';
      days: ReadonlyArray<ContribDay>;
      total: number;
      streak: number;
    };

const LoadingSkeleton = () => {
  const cells = useMemo(() => Array.from({ length: TOTAL_CELLS }, (_, key) => key), []);
  return (
    <div className={`${styles.contrib} ${styles.loading}`} aria-busy="true" aria-live="polite">
      <div className={styles.head}>
        <span className="muted">loading activity…</span>
        <span className="muted">—</span>
      </div>
      <div className={styles.grid} aria-hidden="true">
        {cells.map(key => (
          <div key={key} className={`${styles.cell} ${styles.cellLoading}`} data-level="0" />
        ))}
      </div>
      <div className={styles.legend}>
        <span className="muted">{'// fetching'}</span>
      </div>
    </div>
  );
};

const ErrorState = ({ message }: { message?: string | undefined }) => (
  <div className={`${styles.contrib} ${styles.errored}`} role="alert">
    <div className={styles.head}>
      <span>Contributions unavailable</span>
    </div>
    <div className={styles.errorBody}>
      <span className="muted">{message ?? 'Failed to load activity'}</span>
    </div>
    <div className={styles.legend}>
      <span className="muted">{'// offline or upstream error'}</span>
    </div>
  </div>
);

interface LiveProps {
  days: ReadonlyArray<ContribDay>;
  total: number;
  streak: number;
}

const LiveGrid = ({ days, total, streak }: LiveProps) => {
  // Recompute only when the underlying days reference changes — 730 Date.parse
  // calls shouldn't run on every parent render.
  const cells = useMemo(() => gridCellsFromDays(days), [days]);
  return (
    <div className={styles.contrib}>
      <div className={styles.head}>
        <span>
          <b>{total.toLocaleString()}</b> contributions · last 12 months
        </span>
        <span>
          <b>{streak}</b> day streak
        </span>
      </div>
      <div className={styles.grid} aria-hidden="true">
        {cells.map(c => (
          <div key={c.key} className={styles.cell} data-level={c.level} />
        ))}
      </div>
      <div className={styles.legend}>
        <span className="muted">{'// live'}</span>
        <span className={styles.scale}>
          less
          <span data-level="0" />
          <span data-level="1" />
          <span data-level="2" />
          <span data-level="3" />
          <span data-level="4" />
          more
        </span>
      </div>
    </div>
  );
};

export const ContribGrid = (props: ContribGridProps) => {
  if (props.state === 'loading') return <LoadingSkeleton />;
  if (props.state === 'error') return <ErrorState message={props.message} />;
  return <LiveGrid days={props.days} total={props.total} streak={props.streak} />;
};
