import { invoke } from "@tauri-apps/api/core";
import localforage from "localforage";

export interface PipeStorePlugin {
  id: string;
  name: string;
  description: string | null;
  is_paid: boolean | null;
  price: number | null;
  status: string | null;
  created_at: string | null;
  source_code: string | null;
  developer_accounts: {
    developer_name: string;
  };
  plugin_analytics: {
    downloads_count: number | null;
  };
}

export interface PipeDownloadResponse {
  download_url: string;
  file_hash: string;
  file_size: number;
}

export enum PipeDownloadError {
  PURCHASE_REQUIRED = "purchase required",
  DOWNLOAD_FAILED = "failed to download pipe",
}

type PurchaseHistoryResponse = PurchaseHistoryItem[];

export interface PurchaseHistoryItem {
  id: string;
  amount_paid: number;
  currency: string;
  stripe_payment_status: string;
  created_at: string;
  refunded_at: string | null;
  plugin_id: string;
  plugin_name: string;
  plugin_description: string;
  developer_name: string;
}

interface PurchaseUrlResponse {
  data: {
    checkout_url?: string;
    used_credits?: boolean;
    payment_successful?: boolean;
    already_purchased?: boolean;
  };
}

export interface CheckUpdateResponse {
  has_update: boolean;
  current_version: string;
  latest_version: string;
  latest_file_hash: string;
  latest_file_size: number;
}

export interface CheckUpdatesRequest {
  plugins: Array<{
    pipe_id: string;
    version: string;
  }>;
}

export interface CheckUpdatesResponse {
  results: Array<
    | {
        pipe_id: string;
        has_update: boolean;
        current_version: string;
        latest_version: string;
        latest_file_hash: string;
        latest_file_size: number;
      }
    | {
        pipe_id: string;
        error: string;
        status: number;
      }
  >;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class PipeApi {
  private baseUrl: string;
  private authToken: string;
  private cacheTTL = 60000; // 60 seconds cache

  private constructor(authToken: string) {
    this.baseUrl = "https://screenpi.pe";
    this.authToken = authToken;
  }

  static async create(authToken: string): Promise<PipeApi> {
    const api = new PipeApi(authToken);
    await api.init(authToken);
    return api;
  }

  private async init(authToken: string) {
    try {
      const BASE_URL = await invoke("get_env", { name: "BASE_URL_PRIVATE" });
      if (BASE_URL) {
        this.baseUrl = BASE_URL as string;
      }
      this.authToken = authToken;
    } catch (error) {
      console.error("error initializing base url:", error);
    }
  }

  private async getCached<T>(key: string): Promise<T | null> {
    try {
      const entry = await localforage.getItem<CacheEntry<T>>(`pipe_api_${key}`);
      if (!entry) return null;

      if (Date.now() - entry.timestamp > this.cacheTTL) {
        await localforage.removeItem(`pipe_api_${key}`);
        return null;
      }

      return entry.data;
    } catch (error) {
      console.warn("cache read error:", error);
      return null;
    }
  }

  private async setCache<T>(key: string, data: T) {
    try {
      await localforage.setItem(`pipe_api_${key}`, {
        data,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.warn("cache write error:", error);
    }
  }

  async getUserPurchaseHistory(): Promise<PurchaseHistoryResponse> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/plugins/user-purchase-history`,
        {
          headers: {
            Authorization: `Bearer ${this.authToken}`,
          },
        }
      );
      if (!response.ok) {
        const { error } = (await response.json()) as { error: string };
        throw new Error(`failed to fetch purchase history: ${error}`);
      }

      return (await response.json()) as PurchaseHistoryResponse;
    } catch (error) {
      console.error("error getting purchase history:", error);
      throw error;
    }
  }

  async listStorePlugins(): Promise<PipeStorePlugin[]> {
    const cacheKey = "store-plugins";
    const cached = await this.getCached<PipeStorePlugin[]>(cacheKey);
    if (cached) return cached;

    try {
      const response = await fetch(`${this.baseUrl}/api/plugins/registry`, {
        headers: {
          Authorization: `Bearer ${this.authToken}`,
        },
      });
      if (!response.ok) {
        const { error } = await response.json();
        throw new Error(`failed to fetch plugins: ${error}`);
      }
      const data: PipeStorePlugin[] = await response.json();
      await this.setCache(cacheKey, data);
      return data;
    } catch (error) {
      console.error("error listing pipes:", error);
      throw error;
    }
  }

  async purchasePipe(pipeId: string): Promise<PurchaseUrlResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/plugins/purchase`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({ pipe_id: pipeId }),
      });
      if (!response.ok) {
        const { error } = await response.json();
        throw new Error(`failed to purchase pipe: ${error}`);
      }
      const data = (await response.json()) as PurchaseUrlResponse;
      console.log("purchase data", data);
      return data;
    } catch (error) {
      console.error("error purchasing pipe:", error);
      throw error;
    }
  }

  async downloadPipe(pipeId: string): Promise<PipeDownloadResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/plugins/download`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({ pipe_id: pipeId }),
      });

      if (!response.ok) {
        const { error } = (await response.json()) as { error: string };
        throw new Error(error!, {
          cause:
            response.status === 403
              ? PipeDownloadError.PURCHASE_REQUIRED
              : PipeDownloadError.DOWNLOAD_FAILED,
        });
      }
      const data = (await response.json()) as PipeDownloadResponse;
      return data;
    } catch (error) {
      console.warn("error downloading pipe:", error);
      throw error;
    }
  }

  async checkUpdate(
    pipeId: string,
    version: string
  ): Promise<CheckUpdateResponse> {
    const cacheKey = `update_${pipeId}_${version}`;
    const cached = await this.getCached<CheckUpdateResponse>(cacheKey);
    if (cached) return cached;

    try {
      const response = await fetch(`${this.baseUrl}/api/plugins/check-update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({ pipe_id: pipeId, version }),
      });

      if (!response.ok) {
        const { error } = await response.json();
        throw new Error(`failed to check for updates: ${error}`);
      }

      const data = await response.json();
      await this.setCache(cacheKey, data);
      return data;
    } catch (error) {
      console.error("error checking for updates:", error);
      throw error;
    }
  }

  async checkUpdates(
    plugins: Array<{ pipe_id: string; version: string }>
  ): Promise<CheckUpdatesResponse> {
    // Filter out local plugins
    const localPlugins = plugins.filter(p => p.pipe_id.includes('_local'));
    const remotePlugins = plugins.filter(p => !p.pipe_id.includes('_local'));
    
    if (localPlugins.length > 0) {
      console.log(`[pipe-update] filtered out ${localPlugins.length} local plugins:`, localPlugins);
    }
    
    
    // If no remote plugins, return empty result
    if (remotePlugins.length === 0) {
      console.log("[pipe-update] no remote plugins to check for updates");
      return { 
        results: []
      };
    }
    
    // Create a cache key based on remote plugin IDs and versions
    const cacheKey = `updates_${remotePlugins
      .map((p) => `${p.pipe_id}_${p.version}`)
      .join("_")}`;
    const cached = await this.getCached<CheckUpdatesResponse>(cacheKey);
    if (cached) {
      console.log("[pipe-update] returning cached update results");
      return cached;
    }

    try {
      console.log(`[pipe-update] sending update check request to server for ${remotePlugins.length} plugins`);
      const response = await fetch(`${this.baseUrl}/api/plugins/check-updates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({ plugins: remotePlugins }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error(`[pipe-update] server returned ${response.status}: ${JSON.stringify(errorData)}`);
        throw new Error(`failed to check for updates: ${errorData.error}`);
      }

      const data = await response.json();
      console.log("[pipe-update] received update check response:", data);
      
      // Add back information about local plugins
      if (localPlugins.length > 0) {
        console.log("[pipe-update] adding local plugin info to response");
        const localResults = localPlugins.map(p => ({
          pipe_id: p.pipe_id,
          error: "Local plugin cannot be checked for updates",
          status: 404
        }));
        
        // If data.results exists, add local results to it
        if (data.results) {
          data.results = [...data.results, ...localResults];
        }
      }
      
      await this.setCache(cacheKey, data);
      return data;
    } catch (error) {
      console.error("error checking for updates:", error);
      throw error;
    }
  }

  // method to force refresh cache if needed
  async clearCache() {
    const keys = await localforage.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith("pipe_api_"))
        .map((key) => localforage.removeItem(key))
    );
  }
}
