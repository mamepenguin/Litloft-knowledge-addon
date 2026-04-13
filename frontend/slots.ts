import { lazy } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const slotComponents: Record<string, React.LazyExoticComponent<React.ComponentType<any>>> = {
  "knowledge-vault-summary": lazy(() => import("./KnowledgeVaultSummary")),
  "knowledge-edit": lazy(() => import("./KnowledgeEditSection")),
};
