export type Media = 'broadcast-radio' | 'broadcast-tv';
export type MarketRef = { marketId: string | null; displayName: string };
export type TemplateDraft = {
  id: string; name: string; clientId: string; campaignKey: string; media: Media;
  scope: 'single' | 'multi'; subject: string; body: string; revision: number;
  status: 'draft' | 'published'; markets: MarketRef[]; defaults: Record<string,string>; sourceHash: string;
};
export type TemplateVersion = Omit<TemplateDraft,'markets'|'status'> & {
  versionId: string; version: number; status: 'published'; markets: { marketId: string; displayName: string }[];
};
export type ValidationIssue = { code: string; message: string; marketName?: string };
export type Eligibility = { templateId: string; confirmed: boolean; reason: string; canEditCoverage: boolean };
export type Selection = { repId: string; templateId: string };
export type Recipient = Selection & { firmId: string; name: string; firmName: string; to: string; cc: string[] };
export type RenderedEmail = { subject: string; text: string; html: string; renderHash: string; missing: string[] };
export type PreviewInput = { templateId: string; repId: string; deadline: string };
export type BatchDelivery = {
  conversationId: string;
  recipient: string;
  cc: string[];
  state: 'queued' | 'sending' | 'retry' | 'uncertain' | 'sent' | 'delivered' | 'bounced' | 'failed' | 'needs-review';
  error: string | null;
};
