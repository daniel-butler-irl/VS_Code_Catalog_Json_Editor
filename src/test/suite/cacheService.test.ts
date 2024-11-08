
// src/test/suite/cacheService.test.ts
import * as assert from 'assert';
import { CacheService } from '../../services/CacheService';
import * as sinon from 'sinon';

suite('CacheService Test Suite', () => {
    let cacheService: CacheService;
    let clock: sinon.SinonFakeTimers;
    const sevenDays = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

    setup(() => {
        clock = sinon.useFakeTimers();
        cacheService = CacheService.getInstance();
    });

    teardown(() => {
        clock.restore();
        // Clear the singleton instance
        (CacheService as any).instance = undefined;
    });

    test('should cache and retrieve values', () => {
        cacheService.set('test-key', 'test-value');
        assert.strictEqual(cacheService.get('test-key'), 'test-value');
    });

    test('should respect TTL of 7 days', () => {
        cacheService.set('ttl-test', 'test-value');

        // Advance time by 6 days
        clock.tick(6 * 24 * 60 * 60 * 1000);
        assert.strictEqual(cacheService.get('ttl-test'), 'test-value');

        // Advance to 7 days and 1 millisecond
        clock.tick(24 * 60 * 60 * 1000 + 1);
        assert.strictEqual(cacheService.get('ttl-test'), undefined);
    });

    test('should handle clearing cache by prefix', () => {
        cacheService.set('catalog:test1', 'value1');
        cacheService.set('catalog:test2', 'value2');
        cacheService.set('offering:test3', 'value3');

        const clearedCount = cacheService.clearPrefix('catalog');
        assert.strictEqual(clearedCount, 2);
        assert.strictEqual(cacheService.get('catalog:test1'), undefined);
        assert.strictEqual(cacheService.get('catalog:test2'), undefined);
        assert.strictEqual(cacheService.get('offering:test3'), 'value3');
    });

    test('should handle metadata storage', () => {
        const metadata = { timestamp: new Date().toISOString(), version: '1.0.0' };
        cacheService.set('metadata-test', 'value', metadata);

        const stats = cacheService.getStats();
        assert.strictEqual(stats.totalSize, 1);
        assert.strictEqual(stats.activeEntries, 1);
    });
});
