import { useContext } from "react";
import { EntitlementsContext } from "../contexts/EntitlementsContextDef";

export function useEntitlements() {
  const context = useContext(EntitlementsContext);
  if (!context) {
    throw new Error("useEntitlements must be used within an EntitlementsProvider");
  }
  return context;
}
