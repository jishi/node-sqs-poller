export function backoff(
    baseBackoffSeconds: number,
    receiveCount: number,
    backoffMultipliers: number[],
    maxBackoffSeconds: number): number {
  const endIndex = Math.min(receiveCount, backoffMultipliers.length);
  const backoffSeconds = backoffMultipliers
      .slice(0, endIndex)
      .reduce((acc, multiplier) => acc * multiplier, baseBackoffSeconds);
  return Math.min(backoffSeconds, maxBackoffSeconds);
}
