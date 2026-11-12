import { describe, expect, it } from "vitest";
import { notificationDurations } from "@/lib/notifications";

describe("notification durations", () => {
  it("uses standard dismiss durations for transient notifications", () => {
    expect(notificationDurations.success).toBe(3000);
    expect(notificationDurations.info).toBe(4000);
    expect(notificationDurations.warning).toBe(5000);
    expect(notificationDurations.error).toBe(5000);
  });
});
