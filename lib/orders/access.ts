import type { User } from '@supabase/supabase-js';
import { AccessError, requireMember } from '../access';

export function ordersPilot(user: Pick<User, 'id'>) {
  return process.env.FINAL_FORE_ORDERS_ENABLED === '1' &&
    (process.env.FINAL_FORE_ORDERS_PILOT_USER_IDS ?? '').split(',').map(id => id.trim()).includes(user.id);
}

export async function requireOrdersMember() {
  const member = await requireMember();
  if (!ordersPilot(member.user)) throw new AccessError('The new Orders workspace is available to the pilot staff.', 403);
  return member;
}

export function ordersNavigation(html: string, pilot: boolean) {
  return pilot ? html.replace('href="/orders.html" data-tab="orders"', 'href="/orders" data-tab="orders"') : html;
}
