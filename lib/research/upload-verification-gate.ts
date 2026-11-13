/** No in-memory waiting queue: excess work stays in the existing database file/job rows. */
export class UploadVerificationGate {
  private active = new Set<string>();
  constructor(private readonly limit = 2) {}
  canStart(key: string) { return !this.active.has(key) && this.active.size < this.limit; }

  async run(key: string, work: () => Promise<void>): Promise<boolean> {
    if (!this.canStart(key)) return false;
    this.active.add(key);
    try {
      await work();
      return true;
    } finally {
      this.active.delete(key);
    }
  }
}

// Share across route bundles/client instances in one Node process. This is not a distributed lease.
const processState = globalThis as typeof globalThis & { finalForeUploadVerification?: UploadVerificationGate };
export const uploadVerificationGate = processState.finalForeUploadVerification ??= new UploadVerificationGate();
