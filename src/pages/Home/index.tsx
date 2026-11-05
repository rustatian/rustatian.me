import { useEffect } from 'preact/hooks';
import type { GitHubUser } from '@/api/githubRequests';
import { Seo } from '@/components/Seo/Seo';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { ContribGrid, type ContribGridProps } from '@/components/ui/ContribGrid';
import { SectionHead } from '@/components/ui/SectionHead';
import { StatCard } from '@/components/ui/StatCard';
import { PROFILE, STAT_DEFS, type Stat, type StatKey, TECH } from '@/data/profile';
import { useGitHubContributions, useGitHubUser } from '@/hooks/useGitHub';
import { useSetError } from '@/state/appContext/appContext';
import { computeStreak } from '@/utils/computeStreak';
import styles from './Home.module.css';

type UserLike = Pick<GitHubUser, 'login' | 'public_repos' | 'followers' | 'following'>;
type StatMode = 'loading' | 'error' | 'live';

const PLACEHOLDER_DELTA: Record<Exclude<StatMode, 'live'>, string> = {
  loading: 'loading…',
  error: 'err',
};

const statsFor = (mode: StatMode, user: UserLike | undefined): Stat[] => {
  if (mode === 'live' && user) {
    const live: Record<StatKey, Pick<Stat, 'value' | 'delta'>> = {
      public_repos: { value: String(user.public_repos), delta: `@${user.login}` },
      followers: { value: String(user.followers), delta: 'live' },
      following: { value: String(user.following), delta: 'live' },
    };
    return STAT_DEFS.map(d => ({ ...d, ...live[d.key] }));
  }
  const placeholder = {
    value: '—',
    delta: PLACEHOLDER_DELTA[mode === 'error' ? 'error' : 'loading'],
  };
  return STAT_DEFS.map(d => ({ ...d, ...placeholder }));
};

const Home = () => {
  const userQuery = useGitHubUser();
  const contribQuery = useGitHubContributions();
  const setError = useSetError();

  // Relay both queries' errors into the global toast. Home is the only page
  // that fetches these, so the relay is scoped here instead of firing requests
  // on /about and /contact where the data isn't shown.
  useEffect(() => {
    if (userQuery.isError && userQuery.error) {
      setError(userQuery.error);
      return;
    }
    if (contribQuery.isError && contribQuery.error) {
      setError(contribQuery.error);
    }
  }, [userQuery.isError, userQuery.error, contribQuery.isError, contribQuery.error, setError]);

  const statMode: StatMode = userQuery.isError ? 'error' : userQuery.data ? 'live' : 'loading';
  const stats = statsFor(statMode, userQuery.data);
  const metaNote = userQuery.data
    ? `// @${userQuery.data.login} · live`
    : userQuery.isError
      ? '// upstream error'
      : '// loading /api/v1/github/user';

  const contribProps: ContribGridProps = contribQuery.data
    ? {
        state: 'live',
        days: contribQuery.data.days,
        total: contribQuery.data.totalContributions,
        streak: computeStreak(contribQuery.data.days),
      }
    : contribQuery.isError
      ? { state: 'error', message: contribQuery.error?.message }
      : { state: 'loading' };

  return (
    <>
      <Seo title="rustatian — home" description={PROFILE.bio} />

      <div className={`container route-enter ${styles.page}`}>
        <section className={styles.hero} aria-label="Intro">
          <div>
            <h1 className={styles.bio}>{PROFILE.bio}</h1>
            <div className={styles.actions}>
              <ButtonLink variant="primary" href="/about">
                about <span aria-hidden>→</span>
              </ButtonLink>
              <ButtonLink variant="ghost" href="/contact">
                get in touch
              </ButtonLink>
            </div>
            <div className={styles.meta}>
              <div>
                <div className="label">Location</div>
                <div className={styles.metaVal}>{PROFILE.location}</div>
              </div>
              <div>
                <div className="label">Experience</div>
                <div className={styles.metaVal}>
                  <b>{PROFILE.years}</b> years
                </div>
              </div>
              <div>
                <div className="label">Primary</div>
                <div className={styles.metaVal}>Go · Python</div>
              </div>
            </div>
          </div>
          <ContribGrid {...contribProps} />
        </section>

        <section aria-labelledby="stats-head">
          <SectionHead id="stats-head" title="GitHub, at a glance" meta={metaNote} />
          <div className={styles.stats}>
            {stats.map(s => (
              <StatCard
                key={s.key}
                label={s.label}
                value={s.value}
                accent={s.accent}
                delta={s.delta}
              />
            ))}
          </div>
        </section>

        <section aria-labelledby="tech-head">
          <SectionHead id="tech-head" title="Tech stack" meta="// things I reach for first" />
          <div className={styles.badges}>
            {TECH.map(t => (
              <Badge key={t.label} variant={t.variant}>
                {t.label}
              </Badge>
            ))}
          </div>
        </section>
      </div>
    </>
  );
};

export { Home };
