"use client";

import { useCallback, useState } from "react";

import type { VerifyStatus } from "./ClipRow";
import { markVerified } from "./requests";

/**
 * "Mark as verified" for the rows of one list: idle, saving, then gone on
 * success or failed on failure, from which it can be pressed again.
 */
export function useVerify(
  remove: (id: string) => void,
  setSaving: (id: string, on: boolean) => void,
) {
  const [status, setStatus] = useState<Record<string, VerifyStatus>>({});

  const verify = useCallback(
    (id: string) => {
      setSaving(id, true);
      setStatus((prev) => ({ ...prev, [id]: "saving" }));
      markVerified(id).then(
        () => {
          setSaving(id, false);
          remove(id);
          setStatus(({ [id]: _done, ...rest }) => rest);
        },
        () => {
          setSaving(id, false);
          setStatus((prev) => ({ ...prev, [id]: "failed" }));
        },
      );
    },
    [remove, setSaving],
  );

  return { statusOf: (id: string): VerifyStatus => status[id] ?? "idle", verify };
}
