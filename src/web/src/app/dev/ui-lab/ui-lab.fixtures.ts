import type { AvatarPresentation } from '../../ui/avatar';
import type { StatusMarker, StatusTone } from '../../ui/status-label';

/**
 * Synthetic, fixed fixtures for the UI lab. No customer data, no API shapes and nothing that is
 * saved: the lab exists to exercise the primitives, so every value here is invented and stable
 * (screenshots depend on it). The Arabic strings are sample copy for bidi and font checks, not
 * reviewed translations; the product has no Arabic locale yet.
 */
export const EQUIPMENT_OPTIONS = [
  { value: 'Barbell', label: 'Barbell' },
  { value: 'Dumbbell', label: 'Dumbbell' },
  { value: 'Kettlebell', label: 'Kettlebell' },
  { value: 'Cable', label: 'Cable' },
  { value: 'Bodyweight', label: 'Bodyweight' },
] as const;

export const CLASSIFICATION_OPTIONS = [
  { value: 'Strength', label: 'Strength' },
  { value: 'Conditioning', label: 'Conditioning' },
  { value: 'Mobility', label: 'Mobility' },
  { value: 'General', label: 'General' },
] as const;

export const SET_TYPE_OPTIONS = ['Warm-up', 'Working', 'Back-off'] as const;

export const STATUS_SAMPLES: readonly { label: string; tone: StatusTone; marker: StatusMarker }[] =
  [
    { label: 'Archived', tone: 'neutral', marker: 'dot' },
    { label: 'Active', tone: 'success', marker: 'check' },
    { label: 'Unsaved changes', tone: 'warning', marker: 'dot' },
    { label: 'Access paused', tone: 'danger', marker: 'dot' },
  ];

export const AVATAR_SAMPLES: readonly {
  initials: string;
  presentation: AvatarPresentation;
  caption: string;
}[] = [
  { initials: 'SC', presentation: 'coach-account', caption: 'Coach account · 36' },
  { initials: 'SC', presentation: 'top-bar-user', caption: 'Top bar user · 32' },
  { initials: 'MR', presentation: 'client', caption: 'Client · 40' },
  { initials: 'ON', presentation: 'client-warning', caption: 'Client, warning · 40' },
  { initials: 'LK', presentation: 'client-danger', caption: 'Client, danger · 40' },
  { initials: 'MR', presentation: 'mobile-account', caption: 'Mobile account · 48' },
  { initials: 'SC', presentation: 'message-sender', caption: 'Message sender · 40' },
];

/** Enough rows to make the edge-focus region scroll at every viewport. */
export const EDGE_OPTIONS = [
  'First option, at the top edge of the scroll region',
  'Warm-up sets',
  'Working sets',
  'Back-off sets',
  'Cool-down',
  'Last option, at the bottom edge of the scroll region',
] as const;

export const ARABIC = {
  heading: 'عينة باللغة العربية',
  intro: 'نص تجريبي لاختبار الاتجاه من اليمين إلى اليسار والخط العربي.',
  nameLabel: 'اسم التمرين',
  nameHelp: 'مطلوب. حتى 160 حرفًا.',
  nameError: 'أدخل اسمًا لهذا التمرين.',
  equipmentLabel: 'المعدات',
  equipmentPlaceholder: 'اختر المعدات…',
  equipmentOptions: ['بار حديدي', 'دمبل'],
  tempoLabel: 'الإيقاع',
  loadLabel: 'الحمل',
  includeArchived: 'تضمين المؤرشفة',
  mainLift: 'اعتبره تمرينًا رئيسيًا: لا يمكن للمدربين استبداله إلا بالبدائل المعتمدة',
  save: 'حفظ التغييرات',
  cancel: 'إلغاء',
  addMuscle: 'إضافة عضلة',
  notifications: 'الإشعارات',
  active: 'نشط',
  archived: 'مؤرشف',
  coachName: 'مدرب تجريبي',
  coachInitials: 'م ت',
} as const;
