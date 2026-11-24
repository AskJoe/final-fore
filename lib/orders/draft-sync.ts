export type DraftSyncStatus = { phase: 'saved' | 'pending' | 'saving' | 'error'; error?: string };

/** One writer per editor. Acknowledging an old request never acknowledges newer typing. */
export class DraftSync<Value, Result> {
  private current: Value;
  private acknowledged: string;
  private result?: Result;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<Result | undefined>;
  private disposed = false;
  private unresolved?: {value:Value;fingerprint:string};
  status: DraftSyncStatus = {phase:'saved'};

  constructor(private options: {
    initial: Value; delay?: number; save: (value: Value) => Promise<Result>;
    changed?: (status: DraftSyncStatus) => void;
    accepted?: (value: Value, result: Result, latest: boolean) => void;
  }) {
    this.current=options.initial;
    this.acknowledged=JSON.stringify(options.initial);
  }

  get dirty() { return !!this.unresolved || JSON.stringify(this.current)!==this.acknowledged; }

  private report(status: DraftSyncStatus) {
    this.status=status;
    if (!this.disposed) this.options.changed?.(status);
  }

  set(value: Value) {
    this.current=value;
    clearTimeout(this.timer);
    if (this.disposed) return;
    if (!this.dirty) { if (!this.running) this.report({phase:'saved'}); return; }
    // A failed request requires explicit Retry; typing must not turn a conflict into a retry loop.
    if (this.status.phase==='error') return;
    this.report({phase:this.running?'saving':'pending'});
    this.timer=setTimeout(()=>{ void this.flush().catch(()=>{}); },this.options.delay??750);
  }

  flush(ensure = false): Promise<Result | undefined> {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    if (!this.dirty && (!ensure || this.result!==undefined)) return Promise.resolve(this.result);
    this.report({phase:'saving'});
    this.running=this.drain(ensure).finally(()=>{ this.running=undefined; });
    return this.running;
  }

  private async drain(ensure: boolean) {
    try {
      do {
        const {value,fingerprint}=this.unresolved??{value:this.current,fingerprint:JSON.stringify(this.current)};
        this.unresolved={value,fingerprint};
        const result=await this.options.save(value);
        this.acknowledged=fingerprint;
        this.unresolved=undefined;
        this.result=result;
        this.options.accepted?.(value,result,!this.dirty);
        ensure=false;
      } while (!this.disposed && (this.dirty || ensure));
      this.report({phase:this.dirty?'pending':'saved'});
      return this.result;
    } catch (error) {
      this.report({phase:'error',error:error instanceof Error?error.message:'Could not save your draft.'});
      throw error;
    }
  }

  dispose() { this.disposed=true; clearTimeout(this.timer); }
}
