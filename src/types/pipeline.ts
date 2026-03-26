// ============================================================
// Pipeline shared types — WO-33
// ============================================================
// Shared between:
//   src/app/(ops-dashboard)/ops/pipeline/page.tsx  (Server Component)
//   src/app/api/ops/pipeline/route.ts              (API route)
//   src/app/(ops-dashboard)/ops/pipeline/_components/pipeline-view.tsx
//   src/app/(ops-dashboard)/ops/pipeline/_components/order-detail-drawer.tsx
//
// NOTE: ops_assignee was added in migration 20260319000010.
// If TypeScript errors occur on ops_assignee, run: npm run db:types

import type { OrderStatusEnum, IntegrationTierEnum } from '@/types/database.types'

export interface PipelineOrder {
  orderId:               string
  orderNumber:           string | null
  status:                OrderStatusEnum
  clinicId:              string
  clinicName:            string
  pharmacyId:            string | null
  pharmacyName:          string | null
  pharmacyTier:          IntegrationTierEnum | null
  submissionTier:        IntegrationTierEnum | null
  rerouteCount:          number
  trackingNumber:        string | null
  carrier:               string | null
  stripePaymentIntentId: string | null
  createdAt:             string
  updatedAt:             string
  opsAssignee:           string | null
  // SLA urgency data (REQ-OPV-003)
  nearestSlaDeadline:    string | null
  hasSlaBreached:        boolean
}

export interface FilterOption {
  id:   string
  name: string
}
