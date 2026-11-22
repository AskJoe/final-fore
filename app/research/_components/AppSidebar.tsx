import { legacyAsset } from '@/lib/legacy-pages';
import { ordersNavigation } from '@/lib/orders/access';

/** Use the same navigation markup and responsive sizing as the existing app. */
export default async function AppSidebar({current='research', ordersPilot=false}: {current?:'research'|'orders';ordersPilot?:boolean} = {}){
  const {content}=await legacyAsset('campaign.html');
  const styles=content.match(/<style id="workbook-navigation-styles">([\s\S]*?)<\/style>/)?.[1];
  const footer=content.match(/<footer>([\s\S]*?)<\/footer>/)?.[1];
  if(!styles||!footer)throw new Error('The shared application navigation is missing.');
  const navigation=ordersNavigation(footer,ordersPilot).replace(/ aria-current="page"/g,'')
    .replace(current==='orders'?'data-tab="orders"':'href="/research/new"',
      current==='orders'?'data-tab="orders" aria-current="page"':'href="/research/new" aria-current="page"')
    .replace(/<div class="workbook-status">[\s\S]*?<\/div>/,'');
  return <><style dangerouslySetInnerHTML={{__html:styles}}/><footer dangerouslySetInnerHTML={{__html:navigation}}/></>;
}
