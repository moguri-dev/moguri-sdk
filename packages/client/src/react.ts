import { useSyncExternalStore } from "react";
import type { MoguriClient } from "./index.ts";

export const useMoguri = (client: MoguriClient) => useSyncExternalStore(client.subscribe, client.getState, client.getState);
