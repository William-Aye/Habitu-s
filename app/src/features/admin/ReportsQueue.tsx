import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { decideReport, listReports, type AdminReport, type ReportDecision } from './api';
import { adminStyles as s, AdminButton, ErrorText, QueueState, useQueue } from './ui';

const MIN = 10;
const MAX = 1000;
const DECISIONS: ReportDecision[] = ['dismiss', 'warn', 'remove', 'ban'];

function ReportCard({
  report,
  busy,
  anyBusy,
  onDecide,
}: {
  report: AdminReport;
  busy: boolean;
  anyBusy: boolean;
  onDecide: (decision: ReportDecision, statement: string) => void;
}) {
  const { t } = useTranslation();
  const [statement, setStatement] = useState('');
  const [confirmBan, setConfirmBan] = useState(false);
  const ready = statement.trim().length >= MIN && statement.trim().length <= MAX;
  const off = !ready || anyBusy;

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{report.preview ?? t('admin.reports.noPreview')}</Text>
      <Text style={s.meta}>{t(`safety.reasons.${report.reason}`, { defaultValue: report.reason })}</Text>
      <Text style={s.meta}>
        {report.source === 'auto'
          ? t('admin.reports.sourceAuto')
          : t('admin.reports.sourceUser', { prenom: report.reporterFirstName ?? t('admin.unknownPerson') })}
      </Text>
      {report.ownerFirstName ? (
        <Text style={s.meta}>{t('admin.reports.owner', { prenom: report.ownerFirstName })}</Text>
      ) : null}
      {report.details ? <Text>{report.details}</Text> : null}
      <Text style={s.label}>{t('admin.reports.statement')}</Text>
      <TextInput
        accessibilityLabel={t('admin.reports.statement')}
        placeholder={t('admin.reports.statement')}
        style={[s.input, s.multiline]}
        multiline
        maxLength={MAX}
        value={statement}
        editable={!anyBusy}
        onChangeText={(v) => {
          setStatement(v);
          setConfirmBan(false);
        }}
      />
      <Text style={s.meta}>{t('admin.reports.statementHelp', { min: MIN, max: MAX })}</Text>
      {confirmBan ? (
        <View style={s.row}>
          <AdminButton
            variant="danger"
            label={t('admin.reports.banConfirm')}
            busy={busy}
            disabled={off}
            onPress={() => onDecide('ban', statement)}
          />
          <AdminButton label={t('admin.cancel')} disabled={anyBusy} onPress={() => setConfirmBan(false)} />
        </View>
      ) : (
        <View style={s.row}>
          {DECISIONS.map((d) => (
            <AdminButton
              key={d}
              label={t(`admin.reports.decisions.${d}`)}
              busy={busy}
              disabled={off}
              variant={d === 'ban' ? 'danger' : 'outline'}
              onPress={() => (d === 'ban' ? setConfirmBan(true) : onDecide(d, statement))}
            />
          ))}
        </View>
      )}
    </View>
  );
}

export function ReportsQueue() {
  const { t } = useTranslation();
  const q = useQueue<AdminReport>(listReports);
  return (
    <>
      <ErrorText code={q.error} />
      <QueueState load={q.load} empty={t('admin.reports.empty')} onRetry={q.reload}>
        {(items) =>
          items.map((r) => (
            <ReportCard
              key={r.id}
              report={r}
              busy={q.busyId === r.id}
              anyBusy={!!q.busyId}
              onDecide={(d, text) => void q.act(r.id, () => decideReport(r.id, d, text))}
            />
          ))
        }
      </QueueState>
    </>
  );
}
