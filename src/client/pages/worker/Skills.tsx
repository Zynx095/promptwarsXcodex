import { useI18n } from '../../lib/i18n';
import { useApi } from '../../lib/useApi';
import type { SkillDTO } from '../../../shared/types';
import { Async, Card, Page } from '../../components/ui';
import { SkillForm, SkillList } from '../../components/SkillList';

export function WorkerSkills() {
  const { t } = useI18n();
  const skills = useApi<{ items: SkillDTO[] }>('/skills/mine');
  return (
    <Page title={t('sk.title')}>
      <p>{t('sk.intro')}</p>
      <Card>
        <Async state={skills}>{(d) => <SkillList skills={d.items} />}</Async>
        <p className="muted small">{t('sk.verifyNote')}</p>
      </Card>
      <Card title={t('sk.add')}>
        <SkillForm endpoint="/skills" onAdded={skills.reload} successText={t('sk.added')} />
      </Card>
    </Page>
  );
}
