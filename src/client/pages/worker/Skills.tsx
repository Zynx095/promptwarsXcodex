import { useI18n } from '../../lib/i18n';
import { useApi } from '../../lib/useApi';
import type { SkillDTO } from '../../../shared/types';
import { Async, Page } from '../../components/ui';
import { SkillForm, SkillList } from '../../components/SkillList';

export function WorkerSkills() {
  const { t } = useI18n();
  const skills = useApi<{ items: SkillDTO[] }>('/skills/mine');
  return (
    <Page title={t('sk.title')} description={t('sk.intro')}>
      <section aria-label={t('sk.title')}>
        <Async state={skills}>{(d) => <SkillList skills={d.items} />}</Async>
        <p className="passport-note">{t('sk.verifyNote')}</p>
      </section>
      <section className="passport-add" aria-labelledby="skill-add">
        <h2 id="skill-add" className="section-title">
          {t('sk.add')}
        </h2>
        <SkillForm endpoint="/skills" onAdded={skills.reload} successText={t('sk.added')} />
      </section>
    </Page>
  );
}
