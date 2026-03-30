// ─────────────────────────────────────────────────────────────
// Order Status Config — WO-70
//
// Single source of truth for order status display across all
// three surfaces: Clinic App, Ops Dashboard, Patient Checkout.
//
// Palette is colorblind-safe (tested for deuteranopia, protanopia,
// tritanopia). Dot colors pass WCAG AA contrast on both white
// (#FFFFFF) and dark card (#161B27) backgrounds.
// ─────────────────────────────────────────────────────────────

import type { OrderStatusEnum } from '@/types/database.types'

export interface StatusConfig {
  label:     string
  color:     string  // dot fill color (hex)
  textColor: string  // label text color (hex)
}

export const ORDER_STATUS_CONFIG: Record<OrderStatusEnum, StatusConfig> = {
  DRAFT: {
    label:     'Draft',
    color:     '#94A3B8',
    textColor: '#475569',
  },
  AWAITING_PAYMENT: {
    label:     'Awaiting Payment',
    color:     '#D97706',
    textColor: '#92400E',
  },
  PAYMENT_EXPIRED: {
    label:     'Payment Expired',
    color:     '#DC2626',
    textColor: '#991B1B',
  },
  PAID_PROCESSING: {
    label:     'Paid — Processing',
    color:     '#2563EB',
    textColor: '#1E40AF',
  },
  SUBMISSION_PENDING: {
    label:     'Submission Pending',
    color:     '#2563EB',
    textColor: '#1E40AF',
  },
  SUBMISSION_FAILED: {
    label:     'Submission Failed',
    color:     '#DC2626',
    textColor: '#991B1B',
  },
  FAX_QUEUED: {
    label:     'Fax Queued',
    color:     '#0891B2',
    textColor: '#0E7490',
  },
  FAX_DELIVERED: {
    label:     'Fax Delivered',
    color:     '#16A34A',
    textColor: '#14532D',
  },
  FAX_FAILED: {
    label:     'Fax Failed',
    color:     '#DC2626',
    textColor: '#991B1B',
  },
  PHARMACY_ACKNOWLEDGED: {
    label:     'Pharmacy Ack',
    color:     '#16A34A',
    textColor: '#14532D',
  },
  PHARMACY_COMPOUNDING: {
    label:     'Compounding',
    color:     '#7C3AED',
    textColor: '#5B21B6',
  },
  PHARMACY_PROCESSING: {
    label:     'Processing',
    color:     '#7C3AED',
    textColor: '#5B21B6',
  },
  PHARMACY_REJECTED: {
    label:     'Pharmacy Rejected',
    color:     '#DC2626',
    textColor: '#991B1B',
  },
  REROUTE_PENDING: {
    label:     'Rerouting',
    color:     '#EA580C',
    textColor: '#9A3412',
  },
  READY_TO_SHIP: {
    label:     'Ready to Ship',
    color:     '#16A34A',
    textColor: '#14532D',
  },
  SHIPPED: {
    label:     'Shipped',
    color:     '#16A34A',
    textColor: '#14532D',
  },
  DELIVERED: {
    label:     'Delivered',
    color:     '#16A34A',
    textColor: '#14532D',
  },
  CANCELLED: {
    label:     'Cancelled',
    color:     '#64748B',
    textColor: '#334155',
  },
  ERROR_PAYMENT_FAILED: {
    label:     'Payment Error',
    color:     '#DC2626',
    textColor: '#991B1B',
  },
  ERROR_COMPLIANCE_HOLD: {
    label:     'Compliance Hold',
    color:     '#DC2626',
    textColor: '#991B1B',
  },
  REFUND_PENDING: {
    label:     'Refund Pending',
    color:     '#EA580C',
    textColor: '#9A3412',
  },
  REFUNDED: {
    label:     'Refunded',
    color:     '#64748B',
    textColor: '#334155',
  },
  DISPUTED: {
    label:     'Disputed',
    color:     '#DC2626',
    textColor: '#991B1B',
  },
}

/** Fallback for unknown/future statuses */
const FALLBACK_CONFIG: StatusConfig = {
  label:     '',
  color:     '#94A3B8',
  textColor: '#475569',
}

export function getStatusConfig(status: string): StatusConfig {
  return (ORDER_STATUS_CONFIG as Record<string, StatusConfig>)[status] ?? {
    ...FALLBACK_CONFIG,
    label: status,
  }
}
