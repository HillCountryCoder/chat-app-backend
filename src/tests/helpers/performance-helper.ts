// src/tests/helpers/performance-helper.ts

export interface PerformanceThresholds {
  target: number;
  warning: number;
  critical: number;
}

export interface BenchmarkResult {
  avg: number;
  min: number;
  max: number;
  times: number[];
  p95: number;
  p99: number;
  stdDev: number;
}

export class PerformanceTestHelper {
  /**
   * Measure execution time of an async function
   */
  static async measureTime<T>(
    fn: () => Promise<T>,
  ): Promise<{ result: T; duration: number }> {
    const startTime = performance.now();
    const result = await fn();
    const duration = Math.round(performance.now() - startTime);

    return { result, duration };
  }

  /**
   * Run performance benchmark with multiple iterations and detailed statistics
   */
  static async benchmark(
    name: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fn: () => Promise<any>,
    iterations: number = 10,
  ): Promise<BenchmarkResult> {
    const times: number[] = [];

    console.log(`🏃‍♂️ Running ${name} benchmark (${iterations} iterations)...`);

    // Warm-up run (not counted)
    await fn();

    for (let i = 0; i < iterations; i++) {
      const { duration } = await this.measureTime(fn);
      times.push(duration);

      // Small delay between iterations to avoid overwhelming the system
      if (i < iterations - 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    const avg = times.reduce((sum, time) => sum + time, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);

    // Calculate percentiles
    const sortedTimes = [...times].sort((a, b) => a - b);
    const p95Index = Math.floor(0.95 * sortedTimes.length);
    const p99Index = Math.floor(0.99 * sortedTimes.length);
    const p95 = sortedTimes[p95Index];
    const p99 = sortedTimes[p99Index];

    // Calculate standard deviation
    const stdDev = Math.sqrt(
      times.reduce((sum, time) => sum + Math.pow(time - avg, 2), 0) /
        times.length,
    );

    console.log(`📊 ${name} Results:`);
    console.log(`   Average: ${avg.toFixed(2)}ms`);
    console.log(`   Min: ${min}ms, Max: ${max}ms`);
    console.log(`   P95: ${p95}ms, P99: ${p99}ms`);
    console.log(`   Std Dev: ${stdDev.toFixed(2)}ms`);

    return { avg, min, max, times, p95, p99, stdDev };
  }

  /**
   * Assert performance requirements with flexible thresholds
   */
  static assertPerformance(
    actualMs: number,
    maxMs: number,
    operation: string,
    options: {
      warningThreshold?: number;
      allowance?: number;
      networkDependent?: boolean;
    } = {},
  ) {
    const {
      warningThreshold = maxMs * 0.8,
      allowance = 0,
      networkDependent = false,
    } = options;

    const effectiveMax = maxMs + allowance;

    if (actualMs > effectiveMax) {
      const message = `Performance assertion failed: ${operation} took ${actualMs}ms, expected < ${effectiveMax}ms`;

      if (networkDependent) {
        console.warn(`⚠️ ${message} (network-dependent operation)`);
        // For network-dependent operations, log warning but don't fail
        return;
      }

      throw new Error(message);
    }

    if (actualMs > warningThreshold) {
      console.warn(
        `⚠️ Performance warning: ${operation} took ${actualMs}ms (warning threshold: ${warningThreshold}ms)`,
      );
    }

    console.log(
      `✅ Performance OK: ${operation} took ${actualMs}ms (< ${effectiveMax}ms)`,
    );
  }

  /**
   * Assert benchmark results against thresholds
   */
  static assertBenchmarkPerformance(
    result: BenchmarkResult,
    thresholds: PerformanceThresholds,
    operation: string,
  ) {
    const { avg, p95, p99 } = result;
    const { target, warning, critical } = thresholds;

    // Check average against target
    if (avg <= target) {
      console.log(
        `✅ ${operation} average (${avg.toFixed(
          2,
        )}ms) meets target (${target}ms)`,
      );
    } else if (avg <= warning) {
      console.warn(
        `⚠️ ${operation} average (${avg.toFixed(
          2,
        )}ms) exceeds target but within warning (${warning}ms)`,
      );
    } else if (avg <= critical) {
      console.error(
        `❌ ${operation} average (${avg.toFixed(
          2,
        )}ms) exceeds warning threshold (${warning}ms)`,
      );
    } else {
      throw new Error(
        `Performance critical: ${operation} average (${avg.toFixed(
          2,
        )}ms) exceeds critical threshold (${critical}ms)`,
      );
    }

    // Check P95 against warning threshold
    if (p95 > warning) {
      console.warn(
        `⚠️ ${operation} P95 (${p95}ms) exceeds warning threshold (${warning}ms)`,
      );
    }

    // Check P99 against critical threshold
    if (p99 > critical) {
      console.error(
        `❌ ${operation} P99 (${p99}ms) exceeds critical threshold (${critical}ms)`,
      );
    }
  }

  /**
   * Create performance thresholds based on operation type
   */
  static createThresholds(
    target: number,
    multiplier: { warning: number; critical: number } = {
      warning: 2,
      critical: 4,
    },
  ): PerformanceThresholds {
    return {
      target,
      warning: target * multiplier.warning,
      critical: target * multiplier.critical,
    };
  }

  /**
   * Monitor system resources during test execution
   */
  static async monitorResources<T>(
    name: string,
    fn: () => Promise<T>,
  ): Promise<{
    result: T;
    resourceUsage: NodeJS.MemoryUsage & { duration: number };
  }> {
    const initialMemory = process.memoryUsage();
    const startTime = performance.now();

    const result = await fn();

    const duration = Math.round(performance.now() - startTime);
    const finalMemory = process.memoryUsage();

    const resourceUsage = {
      rss: finalMemory.rss - initialMemory.rss,
      heapTotal: finalMemory.heapTotal - initialMemory.heapTotal,
      heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
      external: finalMemory.external - initialMemory.external,
      arrayBuffers: finalMemory.arrayBuffers - initialMemory.arrayBuffers,
      duration,
    };

    console.log(`🔍 ${name} Resource Usage:`);
    console.log(`   Duration: ${duration}ms`);
    console.log(
      `   Heap Used: ${(resourceUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
    );
    console.log(`   RSS: ${(resourceUsage.rss / 1024 / 1024).toFixed(2)}MB`);

    return { result, resourceUsage };
  }

  /**
   * Test concurrent operations with controlled load
   */
  static async testConcurrentLoad<T>(
    name: string,
    operation: () => Promise<T>,
    concurrency: number,
    totalOperations: number,
  ): Promise<{
    results: T[];
    duration: number;
    operationsPerSecond: number;
    errors: Error[];
  }> {
    console.log(
      `🚀 Testing ${name} with ${concurrency} concurrent operations (${totalOperations} total)`,
    );

    const startTime = performance.now();
    const results: T[] = [];
    const errors: Error[] = [];
    let completed = 0;

    // Create a queue of operations
    const operations = Array(totalOperations)
      .fill(null)
      .map(() => operation);

    // Process operations with controlled concurrency
    const processBatch = async () => {
      const batch = operations.splice(0, concurrency);
      if (batch.length === 0) return;

      const batchPromises = batch.map(async (op) => {
        try {
          const result = await op();
          results.push(result);
          completed++;
        } catch (error) {
          errors.push(error as Error);
          completed++;
        }
      });

      await Promise.all(batchPromises);

      // Log progress
      if (completed % Math.max(1, Math.floor(totalOperations / 10)) === 0) {
        console.log(
          `   Progress: ${completed}/${totalOperations} (${Math.round(
            (completed / totalOperations) * 100,
          )}%)`,
        );
      }

      // Process next batch
      if (operations.length > 0) {
        await processBatch();
      }
    };

    await processBatch();

    const duration = Math.round(performance.now() - startTime);
    const operationsPerSecond = Math.round((totalOperations / duration) * 1000);

    console.log(`📈 ${name} Concurrent Load Results:`);
    console.log(`   Total Duration: ${duration}ms`);
    console.log(`   Operations/Second: ${operationsPerSecond}`);
    console.log(
      `   Success Rate: ${Math.round(
        (results.length / totalOperations) * 100,
      )}%`,
    );
    console.log(`   Errors: ${errors.length}`);

    return {
      results,
      duration,
      operationsPerSecond,
      errors,
    };
  }

  /**
   * Validate that performance doesn't degrade over time
   */
  static validatePerformanceStability(
    times: number[],
    maxDegradation: number = 0.5, // 50% degradation threshold
  ): boolean {
    if (times.length < 10) {
      console.warn("Not enough data points to validate performance stability");
      return true;
    }

    // Split into early and late periods
    const splitPoint = Math.floor(times.length / 2);
    const earlyTimes = times.slice(0, splitPoint);
    const lateTimes = times.slice(splitPoint);

    const earlyAvg =
      earlyTimes.reduce((sum, time) => sum + time, 0) / earlyTimes.length;
    const lateAvg =
      lateTimes.reduce((sum, time) => sum + time, 0) / lateTimes.length;

    const degradation = (lateAvg - earlyAvg) / earlyAvg;

    console.log(`📊 Performance Stability Analysis:`);
    console.log(`   Early Average: ${earlyAvg.toFixed(2)}ms`);
    console.log(`   Late Average: ${lateAvg.toFixed(2)}ms`);
    console.log(`   Degradation: ${(degradation * 100).toFixed(2)}%`);

    if (degradation > maxDegradation) {
      console.error(
        `❌ Performance degraded by ${(degradation * 100).toFixed(
          2,
        )}% (threshold: ${maxDegradation * 100}%)`,
      );
      return false;
    }

    console.log(
      `✅ Performance stable (degradation: ${(degradation * 100).toFixed(2)}%)`,
    );
    return true;
  }

  /**
   * Generate performance report
   */
  static generateReport(
    testName: string,
    results: Array<{
      operation: string;
      benchmark: BenchmarkResult;
      thresholds: PerformanceThresholds;
      passed: boolean;
    }>,
  ): string {
    const report = [
      `\n📊 Performance Test Report: ${testName}`,
      `Generated: ${new Date().toISOString()}`,
      `${"=".repeat(60)}`,
    ];

    let totalPassed = 0;
    const totalTests = results.length;

    results.forEach(({ operation, benchmark, thresholds, passed }) => {
      if (passed) totalPassed++;

      report.push(
        `\n${passed ? "✅" : "❌"} ${operation}`,
        `   Average: ${benchmark.avg.toFixed(2)}ms (target: ${
          thresholds.target
        }ms)`,
        `   P95: ${benchmark.p95}ms, P99: ${benchmark.p99}ms`,
        `   Range: ${benchmark.min}ms - ${benchmark.max}ms`,
        `   Std Dev: ${benchmark.stdDev.toFixed(2)}ms`,
      );
    });

    report.push(
      `\n${"=".repeat(60)}`,
      `Summary: ${totalPassed}/${totalTests} tests passed (${Math.round(
        (totalPassed / totalTests) * 100,
      )}%)`,
    );

    const reportString = report.join("\n");
    console.log(reportString);
    return reportString;
  }
}
