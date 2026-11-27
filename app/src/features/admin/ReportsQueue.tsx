import { useCallback, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { decideReport, listReports, type AdminReport, type ReportDecision } from './api';
import { adminStyles as s, AdminButton, DoneNotice, ErrorText, QueueState, useQueue } from './ui';

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
  const cursor = useRef<{ createdAt: string; id: string } | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [paging, setPaging] = useState(false);
  const firstPage = useCallback(async () => {
    const r = await listReports();
    if (!r.ok) return r;
    const last = r.items[r.items.length - 1];
    cursor.current = last ? { createdAt: last.createdAt, id: last.id } : null;
    setHasMore(r.hasMore);
    if (r.priorityOpenCount === 0) return r;
    // Reports about children (or on an activity with children) come first, from their own list.
    const p = await listReports(null, { priority: true });
    if (!p.ok) return r;
    const first = p.items.map((x) => ({ ...x, priority: true }));
    const ids = new Set(first.map((x) => x.id));
    return { ...r, items: [...first, ...r.items.filter((x) => !ids.has(x.id))] };
  }, []);
  const q = useQueue<AdminReport>(firstPage);
  const seen = (id: string) => q.load.state === 'ready' && q.load.items.some((x) => x.id === id);

  const more = async () => {
    if (paging) return;
    setPaging(true);
    try {
      const r = await listReports(cursor.current);
      if (!r.ok) return void (await q.fail(r.error));
      const last = r.items[r.items.length - 1];
      if (last) cursor.current = { createdAt: last.createdAt, id: last.id };
      setHasMore(r.hasMore);
      q.append(r.items.filter((x) => !seen(x.id)));
    } finally {
      setPaging(false);
    }
  };

  return (
    <>
      <ErrorText code={q.error} />
      <DoneNotice show={q.done} />
      <QueueState load={q.load} empty={t('admin.reports.empty')} onRetry={q.reload}>
        {(items) => {
          const card = (r: AdminReport) => (
            <ReportCard
              key={r.id}
              report={r}
              busy={q.busyId === r.id}
              anyBusy={!!q.busyId}
              onDecide={(d, text) => void q.act(r.id, () => decideReport(r.id, d, text))}
            />
          );
          const urgent = items.filter((r) => r.priority);
          if (urgent.length === 0) return items.map(card);
          const others = items.filter((r) => !r.priority);
          return (
            <>
              <Text accessibilityRole="header" style={s.sectionTitle}>{t('admin.reports.priority', { n: urgent.length })}</Text>
              {urgent.map(card)}
              {others.length > 0 ? (
                <Text accessibilityRole="header" style={s.sectionTitle}>{t('admin.reports.others')}</Text>
              ) : null}
              {others.map(card)}
            </>
          );
        }}
      </QueueState>
      {q.load.state === 'ready' && hasMore ? (
        <AdminButton label={t('admin.reports.more')} onPress={() => void more()} disabled={paging || !!q.busyId} />
      ) : null}
    </>
  );
}
