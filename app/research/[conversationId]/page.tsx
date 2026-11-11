import Thread from '../_components/Thread';
import { researchSendEnabled, researchWritesEnabled } from '@/lib/research/config';
import { researchTestOnly } from '@/lib/research/send-policy';
export default async function ConversationPage({params}:{params:Promise<{conversationId:string}>}){return <Thread id={(await params).conversationId} canSend={researchSendEnabled()&&!researchTestOnly()} canSave={researchWritesEnabled()}/>;}
