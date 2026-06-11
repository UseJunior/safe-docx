/** Options and result types for {@link convertDocxToOdt}, plus the lossiness collector. */

export interface ConvertDocxToOdtOptions {
  metadata?: { title?: string; generator?: string };
}

/** One downgraded construct class and how often it was hit. */
export interface LossinessEntry {
  construct: string;
  count: number;
  detail?: string;
}

export interface ConvertDocxToOdtResult {
  odt: Buffer;
  lossiness: LossinessEntry[];
}

/**
 * Accumulates downgraded constructs during a conversion. Conversion is intentionally lossy,
 * but every drop must be reported — `detail` keeps the first concrete example per construct.
 */
export class LossinessCollector {
  private entries = new Map<string, { count: number; detail?: string }>();

  add(construct: string, detail?: string): void {
    const existing = this.entries.get(construct);
    if (existing) {
      existing.count += 1;
    } else {
      this.entries.set(construct, { count: 1, detail });
    }
  }

  toArray(): LossinessEntry[] {
    return Array.from(this.entries.entries(), ([construct, { count, detail }]) => ({
      construct,
      count,
      ...(detail !== undefined ? { detail } : {}),
    }));
  }
}
