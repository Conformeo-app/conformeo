import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions
} from 'react-native';
import {
  CalendarList,
  CalendarProvider,
  LocaleConfig,
  Timeline,
  WeekCalendar
} from 'react-native-calendars';
import type { TimelineEventProps, TimelineProps } from 'react-native-calendars';
import { useAuth } from '../../core/auth';
import {
  buildDayRange,
  buildWeekRange,
  clampEndFromStart,
  formatDateFr,
  formatHourMinute,
  kindColor,
  kindLabel,
  normalizeIsoInput,
  normalizeUserText,
  planningEvents,
  PlanningEvent,
  PlanningEventKind,
  PlanningIndicators,
  PlanningListFilters,
  PlanningViewMode,
  toDayKey,
  toNullableInput
} from '../../data/planning';
import { isProjectReadOnly } from '../../data/control-mode';
import { useSyncStatus } from '../../data/sync/useSyncStatus';
import { useAppNavigationContext } from '../../navigation/contextStore';
import { Badge } from '../../ui/components/Badge';
import { Button } from '../../ui/components/Button';
import { Card } from '../../ui/components/Card';
import { Chip } from '../../ui/components/Chip';
import { EmptyState } from '../../ui/components/EmptyState';
import { Fab } from '../../ui/components/Fab';
import { Icon } from '../../ui/components/Icon';
import { KpiCard } from '../../ui/components/KpiCard';
import { OfflineBanner } from '../../ui/components/OfflineBanner';
import { SearchInput } from '../../ui/components/SearchInput';
import { SectionHeader } from '../../ui/components/SectionHeader';
import { SegmentedControl } from '../../ui/components/SegmentedControl';
import { SyncStatusBadge } from '../../ui/components/SyncStatusBadge';
import { Text } from '../../ui/components/Text';
import { TextField } from '../../ui/components/TextField';
import { DrawerPanel } from '../../ui/layout/DrawerPanel';
import { Screen } from '../../ui/layout/Screen';
import { SplitView } from '../../ui/layout/SplitView';
import { useTheme } from '../../ui/theme/ThemeProvider';

type FilterKey = 'ALL' | 'PROJECT' | 'TEAM' | 'CONTROL' | 'DOC' | 'MINE';

type EventDraft = {
  title: string;
  description: string;
  kind: PlanningEventKind;
  startAt: string;
  endAt: string;
  assigneeUserId: string;
  teamId: string;
  projectId: string;
  urgent: boolean;
};

const WIDE_BREAKPOINT = 1120;

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'ALL', label: 'Tous' },
  { key: 'PROJECT', label: 'Chantier' },
  { key: 'TEAM', label: 'Équipe' },
  { key: 'CONTROL', label: 'Contrôles' },
  { key: 'DOC', label: 'Docs' },
  { key: 'MINE', label: 'Mes tâches' }
];

const VIEW_OPTIONS: Array<{ key: PlanningViewMode; label: string }> = [
  { key: 'DAY', label: 'Jour' },
  { key: 'WEEK', label: 'Semaine' },
  { key: 'MONTH', label: 'Mois' }
];

LocaleConfig.locales.fr = {
  ...(LocaleConfig.locales.fr ?? {}),
  monthNames: [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre'
  ],
  monthNamesShort: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  dayNames: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  dayNamesShort: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
  today: "Aujourd'hui"
};
LocaleConfig.defaultLocale = 'fr';

function startOfMonth(date: Date) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfMonth(date: Date) {
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  d.setHours(23, 59, 59, 999);
  return d;
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateFromKey(dayKey: string) {
  const parsed = Date.parse(`${dayKey}T00:00:00`);
  if (!Number.isFinite(parsed)) {
    return new Date();
  }
  return new Date(parsed);
}

function addDaysFromKey(dayKey: string, delta: number) {
  const base = dateFromKey(dayKey);
  const next = new Date(base);
  next.setDate(base.getDate() + delta);
  return toDateKey(next);
}

function buildTimelineDates(dayKey: string, numberOfDays: number) {
  return Array.from({ length: numberOfDays }, (_, index) => addDaysFromKey(dayKey, index));
}

function formatDateKey(dayKey: string) {
  const date = dateFromKey(dayKey);
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long'
  });
}

function getRangeForView(viewMode: PlanningViewMode, dayKey: string) {
  const baseDate = dateFromKey(dayKey);

  if (viewMode === 'DAY') {
    return buildDayRange(baseDate);
  }

  if (viewMode === 'WEEK') {
    return buildWeekRange(baseDate);
  }

  const start = startOfMonth(baseDate).toISOString();
  const end = endOfMonth(baseDate).toISOString();
  return { start, end };
}

function createDraftFromDate(dayKey: string, projectId?: string): EventDraft {
  const startAt = normalizeIsoInput(`${dayKey}T08:00:00`) ?? new Date().toISOString();
  return {
    title: '',
    description: '',
    kind: 'TASK',
    startAt,
    endAt: clampEndFromStart(startAt, 60),
    assigneeUserId: '',
    teamId: '',
    projectId: projectId ?? '',
    urgent: false
  };
}

function toDraft(event: PlanningEvent): EventDraft {
  return {
    title: event.title,
    description: event.description ?? '',
    kind: event.kind,
    startAt: event.start_at,
    endAt: event.end_at,
    assigneeUserId: event.assignee_user_id ?? '',
    teamId: event.team_id ?? '',
    projectId: event.project_id ?? '',
    urgent: event.is_urgent
  };
}

function toTimelineStart(timeString: string, fallbackDayKey: string) {
  const source = normalizeUserText(timeString);
  if (!source) {
    return normalizeIsoInput(`${fallbackDayKey}T08:00:00`) ?? new Date().toISOString();
  }

  const normalized = source.includes(' ') ? source.replace(' ', 'T') : source;
  return normalizeIsoInput(normalized) ?? normalizeIsoInput(`${fallbackDayKey}T08:00:00`) ?? new Date().toISOString();
}

function resolveFilters(activeFilter: FilterKey, userId?: string, q?: string): PlanningListFilters {
  const query = normalizeUserText(q ?? '');
  const base: PlanningListFilters = query.length > 0 ? { q: query } : {};

  if (activeFilter === 'PROJECT') {
    return { ...base, kinds: ['PROJECT'] };
  }

  if (activeFilter === 'TEAM') {
    return { ...base, kinds: ['TEAM'] };
  }

  if (activeFilter === 'CONTROL') {
    return { ...base, kinds: ['CONTROL'] };
  }

  if (activeFilter === 'DOC') {
    return { ...base, kinds: ['DOC'] };
  }

  if (activeFilter === 'MINE' && userId) {
    return { ...base, kinds: ['TASK'], onlyMineUserId: userId };
  }

  return base;
}

function toSyncState(
  phase: 'idle' | 'syncing' | 'offline' | 'error',
  queueDepth: number,
  deadLetterCount: number
): 'SYNCED' | 'PENDING' | 'FAILED' {
  if (phase === 'error' || deadLetterCount > 0) {
    return 'FAILED';
  }
  if (phase === 'syncing' || queueDepth > 0) {
    return 'PENDING';
  }
  return 'SYNCED';
}

function emptyIndicators(): PlanningIndicators {
  return {
    weekEventsCount: 0,
    urgentCount: 0,
    mineCount: 0,
    todayCount: 0,
    pendingOpsCount: 0
  };
}

export function PlanningScreen() {
  const { colors, spacing, radii } = useTheme();
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;

  const { activeOrgId, user } = useAuth();
  const { projectId: contextProjectId } = useAppNavigationContext();
  const { status: syncStatus } = useSyncStatus();

  const [viewMode, setViewMode] = useState<PlanningViewMode>('DAY');
  const [anchorDate, setAnchorDate] = useState(toDateKey(new Date()));
  const [activeFilter, setActiveFilter] = useState<FilterKey>('ALL');
  const [query, setQuery] = useState('');

  const [events, setEvents] = useState<PlanningEvent[]>([]);
  const [indicators, setIndicators] = useState<PlanningIndicators>(emptyIndicators());

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createVisible, setCreateVisible] = useState(false);
  const [createDraft, setCreateDraft] = useState<EventDraft>(() => createDraftFromDate(toDateKey(new Date())));

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [detailDraft, setDetailDraft] = useState<EventDraft | null>(null);
  const [mobilePanelVisible, setMobilePanelVisible] = useState(false);

  const [readOnlyMode, setReadOnlyMode] = useState(false);

  const selectedEvent = useMemo(() => {
    return selectedEventId ? events.find((event) => event.id === selectedEventId) ?? null : null;
  }, [events, selectedEventId]);

  const range = useMemo(() => getRangeForView(viewMode, anchorDate), [viewMode, anchorDate]);

  const filters = useMemo(() => resolveFilters(activeFilter, user?.id, query), [activeFilter, query, user?.id]);

  useEffect(() => {
    setCreateDraft((current) => {
      if (current.projectId || !contextProjectId) {
        return current;
      }
      return { ...current, projectId: contextProjectId };
    });
  }, [contextProjectId]);

  useEffect(() => {
    let mounted = true;

    async function checkReadOnly() {
      if (!activeOrgId || !contextProjectId) {
        if (mounted) {
          setReadOnlyMode(false);
        }
        return;
      }

      try {
        const readOnly = await isProjectReadOnly(activeOrgId, contextProjectId);
        if (mounted) {
          setReadOnlyMode(readOnly);
        }
      } catch {
        if (mounted) {
          setReadOnlyMode(false);
        }
      }
    }

    void checkReadOnly();

    return () => {
      mounted = false;
    };
  }, [activeOrgId, contextProjectId]);

  const refresh = useCallback(async () => {
    if (!activeOrgId) {
      setEvents([]);
      setIndicators(emptyIndicators());
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [rows, nextIndicators] = await Promise.all([
        planningEvents.listRange(activeOrgId, range.start, range.end, filters),
        planningEvents.getIndicators(activeOrgId, user?.id)
      ]);

      setEvents(rows);
      setIndicators(nextIndicators);
      setSelectedEventId((current) => (current && rows.some((event) => event.id === current) ? current : null));

      if (__DEV__) {
        console.log('[PLANNING] refresh', {
          orgId: activeOrgId,
          range,
          filter: activeFilter,
          count: rows.length
        });
      }
    } catch (refreshError) {
      const message =
        refreshError instanceof Error ? refreshError.message : 'Impossible de charger le planning en local.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [activeFilter, activeOrgId, filters, range, user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedEvent) {
      setDetailDraft(null);
      return;
    }
    setDetailDraft(toDraft(selectedEvent));
  }, [selectedEvent]);

  const syncState = useMemo(
    () => toSyncState(syncStatus.phase, syncStatus.queueDepth, syncStatus.deadLetterCount),
    [syncStatus.deadLetterCount, syncStatus.phase, syncStatus.queueDepth]
  );

  const timelineEvents = useMemo<TimelineProps['events']>(() => {
    return events.map((event) => ({
      id: event.id,
      start: event.start_at,
      end: event.end_at,
      title: event.title,
      summary: kindLabel(event.kind),
      color: kindColor(event.kind)
    }));
  }, [events]);

  const eventsByDay = useMemo(() => {
    const grouped: Record<string, PlanningEvent[]> = {};

    for (const event of events) {
      const dayKey = toDayKey(event.start_at);
      if (!dayKey) {
        continue;
      }
      const bucket = grouped[dayKey] ?? [];
      bucket.push(event);
      grouped[dayKey] = bucket;
    }

    for (const dayKey of Object.keys(grouped)) {
      grouped[dayKey].sort((left, right) => Date.parse(left.start_at) - Date.parse(right.start_at));
    }

    return grouped;
  }, [events]);

  const markedDates = useMemo(() => {
    const result: Record<
      string,
      {
        selected?: boolean;
        selectedColor?: string;
        dots?: Array<{ key: string; color: string }>;
        marked?: boolean;
      }
    > = {};

    for (const event of events) {
      const dayKey = toDayKey(event.start_at);
      if (!dayKey) {
        continue;
      }

      const color = kindColor(event.kind);
      const dotKey = `${event.kind}-${color}`;
      const existing = result[dayKey]?.dots ?? [];
      if (!existing.some((dot) => dot.key === dotKey)) {
        existing.push({ key: dotKey, color });
      }

      result[dayKey] = {
        ...result[dayKey],
        marked: true,
        dots: existing
      };
    }

    result[anchorDate] = {
      ...(result[anchorDate] ?? {}),
      selected: true,
      selectedColor: colors.primary,
      dots: result[anchorDate]?.dots ?? []
    };

    return result;
  }, [anchorDate, colors.primary, events]);

  const openCreatePanel = useCallback(
    (startAtIso?: string) => {
      const targetDay = startAtIso ? toDayKey(startAtIso) || anchorDate : anchorDate;
      const baseDraft = createDraftFromDate(targetDay, contextProjectId ?? undefined);
      const normalizedStart = startAtIso && normalizeIsoInput(startAtIso);

      setCreateDraft(
        normalizedStart
          ? {
              ...baseDraft,
              startAt: normalizedStart,
              endAt: clampEndFromStart(normalizedStart, 60)
            }
          : baseDraft
      );
      setCreateVisible(true);
    },
    [anchorDate, contextProjectId]
  );

  const onTimelineEventPress = useCallback(
    (timelineEvent: TimelineEventProps) => {
      const id = typeof timelineEvent.id === 'string' ? timelineEvent.id : null;
      if (!id) {
        return;
      }

      setSelectedEventId(id);
      if (!isWide) {
        setMobilePanelVisible(true);
      }
    },
    [isWide]
  );

  const onTimelineLongPress = useCallback(
    (timeString: string) => {
      const startAt = toTimelineStart(timeString, anchorDate);
      openCreatePanel(startAt);
    },
    [anchorDate, openCreatePanel]
  );

  const submitCreate = useCallback(async () => {
    if (!activeOrgId || !user?.id) {
      setError('Session invalide : utilisateur ou organisation manquante.');
      return;
    }

    if (readOnlyMode) {
      setError('Lecture seule (mode contrôle).');
      return;
    }

    const title = normalizeUserText(createDraft.title);
    const startAt = normalizeIsoInput(createDraft.startAt);
    const endAt = normalizeIsoInput(createDraft.endAt);

    if (!title) {
      setError('Le titre est obligatoire.');
      return;
    }
    if (!startAt || !endAt) {
      setError('Les dates de début et de fin sont invalides.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const created = await planningEvents.create({
        org_id: activeOrgId,
        project_id: toNullableInput(createDraft.projectId) ?? contextProjectId ?? undefined,
        title,
        description: toNullableInput(createDraft.description) ?? undefined,
        kind: createDraft.kind,
        start_at: startAt,
        end_at: endAt,
        assignee_user_id: toNullableInput(createDraft.assigneeUserId) ?? undefined,
        team_id: toNullableInput(createDraft.teamId) ?? undefined,
        is_urgent: createDraft.urgent,
        created_by: user.id
      });

      setCreateVisible(false);
      setSelectedEventId(created.id);
      await refresh();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Création impossible.';
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [activeOrgId, contextProjectId, createDraft, readOnlyMode, refresh, user?.id]);

  const submitUpdate = useCallback(async () => {
    if (!selectedEvent || !detailDraft) {
      return;
    }

    if (readOnlyMode) {
      setError('Lecture seule (mode contrôle).');
      return;
    }

    const title = normalizeUserText(detailDraft.title);
    const startAt = normalizeIsoInput(detailDraft.startAt);
    const endAt = normalizeIsoInput(detailDraft.endAt);

    if (!title) {
      setError('Le titre est obligatoire.');
      return;
    }
    if (!startAt || !endAt) {
      setError('Les dates de début et de fin sont invalides.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await planningEvents.update(selectedEvent.id, {
        title,
        description: toNullableInput(detailDraft.description),
        kind: detailDraft.kind,
        start_at: startAt,
        end_at: endAt,
        assignee_user_id: toNullableInput(detailDraft.assigneeUserId),
        team_id: toNullableInput(detailDraft.teamId),
        project_id: toNullableInput(detailDraft.projectId),
        is_urgent: detailDraft.urgent
      });

      await refresh();
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : 'Mise à jour impossible.';
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [detailDraft, readOnlyMode, refresh, selectedEvent]);

  const removeSelected = useCallback(async () => {
    if (!selectedEvent) {
      return;
    }

    if (readOnlyMode) {
      setError('Lecture seule (mode contrôle).');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await planningEvents.remove(selectedEvent.id);
      setSelectedEventId(null);
      setMobilePanelVisible(false);
      await refresh();
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : 'Suppression impossible.';
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [readOnlyMode, refresh, selectedEvent]);

  const renderCalendarContent = () => {
    if (viewMode === 'MONTH') {
      return (
        <CalendarList
          current={anchorDate}
          onDayPress={(day) => setAnchorDate(day.dateString)}
          markedDates={markedDates}
          markingType="multi-dot"
          firstDay={1}
          pastScrollRange={12}
          futureScrollRange={12}
          hideExtraDays={false}
          enableSwipeMonths
          theme={{
            calendarBackground: colors.surface,
            dayTextColor: colors.text,
            monthTextColor: colors.text,
            textSectionTitleColor: colors.mutedText,
            todayTextColor: colors.primary,
            arrowColor: colors.primary,
            selectedDayTextColor: colors.onPrimary,
            selectedDayBackgroundColor: colors.primary
          }}
        />
      );
    }

    if (viewMode === 'WEEK') {
      const baseDateKey = toDayKey(range.start) || anchorDate;
      const weekDates = buildTimelineDates(baseDateKey, 7);

      return (
        <CalendarProvider date={anchorDate} onDateChanged={(dateString) => setAnchorDate(dateString)} numberOfDays={7}>
          <WeekCalendar
            firstDay={1}
            allowShadow={false}
            hideExtraDays
            markedDates={markedDates}
            markingType="multi-dot"
            theme={{
              calendarBackground: colors.surface,
              dayTextColor: colors.text,
              textSectionTitleColor: colors.mutedText,
              todayTextColor: colors.primary,
              selectedDayTextColor: colors.onPrimary,
              selectedDayBackgroundColor: colors.primary,
              monthTextColor: colors.text,
              arrowColor: colors.primary
            }}
          />

          <View style={{ flex: 1, minHeight: 0, borderTopWidth: 1, borderColor: colors.border }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.md, gap: spacing.sm }}
            >
              {weekDates.map((dayKey) => {
                const dayEvents = eventsByDay[dayKey] ?? [];
                return (
                  <View
                    key={dayKey}
                    style={{
                      width: 220,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radii.md,
                      backgroundColor: colors.surface,
                      padding: spacing.sm,
                      gap: spacing.sm
                    }}
                  >
                    <Text variant="bodyStrong" numberOfLines={2}>
                      {formatDateKey(dayKey)}
                    </Text>

                    {dayEvents.length === 0 ? (
                      <Text variant="caption" style={{ color: colors.mutedText }}>
                        Aucun créneau
                      </Text>
                    ) : (
                      dayEvents.map((event) => (
                        <Pressable
                          key={event.id}
                          accessibilityRole="button"
                          onPress={() => {
                            setSelectedEventId(event.id);
                            if (!isWide) {
                              setMobilePanelVisible(true);
                            }
                          }}
                          style={{
                            borderWidth: 1,
                            borderColor: selectedEventId === event.id ? colors.primary : colors.border,
                            borderRadius: radii.sm,
                            backgroundColor: selectedEventId === event.id ? colors.primarySoft : colors.surfaceAlt,
                            padding: spacing.sm
                          }}
                        >
                          <Text variant="bodySmall" numberOfLines={2}>
                            {event.title}
                          </Text>
                          <Text variant="caption" style={{ color: colors.mutedText, marginTop: spacing.xs }}>
                            {formatHourMinute(event.start_at)} → {formatHourMinute(event.end_at)}
                          </Text>
                          <Text variant="caption" style={{ color: colors.mutedText }}>
                            {kindLabel(event.kind)}
                          </Text>
                        </Pressable>
                      ))
                    )}

                    <Button
                      label="Ajouter"
                      variant="ghost"
                      onPress={() => openCreatePanel(`${dayKey}T08:00:00`)}
                      disabled={readOnlyMode}
                    />
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </CalendarProvider>
      );
    }

    return (
      <CalendarProvider
        date={anchorDate}
        onDateChanged={(dateString) => setAnchorDate(dateString)}
        numberOfDays={1}
      >
        <WeekCalendar
          firstDay={1}
          allowShadow={false}
          hideExtraDays
          markedDates={markedDates}
          markingType="multi-dot"
          theme={{
            calendarBackground: colors.surface,
            dayTextColor: colors.text,
            textSectionTitleColor: colors.mutedText,
            todayTextColor: colors.primary,
            selectedDayTextColor: colors.onPrimary,
            selectedDayBackgroundColor: colors.primary,
            monthTextColor: colors.text,
            arrowColor: colors.primary
          }}
        />

        <View style={{ flex: 1, minHeight: 0, borderTopWidth: 1, borderColor: colors.border }}>
          <Timeline
            key={`DAY-${anchorDate}`}
            date={toDayKey(range.start) || anchorDate}
            events={timelineEvents}
            numberOfDays={1}
            format24h
            start={7}
            end={19}
            overlapEventsSpacing={10}
            rightEdgeSpacing={28}
            onEventPress={onTimelineEventPress}
            onBackgroundLongPress={onTimelineLongPress}
            showNowIndicator
            scrollToNow
          />
        </View>
      </CalendarProvider>
    );
  };

  const renderDetailsPanel = () => {
    if (!selectedEvent || !detailDraft) {
      return (
        <EmptyState
          icon="calendar-blank"
          title="Sélectionnez un créneau"
          message="Choisissez un événement dans la liste ou le calendrier pour afficher les détails."
        />
      );
    }

    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.xl, gap: spacing.md }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: spacing.sm }}>
          <Text variant="h2">Détails du créneau</Text>
          <Text variant="caption" style={{ color: colors.mutedText }}>
            {formatDateFr(selectedEvent.start_at)} → {formatDateFr(selectedEvent.end_at)}
          </Text>
          <Badge tone={selectedEvent.is_urgent ? 'danger' : 'info'} label={selectedEvent.is_urgent ? 'Urgent' : 'Standard'} />
        </View>

        <TextField
          label="Titre"
          value={detailDraft.title}
          onChangeText={(value) => setDetailDraft((current) => (current ? { ...current, title: value } : current))}
          editable={!readOnlyMode && !saving}
        />

        <TextField
          label="Description"
          value={detailDraft.description}
          onChangeText={(value) => setDetailDraft((current) => (current ? { ...current, description: value } : current))}
          editable={!readOnlyMode && !saving}
          multiline
          inputStyle={{ minHeight: 96, textAlignVertical: 'top' }}
        />

        <TextField
          label="Début (ISO)"
          value={detailDraft.startAt}
          onChangeText={(value) => setDetailDraft((current) => (current ? { ...current, startAt: value } : current))}
          editable={!readOnlyMode && !saving}
        />

        <TextField
          label="Fin (ISO)"
          value={detailDraft.endAt}
          onChangeText={(value) => setDetailDraft((current) => (current ? { ...current, endAt: value } : current))}
          editable={!readOnlyMode && !saving}
        />

        <View style={{ gap: spacing.sm }}>
          <Text variant="caption" style={{ color: colors.mutedText }}>
            Type
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {(['TASK', 'PROJECT', 'TEAM', 'CONTROL', 'DOC'] as const).map((kind) => (
              <Chip
                key={kind}
                label={kindLabel(kind)}
                active={detailDraft.kind === kind}
                disabled={readOnlyMode || saving}
                onPress={() => setDetailDraft((current) => (current ? { ...current, kind } : current))}
              />
            ))}
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Chip
            label="Urgence"
            active={detailDraft.urgent}
            disabled={readOnlyMode || saving}
            onPress={() => setDetailDraft((current) => (current ? { ...current, urgent: !current.urgent } : current))}
          />
        </View>

        <TextField
          label="Utilisateur assigné"
          value={detailDraft.assigneeUserId}
          onChangeText={(value) => setDetailDraft((current) => (current ? { ...current, assigneeUserId: value } : current))}
          editable={!readOnlyMode && !saving}
        />

        <TextField
          label="Équipe"
          value={detailDraft.teamId}
          onChangeText={(value) => setDetailDraft((current) => (current ? { ...current, teamId: value } : current))}
          editable={!readOnlyMode && !saving}
        />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Button
            label={saving ? 'Enregistrement…' : 'Enregistrer'}
            onPress={() => void submitUpdate()}
            disabled={saving || readOnlyMode}
          />
          <Button
            label="Supprimer"
            variant="danger"
            onPress={() => void removeSelected()}
            disabled={saving || readOnlyMode}
          />
        </View>

        {readOnlyMode ? (
          <Text variant="caption" style={{ color: colors.warningText }}>
            Lecture seule (mode contrôle).
          </Text>
        ) : null}
      </ScrollView>
    );
  };

  const renderCreateForm = () => {
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.xl, gap: spacing.md }}
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="caption" style={{ color: colors.mutedText }}>
          Création locale immédiate. La synchronisation se fera automatiquement.
        </Text>

        <TextField
          label="Titre"
          value={createDraft.title}
          onChangeText={(value) => setCreateDraft((current) => ({ ...current, title: value }))}
          editable={!saving && !readOnlyMode}
        />

        <TextField
          label="Description"
          value={createDraft.description}
          onChangeText={(value) => setCreateDraft((current) => ({ ...current, description: value }))}
          editable={!saving && !readOnlyMode}
          multiline
          inputStyle={{ minHeight: 96, textAlignVertical: 'top' }}
        />

        <TextField
          label="Début (ISO)"
          value={createDraft.startAt}
          onChangeText={(value) => {
            setCreateDraft((current) => ({
              ...current,
              startAt: value,
              endAt: normalizeIsoInput(current.endAt) ? current.endAt : clampEndFromStart(value, 60)
            }));
          }}
          editable={!saving && !readOnlyMode}
        />

        <TextField
          label="Fin (ISO)"
          value={createDraft.endAt}
          onChangeText={(value) => setCreateDraft((current) => ({ ...current, endAt: value }))}
          editable={!saving && !readOnlyMode}
        />

        <View style={{ gap: spacing.sm }}>
          <Text variant="caption" style={{ color: colors.mutedText }}>
            Type
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {(['TASK', 'PROJECT', 'TEAM', 'CONTROL', 'DOC'] as const).map((kind) => (
              <Chip
                key={kind}
                label={kindLabel(kind)}
                active={createDraft.kind === kind}
                disabled={saving || readOnlyMode}
                onPress={() => setCreateDraft((current) => ({ ...current, kind }))}
              />
            ))}
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Chip
            label="Urgence"
            active={createDraft.urgent}
            disabled={saving || readOnlyMode}
            onPress={() => setCreateDraft((current) => ({ ...current, urgent: !current.urgent }))}
          />
        </View>

        <TextField
          label="Utilisateur assigné"
          value={createDraft.assigneeUserId}
          onChangeText={(value) => setCreateDraft((current) => ({ ...current, assigneeUserId: value }))}
          editable={!saving && !readOnlyMode}
        />

        <TextField
          label="Équipe"
          value={createDraft.teamId}
          onChangeText={(value) => setCreateDraft((current) => ({ ...current, teamId: value }))}
          editable={!saving && !readOnlyMode}
        />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Button
            label={saving ? 'Création…' : 'Créer'}
            onPress={() => void submitCreate()}
            disabled={saving || readOnlyMode}
          />
          <Button label="Annuler" variant="ghost" onPress={() => setCreateVisible(false)} disabled={saving} />
        </View>

        {readOnlyMode ? (
          <Text variant="caption" style={{ color: colors.warningText }}>
            Lecture seule (mode contrôle).
          </Text>
        ) : null}
      </ScrollView>
    );
  };

  const listHeader = (
    <View style={{ gap: spacing.md }}>
      <SearchInput value={query} onChangeText={setQuery} placeholder="Rechercher un créneau" />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Badge tone="info" label={`${indicators.todayCount} aujourd'hui`} />
        <Badge tone={indicators.urgentCount > 0 ? 'danger' : 'success'} label={`${indicators.urgentCount} urgents`} />
        <Badge tone="sync" label={`${indicators.pendingOpsCount} en attente`} />
      </View>

      <Text variant="caption" style={{ color: colors.mutedText }}>
        {formatDateKey(anchorDate)}
      </Text>
    </View>
  );

  return (
    <Screen>
      <SectionHeader
        title="Planning"
        subtitle="Vue jour/semaine/mois, création rapide et détails contextuels."
        right={
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'flex-end' }}>
            <SyncStatusBadge state={syncState} />
            {syncStatus.deadLetterCount > 0 ? (
              <Badge tone="danger" label={`${syncStatus.deadLetterCount} erreurs`} icon="alert-circle" />
            ) : null}
          </View>
        }
      />

      <OfflineBanner visible={syncStatus.phase === 'offline'} />

      <View style={{ marginBottom: spacing.md }}>
        <SegmentedControl value={viewMode} options={VIEW_OPTIONS} onChange={setViewMode} />
      </View>

      <View style={{ marginBottom: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {FILTERS.map((filter) => (
          <Chip
            key={filter.key}
            label={filter.label}
            active={activeFilter === filter.key}
            onPress={() => setActiveFilter(filter.key)}
          />
        ))}
      </View>

      {readOnlyMode ? (
        <Card style={{ marginBottom: spacing.md }}>
          <Text variant="caption" style={{ color: colors.warningText }}>
            Lecture seule (mode contrôle).
          </Text>
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.md }}>
        <KpiCard title="Semaine" value={indicators.weekEventsCount} icon="calendar-week" tone="info" />
        <KpiCard title="Mes tâches" value={indicators.mineCount} icon="account-check" tone="success" />
        <KpiCard title="Urgences" value={indicators.urgentCount} icon="alert" tone={indicators.urgentCount > 0 ? 'danger' : 'neutral'} />
      </View>

      <View style={{ flex: 1, minHeight: 0 }}>
        <SplitView
          breakpoint={WIDE_BREAKPOINT}
          sidebarWidth={360}
          sidebar={
            <Card style={{ flex: 1, minHeight: 0, borderTopRightRadius: isWide ? 0 : radii.md, borderBottomRightRadius: isWide ? 0 : radii.md }}>
              <FlatList
                data={events}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xl }}
                ListHeaderComponent={listHeader}
                ListHeaderComponentStyle={{ marginBottom: spacing.md }}
                renderItem={({ item }) => {
                  const selected = selectedEventId === item.id;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setSelectedEventId(item.id);
                        if (!isWide) {
                          setMobilePanelVisible(true);
                        }
                      }}
                      style={{
                        borderWidth: 1,
                        borderColor: selected ? colors.primary : colors.border,
                        borderRadius: radii.md,
                        padding: spacing.sm,
                        backgroundColor: selected ? colors.primarySoft : colors.surface
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}>
                        <Text variant="bodyStrong" numberOfLines={2} style={{ flex: 1 }}>
                          {item.title}
                        </Text>
                        {item.is_urgent ? <Icon name="alert" size={18} color={colors.danger} /> : null}
                      </View>
                      <Text variant="caption" style={{ color: colors.mutedText, marginTop: spacing.xs }}>
                        {formatHourMinute(item.start_at)} → {formatHourMinute(item.end_at)}
                      </Text>
                      <Text variant="caption" style={{ color: colors.mutedText, marginTop: spacing.xs }}>
                        {kindLabel(item.kind)}
                      </Text>
                    </Pressable>
                  );
                }}
                ListEmptyComponent={
                  loading ? (
                    <Text variant="caption" style={{ color: colors.mutedText }}>
                      Chargement des créneaux...
                    </Text>
                  ) : (
                    <EmptyState
                      icon="calendar-remove"
                      title="Aucun créneau"
                      message="Aucun événement trouvé avec les filtres actuels."
                      ctas={[{ label: 'Créer', onPress: () => openCreatePanel() }]}
                    />
                  )
                }
              />
            </Card>
          }
          content={
            <View style={{ flex: 1, minHeight: 0 }}>
              {isWide ? (
                <View style={{ flex: 1, minHeight: 0, flexDirection: 'row', gap: spacing.md }}>
                  <Card style={{ flex: 1, minHeight: 0, padding: 0, overflow: 'hidden' }}>{renderCalendarContent()}</Card>

                  <Card style={{ width: 360, minHeight: 0 }}>{renderDetailsPanel()}</Card>
                </View>
              ) : (
                <Card style={{ flex: 1, minHeight: 0, padding: 0, overflow: 'hidden' }}>{renderCalendarContent()}</Card>
              )}
            </View>
          }
        />
      </View>

      {error ? (
        <Card style={{ marginTop: spacing.md }}>
          <Text variant="caption" style={{ color: colors.danger }}>
            {error}
          </Text>
          <View style={{ marginTop: spacing.sm, flexDirection: 'row', gap: spacing.sm }}>
            <Button label="Réessayer" variant="secondary" onPress={() => void refresh()} />
            <Button label="Fermer" variant="ghost" onPress={() => setError(null)} />
          </View>
        </Card>
      ) : null}

      <Fab icon="plus" onPress={() => openCreatePanel()} />

      <DrawerPanel visible={createVisible} title="Créer un créneau" onClose={() => setCreateVisible(false)}>
        {renderCreateForm()}
      </DrawerPanel>

      {!isWide ? (
        <DrawerPanel visible={mobilePanelVisible} title="Détails du créneau" onClose={() => setMobilePanelVisible(false)}>
          {renderDetailsPanel()}
        </DrawerPanel>
      ) : null}
    </Screen>
  );
}

// Dev guardrail: used by navigation wiring assertions.
(PlanningScreen as any).screenKey = 'PLANNING';
