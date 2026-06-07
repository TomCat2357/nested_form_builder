import { useSyncExternalStore } from "react";
import { getSidebarCollapsed, subscribeSidebarCollapsed } from "../state/sidebarCollapseStore.js";

// 左サイドバーの折りたたみ状態を購読するフック。AppLayout が利用する。
export const useSidebarCollapsed = () =>
  useSyncExternalStore(subscribeSidebarCollapsed, getSidebarCollapsed, getSidebarCollapsed);
