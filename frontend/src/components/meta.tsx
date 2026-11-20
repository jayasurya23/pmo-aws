import { createContext, ReactNode, useContext } from "react";
import { useApi } from "@/lib/api";

interface Meta {
  meta: any | null;
  definitions: any | null;
  reloadMeta: () => void;
}
const MetaCtx = createContext<Meta>({ meta: null, definitions: null, reloadMeta: () => {} });

export function MetaProvider({ children }: { children: ReactNode }) {
  const m = useApi("/meta");
  const d = useApi("/meta/definitions");
  return <MetaCtx.Provider value={{ meta: m.data, definitions: d.data, reloadMeta: m.reload }}>{children}</MetaCtx.Provider>;
}

export const useMeta = () => useContext(MetaCtx);
