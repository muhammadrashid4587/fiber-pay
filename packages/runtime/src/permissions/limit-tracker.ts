import type { PermissionStorage } from './storage.js';
import type { PermissionUsageDaily, PermissionUsageHourly } from './types.js';

/**
 * Tracks and enforces usage limits for permission grants.
 * Handles daily and hourly limits with automatic midnight UTC reset.
 */
export class LimitTracker {
  private readonly storage: PermissionStorage;
  private lastResetDate: string;

  /**
   * Creates a new LimitTracker instance
   * @param storage - PermissionStorage instance for database operations
   */
  constructor(storage: PermissionStorage) {
    this.storage = storage;
    this.lastResetDate = this.getCurrentUTCDate();
  }

  /**
   * Checks if a payment is allowed based on grant limits
   * @param grantId - Grant ID
   * @param amount - Payment amount in shannons
   * @returns Object with allowed boolean and optional reason string
   */
  async checkPaymentAllowed(
    grantId: string,
    amount: bigint,
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Check if reset is needed first
    await this.resetIfNeeded();

    const grant = this.storage.getGrantById(grantId);
    if (!grant) {
      return { allowed: false, reason: 'Grant not found' };
    }

    if (grant.status !== 'active') {
      return { allowed: false, reason: `Grant is ${grant.status}` };
    }

    // Check per-payment limit
    if (grant.per_payment_limit !== undefined && amount > grant.per_payment_limit) {
      return {
        allowed: false,
        reason: `Payment amount ${amount} exceeds per-payment limit ${grant.per_payment_limit}`,
      };
    }

    const now = new Date();
    const dateStr = this.formatDate(now);
    const hourStr = this.formatHour(now);

    // Get current usage
    const dailyUsage = this.storage.getDailyUsage(grantId, dateStr);
    const hourlyUsage = this.storage.getHourlyUsage(grantId, hourStr);

    // Check daily amount limit
    if (grant.daily_payment_limit !== undefined) {
      const newDailyAmount = dailyUsage.amount_paid + amount;
      if (newDailyAmount > grant.daily_payment_limit) {
        return {
          allowed: false,
          reason: `Daily amount limit exceeded: ${newDailyAmount} > ${grant.daily_payment_limit}`,
        };
      }
    }

    // Check daily count limit
    if (grant.daily_count_limit !== undefined) {
      const newDailyCount = dailyUsage.payments_count + 1;
      if (newDailyCount > grant.daily_count_limit) {
        return {
          allowed: false,
          reason: `Daily count limit exceeded: ${newDailyCount} > ${grant.daily_count_limit}`,
        };
      }
    }

    // Check hourly count limit
    if (grant.hourly_count_limit !== undefined) {
      const newHourlyCount = hourlyUsage.payments_count + 1;
      if (newHourlyCount > grant.hourly_count_limit) {
        return {
          allowed: false,
          reason: `Hourly count limit exceeded: ${newHourlyCount} > ${grant.hourly_count_limit}`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Records a payment usage for a grant
   * Updates daily and hourly usage tables, as well as grant totals
   * @param grantId - Grant ID
   * @param amount - Payment amount in shannons
   */
  async recordPayment(grantId: string, amount: bigint): Promise<void> {
    // Check if reset is needed first
    await this.resetIfNeeded();

    // Use storage's recordPaymentUsage which handles the transaction
    this.storage.recordPaymentUsage(grantId, amount);
  }

  /**
   * Gets daily usage for a grant on a specific date
   * @param grantId - Grant ID
   * @param date - Date in YYYY-MM-DD format
   * @returns Daily usage record
   */
  async getDailyUsage(grantId: string, date: string): Promise<PermissionUsageDaily> {
    return this.storage.getDailyUsage(grantId, date);
  }

  /**
   * Gets hourly usage for a grant in a specific hour
   * @param grantId - Grant ID
   * @param hour - Hour in YYYY-MM-DD-HH format
   * @returns Hourly usage record
   */
  async getHourlyUsage(grantId: string, hour: string): Promise<PermissionUsageHourly> {
    return this.storage.getHourlyUsage(grantId, hour);
  }

  /**
   * Checks if daily reset is needed and updates internal tracking.
   * Daily reset occurs at midnight UTC.
   * This method compares the current UTC date with the last recorded date
   * and resets counters if they differ.
   */
  async resetIfNeeded(): Promise<void> {
    const currentDate = this.getCurrentUTCDate();
    if (currentDate !== this.lastResetDate) {
      // Date has changed, reset tracking
      this.lastResetDate = currentDate;
    }
  }

  /**
   * Gets the current UTC date in YYYY-MM-DD format
   */
  private getCurrentUTCDate(): string {
    return this.formatDate(new Date());
  }

  /**
   * Formats a date as YYYY-MM-DD in UTC
   */
  private formatDate(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Formats a date hour as YYYY-MM-DD-HH in UTC
   */
  private formatHour(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    return `${year}-${month}-${day}-${hour}`;
  }
}
