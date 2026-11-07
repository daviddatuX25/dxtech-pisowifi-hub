export interface PromoDurationSummary {
  durationLabel: string;
  durationNote: string;
  dataUnavailable: boolean;
}

export function summarizePromoDuration(input: {
  declaredDuration?: unknown;
  fulfillmentType: string;
  voucherDurationLabels?: unknown;
  voucherHasUndeclaredDuration?: unknown;
}): PromoDurationSummary {
  const declaredDuration = typeof input.declaredDuration === 'string'
    ? input.declaredDuration.trim()
    : '';
  if (declaredDuration) {
    return {
      durationLabel: declaredDuration,
      durationNote: '',
      dataUnavailable: false,
    };
  }

  if (input.fulfillmentType !== 'voucher') {
    return {
      durationLabel: 'No voucher duration',
      durationNote: 'This promotion uses manual operator top-up; no voucher time applies.',
      dataUnavailable: false,
    };
  }

  if (!Array.isArray(input.voucherDurationLabels)
    || !input.voucherDurationLabels.every((label) => typeof label === 'string')
    || typeof input.voucherHasUndeclaredDuration !== 'boolean') {
    return {
      durationLabel: 'Duration data unavailable',
      durationNote: 'Voucher duration data is missing from the API response. Deploy the API update to show accurate times.',
      dataUnavailable: true,
    };
  }

  const labels = input.voucherDurationLabels
    .map((label: string) => label.trim())
    .filter(Boolean);
  const hasUndeclaredDuration = input.voucherHasUndeclaredDuration;
  const joinedLabels = labels.join(', ');
  const durationDetails = joinedLabels.length <= 120 ? joinedLabels : `${labels.length} different declared times`;

  if (hasUndeclaredDuration) {
    return {
      durationLabel: labels.length ? 'Mixed / partly unknown duration' : 'Undeclared voucher duration',
      durationNote: labels.length
        ? `Known available voucher times: ${durationDetails}; some available codes have no declared time.`
        : 'Some available voucher codes have no declared time.',
      dataUnavailable: false,
    };
  }

  if (labels.length > 1) {
    return {
      durationLabel: 'Multiple voucher durations',
      durationNote: `Available vouchers use different declared times: ${durationDetails}.`,
      dataUnavailable: false,
    };
  }

  if (labels.length === 1) {
    return {
      durationLabel: labels[0],
      durationNote: '',
      dataUnavailable: false,
    };
  }

  return {
    durationLabel: 'No available voucher duration',
    durationNote: 'No unassigned voucher codes are currently available to determine a time.',
    dataUnavailable: false,
  };
}

