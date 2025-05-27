export class PerformanceTestHelper {
  /**
   * Measure execution time of an async function
   */
  static async measureTime<T>(
    fn: () => Promise<T>,
  ): Promise<{ result: T; duration: number }> {
    const startTime = Date.now();
    const result = await fn();
    const duration = Date.now() - startTime;

    return { result, duration };
  }

  /**
   * Run performance benchmark with multiple iterations
   */
  static async benchmark(
    name: string,
    fn: () => Promise<any>,
    iterations: number = 10,
  ) {
    const times: number[] = [];

    console.log(`🏃‍♂️ Running ${name} benchmark (${iterations} iterations)...`);

    for (let i = 0; i < iterations; i++) {
      const { duration } = await this.measureTime(fn);
      times.push(duration);
    }

    const avg = times.reduce((sum, time) => sum + time, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);

    console.log(`📊 ${name} Results:`);
    console.log(`   Average: ${avg.toFixed(2)}ms`);
    console.log(`   Min: ${min}ms`);
    console.log(`   Max: ${max}ms`);

    return { avg, min, max, times };
  }

  /**
   * Assert performance requirements
   */
  static assertPerformance(actualMs: number, maxMs: number, operation: string) {
    if (actualMs > maxMs) {
      throw new Error(
        `Performance assertion failed: ${operation} took ${actualMs}ms, expected < ${maxMs}ms`,
      );
    }
    console.log(
      `✅ Performance OK: ${operation} took ${actualMs}ms (< ${maxMs}ms)`,
    );
  }
}
