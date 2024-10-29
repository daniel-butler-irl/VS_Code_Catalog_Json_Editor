// src/services/CacheService.ts

export class CacheService {
  private cache: Map<string, { value: any; expiry: number }> = new Map();

  constructor(private ttlSeconds: number = 3600) {}

  public get(key: string): any | undefined {
    const record = this.cache.get(key);
    if (record) {
      if (Date.now() < record.expiry) {
        return record.value;
      } else {
        this.cache.delete(key); // Remove expired entry
      }
    }
    return undefined;
  }

  public set(key: string, value: any): void {
    const expiry = Date.now() + this.ttlSeconds * 1000;
    this.cache.set(key, { value, expiry });
  }
}
