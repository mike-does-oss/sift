import { describe, it, expect } from "vitest";
import { createPullProgressTracker } from "../pull-progress";

describe("createPullProgressTracker", () => {
  it("is indeterminate until a layer reports a total", () => {
    const tracker = createPullProgressTracker();
    expect(tracker.update({ status: "pulling manifest" })).toEqual({
      status: "pulling manifest",
      percent: null,
    });
  });

  it("computes percent from a single layer's completed/total", () => {
    const tracker = createPullProgressTracker();
    tracker.update({ status: "pulling manifest" });
    const { percent } = tracker.update({
      status: "pulling abc",
      digest: "sha256:abc",
      total: 100,
      completed: 25,
    });
    expect(percent).toBe(25);
  });

  it("sums completed/total across multiple layers instead of resetting per layer", () => {
    const tracker = createPullProgressTracker();
    tracker.update({ status: "pulling abc", digest: "sha256:abc", total: 100, completed: 100 });
    // Ollama restarts the counter at 0 for the next layer — a naive
    // "latest line" percent would drop back to 0% here.
    const { percent } = tracker.update({ status: "pulling def", digest: "sha256:def", total: 100, completed: 50 });
    expect(percent).toBe(75); // (100 + 50) / (100 + 100)
  });

  it("updates the running total for a digest as more lines arrive for it", () => {
    const tracker = createPullProgressTracker();
    tracker.update({ status: "pulling abc", digest: "sha256:abc", total: 200, completed: 50 });
    const { percent } = tracker.update({ status: "pulling abc", digest: "sha256:abc", total: 200, completed: 150 });
    expect(percent).toBe(75);
  });

  it("caps percent at 100 and passes the status text through unchanged", () => {
    const tracker = createPullProgressTracker();
    const { status, percent } = tracker.update({
      status: "verifying sha256 digest",
      digest: "sha256:abc",
      total: 100,
      completed: 100,
    });
    expect(status).toBe("verifying sha256 digest");
    expect(percent).toBe(100);
  });
});
