import { useEntitlements } from "../hooks/useEntitlements";
import type { SubscriptionPlanId } from "../types";

interface PlanBadgeProps {
  planId: SubscriptionPlanId | null | undefined;
  className?: string;
}

export default function PlanBadge({ planId, className = "" }: PlanBadgeProps) {
  const { getPlanName } = useEntitlements();
  if (!planId || planId === "free") return null;

  const label = getPlanName(planId);
  const tone = planId === "max"
    ? "bg-amber-100 text-amber-800 border-amber-200"
    : "bg-primary/10 text-primary border-primary/20";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide leading-none ${tone} ${className}`}>
      {label}
    </span>
  );
}
