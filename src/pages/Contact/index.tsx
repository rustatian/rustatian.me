import { Seo } from '@/components/Seo/Seo';
import { PageHeader } from '@/components/ui/PageHeader';
import { CcLink, CcRow } from '@/components/ui/SocialLink';
import { EMAIL } from '@/constants';
import { PROFILE, SOCIALS } from '@/data/profile';
import styles from './Contact.module.css';

const Contact = () => (
  <>
    <Seo
      title="contact · rustatian"
      description="Say hello — best reached by email for anything substantive, or by GitHub, LinkedIn, Twitch, YouTube for short-form."
    />

    <PageHeader
      eyebrow="contact"
      title="Say hello."
      lead="Best reached by email for anything substantive, or by the usual platforms for short-form."
    />

    <div className={`container route-enter ${styles.page}`}>
      <section aria-labelledby="cc-head">
        <div className={styles.cc}>
          <div className={styles.ccHead}>
            <div className={styles.ccMark} id="cc-head">
              <span className={styles.ccPrompt}>~</span>
              <span className={styles.ccName}>{PROFILE.handle}</span>
            </div>
            <div className={styles.ccStatus}>
              <span className="dot" aria-hidden />
              available
            </div>
          </div>

          <div className={styles.ccGrid}>
            <CcRow label="email" value={EMAIL} href={`mailto:${EMAIL}`} />
            <CcRow label="location" value={PROFILE.location} />
            <CcRow label="timezone" value="Europe/Warsaw · UTC+1" />
          </div>

          <div className={styles.ccRule} />

          <div className={styles.ccLinks}>
            {SOCIALS.map(s => (
              <CcLink key={s.label} social={s} />
            ))}
          </div>
        </div>
      </section>
    </div>
  </>
);

export { Contact };
