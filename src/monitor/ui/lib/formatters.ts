export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatNumber(value: number | undefined | null, digits = 0): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return '0';
  }
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}

export function formatCompact(value: number | undefined | null): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return '0';
  }
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(amount);
}

export function formatCurrency(value: number | undefined | null, currency = 'USD'): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return '$0.00';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(amount);
}

export function formatDuration(value: number | undefined | null): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return '0m';
  }
  const totalMinutes = Math.round(amount / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function formatTimestamp(value: string | undefined | null): string {
  if (!value) {
    return 'None';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatList(values: Array<string | undefined | null>): string {
  const filtered = values.map((value) => String(value ?? '').trim()).filter(Boolean);
  if (!filtered.length) {
    return 'None';
  }
  return filtered.join(', ');
}

export function badgeTone(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'connected' || normalized === 'approved' || normalized === 'completed' || normalized === 'running') {
    return 'good';
  }
  if (normalized === 'pending' || normalized === 'stale' || normalized === 'review') {
    return 'warn';
  }
  if (normalized === 'rejected' || normalized === 'historical' || normalized === 'error') {
    return 'bad';
  }
  return 'neutral';
}
