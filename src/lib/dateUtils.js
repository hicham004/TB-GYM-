/**
 * Global date formatting utility â€” DD/MM/YYYY everywhere
 */
import { format as dateFnsFormat, parseISO, isValid, addDays, addWeeks, differenceInDays } from 'date-fns';

/**
 * Format any date to DD/MM/YYYY
 */
export function formatDate(date) {
  if (!date) return 'â€”';
  try {
    const d = typeof date === 'string' ? parseISO(date) : date;
    if (!isValid(d)) return 'â€”';
    return dateFnsFormat(d, 'dd/MM/yyyy');
  } catch {
    return 'â€”';
  }
}

/**
 * Format date with time DD/MM/YYYY Â· HH:mm
 */
export function formatDateTime(date) {
  if (!date) return 'â€”';
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (!isValid(d)) return 'â€”';
    return dateFnsFormat(d, 'dd/MM/yyyy Â· HH:mm');
  } catch {
    return 'â€”';
  }
}

/**
 * Calculate payment due date: start date + 5 days
 */
export function calcPaymentDueDate(startDate) {
  if (!startDate) return null;
  try {
    const d = typeof startDate === 'string' ? parseISO(startDate) : startDate;
    return dateFnsFormat(addDays(d, 5), 'yyyy-MM-dd');
  } catch {
    return null;
  }
}

/**
 * Calculate program end date from start + weeks
 */
export function calcEndDate(startDate, weeks) {
  if (!startDate || !weeks) return null;
  try {
    const d = typeof startDate === 'string' ? parseISO(startDate) : startDate;
    return dateFnsFormat(addWeeks(d, Number(weeks)), 'yyyy-MM-dd');
  } catch {
    return null;
  }
}

/**
 * Today as yyyy-MM-dd string
 */
export function todayISO() {
  return dateFnsFormat(new Date(), 'yyyy-MM-dd');
}

export { differenceInDays, addDays, addWeeks };
