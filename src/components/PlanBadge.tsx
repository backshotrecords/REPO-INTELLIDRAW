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

  if (planId === "max") {
    return (
      <span className={`relative inline-flex shrink-0 overflow-hidden rounded-md p-[1px] align-middle ${className}`}>
        <span className="absolute inset-[-1000%] animate-[spin_2s_linear_infinite] bg-[conic-gradient(from_90deg_at_50%_50%,#E2CBFF_0%,#393BB2_50%,#E2CBFF_100%)]" />
        <span className="relative inline-flex h-full w-full items-center justify-center rounded-[5px] bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide leading-none text-white backdrop-blur-3xl">
          {label}
        </span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide leading-none bg-primary/10 text-primary border-primary/20 ${className}`}>
      {label}
    </span>
  );
}
