import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  decideCategory,
  listCategories,
  listCategoryRequests,
  type AdminCategoryRequest,
  type CategoryOption,
} from './api';
import { adminStyles as s, AdminButton, ErrorText, QueueState, useQueue } from './ui';

function Choices({ label, options, value, onChange }: { label: string; options: CategoryOption[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>{label}</Text>
      <View style={s.row}>
        {options.map((c) => (
          <Pressable
            key={c.id}
            accessibilityRole="radio"
            accessibilityLabel={c.nameFr}
            accessibilityState={{ selected: value === c.id }}
            style={[s.choice, value === c.id && s.chosen]}
            onPress={() => onChange(c.id)}
          >
            <Text>{c.nameFr}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function RequestCard({
  request,
  roots,
  all,
  busy,
  anyBusy,
  onDecide,
}: {
  request: AdminCategoryRequest;
  roots: CategoryOption[];
  all: CategoryOption[];
  busy: boolean;
  anyBusy: boolean;
  onDecide: (action: 'approve' | 'merge' | 'reject', opts?: { parent?: string; nameEn?: string; into?: string }) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'approve' | 'merge' | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [into, setInto] = useState<string | null>(null);
  const [nameEn, setNameEn] = useState('');
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{request.requestedName}</Text>
      <Text style={s.meta}>{t('admin.categories.by', { prenom: request.requesterFirstName ?? t('admin.unknownPerson') })}</Text>
      {mode === 'approve' ? (
        <>
          <Choices label={t('admin.categories.parent')} options={roots} value={parent} onChange={setParent} />
          <TextInput
            accessibilityLabel={t('admin.categories.nameEn')}
            placeholder={t('admin.categories.nameEn')}
            style={s.input}
            maxLength={80}
            value={nameEn}
            onChangeText={setNameEn}
          />
          <View style={s.row}>
            <AdminButton
              variant="primary"
              label={t('admin.categories.approveConfirm')}
              busy={busy}
              disabled={!parent || nameEn.trim().length < 2 || anyBusy}
              onPress={() => parent && onDecide('approve', { parent, nameEn })}
            />
            <AdminButton label={t('admin.cancel')} disabled={anyBusy} onPress={() => setMode(null)} />
          </View>
        </>
      ) : mode === 'merge' ? (
        <>
          <Choices label={t('admin.categories.mergeInto')} options={all} value={into} onChange={setInto} />
          <View style={s.row}>
            <AdminButton
              variant="primary"
              label={t('admin.categories.mergeConfirm')}
              busy={busy}
              disabled={!into || anyBusy}
              onPress={() => into && onDecide('merge', { into })}
            />
            <AdminButton label={t('admin.cancel')} disabled={anyBusy} onPress={() => setMode(null)} />
          </View>
        </>
      ) : (
        <View style={s.row}>
          <AdminButton variant="primary" label={t('admin.approve')} disabled={anyBusy} onPress={() => setMode('approve')} />
          <AdminButton label={t('admin.categories.merge')} disabled={anyBusy} onPress={() => setMode('merge')} />
          <AdminButton label={t('admin.reject')} busy={busy} disabled={anyBusy} onPress={() => onDecide('reject')} />
        </View>
      )}
    </View>
  );
}

export function CategoriesQueue() {
  const { t } = useTranslation();
  const q = useQueue<AdminCategoryRequest>(listCategoryRequests);
  const [cats, setCats] = useState<{ roots: CategoryOption[]; all: CategoryOption[] }>({ roots: [], all: [] });
  useEffect(() => {
    let active = true;
    void listCategories().then((r) => active && r.ok && setCats({ roots: r.roots, all: r.all }));
    return () => {
      active = false;
    };
  }, []);
  return (
    <>
      <ErrorText code={q.error} />
      <QueueState load={q.load} empty={t('admin.categories.empty')} onRetry={q.reload}>
        {(items) =>
          items.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              roots={cats.roots}
              all={cats.all}
              busy={q.busyId === r.id}
              anyBusy={!!q.busyId}
              onDecide={(action, opts) => void q.act(r.id, () => decideCategory(r.id, action, opts))}
            />
          ))
        }
      </QueueState>
    </>
  );
}
