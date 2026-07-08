import { useCallback, useEffect, useRef, useState } from "react";
import {
  NetworkError,
  apiCreateProjectAsset,
  apiCreateProjectAssetLink,
  apiDeleteProjectAsset,
  apiDeleteProjectAssetLink,
  apiListProjectAssets,
  apiUpdateProjectAsset,
  apiUpdateProjectAssetLinkStatus,
} from "../lib/api";
import {
  ASSET_ACCENT_CYCLE,
  UNFILED_ASSET_SCOPE,
  notifyProjectAssetsChanged,
  subscribeToProjectAssets,
  type ProjectAsset,
  type ProjectAssetLink,
  type RegisterProjectAssetInput,
} from "../lib/projectAssets";

interface UseProjectAssetsOptions {
  /** Skip fetching until the UI actually needs the registry (panel open). */
  enabled?: boolean;
}

function isTempId(id: string) {
  return id.startsWith("temp_");
}

function makeTempId() {
  return `temp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function describeError(err: unknown, fallback: string) {
  if (err instanceof NetworkError) return "You're offline — asset changes couldn't be saved.";
  return err instanceof Error ? err.message : fallback;
}

/**
 * Supabase-backed project asset registry for one ROOT project scope.
 * Mutations apply optimistically and roll back on failure (error surfaced via
 * `error`); other mounted consumers refetch through the shared change event.
 */
export function useProjectAssets(
  scopes: Array<string | null | undefined>,
  options: UseProjectAssetsOptions = {},
) {
  const enabled = options.enabled ?? true;
  const scope = scopes[0] || UNFILED_ASSET_SCOPE;

  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [links, setLinks] = useState<ProjectAssetLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stateRef = useRef({ assets, links });
  stateRef.current = { assets, links };
  const fetchSeqRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const reload = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const data = await apiListProjectAssets(scope);
      if (seq !== fetchSeqRef.current) return;
      hasLoadedRef.current = true;
      setAssets(data.assets);
      setLinks(data.links);
      setError(null);
    } catch (err) {
      if (seq !== fetchSeqRef.current) return;
      setError(describeError(err, "Failed to load project assets"));
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    hasLoadedRef.current = false;
    if (!enabled) return;
    void reload();
    return subscribeToProjectAssets(() => void reload());
  }, [enabled, reload]);

  const registerAsset = useCallback((input: RegisterProjectAssetInput) => {
    const now = new Date().toISOString();
    const tempAsset: ProjectAsset = {
      id: makeTempId(),
      scope,
      type: input.type,
      name: input.name.trim().slice(0, 80),
      markdown: input.type === "markdown" ? input.markdown ?? "" : undefined,
      targetId: input.type === "markdown" ? undefined : input.targetId,
      accent: input.accent ?? ASSET_ACCENT_CYCLE[stateRef.current.assets.length % ASSET_ACCENT_CYCLE.length],
      created_at: now,
      updated_at: now,
    };
    setAssets((current) => [...current, tempAsset]);

    void apiCreateProjectAsset(scope, { ...input, accent: tempAsset.accent })
      .then((created) => {
        setAssets((current) => current.map((asset) => (asset.id === tempAsset.id ? created : asset)));
        notifyProjectAssetsChanged();
      })
      .catch((err) => {
        setAssets((current) => current.filter((asset) => asset.id !== tempAsset.id));
        setError(describeError(err, "Failed to register asset"));
      });
  }, [scope]);

  const updateAsset = useCallback((
    asset: Pick<ProjectAsset, "id" | "scope">,
    patch: Partial<Pick<ProjectAsset, "name" | "markdown">>,
  ) => {
    const previousAssets = stateRef.current.assets;
    setAssets((current) => current.map((item) =>
      item.id === asset.id
        ? {
            ...item,
            ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 80) || item.name } : {}),
            ...(patch.markdown !== undefined ? { markdown: patch.markdown } : {}),
            updated_at: new Date().toISOString(),
          }
        : item,
    ));
    if (isTempId(asset.id)) return;

    void apiUpdateProjectAsset(asset.id, patch)
      .then(() => notifyProjectAssetsChanged())
      .catch((err) => {
        setAssets(previousAssets);
        setError(describeError(err, "Failed to update asset"));
      });
  }, []);

  const removeAsset = useCallback((asset: Pick<ProjectAsset, "id" | "scope">) => {
    const previous = stateRef.current;
    setAssets((current) => current.filter((item) => item.id !== asset.id));
    setLinks((current) => current.filter((link) => link.assetId !== asset.id));
    if (isTempId(asset.id)) return;

    void apiDeleteProjectAsset(asset.id)
      .then(() => notifyProjectAssetsChanged())
      .catch((err) => {
        setAssets(previous.assets);
        setLinks(previous.links);
        setError(describeError(err, "Failed to remove asset"));
      });
  }, []);

  const toggleNodeLink = useCallback((
    asset: Pick<ProjectAsset, "id" | "scope">,
    canvasId: string,
    nodeId: string,
  ) => {
    if (isTempId(asset.id)) return;

    const existing = stateRef.current.links.find(
      (link) => link.assetId === asset.id && link.canvasId === canvasId && link.nodeId === nodeId,
    );

    if (existing) {
      const previousLinks = stateRef.current.links;
      setLinks((current) => current.filter((link) => link.id !== existing.id));
      if (isTempId(existing.id)) return;
      void apiDeleteProjectAssetLink(existing.id)
        .then(() => notifyProjectAssetsChanged())
        .catch((err) => {
          setLinks(previousLinks);
          setError(describeError(err, "Failed to unlink asset"));
        });
      return;
    }

    const tempLink: ProjectAssetLink = {
      id: makeTempId(),
      scope,
      assetId: asset.id,
      canvasId,
      nodeId,
      status: "active",
      created_at: new Date().toISOString(),
    };
    setLinks((current) => [...current, tempLink]);

    void apiCreateProjectAssetLink(asset.id, canvasId, nodeId, scope)
      .then((created) => {
        setLinks((current) => current.map((link) => (link.id === tempLink.id ? created : link)));
        notifyProjectAssetsChanged();
      })
      .catch((err) => {
        setLinks((current) => current.filter((link) => link.id !== tempLink.id));
        if (err instanceof Error && err.message === "Already linked") {
          void reload();
          return;
        }
        setError(describeError(err, "Failed to link asset"));
      });
  }, [scope, reload]);

  const removeLink = useCallback((link: Pick<ProjectAssetLink, "id" | "scope">) => {
    const previousLinks = stateRef.current.links;
    setLinks((current) => current.filter((item) => item.id !== link.id));
    if (isTempId(link.id)) return;

    void apiDeleteProjectAssetLink(link.id)
      .then(() => notifyProjectAssetsChanged())
      .catch((err) => {
        setLinks(previousLinks);
        setError(describeError(err, "Failed to remove link"));
      });
  }, []);

  const toggleLinkStatus = useCallback((link: Pick<ProjectAssetLink, "id" | "scope">) => {
    const current = stateRef.current.links.find((item) => item.id === link.id);
    if (!current) return;
    const nextStatus = current.status === "active" ? "pending" : "active";
    setLinks((items) => items.map((item) => (item.id === link.id ? { ...item, status: nextStatus } : item)));
    if (isTempId(link.id)) return;

    void apiUpdateProjectAssetLinkStatus(link.id, nextStatus)
      .then(() => notifyProjectAssetsChanged())
      .catch((err) => {
        setLinks((items) => items.map((item) => (item.id === link.id ? { ...item, status: current.status } : item)));
        setError(describeError(err, "Failed to update link"));
      });
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    assets,
    links,
    loading,
    error,
    clearError,
    registerAsset,
    updateAsset,
    removeAsset,
    toggleNodeLink,
    removeLink,
    toggleLinkStatus,
  };
}
